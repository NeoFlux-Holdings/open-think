/**
 * Notifier plugin — how the PA reaches you.
 *
 * Channels (first supported channel wins unless `channel` is explicit):
 *   1. `email`      — owner's email via `env.SEB.send()` (same binding as email plugin)
 *   2. `web-push`   — Web Push API; client subscriptions live in D1 table `push_subscriptions`
 *   3. `log`        — console + audit event; last-resort fallback
 *
 * Intentionally no SMS / Twilio / Pushover here — the brief said "native CF
 * solutions," and email + Web Push cover 95% of PA use cases.
 *
 * Every outbound notification is audit-logged to the `notifications` D1 table
 * so Helm can surface "here's what I pinged you about today" in the digest.
 */

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";
import { buildPushPayload, sendWebPushNotification } from "../webpush";

type Channel = "email" | "web-push" | "log";

async function ensureNotificationsTable(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        url TEXT,
        ok INTEGER NOT NULL,
        error TEXT,
        sent_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
}

async function recordNotification(
  env: Env,
  row: { id: string; channel: Channel; title?: string; body: string; url?: string; ok: boolean; error?: string }
): Promise<void> {
  if (!env.DB) return;
  await ensureNotificationsTable(env);
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO notifications (id, channel, title, body, url, ok, error, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.channel,
      row.title ?? null,
      row.body,
      row.url ?? null,
      row.ok ? 1 : 0,
      row.error ?? null,
      new Date().toISOString()
    )
    .run();
}

async function sendSelfEmail(
  env: Env,
  subject: string,
  body: string,
  url?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = env.OWNER_EMAIL ?? env.AGENT_OWNER_EMAIL;
  const from = env.FROM_EMAIL ?? env.OWNER_EMAIL ?? env.AGENT_OWNER_EMAIL;
  if (!env.SEB) return { ok: false, error: "SEB binding missing" };
  if (!to) return { ok: false, error: "OWNER_EMAIL not configured" };
  if (!from) return { ok: false, error: "FROM_EMAIL (or OWNER_EMAIL) not configured" };
  try {
    const msg = createMimeMessage();
    msg.setSender({ addr: from });
    msg.setRecipient(to);
    msg.setSubject(subject);
    msg.setHeader("X-Open-Think-Notifier", "true");
    const text = url ? `${body}\n\n${url}` : body;
    msg.addMessage({ contentType: "text/plain", data: text });
    await env.SEB.send(new EmailMessage(from, to, msg.asRaw()));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function ensurePushTable(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_email TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_email: string | null;
}

async function sendWebPush(
  env: Env,
  title: string,
  body: string,
  url?: string
): Promise<
  | { ok: true; sent: number; failed: number; pruned: number }
  | { ok: false; error: string }
> {
  if (!env.DB) return { ok: false, error: "DB binding missing (push subscription table)" };

  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject =
    env.VAPID_SUBJECT ?? (env.OWNER_EMAIL ? `mailto:${env.OWNER_EMAIL}` : undefined);
  if (!publicKey || !privateKey || !subject) {
    return {
      ok: false,
      error:
        "Web Push needs VAPID keys. Run `npm run vapid:generate`, then `wrangler secret put VAPID_PUBLIC_KEY`, `wrangler secret put VAPID_PRIVATE_KEY`, and set VAPID_SUBJECT (or OWNER_EMAIL)."
    };
  }

  await ensurePushTable(env);
  const rs = await env.DB
    .prepare(`SELECT endpoint, p256dh, auth, user_email FROM push_subscriptions`)
    .all<PushSubscriptionRow>();
  const rows = rs.results ?? [];
  if (rows.length === 0) {
    return { ok: false, error: "No push subscriptions registered. Visit /app and enable notifications." };
  }

  const payload = buildPushPayload({ title, body, url, icon: "/icon-192.png" });

  let sent = 0;
  let failed = 0;
  let pruned = 0;

  // Fan out sequentially — push services are already async; parallel fan-out
  // only helps at high volume and risks hitting per-endpoint rate limits.
  for (const row of rows) {
    const r = await sendWebPushNotification(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      payload,
      { publicKey, privateKey, subject },
      { ttl: 60 * 60 * 24, urgency: "normal" }
    );
    if (r.ok) {
      sent += 1;
    } else if (r.expired) {
      await env.DB
        .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
        .bind(row.endpoint)
        .run();
      pruned += 1;
    } else {
      failed += 1;
      console.warn(
        `[notifier/web-push] ${new URL(row.endpoint).host} status=${r.status} error=${r.error ?? "(none)"}`
      );
    }
  }

  if (sent === 0) {
    return {
      ok: false,
      error: `All ${rows.length} push targets failed (pruned ${pruned}, failed ${failed})`
    };
  }
  return { ok: true, sent, failed, pruned };
}

export class NotifierPlugin implements AgentPlugin {
  readonly id = "notifier";
  readonly version = "0.1.0";
  readonly description = "Reach the owner via email (self-notify) or Web Push";
  readonly capabilities = ["connectors", "tools"] as const;

  private env?: Env;

  async initialize(context: PluginContext): Promise<void> {
    this.env = context.env;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.env) return { ok: false, error: "Plugin not initialized" };
    const inObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

    switch (action) {
      case "notify-user": {
        const title = String(inObj.title ?? "Helm update");
        const body = String(inObj.body ?? "");
        const url = typeof inObj.url === "string" ? inObj.url : undefined;
        if (!body) return { ok: false, error: "input.body required" };
        const requested = (inObj.channel as Channel | undefined) ?? this.preferredChannel();
        const id = crypto.randomUUID();

        if (requested === "email") {
          const r = await sendSelfEmail(this.env, title, body, url);
          await recordNotification(this.env, { id, channel: "email", title, body, url, ok: r.ok, error: r.ok ? undefined : r.error });
          return r.ok ? { ok: true, data: { id, channel: "email" } } : { ok: false, error: r.error };
        }
        if (requested === "web-push") {
          const r = await sendWebPush(this.env, title, body, url);
          await recordNotification(this.env, {
            id,
            channel: "web-push",
            title,
            body,
            url,
            ok: r.ok,
            error: r.ok ? undefined : r.error
          });
          return r.ok
            ? {
                ok: true,
                data: {
                  id,
                  channel: "web-push",
                  sent: r.sent,
                  failed: r.failed,
                  pruned: r.pruned
                }
              }
            : { ok: false, error: r.error };
        }
        // log fallback
        console.log("[notifier/log]", title, body, url);
        await recordNotification(this.env, { id, channel: "log", title, body, url, ok: true });
        return { ok: true, data: { id, channel: "log" } };
      }

      case "notifier-list": {
        if (!this.env.DB) return { ok: false, error: "DB binding missing" };
        await ensureNotificationsTable(this.env);
        const limit = typeof inObj.limit === "number" ? Math.min(inObj.limit, 200) : 50;
        const rs = await this.env.DB
          .prepare(
            `SELECT id, channel, title, body, url, ok, error, sent_at as sentAt
               FROM notifications
              ORDER BY sent_at DESC
              LIMIT ?`
          )
          .bind(limit)
          .all();
        return { ok: true, data: { count: rs.results?.length ?? 0, items: rs.results ?? [] } };
      }

      case "notifier-subscribe-push": {
        // Client calls this to register a Web Push subscription.
        if (!this.env.DB) return { ok: false, error: "DB binding missing" };
        const endpoint = String(inObj.endpoint ?? "");
        const keys = inObj.keys as { p256dh?: string; auth?: string } | undefined;
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
          return { ok: false, error: "endpoint + keys.p256dh + keys.auth required" };
        }
        await ensurePushTable(this.env);
        await this.env.DB
          .prepare(
            `INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, user_email, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(endpoint, keys.p256dh, keys.auth, this.env.OWNER_EMAIL ?? null, new Date().toISOString())
          .run();
        return { ok: true, data: { registered: endpoint.slice(0, 40) + "…" } };
      }

      default:
        return { ok: false, error: `Unknown notifier action: ${action}` };
    }
  }

  private preferredChannel(): Channel {
    if (this.env?.SEB && (this.env.OWNER_EMAIL || this.env.AGENT_OWNER_EMAIL)) return "email";
    return "log";
  }
}
