/**
 * Push-sender tests. We stub the push-service HTTP endpoint and assert that:
 *   - the outbound POST has the correct headers (aes128gcm, vapid auth, ttl, urgency)
 *   - the body is a non-empty Uint8Array (actual bytes are tested in encrypt.test)
 *   - 201/202 → ok
 *   - 410 / 404 → expired=true (signal to delete the subscription)
 *   - 429 / 5xx → retryable=true
 *   - payload oversize is rejected without a network call
 *   - network error is reported as retryable
 */
import { describe, expect, it, vi } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  generateVapidKeys,
  sendWebPushNotification
} from "../src/webpush";

async function fakeSubscription(): Promise<{
  endpoint: string;
  p256dh: string;
  auth: string;
}> {
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
    endpoint: "https://fcm.googleapis.com/fcm/send/ABCD_test_endpoint",
    p256dh: base64UrlEncode(raw),
    auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
  };
}

describe("sendWebPushNotification", () => {
  it("sends with correct headers + returns ok on 201", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    const captured: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      bodyLength?: number;
    } = {};
    const fetchStub = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      captured.url = typeof url === "string" ? url : (url as Request).url;
      captured.method = init?.method;
      captured.headers = init?.headers as Record<string, string>;
      const b = init?.body;
      if (b instanceof ArrayBuffer) captured.bodyLength = b.byteLength;
      else if (b instanceof Uint8Array) captured.bodyLength = b.byteLength;
      else if (typeof b === "string") captured.bodyLength = b.length;
      else captured.bodyLength = 0;
      return new Response(null, { status: 201 });
    });

    const r = await sendWebPushNotification(
      sub,
      { title: "t", body: "b" },
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
      { ttl: 3600, urgency: "high", topic: "build-passed" },
      fetchStub as unknown as typeof fetch
    );

    expect(r.ok).toBe(true);
    expect(r.status).toBe(201);
    expect(r.expired).toBe(false);
    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(sub.endpoint);
    const h = captured.headers!;
    expect(h["content-encoding"]).toBe("aes128gcm");
    expect(h["content-type"]).toBe("application/octet-stream");
    expect(Number(h["content-length"])).toBeGreaterThan(16 + 4 + 1 + 65);
    expect(h["ttl"]).toBe("3600");
    expect(h["urgency"]).toBe("high");
    expect(h["topic"]).toBe("build-passed");
    expect(h["authorization"]).toMatch(/^vapid t=[\w.-]+,k=[\w-]+$/);
    expect(captured.bodyLength!).toBeGreaterThan(16 + 4 + 1 + 65);
  });

  it("returns ok on 202", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    const fetchStub = vi.fn(async () => new Response(null, { status: 202 }));
    const r = await sendWebPushNotification(
      sub,
      "ping",
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
      {},
      fetchStub as unknown as typeof fetch
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe(202);
  });

  it("flags 410 as expired (caller should delete subscription)", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    const fetchStub = vi.fn(async () => new Response("subscription gone", { status: 410 }));
    const r = await sendWebPushNotification(
      sub,
      "ping",
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
      {},
      fetchStub as unknown as typeof fetch
    );
    expect(r.ok).toBe(false);
    expect(r.expired).toBe(true);
    expect(r.retryable).toBe(false);
    expect(r.error).toContain("subscription gone");
  });

  it("flags 404 as expired", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    const fetchStub = vi.fn(async () => new Response(null, { status: 404 }));
    const r = await sendWebPushNotification(
      sub,
      "ping",
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
      {},
      fetchStub as unknown as typeof fetch
    );
    expect(r.expired).toBe(true);
  });

  it("flags 429 / 503 as retryable (not expired)", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    for (const status of [429, 500, 502, 503]) {
      const fetchStub = vi.fn(async () => new Response("retry please", { status }));
      const r = await sendWebPushNotification(
        sub,
        "ping",
        { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
        {},
        fetchStub as unknown as typeof fetch
      );
      expect(r.expired).toBe(false);
      expect(r.retryable).toBe(true);
      expect(r.status).toBe(status);
    }
  });

  it("rejects oversized payloads without making a network call", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    const fetchStub = vi.fn();
    const huge = "x".repeat(5000);
    const r = await sendWebPushNotification(
      sub,
      huge,
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
      {},
      fetchStub as unknown as typeof fetch
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/payload too large/);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("reports network errors as retryable", async () => {
    const sub = await fakeSubscription();
    const keys = await generateVapidKeys();
    const fetchStub = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await sendWebPushNotification(
      sub,
      "ping",
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" },
      {},
      fetchStub as unknown as typeof fetch
    );
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it("rejects incomplete subscription", async () => {
    const keys = await generateVapidKeys();
    const r = await sendWebPushNotification(
      { endpoint: "", p256dh: "x", auth: "y" },
      "ping",
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:x@example.com" }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/endpoint/);
  });

  it("rejects incomplete VAPID config", async () => {
    const sub = await fakeSubscription();
    const r = await sendWebPushNotification(
      sub,
      "ping",
      { publicKey: "", privateKey: "", subject: "" }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VAPID/);
  });
});
