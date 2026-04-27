import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "email",
  title: "Email (Cloudflare Email Workers)",
  tagline: "Send + receive email natively on Cloudflare — no SendGrid, no Mailgun.",
  description: `Outbound via the \`send_email\` binding (\`env.SEB.send(EmailMessage)\`) over a \`mimetext\`-built MIME envelope. Inbound via the Worker's \`email()\` handler — Email Routing forwards every message to \`postal-mime.parse()\` and Helm indexes it into a D1 \`inbound_email\` table. \`email-send\` is marked dangerous so selective-mode holds the draft for owner approval; \`email-draft\` is the read-only preview path. Pair with the \`notifier\` plugin to use email as the PA's primary push channel.`,
  type: "plugin",
  category: "productivity",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/email.ts",
  license: "Apache-2.0",
  tags: ["email", "cloudflare-native", "send-email", "inbox", "dangerous-by-default"],
  install: {
    enabledPluginsAdd: ["email"],
    secrets: [
      {
        name: "OWNER_EMAIL",
        description: "The inbox the PA writes to and reads from.",
        required: true
      },
      {
        name: "FROM_EMAIL",
        description: "Sender address — domain must have Email Routing active.",
        required: false
      }
    ],
    wranglerSnippet: `[[send_email]]\nname = "SEB"\n# destination_address = "you@example.com"  # optional restriction`,
    manualSteps: [
      "dash → Email → Email Routing → enable on your sender domain",
      "Verify the destination address (your inbox) so SEB.send() can target it",
      "For inbound: dash → Email Routing → catch-all → Send to Worker → pick this Worker",
      "wrangler deploy"
    ]
  },
  docsPath: "/docs/pa-stack",
  verified: true,
  accents: ["#f38020"]
};
