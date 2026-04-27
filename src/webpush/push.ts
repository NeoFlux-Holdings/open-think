/**
 * Web Push sender. Composes the encrypted body, signs the VAPID JWT, fires
 * the POST at the subscription endpoint, and classifies the response for the
 * caller (ok / expired / transient / fatal).
 */

import { encryptWebPushPayload, MAX_PLAINTEXT_BYTES } from "./encrypt";
import { audienceFromEndpoint, buildVapidAuthHeader, signVapidJwt } from "./vapid";

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: or https:// contact for the push service to reach you. */
  subject: string;
}

export interface PushOptions {
  /** Seconds the push service should retain the message. Default 86400 (1 day). */
  ttl?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Optional 32-char base64url tag for dedup / replacement at the push service. */
  topic?: string;
}

export interface PushResult {
  ok: boolean;
  /** HTTP status. 0 if we failed before making the request. */
  status: number;
  /** 404/410: the subscription is dead; the caller should delete it. */
  expired: boolean;
  /** 429/503: temporary; caller may retry later. */
  retryable: boolean;
  error?: string;
}

function normalizePayload(payload: Uint8Array | string | Record<string, unknown>): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Send a single Web Push notification. Returns a shape the notifier plugin
 * can use to decide whether to prune the subscription (expired=true) or
 * retry later (retryable=true).
 */
export async function sendWebPushNotification(
  subscription: PushSubscription,
  payload: Uint8Array | string | Record<string, unknown>,
  vapid: VapidConfig,
  options: PushOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<PushResult> {
  if (!subscription?.endpoint) {
    return { ok: false, status: 0, expired: false, retryable: false, error: "subscription.endpoint missing" };
  }
  if (!subscription.p256dh || !subscription.auth) {
    return {
      ok: false,
      status: 0,
      expired: false,
      retryable: false,
      error: "subscription.keys.p256dh and subscription.keys.auth required"
    };
  }
  if (!vapid?.publicKey || !vapid?.privateKey || !vapid?.subject) {
    return {
      ok: false,
      status: 0,
      expired: false,
      retryable: false,
      error: "VAPID config incomplete — publicKey, privateKey, subject all required"
    };
  }

  const plaintext = normalizePayload(payload);
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    return {
      ok: false,
      status: 0,
      expired: false,
      retryable: false,
      error: `payload too large: ${plaintext.length} bytes (max ${MAX_PLAINTEXT_BYTES} with rs=4096)`
    };
  }

  let body: Uint8Array;
  try {
    body = (await encryptWebPushPayload({
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      payload: plaintext
    })).body;
  } catch (err) {
    return { ok: false, status: 0, expired: false, retryable: false, error: `encrypt failed: ${(err as Error).message}` };
  }

  let jwt: string;
  try {
    jwt = await signVapidJwt({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
      audience: audienceFromEndpoint(subscription.endpoint),
      subject: vapid.subject
    });
  } catch (err) {
    return { ok: false, status: 0, expired: false, retryable: false, error: `VAPID sign failed: ${(err as Error).message}` };
  }

  const headers: Record<string, string> = {
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    "content-length": String(body.length),
    ttl: String(Math.max(0, Math.min(2419200, Math.floor(options.ttl ?? 86400)))),
    urgency: options.urgency ?? "normal",
    authorization: buildVapidAuthHeader(jwt, vapid.publicKey)
  };
  if (options.topic) {
    // Push services reject topics longer than 32 chars; we also strip
    // non-base64url characters defensively.
    const safe = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (safe) headers.topic = safe;
  }

  let resp: Response;
  try {
    // `body` is a Uint8Array; workers-types needs a plain ArrayBuffer or one of
    // the concrete BodyInit types. Slicing into a fresh ArrayBuffer also avoids
    // accidental sharing of the underlying buffer with the encryption module.
    const bodyBuffer = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer;
    resp = await fetchImpl(subscription.endpoint, { method: "POST", headers, body: bodyBuffer });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      expired: false,
      retryable: true,
      error: `network error: ${(err as Error).message}`
    };
  }

  if (resp.status >= 200 && resp.status < 300) {
    return { ok: true, status: resp.status, expired: false, retryable: false };
  }

  const expired = resp.status === 404 || resp.status === 410;
  const retryable = resp.status === 429 || resp.status === 500 || resp.status === 502 || resp.status === 503;
  let text = "";
  try {
    text = await resp.text();
  } catch {
    // ignore — some push services return empty bodies
  }
  return {
    ok: false,
    status: resp.status,
    expired,
    retryable,
    error: text ? text.slice(0, 500) : `push failed with status ${resp.status}`
  };
}

/**
 * Compose a standard web-push notification payload. Browsers expect
 * `{ title, body, icon?, url?, tag? }`-shaped JSON in the Service Worker's
 * `push` event handler.
 */
export function buildPushPayload(input: {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  const { title, body, url, icon, tag, data } = input;
  const payload: Record<string, unknown> = { title, body };
  if (url) payload.url = url;
  if (icon) payload.icon = icon;
  if (tag) payload.tag = tag;
  if (data) payload.data = data;
  return payload;
}
