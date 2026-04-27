/**
 * RFC 8291 payload encryption — full round-trip test.
 *
 * We simulate a browser subscription by generating an ECDH key pair + a
 * random 16-byte auth secret. encryptWebPushPayload() runs the server side
 * (what the Worker does before posting to the push service); _decryptForTests
 * runs the browser side (what the service worker's push event handler would
 * do after the browser decodes the RFC 8188 header).
 *
 * If the two halves agree on every plaintext we try, we've verified the full
 * HKDF chain + AES-128-GCM + record framing is spec-correct.
 */
import { describe, expect, it } from "vitest";
import {
  _decryptForTests,
  base64UrlDecode,
  base64UrlEncode,
  encryptWebPushPayload,
  MAX_PLAINTEXT_BYTES
} from "../src/webpush";

/** Simulate a browser subscription. Returns the fields a real PushSubscription exposes. */
async function fakeSubscription(): Promise<{
  p256dh: string;
  auth: string;
  clientPrivateJwk: JsonWebKey;
  clientPublic: Uint8Array;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!pubJwk.x || !pubJwk.y) throw new Error("ecdh keygen missing coords");
  const x = base64UrlDecode(pubJwk.x);
  const y = base64UrlDecode(pubJwk.y);
  const clientPublic = new Uint8Array(65);
  clientPublic[0] = 0x04;
  clientPublic.set(x, 1);
  clientPublic.set(y, 33);
  const authBytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: base64UrlEncode(clientPublic),
    auth: base64UrlEncode(authBytes),
    clientPrivateJwk: privJwk,
    clientPublic
  };
}

describe("webpush.encrypt", () => {
  it("round-trips a short UTF-8 payload", async () => {
    const sub = await fakeSubscription();
    const plaintext = new TextEncoder().encode("Hello, Tom — your build shipped.");
    const { body } = await encryptWebPushPayload({
      p256dh: sub.p256dh,
      auth: sub.auth,
      payload: plaintext
    });

    // Header sanity: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext.
    expect(body.length).toBeGreaterThan(16 + 4 + 1 + 65);
    expect(body[20]).toBe(65);
    expect(body[17]).toBe(0x00); // rs high byte
    expect(body[18]).toBe(0x10); // 0x1000 = 4096
    expect(body[19]).toBe(0x00);

    const decoded = await _decryptForTests({
      body,
      clientPrivateJwk: sub.clientPrivateJwk,
      authSecret: base64UrlDecode(sub.auth),
      clientPublic: sub.clientPublic
    });
    expect(new TextDecoder().decode(decoded)).toBe("Hello, Tom — your build shipped.");
  });

  it("round-trips an empty payload", async () => {
    const sub = await fakeSubscription();
    const { body } = await encryptWebPushPayload({
      p256dh: sub.p256dh,
      auth: sub.auth,
      payload: new Uint8Array()
    });
    const decoded = await _decryptForTests({
      body,
      clientPrivateJwk: sub.clientPrivateJwk,
      authSecret: base64UrlDecode(sub.auth),
      clientPublic: sub.clientPublic
    });
    expect(decoded.length).toBe(0);
  });

  it("round-trips a near-maximum payload", async () => {
    const sub = await fakeSubscription();
    const plaintext = new Uint8Array(MAX_PLAINTEXT_BYTES);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i & 0xff;
    const { body } = await encryptWebPushPayload({
      p256dh: sub.p256dh,
      auth: sub.auth,
      payload: plaintext
    });
    const decoded = await _decryptForTests({
      body,
      clientPrivateJwk: sub.clientPrivateJwk,
      authSecret: base64UrlDecode(sub.auth),
      clientPublic: sub.clientPublic
    });
    expect(decoded.length).toBe(plaintext.length);
    for (let i = 0; i < plaintext.length; i++) expect(decoded[i]).toBe(plaintext[i]);
  });

  it("rejects payloads larger than MAX_PLAINTEXT_BYTES", async () => {
    const sub = await fakeSubscription();
    await expect(
      encryptWebPushPayload({
        p256dh: sub.p256dh,
        auth: sub.auth,
        payload: new Uint8Array(MAX_PLAINTEXT_BYTES + 1)
      })
    ).rejects.toThrowError(/payload too large/);
  });

  it("rejects an auth secret that isn't 16 bytes", async () => {
    const sub = await fakeSubscription();
    await expect(
      encryptWebPushPayload({
        p256dh: sub.p256dh,
        auth: base64UrlEncode(new Uint8Array(8)),
        payload: new TextEncoder().encode("hi")
      })
    ).rejects.toThrowError(/subscription\.auth must decode to 16 bytes/);
  });

  it("rejects a malformed p256dh public key", async () => {
    await expect(
      encryptWebPushPayload({
        p256dh: base64UrlEncode(new Uint8Array(32)),
        auth: base64UrlEncode(new Uint8Array(16)),
        payload: new TextEncoder().encode("hi")
      })
    ).rejects.toThrowError(/65-byte uncompressed/);
  });

  it("produces a different ciphertext for the same payload across calls (fresh salt + ephemeral key)", async () => {
    const sub = await fakeSubscription();
    const payload = new TextEncoder().encode("same payload twice");
    const a = await encryptWebPushPayload({ p256dh: sub.p256dh, auth: sub.auth, payload });
    const b = await encryptWebPushPayload({ p256dh: sub.p256dh, auth: sub.auth, payload });
    expect(a.body).not.toEqual(b.body);
    expect(a.serverPublicKeyRaw).not.toEqual(b.serverPublicKeyRaw);
  });
});
