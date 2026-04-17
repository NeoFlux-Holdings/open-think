# Open Think: Cloudflare-Native Agent Runtime

A security-first, modular starter for building Cloudflare-based agents inspired by Project Think.

## Goals

- **Cloudflare-first** deployment model (Workers + optional Durable Objects).
- **Plugin system** for connectors/integrations/MCP servers.
- **Built-in support** for:
  - Cloudflare API MCP server workflows.
  - `mpp.dev` provider integration as a plugin.
  - Cloudflare Artifacts (Git-for-agents) operations as a plugin.
- **Secure defaults**: explicit allow-lists, secret-only credential handling, and bounded tool execution.
- **Easy onboarding**: one-command local dev and deploy.

## Architecture

- `src/index.ts` – Worker entrypoint and HTTP routes.
- `src/core/plugin.ts` – plugin contracts and capability model.
- `src/core/runtime.ts` – runtime bootstrap and plugin orchestration.
- `src/core/config.ts` – environment parsing + guardrails.
- `src/core/connectors.ts` – shared JSON HTTP connector abstraction for plugin integrations.
- `src/plugins/*` – first-party plugins (`cloudflareApiMcp`, `mpp`).

## Recommended path: deploy a thin slice first

If your goal is a personal/professional production agent, the best sequence is:

1. **Deploy Cloudflare-only first** (`cloudflare-api-mcp` plugin only).
2. Validate auth, logs, error handling, and rate limits in production.
3. Add higher-risk or optional integrations (`mpp`, other connectors) one at a time.

This keeps blast radius small while still letting you iterate quickly.

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy env template:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. Run locally:

   ```bash
   npm run dev
   ```

4. Deploy:

   ```bash
   npm run deploy
   ```

## Security model

- Secrets are read from Worker env bindings only.
- Plugin activation is controlled by an explicit comma-separated allow-list (`ENABLED_PLUGINS`).
- Runtime enforces per-plugin capability declarations and startup validation.
- Runtime fails fast when enabled plugin IDs are not registered.
- Required plugin secrets are validated during bootstrap.
- Outbound connector hosts are allow-listed via `ALLOWED_HOSTS`, enforced by a restricted fetch wrapper.
- API errors include stable error codes and request IDs for debugging.
- Plugin/skill invoke routes emit structured audit logs (JSON) with request IDs and durations.

## Config

| Variable | Required | Description |
| --- | --- | --- |
| `ENABLED_PLUGINS` | yes | Comma-separated plugin IDs, e.g. `cloudflare-api-mcp,mpp`. |
| `ALLOWED_HOSTS` | yes | Comma-separated host allow-list for plugin outbound calls. |
| `CLOUDFLARE_API_TOKEN` | for CF plugin | Preferred token for Cloudflare API/MCP operations. |
| `CLOUDFLARE_AGENT_TOKEN` | optional for CF plugin | Alternative Cloudflare Agent token if API token is not used. |
| `MPP_API_KEY` | for MPP plugin | API key for mpp.dev integration. |
| `MODEL_DEFAULT` | no | Default model alias exposed to plugins. |
| `ALERT_ERROR_RATE_PCT` | no | Alert threshold percentage for `POST /alerts/check` (default `5`). |
| `ALERT_WEBHOOK_URL` | no | Optional webhook target for alert notifications when threshold is exceeded. |
| `ARTIFACTS` binding | for artifacts plugin | Cloudflare Workers Artifacts binding (no API token required for binding calls). |

## HTTP endpoints

- `GET /` – quick route map for API usability.
- `GET /health` – runtime, plugin, and skill status.
- `GET /plugins` – loaded plugin metadata.
- `GET /skills` – available skill catalog (filtered by enabled plugins).
- `GET /metrics` – in-memory request/error/latency counters for observability.
- `POST /alerts/check` – evaluate error-rate alert threshold and optionally emit webhook.
- `POST /invoke/{pluginId}` – invoke a plugin action with JSON payload.
- `POST /skills/invoke/{skillId}` – invoke predefined skill workflows.

## Extending with new plugins

1. Scaffold with `npm run plugin:new -- <plugin-id>` (recommended).
2. Implement the `AgentPlugin` interface.
3. Export plugin from `src/plugins/registry.ts`.
4. Add plugin ID to `ENABLED_PLUGINS`.

This keeps connectors, integrations, and additional MCP implementations composable with minimal coupling.


## Skills support (starter)

This runtime now includes a lightweight skill catalog layer on top of plugins.

- Skills map a stable skill ID to a plugin + action pair.
- Skill availability is filtered by enabled plugins at runtime.
- This provides a simple management surface before adding persistent DB-backed skill state.

Current built-in skills:

- `cf-introspect` → `cloudflare-api-mcp:introspect`
- `cf-list-zones` → `cloudflare-api-mcp:list-zones`
- `cf-list-dns-records` → `cloudflare-api-mcp:list-dns-records` (`input.zoneId` required)
- `mpp-status` → `mpp:status`
- `mpp-list-models` → `mpp:list-models`
- `artifacts-create-repo` → `artifacts:create-repo`
- `artifacts-import-repo` → `artifacts:import-repo`
- `artifacts-fork-repo` → `artifacts:fork-repo`

Example:

```bash
curl -X POST "https://<your-worker-url>/skills/invoke/cf-introspect" \
  -H "content-type: application/json" \
  -d '{"input":{"from":"skill"}}'
```

## Community and quality

- Contribution guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Execution plan / roadmap: [`docs/EXECUTION_PLAN.md`](./docs/EXECUTION_PLAN.md)
- Plugin SDK guide: [`docs/PLUGIN_SDK.md`](./docs/PLUGIN_SDK.md)
- Capability compatibility matrix: [`docs/CAPABILITIES.md`](./docs/CAPABILITIES.md)
- Release policy: [`docs/RELEASE_POLICY.md`](./docs/RELEASE_POLICY.md)
- Deployment runbook: [`docs/DEPLOYMENT_RUNBOOK.md`](./docs/DEPLOYMENT_RUNBOOK.md)
- Incident playbook template: [`docs/INCIDENT_PLAYBOOK.md`](./docs/INCIDENT_PLAYBOOK.md)
- Artifacts integration guide: [`docs/ARTIFACTS_INTEGRATION.md`](./docs/ARTIFACTS_INTEGRATION.md)
- Codex-web + Cloudflare MCP setup notes: [`docs/CODEX_WEB_SETUP.md`](./docs/CODEX_WEB_SETUP.md)
- PR and issue templates enforce problem-first, test-backed contributions and discourage low-quality auto-generated changes.

## Deploy to Cloudflare (production)

1. Authenticate Wrangler:

   ```bash
   npx wrangler login
   ```

2. Configure secrets with guided setup:

   ```bash
   npm run cf:bootstrap
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

   For full production steps + rollback, use [`docs/DEPLOYMENT_RUNBOOK.md`](./docs/DEPLOYMENT_RUNBOOK.md).

4. Smoke test (recommended automated check):

   ```bash
   npm run cf:smoke -- https://<your-worker-url>
   ```

   Optional deeper check (calls Cloudflare API `list-zones` via plugin):

   ```bash
   npm run cf:smoke -- https://<your-worker-url> --list-zones
   ```

### Cloudflare token guidance

- Set `CLOUDFLARE_API_TOKEN` (preferred) or `CLOUDFLARE_AGENT_TOKEN`.
- Scope tokens to least privilege (for example DNS + Workers permissions only if that is all you need).
- Agent Lee itself is a dashboard-native assistant; there is no separate Agent Lee API required to run this Worker.
- To access Cloudflare tools from your own agent, use Cloudflare's MCP endpoint (`https://mcp.cloudflare.com/mcp`) with OAuth or a bearer token flow.


### Cloudflare MCP login

This repo does not perform browser/OAuth login automatically. Use one of these approaches:

1. **OAuth in your MCP client** (recommended): add `https://mcp.cloudflare.com/mcp` as your server and complete the interactive OAuth prompt in your MCP client UI.
2. **Bearer token flow**: use a least-privilege Cloudflare token in your MCP client configuration if your client supports static bearer auth.

For this Worker runtime itself, `npm run cf:bootstrap` already configures the Cloudflare secret used by the `cloudflare-api-mcp` plugin.

### Cloud-only MCP setup (no local Worker required)

Yes — this is possible when you are "using cloud". You can connect your MCP client directly to Cloudflare MCP:

1. Generate config snippet:

   ```bash
   npm run cf:mcp:config
   ```

2. Paste output into your MCP client config (or manually set server URL to `https://mcp.cloudflare.com/mcp`).
3. Authenticate in the MCP client OAuth prompt, **or** provide bearer token headers if your client supports that.

This MCP setup is separate from your Worker deploy. Your Worker uses `npm run cf:bootstrap` for secrets; your MCP client uses OAuth/token directly against Cloudflare MCP.

## Enabling mpp plugin later

When you're ready to add `mpp`:

1. Set secret:

   ```bash
   npx wrangler secret put MPP_API_KEY
   ```

2. Update plugin/host allow-lists (`ENABLED_PLUGINS=cloudflare-api-mcp,mpp`, include `api.mpp.dev` in `ALLOWED_HOSTS`).
3. Deploy again.
