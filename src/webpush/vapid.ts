/**
 * VAPID (Voluntary Application Server Identification for Web Push) — RFC 8292.
 *
 * What this module does:
 *   - Generates VAPID key pairs (ECDSA P-256)
 *   - Exports public keys in the uncompressed point format (0x04 || x || y)
 *     that browsers expect in `PushManager.subscribe({ applicationServerKey })`
 *   - Signs the VAPID JWT (ES256) required on every push
 *   - Builds the `Authorization: vapid t=...,k=...` header
 *
 * Why we hand-roll this: Workers' `SubtleCrypto` already has ECDSA P-256 + HMAC
 * + SHA-256 built in. Pulling a web-push library adds bundle weight and most
 * don't tree-shake well in the Workers bundler.
 *
 * Key sources:
 *   - RFC 8292 (VAPID) — JWT claims, header shape
 *   - Web Push draft — aud = scheme+host of endpoint, exp <= 24h
 */

import { base64UrlDecode, base64UrlEncode, base64UrlEncodeString } from "./base64url";

export interface VapidKeys {
  /** Uncompressed P-256 public point (0x04 || x || y), base64url — 65 bytes raw. */
  publicKey: string;
  /** Raw P-256 private scalar d, base64url — 32 bytes raw. */
  privateKey: string;
}

export interface VapidSigningInput {
  publicKey: string;
  privateKey: string;
  audience: string;
  subject: string;
  expirationSec?: number;
}

/* ---------------- key generation ---------------- */

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const [priv, pub] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey)
  ]);
  if (!priv.d || !pub.x || !pub.y) {
    throw new Error("VAPID key generation failed: incomplete JWK");
  }
  const x = base64UrlDecode(pub.x);
  const y = base64UrlDecode(pub.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("VAPID key generation failed: unexpected coordinate size");
  }
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(x, 1);
  uncompressed.set(y, 33);
  return {
    publicKey: base64UrlEncode(uncompressed),
    privateKey: priv.d
  };
}

/* ---------------- internals ---------------- */

function splitUncompressedPoint(publicKeyB64u: string): { x: string; y: string } {
  const raw = base64UrlDecode(publicKeyB64u);
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(
      `invalid VAPID public key: expected 65-byte uncompressed P-256 point (0x04 || x || y), got ${raw.length} bytes`
    );
  }
  return {
    x: base64UrlEncode(raw.subarray(1, 33)),
    y: base64UrlEncode(raw.subarray(33, 65))
  };
}

async function importVapidPrivateKey(
  privateKeyB64u: string,
  publicKeyB64u: string
): Promise<CryptoKey> {
  const { x, y } = splitUncompressedPoint(publicKeyB64u);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      d: privateKeyB64u,
      ext: true
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

export async function importVapidPublicKey(publicKeyB64u: string): Promise<CryptoKey> {
  const { x, y } = splitUncompressedPoint(publicKeyB64u);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );
}

/* ---------------- JWT signing ---------------- */

/**
 * Sign the VAPID JWT. Returns a compact JWS (`header.payload.signature`).
 *
 * `audience` MUST be `${scheme}://${host}` of the push endpoint (RFC 8292).
 * `subject` is a `mailto:` or `https:` contact URL the push service can use
 * to reach the application owner.
 */
export async function signVapidJwt(input: VapidSigningInput): Promise<string> {
  if (!input.publicKey || !input.privateKey) throw new Error("VAPID keys missing");
  if (!/^https?:\/\//.test(input.audience)) throw new Error("audience must be an https:// origin");
  if (!/^(mailto:|https:\/\/)/.test(input.subject)) {
    throw new Error('subject must start with "mailto:" or "https://"');
  }

  const key = await importVapidPrivateKey(input.privateKey, input.publicKey);

  const header = { typ: "JWT", alg: "ES256" };
  const exp = Math.floor(Date.now() / 1000) + clamp(input.expirationSec ?? 12 * 3600, 60, 24 * 3600);
  const payload = { aud: input.audience, exp, sub: input.subject };

  const headerB64 = base64UrlEncodeString(JSON.stringify(header));
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // SubtleCrypto returns the IEEE-P1363 encoding (r || s, 64 bytes for P-256)
  // which is exactly what JWS wants — no DER → raw conversion required.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Build the `Authorization` header value for VAPID.
 *   Authorization: vapid t=<jwt>,k=<public key base64url>
 */
export function buildVapidAuthHeader(jwt: string, publicKeyB64u: string): string {
  if (!jwt) throw new Error("jwt required");
  if (!publicKeyB64u) throw new Error("publicKey required");
  return `vapid t=${jwt},k=${publicKeyB64u}`;
}

/** Extract the audience (scheme + host) from a push endpoint URL. */
export function audienceFromEndpoint(endpoint: string): string {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
