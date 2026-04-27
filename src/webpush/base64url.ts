/**
 * URL-safe base64 encode/decode. VAPID JWTs, ECDH public keys, auth secrets,
 * and push payloads all travel as base64url — no padding, `+/` replaced with
 * `-_`. These helpers are used everywhere in the webpush module.
 *
 * We hand-roll this because jose exports its own but the ergonomics differ
 * slightly; having our own keeps the module self-contained and makes the
 * crypto paths easier to audit.
 */

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array | ArrayBufferView): string {
  let view: Uint8Array;
  if (bytes instanceof Uint8Array) view = bytes;
  else if (bytes instanceof ArrayBuffer) view = new Uint8Array(bytes);
  else view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    s += String.fromCharCode(...view.subarray(i, Math.min(i + chunk, view.length)));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

export function base64UrlDecode(s: string): Uint8Array {
  if (typeof s !== "string") throw new TypeError("base64UrlDecode expects a string");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Convert a Uint8Array (which may be a view over SharedArrayBuffer in some
 * type libs) into a plain ArrayBuffer, which is what SubtleCrypto operations
 * require in the Workers types. This copies the exact byte range referenced
 * by the view, which is what we want everywhere — we never want to leak
 * bytes outside the view into a crypto operation.
 */
export function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}
