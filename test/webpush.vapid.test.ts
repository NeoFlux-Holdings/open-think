/**
 * VAPID key-gen + JWT tests.
 *
 * Coverage:
 *   - generateVapidKeys() produces a 65-byte uncompressed P-256 point and a
 *     32-byte private scalar, both round-trippable through the JWS signer.
 *   - signVapidJwt() emits a compact ES256 JWT with the expected claims and
 *     a 64-byte (r||s) signature that verifies under the emitted public key.
 *   - Audience helper + auth header formatting.
 *   - Subject validation rejects anything that isn't mailto:/https://.
 */
import { describe, expect, it } from "vitest";
import {
  audienceFromEndpoint,
  base64UrlDecode,
  buildVapidAuthHeader,
  generateVapidKeys,
  importVapidPublicKey,
  signVapidJwt
} from "../src/webpush";

function decodeJson(b64: string): unknown {
  const bytes = base64UrlDecode(b64);
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("vapid.generateVapidKeys", () => {
  it("produces a 65-byte uncompressed public point and 32-byte private scalar", async () => {
    const keys = await generateVapidKeys();
    const pub = base64UrlDecode(keys.publicKey);
    const priv = base64UrlDecode(keys.privateKey);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    expect(priv.length).toBe(32);
  });

  it("generates distinct keys on every call", async () => {
    const a = await generateVapidKeys();
    const b = await generateVapidKeys();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe("vapid.signVapidJwt", () => {
  it("emits a valid ES256 JWS that verifies with the public key", async () => {
    const keys = await generateVapidKeys();
    const audience = "https://fcm.googleapis.com";
    const subject = "mailto:tom@example.com";
    const jwt = await signVapidJwt({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      audience,
      subject,
      expirationSec: 3600
    });
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = decodeJson(parts[0]) as Record<string, unknown>;
    const payload = decodeJson(parts[1]) as Record<string, unknown>;
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(payload.aud).toBe(audience);
    expect(payload.sub).toBe(subject);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 3600);

    const signature = base64UrlDecode(parts[2]);
    expect(signature.length).toBe(64); // P-256 r||s

    const publicKey = await importVapidPublicKey(keys.publicKey);
    const sigBuf = signature.buffer.slice(
      signature.byteOffset,
      signature.byteOffset + signature.byteLength
    ) as ArrayBuffer;
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const dataBuf = signingInput.buffer.slice(
      signingInput.byteOffset,
      signingInput.byteOffset + signingInput.byteLength
    ) as ArrayBuffer;
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sigBuf,
      dataBuf
    );
    expect(ok).toBe(true);
  });

  it("clamps expiration to 24h", async () => {
    const keys = await generateVapidKeys();
    const jwt = await signVapidJwt({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      audience: "https://example.com",
      subject: "mailto:x@example.com",
      expirationSec: 10 * 24 * 3600 // 10 days — should clamp to 24h
    });
    const parts = jwt.split(".");
    const payload = decodeJson(parts[1]) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    expect((payload.exp as number) - now).toBeLessThanOrEqual(24 * 3600 + 5);
  });

  it("rejects non-mailto / non-https subject", async () => {
    const keys = await generateVapidKeys();
    await expect(
      signVapidJwt({
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        audience: "https://example.com",
        subject: "tom@example.com" // missing mailto:
      })
    ).rejects.toThrowError(/subject must start with/);
  });

  it("rejects non-https audience", async () => {
    const keys = await generateVapidKeys();
    await expect(
      signVapidJwt({
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        audience: "fcm.googleapis.com",
        subject: "mailto:x@example.com"
      })
    ).rejects.toThrowError(/audience must be an https/);
  });
});

describe("vapid helpers", () => {
  it("audienceFromEndpoint drops path + query", () => {
    expect(audienceFromEndpoint("https://fcm.googleapis.com/fcm/send/abc123?q=1")).toBe(
      "https://fcm.googleapis.com"
    );
    expect(audienceFromEndpoint("https://updates.push.services.mozilla.com/wpush/v1/xyz")).toBe(
      "https://updates.push.services.mozilla.com"
    );
  });

  it("buildVapidAuthHeader formats the VAPID auth header", () => {
    expect(buildVapidAuthHeader("a.b.c", "pubkey")).toBe("vapid t=a.b.c,k=pubkey");
  });

  it("importVapidPublicKey rejects malformed input", async () => {
    await expect(importVapidPublicKey("not-a-real-key")).rejects.toThrow();
  });
});
