# Running Cloudflare MCP from Codex Web (Sandbox Notes)

## Short answer

Yes, you can use Cloudflare MCP while working in cloud/Codex-web workflows, but OAuth must be completed in an MCP-capable client UI.

## Why this feels confusing

- This repo's runtime (`wrangler deploy`, Worker secrets) is one system.
- Cloudflare MCP login (`https://mcp.cloudflare.com/mcp`) is a second system.
- The command sandbox can run shell commands, but it does not complete interactive browser OAuth popups on your behalf.

## What to do

### 1) Configure MCP server URL in your client

Use Cloudflare MCP URL:

- `https://mcp.cloudflare.com/mcp`

Cloudflare's MCP repos/docs describe remote `streamable-http` MCP usage and URLs for Cloudflare MCP servers.

### 2) Choose auth mode

- **OAuth (recommended):** complete the sign-in/consent flow from your MCP client UI.
- **Bearer token:** if your client supports static headers, provide `Authorization: Bearer <token>` using a least-privilege Cloudflare token.

### 3) If your client only supports local command MCP

Use `mcp-remote` bridge style config (documented by Cloudflare in `mcp-server-cloudflare`):

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.cloudflare.com/mcp"]
    }
  }
}
```

### 4) Keep Worker deploy separate

- Worker setup in this repo: `npm run cf:bootstrap` then `npm run deploy`
- Post-deploy health check: `npm run cf:smoke -- https://<your-worker-url>`

## Helper command in this repo

Generate MCP client config JSON:

```bash
npm run cf:mcp:config
```

If `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_AGENT_TOKEN`) is exported, the generated config includes bearer auth headers.
