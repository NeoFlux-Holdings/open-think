/**
 * Email plugin — native Cloudflare Email Workers.
 *
 * Outbound: uses the `send_email` binding (`env.SEB.send(EmailMessage)`) built
 * from a `mimetext` MIME document. Email Routing must be active on the sender
 * domain, and the recipient must be a verified destination (or the binding
 * must omit `destination_address` to allow any-verified).
 *
 * Inbound (receive side): handled by the top-level `email()` Worker handler in
 * `src/emailHandler.ts`. Inbound mail is parsed with `postal-mime` and either
 * forwarded, saved to memory, or both.
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
 */

import { EmailMessage } from "cloudflare:email";
// Use the browser build — the default "mimetext" entry resolves to
// dist/mimetext.node.es.js which imports `node:os` for `EOL`. Workers
// can't load `node:os` even with nodejs_compat_v2, so the deploy fails
// validation. The browser build hardcodes EOL = "\r\n" instead.
import { createMimeMessage } from "mimetext/browser";
import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";

interface EmailDraft {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

function buildMime(draft: EmailDraft, defaultFrom: string): { from: string; to: string; raw: string } {
  const from = draft.from ?? defaultFrom;
  const to = Array.isArray(draft.to) ? draft.to[0] : draft.to;
  if (!to) throw new Error("draft.to required");
  if (!draft.subject) throw new Error("draft.subject required");
  if (!draft.text && !draft.html) throw new Error("draft.text or draft.html required");

  const msg = createMimeMessage();
  msg.setSender({ addr: from });
  msg.setRecipient(to);
  msg.setSubject(draft.subject);
  if (draft.replyTo) msg.setHeader("Reply-To", draft.replyTo);
  msg.setHeader("X-Open-Think", "helm");

  if (draft.text) {
    msg.addMessage({ contentType: "text/plain", data: draft.text });
  }
  if (draft.html) {
    msg.addMessage({ contentType: "text/html", data: draft.html });
  }
  return { from, to, raw: msg.asRaw() };
}

export class EmailPlugin implements AgentPlugin {
  readonly id = "email";
  readonly version = "0.1.0";
  readonly description = "Send + receive email via Cloudflare Email Workers (send_email binding + Email Routing)";
  readonly capabilities = ["connectors", "tools"] as const;

  private env?: Env;

  async initialize(context: PluginContext): Promise<void> {
    this.env = context.env;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.env) return { ok: false, error: "Plugin not initialized" };
    const inObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

    switch (action) {
      case "email-draft": {
        // Dry-run: builds the MIME envelope, returns it without sending. Useful
        // for selective-mode approval — Helm renders the draft as an exhibit,
        // user taps Execute to actually send.
        const draft = this.readDraft(inObj);
        if (!draft) return { ok: false, error: "to, subject, and text|html required" };
        try {
          const built = buildMime(draft, this.defaultFrom());
          return {
            ok: true,
            data: {
              action: "draft",
              from: built.from,
              to: built.to,
              subject: draft.subject,
              preview: (draft.text ?? draft.html ?? "").slice(0, 200),
              sizeBytes: built.raw.length
            }
          };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }

      case "email-send": {
        if (!this.env.SEB) {
          return {
            ok: false,
            error: "SEB binding missing — add [[send_email]] name=\"SEB\" to wrangler.toml and redeploy."
          };
        }
        const draft = this.readDraft(inObj);
        if (!draft) return { ok: false, error: "to, subject, and text|html required" };
        try {
          const built = buildMime(draft, this.defaultFrom());
          const message = new EmailMessage(built.from, built.to, built.raw);
          await this.env.SEB.send(message);
          return {
            ok: true,
            data: { sentTo: built.to, from: built.from, subject: draft.subject, bytes: built.raw.length }
          };
        } catch (err) {
          const msg = (err as Error).message;
          // Common hints for the most common failures.
          let hint = "";
          if (/verified/i.test(msg)) hint = " — is the recipient verified in Email Routing?";
          if (/domain/i.test(msg)) hint = " — sender domain must have Email Routing active.";
          return { ok: false, error: `send failed: ${msg}${hint}` };
        }
      }

      case "email-inbox": {
        // List recent inbound messages that the inbound handler persisted to
        // the `inbound_email` D1 table. Requires the DB binding.
        if (!this.env.DB) {
          return { ok: false, error: "DB binding missing — needed to list inbound email." };
        }
        const limit = typeof inObj.limit === "number" ? Math.min(inObj.limit, 100) : 20;
        const since = typeof inObj.since === "string" ? inObj.since : null;
        await this.ensureInboxTable();
        const rs = since
          ? await this.env.DB
              .prepare(
                `SELECT id, from_addr as fromAddr, to_addr as toAddr, subject, preview, received_at as receivedAt, stored_raw as storedRaw
                   FROM inbound_email
                  WHERE received_at >= ?
                  ORDER BY received_at DESC
                  LIMIT ?`
              )
              .bind(since, limit)
              .all()
          : await this.env.DB
              .prepare(
                `SELECT id, from_addr as fromAddr, to_addr as toAddr, subject, preview, received_at as receivedAt, stored_raw as storedRaw
                   FROM inbound_email
                  ORDER BY received_at DESC
                  LIMIT ?`
              )
              .bind(limit)
              .all();
        return { ok: true, data: { count: rs.results?.length ?? 0, items: rs.results ?? [] } };
      }

      case "email-thread": {
        // Fetch a single inbound message + any replies we've sent in reply.
        if (!this.env.DB) return { ok: false, error: "DB binding missing" };
        const id = String(inObj.id ?? "");
        if (!id) return { ok: false, error: "input.id required" };
        await this.ensureInboxTable();
        const rs = await this.env.DB
          .prepare(
            `SELECT id, from_addr as fromAddr, to_addr as toAddr, subject, preview, received_at as receivedAt, stored_raw as storedRaw
               FROM inbound_email
              WHERE id = ?`
          )
          .bind(id)
          .first();
        if (!rs) return { ok: false, error: "not found" };
        return { ok: true, data: rs };
      }

      default:
        return { ok: false, error: `Unknown email action: ${action}` };
    }
  }

  private defaultFrom(): string {
    return (
      this.env?.FROM_EMAIL ||
      this.env?.OWNER_EMAIL ||
      this.env?.AGENT_OWNER_EMAIL ||
      "helm@localhost"
    );
  }

  private readDraft(inObj: Record<string, unknown>): EmailDraft | null {
    const to = inObj.to;
    const subject = inObj.subject;
    if (typeof subject !== "string" || subject.length === 0) return null;
    if (typeof to !== "string" && !Array.isArray(to)) return null;
    const text = typeof inObj.text === "string" ? inObj.text : undefined;
    const html = typeof inObj.html === "string" ? inObj.html : undefined;
    if (!text && !html) return null;
    return {
      to: to as string | string[],
      subject,
      text,
      html,
      from: typeof inObj.from === "string" ? inObj.from : undefined,
      replyTo: typeof inObj.replyTo === "string" ? inObj.replyTo : undefined
    };
  }

  private async ensureInboxTable(): Promise<void> {
    if (!this.env?.DB) return;
    await this.env.DB
      .prepare(
        `CREATE TABLE IF NOT EXISTS inbound_email (
          id TEXT PRIMARY KEY,
          from_addr TEXT NOT NULL,
          to_addr TEXT NOT NULL,
          subject TEXT,
          preview TEXT,
          stored_raw INTEGER NOT NULL DEFAULT 0,
          received_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      )
      .run();
  }
}
