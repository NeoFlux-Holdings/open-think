#!/usr/bin/env node
/**
 * Generate a VAPID key pair for Web Push.
 *
 *   npm run vapid:generate
 *
 * Prints two base64url values — the uncompressed P-256 public key (65 bytes)
 * and the raw 32-byte private scalar. Both are in the same shape Workers'
 * `SubtleCrypto` expects, so you can paste them straight into
 * `wrangler secret put`.
 *
 * The public key ALSO goes into the browser via
 * `PushManager.subscribe({ applicationServerKey })`, so you can optionally
 * copy it into your service-worker / front-end constant.
 */

// Node's Web Crypto matches the Workers' API for our needs.
const { subtle } = globalThis.crypto;

function base64UrlEncode(bytes) {
  const chunks = [];
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...view.subarray(i, Math.min(i + 0x8000, view.length))));
  }
  return Buffer.from(chunks.join(""), "binary").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"));
}

async function main() {
  const pair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const [priv, pub] = await Promise.all([
    subtle.exportKey("jwk", pair.privateKey),
    subtle.exportKey("jwk", pair.publicKey)
  ]);

  const x = base64UrlDecode(pub.x);
  const y = base64UrlDecode(pub.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error(`unexpected P-256 coordinate size (${x.length}, ${y.length})`);
  }
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(x, 1);
  uncompressed.set(y, 33);

  const publicKey = base64UrlEncode(uncompressed);
  const privateKey = priv.d;

  process.stdout.write(
    [
      "",
      "== VAPID keys generated ==",
      "",
      `VAPID_PUBLIC_KEY=${publicKey}`,
      `VAPID_PRIVATE_KEY=${privateKey}`,
      "",
      "# Add to your Worker (keep VAPID_PRIVATE_KEY as a secret, not a var):",
      "   wrangler secret put VAPID_PUBLIC_KEY",
      "   wrangler secret put VAPID_PRIVATE_KEY",
      "",
      "# Also set a contact subject (browsers require it):",
      '   wrangler secret put VAPID_SUBJECT   # mailto:you@example.com',
      "",
      "# The browser's service worker needs VAPID_PUBLIC_KEY to subscribe:",
      "   registration.pushManager.subscribe({",
      "     userVisibleOnly: true,",
      `     applicationServerKey: '${publicKey.slice(0, 24)}…'  // from /webpush/public-key`,
      "   })",
      ""
    ].join("\n")
  );
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});
