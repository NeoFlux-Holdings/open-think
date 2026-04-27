/**
 * Notifier plugin — Web Push path integration test.
 *
 * We wire a fake D1 (push_subscriptions + notifications) and a stubbed global
 * fetch that returns 201 for the "live" endpoint and 410 for the "dead" one.
 * After a single `notify-user` call we assert:
 *   - the live subscription receives a VAPID-signed POST
 *   - the dead subscription is pruned from the table (410 = gone)
 *   - the plugin result summarises { sent, failed, pruned }
 *   - a row is appended to the `notifications` audit log
 */
import { describe, expect, it, vi } from "vitest";
import { NotifierPlugin } from "../src/plugins/notifier";
import {
  base64UrlDecode,
  base64UrlEncode,
  generateVapidKeys
} from "../src/webpush";
import type { Env } from "../src/types";

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_email: string | null;
  created_at: string;
}

interface NotificationRow {
  id: string;
  channel: string;
  title: string | null;
  body: string;
  url: string | null;
  ok: number;
  error: string | null;
  sent_at: string;
}

async function makeSubscription(endpoint: string): Promise<SubscriptionRow> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const x = base64UrlDecode(jwk.x!);
  const y = base64UrlDecode(jwk.y!);
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return {
    endpoint,
    p256dh: base64UrlEncode(raw),
    auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
    user_email: null,
    created_at: new Date().toISOString()
  };
}

function fakeDb(initial: SubscriptionRow[]): {
  db: D1Database;
  notifications: NotificationRow[];
  subs: SubscriptionRow[];
} {
  const notifications: NotificationRow[] = [];
  const subs = [...initial];
  const db = {
    prepare(sql: string) {
      return {
        _sql: sql,
        _binds: [] as unknown[],
        bind(...args: unknown[]) {
          this._binds = args;
          return this;
        },
        async run() {
          if (/DELETE FROM push_subscriptions WHERE endpoint = \?/i.test(this._sql)) {
            const [ep] = this._binds as [string];
            const i = subs.findIndex((s) => s.endpoint === ep);
            if (i >= 0) subs.splice(i, 1);
          }
          if (/INSERT OR REPLACE INTO notifications/i.test(this._sql)) {
            const [id, channel, title, body, url, ok, error, sent_at] = this._binds as [
              string, string, string | null, string, string | null, number, string | null, string
            ];
            notifications.push({ id, channel, title, body, url, ok, error, sent_at });
          }
          return { meta: { changes: 0 } };
        },
        async all<T = unknown>() {
          if (/FROM push_subscriptions/i.test(this._sql)) {
            return { results: subs as unknown as T[] };
          }
          return { results: [] as T[] };
        }
      };
    }
  } as unknown as D1Database;
  return { db, notifications, subs };
}

async function initNotifier(env: Env): Promise<NotifierPlugin> {
  const p = new NotifierPlugin();
  await p.initialize({
    config: {
      enabledPlugins: new Set(["notifier"]),
      allowedHosts: new Set(),
      modelDefault: "x",
      alertErrorRatePct: 5
    },
    fetch: globalThis.fetch,
    env
  });
  return p;
}

describe("notifier → web-push integration", () => {
  it("fans out to live subscriptions, prunes dead ones, and records an audit row", async () => {
    const vapid = await generateVapidKeys();
    const live = await makeSubscription("https://push.example.com/live-endpoint");
    const dead = await makeSubscription("https://push.example.com/dead-endpoint");
    const { db, notifications, subs } = fakeDb([live, dead]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (async (url: RequestInfo) => {
        const target = typeof url === "string" ? url : (url as Request).url;
        if (target.includes("live-endpoint")) return new Response(null, { status: 201 });
        if (target.includes("dead-endpoint")) return new Response("gone", { status: 410 });
        return new Response("?", { status: 500 });
      }) as typeof fetch
    );

    const env: Env = {
      ENABLED_PLUGINS: "notifier",
      ALLOWED_HOSTS: "",
      DB: db,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:tom@example.com"
    } as unknown as Env;

    const notifier = await initNotifier(env);
    const result = await notifier.invoke("notify-user", {
      title: "Helm",
      body: "your build shipped",
      url: "https://helm.example.com/app",
      channel: "web-push"
    });

    expect(result.ok).toBe(true);
    const data = result.data as { sent: number; failed: number; pruned: number; channel: string };
    expect(data.channel).toBe("web-push");
    expect(data.sent).toBe(1);
    expect(data.pruned).toBe(1);

    // Live endpoint should have received a POST; dead endpoint also POSTed but
    // returned 410 → we pruned it from the `subs` array.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const livePost = fetchSpy.mock.calls.find((c) => String(c[0]).includes("live-endpoint"));
    expect(livePost).toBeDefined();
    const init = livePost![1] as RequestInit;
    expect((init.headers as Record<string, string>)["authorization"]).toMatch(/^vapid t=/);
    expect((init.headers as Record<string, string>)["content-encoding"]).toBe("aes128gcm");

    // Dead subscription pruned from the table, live remains.
    expect(subs).toHaveLength(1);
    expect(subs[0].endpoint).toBe(live.endpoint);

    // Audit row appended.
    expect(notifications).toHaveLength(1);
    expect(notifications[0].channel).toBe("web-push");
    expect(notifications[0].ok).toBe(1);

    fetchSpy.mockRestore();
  });

  it("returns a clean error when VAPID keys aren't configured", async () => {
    const sub = await makeSubscription("https://push.example.com/anything");
    const { db } = fakeDb([sub]);
    const env: Env = {
      ENABLED_PLUGINS: "notifier",
      ALLOWED_HOSTS: "",
      DB: db
    } as unknown as Env;
    const notifier = await initNotifier(env);
    const r = await notifier.invoke("notify-user", {
      body: "test",
      channel: "web-push"
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VAPID/);
  });

  it("returns a clean error when no subscriptions are registered", async () => {
    const vapid = await generateVapidKeys();
    const { db } = fakeDb([]);
    const env: Env = {
      ENABLED_PLUGINS: "notifier",
      ALLOWED_HOSTS: "",
      DB: db,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:tom@example.com"
    } as unknown as Env;
    const notifier = await initNotifier(env);
    const r = await notifier.invoke("notify-user", { body: "test", channel: "web-push" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No push subscriptions/);
  });
});
