/**
 * Inbound email handler — Cloudflare Email Routing → Worker.
 *
 * Register this Worker as a catch-all (or a specific address) destination in
 * Email Routing. Every inbound message arrives here as a `ForwardableEmailMessage`.
 * We parse it with `postal-mime`, persist a compact row in `inbound_email`
 * (D1), and either forward it onward or just stash it for Helm to read via
 * the `email-inbox` skill.
 *
 * Security:
 *   - Forwarding is only enabled when `INBOUND_FORWARD_TO` is set AND the
 *     destination is verified in Email Routing.
 *   - We never auto-reply to external senders from this handler (reply is
 *     always a human-approved action through Helm's selective mode).
 */

import PostalMime from "postal-mime";
import type { Env } from "./types";

interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  headers: Headers;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  setReject(reason: string): void;
  reply?(message: unknown): Promise<void>;
}

async function readRawToBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const raw = await readRawToBuffer(message.raw);
  const parsed = await PostalMime.parse(raw);

  const id = crypto.randomUUID();
  const from = parsed.from?.address ?? message.from;
  const to = parsed.to?.[0]?.address ?? message.to;
  const subject = parsed.subject ?? "";
  const preview = (parsed.text ?? parsed.html ?? "").replace(/\s+/g, " ").slice(0, 400);

  if (env.DB) {
    await env.DB
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
    await env.DB
      .prepare(
        `INSERT OR REPLACE INTO inbound_email (id, from_addr, to_addr, subject, preview, stored_raw, received_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(id, from, to, subject, preview, new Date().toISOString())
      .run();
  }

  // Persist the raw MIME to R2 if the binding exists — lets Helm show full
  // attachments / HTML later without bloating D1.
  if (env.WORKSPACE) {
    try {
      await env.WORKSPACE.put(`inbound/${id}.eml`, raw, {
        httpMetadata: { contentType: "message/rfc822" },
        customMetadata: { from, to, subject }
      });
    } catch (err) {
      console.error("[email-inbound] R2 put failed", (err as Error).message);
    }
  }

  // Best-effort forward to the owner if configured. Never blocks on failure.
  const forwardTo = (env as Env & { INBOUND_FORWARD_TO?: string }).INBOUND_FORWARD_TO;
  if (forwardTo) {
    ctx.waitUntil(
      message
        .forward(forwardTo)
        .catch((err) =>
          console.error("[email-inbound] forward failed:", (err as Error).message)
        )
    );
  }
}
