import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "notifier",
  title: "Notifier (Email + Web Push)",
  tagline: "Reach the owner via email or Web Push — full RFC 8292 VAPID, RFC 8291 aes128gcm.",
  description: `Two channels, one skill (\`notify-user\`). Email path uses the same \`send_email\` binding as the email plugin; Web Push path is a from-scratch implementation in \`src/webpush/\` covering ECDSA P-256 VAPID JWT signing, ECDH-ES + HKDF + AES-128-GCM payload encryption, and 410/404-driven auto-pruning of dead subscriptions. Browsers fetch the VAPID public key unauthenticated from \`/webpush/public-key\`; subscriptions land in D1 \`push_subscriptions\` after Access-gated POST to \`/webpush/subscribe\`. Every notification is audit-logged in D1 \`notifications\`.`,
  type: "plugin",
  category: "tools",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/notifier.ts",
  license: "Apache-2.0",
  tags: ["push", "vapid", "web-push", "email", "rfc-8291", "rfc-8292"],
  install: {
    enabledPluginsAdd: ["notifier"],
    secrets: [
      {
        name: "VAPID_PUBLIC_KEY",
        description: "Web Push public key (uncompressed P-256, base64url). Generate with `npm run vapid:generate`.",
        required: false
      },
      {
        name: "VAPID_PRIVATE_KEY",
        description: "Web Push private scalar (32 bytes, base64url). Keep as a Worker secret.",
        required: false
      },
      {
        name: "VAPID_SUBJECT",
        description: "VAPID `sub` claim — `mailto:you@example.com` or an https URL.",
        required: false
      }
    ],
    manualSteps: [
      "Decide your channels: email-only is fine without VAPID. For Web Push you need all three VAPID secrets.",
      "npm run vapid:generate — copy the two values, then `wrangler secret put VAPID_PUBLIC_KEY` and VAPID_PRIVATE_KEY",
      "wrangler secret put VAPID_SUBJECT  ← e.g. mailto:you@example.com",
      "Browser side: GET /webpush/public-key, then PushManager.subscribe(...), then POST /webpush/subscribe",
      "Test: curl -X POST https://<worker>/webpush/test -H 'cf-access-jwt-assertion: <token>'"
    ]
  },
  docsPath: "/docs/pa-stack",
  verified: true,
  accents: ["#f38020", "#10a37f"]
};
