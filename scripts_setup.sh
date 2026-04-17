#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required (install Node.js first)."
  exit 1
fi

echo "Configuring Cloudflare Worker secrets for this project."
echo ""
echo "Required for Cloudflare plugin: CLOUDFLARE_API_TOKEN (preferred) or CLOUDFLARE_AGENT_TOKEN"
read -r -p "Use CLOUDFLARE_API_TOKEN? [Y/n]: " use_api_token

if [[ "${use_api_token:-y}" =~ ^([Yy]|)$ ]]; then
  npx wrangler secret put CLOUDFLARE_API_TOKEN
else
  npx wrangler secret put CLOUDFLARE_AGENT_TOKEN
fi

echo ""
read -r -p "Enable and configure the optional mpp plugin now? [y/N]: " configure_mpp
if [[ "${configure_mpp:-n}" =~ ^[Yy]$ ]]; then
  npx wrangler secret put MPP_API_KEY
fi

echo ""
echo "Done. Next steps:"
echo "  1) Confirm ENABLED_PLUGINS / ALLOWED_HOSTS in wrangler.toml"
echo "  2) Deploy: npx wrangler deploy"
