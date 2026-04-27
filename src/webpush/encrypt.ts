/**
 * Web Push payload encryption — RFC 8291 (Message Encryption) using the
 * `aes128gcm` content encoding from RFC 8188.
 *
 * Shape (single-record, rs=4096):
 *
 *   body = salt(16) || rs(4, big-endian) || idlen(1) || keyid(65) || ciphertext
 *   ciphertext = AES-128-GCM(cek, nonce, plaintext || 0x02)
 *   cek, nonce = HKDF derivations rooted in the ECDH shared secret
 *
 * We implement HKDF on top of HMAC-SHA256 directly because SubtleCrypto
 * doesn't expose HKDF with the exact info/salt choreography the spec needs.
 *
 * Limit: plaintext must be ≤ rs - 16 (GCM tag) - 1 (padding delim) - 1 = 4078
 * bytes for rs=4096. We use rs=4096 (the de-facto web-push default) and cap
 * the plaintext at that limit in push.ts.
 */

import { base64UrlDecode, base64UrlEncode, toArrayBuffer } from "./base64url";

export interface EncryptInput {
  /** Client's uncompressed P-256 public key (base64url, 65 bytes). */
  p256dh: string;
  /** Client's 16-byte auth secret (base64url). */
  auth: string;
  /** Plaintext payload bytes. */
  payload: Uint8Array;
}

export interface EncryptOutput {
  body: Uint8Array;
  serverPublicKeyRaw: Uint8Array;
}

const RECORD_SIZE = 4096;
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - 16 - 1 - 1; // 4078

/* ---------------- small utils ---------------- */

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", imported, toArrayBuffer(data));
  return new Uint8Array(sig);
}

/**
 * HKDF-Extract(salt, ikm) → prk. A single HMAC-SHA256(salt, ikm) per RFC 5869.
 */
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

/**
 * HKDF-Expand first iteration only. Every web-push key we derive is ≤32 bytes,
 * so one round of HMAC is enough. output = HMAC(prk, info || 0x01)[:length].
 */
async function hkdfExpand1(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  if (length > 32) throw new Error("hkdfExpand1 only handles length ≤ 32");
  const input = new Uint8Array(info.length + 1);
  input.set(info, 0);
  input[info.length] = 0x01;
  const full = await hmacSha256(prk, input);
  return full.subarray(0, length);
}

/* ---------------- ECDH helpers ---------------- */

async function importClientPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error("subscription.p256dh must decode to a 65-byte uncompressed P-256 point");
  }
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(raw.subarray(1, 33)),
      y: base64UrlEncode(raw.subarray(33, 65)),
      ext: true
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

interface ServerEcdhKeys {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

async function generateServerEcdhKeys(): Promise<ServerEcdhKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  if (!jwk.x || !jwk.y) throw new Error("failed to export server ECDH public key");
  const x = base64UrlDecode(jwk.x);
  const y = base64UrlDecode(jwk.y);
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return { privateKey: pair.privateKey, publicRaw: raw };
}

/* ---------------- main entry point ---------------- */

export async function encryptWebPushPayload(input: EncryptInput): Promise<EncryptOutput> {
  const clientPublic = base64UrlDecode(input.p256dh);
  const authSecret = base64UrlDecode(input.auth);
  if (authSecret.length !== 16) {
    throw new Error(`subscription.auth must decode to 16 bytes (got ${authSecret.length})`);
  }
  if (input.payload.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`payload too large: ${input.payload.length} bytes (max ${MAX_PLAINTEXT_BYTES})`);
  }

  const clientKey = await importClientPublicKey(clientPublic);
  const server = await generateServerEcdhKeys();

  // ECDH shared secret (32 bytes).
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientKey },
    server.privateKey,
    256
  );
  const ecdhSecret = new Uint8Array(sharedBits);

  // key_info ties the IKM to both public keys so a MITM can't swap the
  // server's key mid-flight.
  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info"),
    new Uint8Array([0x00]),
    clientPublic,
    server.publicRaw
  );

  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const ikm = await hkdfExpand1(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);

  const cek = await hkdfExpand1(
    prk,
    new TextEncoder().encode("Content-Encoding: aes128gcm\0"),
    16
  );
  const nonce = await hkdfExpand1(
    prk,
    new TextEncoder().encode("Content-Encoding: nonce\0"),
    12
  );

  // RFC 8188 padding: a single record with 0x02 terminator means "last record."
  const padded = new Uint8Array(input.payload.length + 1);
  padded.set(input.payload, 0);
  padded[input.payload.length] = 0x02;

  const cekKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce) },
      cekKey,
      toArrayBuffer(padded)
    )
  );

  // Header layout from RFC 8188 Section 2:
  //   salt(16) || rs(4) || idlen(1) || keyid(idlen) || ciphertext
  const body = new Uint8Array(16 + 4 + 1 + 65 + ciphertext.length);
  let off = 0;
  body.set(salt, off);
  off += 16;
  body[off++] = (RECORD_SIZE >>> 24) & 0xff;
  body[off++] = (RECORD_SIZE >>> 16) & 0xff;
  body[off++] = (RECORD_SIZE >>> 8) & 0xff;
  body[off++] = RECORD_SIZE & 0xff;
  body[off++] = 65;
  body.set(server.publicRaw, off);
  off += 65;
  body.set(ciphertext, off);

  return { body, serverPublicKeyRaw: server.publicRaw };
}

/**
 * Test-only: decrypt a web-push body with the client-side private key. Not
 * used in production — exposed so tests can prove encrypt() round-trips.
 */
export async function _decryptForTests(input: {
  body: Uint8Array;
  clientPrivateJwk: JsonWebKey;
  authSecret: Uint8Array;
  clientPublic: Uint8Array;
}): Promise<Uint8Array> {
  if (input.authSecret.length !== 16) throw new Error("authSecret must be 16 bytes");
  if (input.body.length < 16 + 4 + 1 + 65) throw new Error("body too short");

  const salt = input.body.subarray(0, 16);
  const idlen = input.body[20];
  if (idlen !== 65) throw new Error(`unexpected keyid length ${idlen}`);
  const serverPublicRaw = input.body.subarray(21, 21 + 65);
  const ciphertext = input.body.subarray(21 + 65);

  const clientPrivateKey = await crypto.subtle.importKey(
    "jwk",
    input.clientPrivateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const serverPublicKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(serverPublicRaw.subarray(1, 33)),
      y: base64UrlEncode(serverPublicRaw.subarray(33, 65)),
      ext: true
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverPublicKey },
    clientPrivateKey,
    256
  );
  const ecdhSecret = new Uint8Array(sharedBits);

  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info"),
    new Uint8Array([0x00]),
    input.clientPublic,
    serverPublicRaw
  );
  const prkKey = await hkdfExtract(input.authSecret, ecdhSecret);
  const ikm = await hkdfExpand1(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand1(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand1(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const cekKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce) },
      cekKey,
      toArrayBuffer(ciphertext)
    )
  );
  // Strip trailing padding: 0x02 (last record) after plaintext.
  if (padded.length === 0) return padded;
  const last = padded[padded.length - 1];
  if (last !== 0x02 && last !== 0x01) {
    throw new Error(`unexpected record terminator 0x${last.toString(16)}`);
  }
  return padded.subarray(0, padded.length - 1);
}
