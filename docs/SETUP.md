# Settings + Guided Setup

The `/app` **Settings** tab is the control plane for configuring Open Think. Three panels in one page:

1. **Runtime readiness** — a live score (0–100) and the top ~3 recommended next actions.
2. **Guided setup** — hands the job to Helm, pre-primed with your current runtime state and optional goal. If the Cloudflare MCP is wired, Helm drives it directly; otherwise it walks you through the commands.
3. **Capability checklist** — one card per provider / tooling / infra capability with status pill, missing-env hints, and doc links.
4. **Snippet generator** — tick plugins → get copy-paste `wrangler.toml` + `.dev.vars` fragments that merge cleanly with what you already have.

Keyboard: press `g t` to jump to Settings.

## How guided setup works

1. You type a goal (or leave blank for the default: *"walk me through the recommended minimal setup"*).
2. `POST /setup/guided-start` creates a new session `setup:<uuid>`, persists a primer as a `system` message. The primer contains:
   - Your current readiness score + enabled plugins
   - Per-capability status (configured / missing)
   - Recommended next actions
   - Whether Cloudflare MCP is available — and if so, explicit instructions to call `mcp-call-tool`
   - The full skill catalog Helm is allowed to propose
3. UI navigates to `#/conductor` with the primed session.
4. Helm now acts as a setup agent. Every infra change surfaces as an exhibit card; you approve.

Recommended mode when the MCP bridge is connected is **selective** — Helm auto-runs read-only probes but stops before anything destructive. When the bridge isn't connected, **propose** is the default so every suggestion comes back as a copy-paste command.

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/setup/status` | GET | Aggregated capability check + readiness score + MCP presence |
| `/setup/snippet` | POST | Generate wrangler.toml + .dev.vars delta for selected plugins |
| `/setup/guided-start` | POST | Create a primed Helm session, return its `sessionName` |

## Example — `/setup/status`

```json
{
  "ok": true,
  "data": {
    "enabledPlugins": ["admin", "workers-ai", "cf-ai-gateway"],
    "readinessScore": 72,
    "mcpBridge": { "configured": true, "url": "https://mcp.cloudflare.com/mcp", "provider": "cloudflare" },
    "recommended": [
      "Deploy companion/codex-bridge/ to use a ChatGPT subscription without paste-in tokens"
    ],
    "capabilities": [
      {
        "id": "cf-ai-gateway",
        "label": "Cloudflare AI Gateway (23+ providers)",
        "enabled": true,
        "configured": true,
        "missing": [],
        "hint": "Create a gateway at dash → AI → AI Gateway, then wrangler secret put AI_GATEWAY_ID."
      }
      // ... etc
    ]
  }
}
```

## Why not a full click-ops wizard?

Two reasons:

1. **Helm is the wizard.** Building a parallel click-ops flow would duplicate logic and diverge from the primary surface. The Settings tab focuses on *visibility* (status + snippets); execution is delegated to the conversational agent that already knows how to propose, approve, and audit skill invocations.
2. **MCP is the right primitive for write-ops.** The Cloudflare MCP already exposes typed tools for every mutation we'd need (gateways, KV, D1, R2, zones, DNS, secrets-store). Wrapping them in bespoke Settings UI buttons would add a maintenance burden every time CF adds a tool. Going through Helm + `mcp-call-tool` means new MCP tools show up automatically.

## Future upgrades

- **Stream the guided setup** via `/conductor/stream` — show MCP tool calls and results in real time instead of buffered turns. Requires the codex app-server bridge; already supported by the streaming infra shipped in Phase 14–15.
- **Bulk-apply snippets** — a button that calls out to the CF API directly (via the user's token) to create all listed resources in one shot. Requires clear audit trail.
- **Rollback** — capture the state before each setup turn so unintended MCP mutations can be reversed. The session DO already has everything we need.
