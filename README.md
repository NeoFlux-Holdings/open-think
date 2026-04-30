# Open Think

**A Cloudflare-native agent runtime + personal-assistant stack, inspired by [Project Think](https://blog.cloudflare.com/project-think/).**

Open Think gives you the building blocks of a production agent — durable sessions, tool plugins, MCP, Workers AI, Browser Rendering, Sandboxes — plus an opinionated **personal-assistant stack** (auth, memory, email, scheduling, push, durable workflows, cost tracking) wrapped in a security-first plugin system you can extend in minutes and deploy in one click.

Think of it as an OpenClaw- / Hermes-class runtime that lives entirely on Cloudflare's edge: zero when idle, mathematically cheap when busy, no VMs or containers to babysit. Architecture and code paths are documented in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

**Meet Helm** — the built-in meta-agent at [`/app`](docs/HELM.md) that reads your runtime, plans skill invocations, and gives you two modes:

- **plan** — describes what it would do without touching anything
- **execute** — native tool-use end-to-end via any enabled provider, with token streaming and a real interrupt button

Plus a **Shell** tab at `/app#/shell` — a real bash session in a Cloudflare Container, accessible from the browser (xterm.js) or terminal (`npm run shell -- --host your.workers.dev`).

**Five paths to a model** — pick any combination ([full matrix in docs/PROVIDERS.md](docs/PROVIDERS.md)):

| Plugin | What you get |
| --- | --- |
| `cf-ai-gateway` | **Cloudflare AI Gateway** — 23+ providers (Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek, xAI, Cerebras, HuggingFace, …) behind one binding with BYOK via Secrets Store |
| `workers-ai` | Direct Cloudflare-hosted models through `env.AI` (free tier available) |
| `anthropic` | Direct Anthropic Messages API |
| `openai-compatible` | Direct to any OpenAI-compatible endpoint (Groq, Together, Ollama, self-hosted) |
| `codex` | **OpenAI Codex** — API key, paste-in ChatGPT Plus/Pro subscription tokens from `codex login`, **or full `codex app-server` bridge over WebSocket/HTTP JSON-RPC** (no token rotation — the host's `codex` CLI owns OAuth). OAuth device-code flow also scaffolded. |

Your own agent (Claude Code, OpenClaw, custom) can also drive Helm via `POST /conductor/message` — treat it as a planner that emits `suggestedActions[]` your agent decides to execute. Pair with the Cloudflare MCP and you have a chat-first control plane for your whole account.

---

## Five ways to deploy

| Path | Audience | Time to first chat | What you keep |
|---|---|---|---|
| **Zero-config** — `wrangler deploy` from a fork | Anyone with a terminal | ~60 sec | Full control. Workers AI runs free. PA features opt-in later |
| **One-click button** — Cloudflare's [Deploy to Workers](https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think) | No CF account yet | ~5 min | CF handles signup + fork + first deploy in one flow |
| **Browser deploy** — paste a CF API token at [`/deploy/cloud`](https://beta.open-think.app/deploy/cloud) | CF account, no terminal | ~3 min | We upload the bundle via API — Worker live without touching wrangler. Token used once, never persisted |
| **Agent-driven** — paste a prompt into Cloudflare's Agent Lee or Claude/ChatGPT at [`/deploy/agent`](https://beta.open-think.app/deploy/agent) | Anyone who'd rather have an AI drive the deploy | ~3 min | The agent walks you through every step + verifies health. Same end-state as browser deploy |
| **Helm Cloud** — Stripe subscription, we push updates ([`/pricing`](https://beta.open-think.app/pricing)) | Hands-off + privacy | ~3 min | Worker runs in *your* CF account. Your data never touches us. Encrypted token rotates anytime. Cancel → Worker keeps running |

There's also [`/deploy/guided`](https://beta.open-think.app/deploy/guided) — a terminal-styled walkthrough variant of `/deploy/cloud` for users who want to *see* what's happening as click-through commands.

The fourth path is the privacy-first SaaS model documented in [`docs/ARCHITECTURE.md#helm-cloud`](./docs/ARCHITECTURE.md#helm-cloud-architecture-ii--managed-deploy-saas): your Worker runs in your account against your bindings; we hold a narrow deploy-only token, encrypted at rest, used to push the latest bundle on a schedule. Runtime data never crosses our infrastructure. See the [Helm Cloud runbook](./docs/HELM_CLOUD_RUNBOOK.md) for the operator side.

---

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_ORG/open-think)

> Replace `YOUR_ORG/open-think` with your fork URL.

**Zero-config default**: a fresh `wrangler deploy` produces a working chat agent in ~60 seconds with **no secrets to fill in**. Workers AI is bound by default and runs free; Helm picks it up automatically; auth runs in a "first-run permissive" mode that lets you visit `/app` and start chatting right away. A yellow banner reminds you to lock auth down before sharing the URL.

Open the deployed Worker root (`/` or `/welcome`) for a friendly checklist of what's wired up vs. still optional. Click **Open Helm** to chat.

### Add features when you want them

Each PA-stack feature is opt-in. Uncomment a single block in [`wrangler.toml`](./wrangler.toml), then redeploy:

| To enable | What to do |
| --- | --- |
| Long-term memory (D1 fallback) | `wrangler d1 create tom-tom-pa` → paste id → uncomment `[[d1_databases]]` |
| Outbound email | Enable Email Routing on your domain → uncomment `[[send_email]]` |
| Morning briefing | Uncomment `[[workflows]]` + `[triggers]` (D1 must be on first) |
| Web Push notifications | Open `/app#/settings` → click **Generate VAPID keys** (browser-side, never sent to server) → paste the three `wrangler secret put` commands |
| Cloudflare Access (auth) | dash → Zero Trust → Access → Applications → Self-hosted → set `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` |

Or run the all-in-one CLI wizard:

```bash
npm install
npm run pa:setup          # personal-assistant wizard: D1 + VAPID + Access prompts + deploy
# or
npm run cf:bootstrap      # bare-runtime wizard (no PA stack)
```

Both work on Windows / macOS / Linux.

---

## What you get on day one

| Primitive | Think equivalent | Open Think delivery |
| --- | --- | --- |
| Durable per-agent identity | Durable Objects | `AgentSessionDO` — `extends DurableObject<Env>` with real `ctx.storage.sql` |
| Transactional agent storage | DO SQLite | `messages` + `fibers` tables, recursive tree queries, `LIKE` search |
| Tree-structured message history | Session API | `GET|POST /sessions/{name}/messages`, `/tree`, `/fork`, `/compact`, `/search` |
| Durable execution (fibers) | Fiber checkpointing | `POST /sessions/{name}/fibers` with idempotency keys, `GET /fibers/{id}` |
| Tool servers (internal & external) | MCP | `mcp-client` plugin + existing `cloudflare-api-mcp` |
| Model inference | Workers AI + AI Gateway | `workers-ai` plugin with `AI_GATEWAY_ID` routing |
| External providers | — | `anthropic`, `openai-compatible` (Groq/Together/Ollama/etc.) |
| Web-scale tier-3 execution | Browser Rendering | `browser` plugin |
| Tier-4 execution | Cloudflare Sandbox | `sandbox` plugin |
| **Helm Shell** | — | Cloudflare-Container-backed bash at `/app#/shell` (xterm.js) + `npm run shell` (CLI). Per-session container, ephemeral disk, 15-min idle sleep |
| **CF infra control** | — | `cloudflare-admin` plugin — agent uses `CLOUDFLARE_API_TOKEN` to verify, list/create D1, KV, R2, secrets, Access apps. Generic `cf-api` escape hatch for anything else |
| Git-for-agents storage | Cloudflare Artifacts | `artifacts` plugin |
| Extensibility | Self-authored extensions | Plugin SDK + `npm run plugin:new` scaffold |
| Meta-agent | — | Helm at [`/app`](src/app.ts) — chat, plan, approve-to-run exhibit cards |
| Runtime introspection | — | `admin` plugin: `introspect`, `health-check`, `suggest-plugins`, `env-template`, `cost-today/range/cap/rollup` |
| **Auth** | — | Cloudflare Access JWT verification on every gated route; `DEV_AUTH_BYPASS=1` for local |
| **Long-term memory** | — | `memory` plugin — Cloudflare Agent Memory (private beta) when bound, D1 fallback otherwise |
| **Email (in/out)** | — | `email` plugin — `send_email` binding + Email Routing → `email()` handler with `postal-mime` |
| **Push (Web Push VAPID)** | — | `notifier` plugin — full RFC 8292 + RFC 8291 (ECDSA P-256, ECDH-ES + AES-128-GCM) |
| **Schedule** | — | Workers Cron Triggers → D1 `pa_workflows` → registered handlers (`morning-briefing`, `cost-rollup`, …) |
| **Durable workflows** | — | Cloudflare Workflows — `MorningBriefingWorkflow` (4-step, retried per step) |
| **Spending cap** | — | `enforceSpendingCap()` rolls AI Gateway analytics into D1 `cost_daily` for a hard daily ceiling |
| DX | — | `/app` (editorial UI), `/playground` (fallback), `/openapi.json`, skill catalog, typed SDK client (`src/sdk`) |

See [`docs/THINK_ALIGNMENT.md`](./docs/THINK_ALIGNMENT.md) for the full mapping, including the roadmap for fibers, facets, and dynamic-Worker code execution.

---

## Architecture

A canonical map of every code path lives at [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Quick orientation:

- **Three Workers**: agent runtime (`src/`), marketing site + Helm Cloud (`site/`), codex-bridge-worker (`companion/codex-bridge-worker/`). Each independently deployable.
- **Plugin bus**: `src/core/plugin.ts` defines the contract; `src/plugins/registry.ts` is the single source of truth for which plugins exist; turning one on is a comma in `ENABLED_PLUGINS`.
- **Skill catalog** (`src/core/skills.ts`): ~50 skills across 17 plugins, each with a JSON schema and a `dangerous` flag. This is what Helm calls; Helm doesn't see plugins, it sees skills.
- **Helm meta-agent** (`src/conductor.ts`): three modes (`propose`/`selective`/`auto`) × five providers; native tool-use streaming via `src/conductor-tool-stream.ts` + provider-specific adapters in `src/anthropic-stream.ts` / `src/openai-stream.ts`.
- **PA stack** (auth/memory/email/scheduler/notifier/workflows/cost): nine features built on native CF primitives, all opt-in, all degrade gracefully when bindings are missing. See [`docs/PA_STACK.md`](./docs/PA_STACK.md).
- **Helm Cloud SaaS layer** (`site/src/cloud/`): D1-persisted deployments with AES-256-GCM encrypted tokens, hourly cron pushes from a manifest URL, manage page + four actions (pause/resume/rotate-token/billing-portal).
- **OpenAPI** at `/openapi.json`, **playground** at `/playground`, **Helm UI** at `/app`.

---

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in CLOUDFLARE_API_TOKEN
npm run dev
```

Then open:

- <http://127.0.0.1:8787/playground> — interactive UI
- <http://127.0.0.1:8787/openapi.json> — machine-readable API
- <http://127.0.0.1:8787/skills> — available skills

---

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /` | Route map + service metadata |
| `GET /app` | Helm + dashboard UI (editorial broadsheet) |
| `POST /conductor/message` | Send a message to Helm (the meta-agent) |
| `GET /playground` | Simpler fallback UI |
| `GET /openapi.json` | OpenAPI 3.0 document |
| `GET /health` | Plugin/skill counts, DO/AI binding presence |
| `GET /plugins` | Loaded plugin metadata |
| `GET /skills` | Available skills (filtered by enabled plugins) |
| `GET /metrics` | In-memory counters |
| `POST /alerts/check` | Error-rate evaluation + optional webhook fanout |
| `POST /invoke/{pluginId}` | Invoke a plugin action |
| `POST /skills/invoke/{skillId}` | Invoke a named skill |
| `POST /sessions/{name}/init` | Create or attach a session |
| `GET /sessions/{name}` | Describe session |
| `GET \| POST /sessions/{name}/messages` | List or append messages |
| `GET /sessions/{name}/tree` | Tree view of messages |
| `POST /sessions/{name}/fork` | Fork from a message id into a new session |
| `POST /sessions/{name}/compact` | Record a compaction summary |
| `POST /sessions/{name}/search` | Substring search over messages |
| `GET \| POST /sessions/{name}/fibers` | List / upsert durable idempotent jobs |
| `GET /sessions/{name}/fibers/{id}` | Fetch a fiber by id |

---

## Security model

- Secrets flow only through Worker bindings (`wrangler secret put`).
- `ENABLED_PLUGINS` is an explicit allow-list — runtime fails fast on unknown ids.
- Each plugin declares required secrets; bootstrap refuses to start without them.
- Outbound fetches from plugins go through a restricted fetch that blocks any host not in `ALLOWED_HOSTS`.
- All plugin / skill invocations emit structured audit logs with a `requestId` header echoed on the response.
- Plugin capabilities are validated against a canonical set (see [`docs/CAPABILITIES.md`](./docs/CAPABILITIES.md)).

---

## Config reference

| Variable | Required | Description |
| --- | --- | --- |
| `ENABLED_PLUGINS` | yes | Comma-separated plugin ids, e.g. `cloudflare-api-mcp,workers-ai`. |
| `ALLOWED_HOSTS` | yes | Comma-separated outbound host allow-list. |
| `CLOUDFLARE_API_TOKEN` | for CF plugin | Preferred Cloudflare API token (scoped). |
| `CLOUDFLARE_AGENT_TOKEN` | optional | Alternative Cloudflare Agent token. |
| `MCP_DEFAULT_URL` | for mcp-client | Default outbound MCP server URL. |
| `MCP_BEARER_TOKEN` | optional | Bearer token for the default MCP server. |
| `AI_GATEWAY_ID` | optional | Route `workers-ai` runs through an AI Gateway. |
| `MPP_API_KEY` | for mpp | API key for `mpp.dev`. |
| `ANTHROPIC_API_KEY` | for anthropic | Enables the `anthropic` provider plugin. |
| `OPENAI_COMPATIBLE_URL` | for openai-compatible | Base URL for any OpenAI-compatible endpoint. |
| `OPENAI_COMPATIBLE_KEY` | optional | Bearer key for the OpenAI-compatible endpoint. |
| `MODEL_DEFAULT` | no | Default model id exposed to plugins. |
| `ALERT_ERROR_RATE_PCT` | no | Threshold for `POST /alerts/check` (default `5`). |
| `ALERT_WEBHOOK_URL` | no | Optional webhook target for alert fanouts. |
| `AI` binding | for workers-ai | Workers AI binding (`[ai]` in wrangler.toml). |
| `AGENT_SESSIONS` binding | for sessions | Durable Object namespace (configured by default). |
| `BROWSER` binding | for browser plugin | Cloudflare Browser Rendering binding. |
| `SANDBOX` service | for sandbox plugin | Cloudflare Sandbox worker bound as a service. |
| `ARTIFACTS` binding | for artifacts plugin | Cloudflare Artifacts binding. |

---

## Extending with a new plugin

```bash
npm run plugin:new -- my-plugin-id
```

This generates `src/plugins/community/my-plugin-id.ts` + test scaffold. Then:

1. Implement actions in the generated class.
2. Export it from `src/plugins/registry.ts`.
3. Add the plugin id to `ENABLED_PLUGINS` and any required hosts to `ALLOWED_HOSTS`.

See [`docs/PLUGIN_SDK.md`](./docs/PLUGIN_SDK.md) for the contract and best practices.

---

## Production deploy

1. `npx wrangler login`
2. `npm run cf:bootstrap` (writes secrets, optionally deploys)
3. `npm run deploy`
4. `npm run cf:smoke -- https://<your-worker-url>` (optionally `--list-zones`)

Full runbook: [`docs/DEPLOYMENT_RUNBOOK.md`](./docs/DEPLOYMENT_RUNBOOK.md).

---

## Community & quality

- [**Architecture**](./docs/ARCHITECTURE.md) — how the three Workers, plugin bus, skill catalog, PA stack, and Helm Cloud SaaS layer fit together
- [**PA stack**](./docs/PA_STACK.md) — 9-feature personal-assistant build on native Cloudflare primitives (Access + Agent Memory + Email Workers + Workflows + Cron + AI Gateway)
- [**Helm Cloud runbook**](./docs/HELM_CLOUD_RUNBOOK.md) — operator manual for the SaaS layer (secrets, monitoring, incidents, pre-flight checklist)
- [Helm meta-agent](./docs/HELM.md) — approve-to-run chat control plane
- [Providers](./docs/PROVIDERS.md) — five paths to a model (CF AI Gateway, Workers AI, Anthropic, OpenAI-compat, Codex)
- [Codex app-server bridge](./docs/CODEX_APPSERVER.md) — deployment recipes for full subscription auth via JSON-RPC
- [Rollback](./docs/ROLLBACK.md) — undo destructive Cloudflare MCP operations via a shipped inverse registry
- [Companion codex-bridge](./companion/codex-bridge/) — deployable Node/Docker server that wraps `codex app-server` into HTTP + SSE
- [Companion codex-bridge-worker](./companion/codex-bridge-worker/) — Cloudflare-native bridge alternative (no Docker, manual token rotation)
- [Contribution guide](./CONTRIBUTING.md) — anti-slop policy + AI disclosure requirement
- [Execution plan](./docs/EXECUTION_PLAN.md) — phase-by-phase shipped log
- [Plugin SDK](./docs/PLUGIN_SDK.md)
- [Capability matrix](./docs/CAPABILITIES.md)
- [Release policy](./docs/RELEASE_POLICY.md)
- [Deployment runbook](./docs/DEPLOYMENT_RUNBOOK.md)
- [Incident playbook](./docs/INCIDENT_PLAYBOOK.md)
- [Think alignment doc](./docs/THINK_ALIGNMENT.md)
- [Artifacts integration](./docs/ARTIFACTS_INTEGRATION.md)
- [Codex-web + MCP setup](./docs/CODEX_WEB_SETUP.md)

### Test counts (current)

- Main repo (`test/`): **194 tests** — runtime, plugins, conductor, streaming, rollback, web push, scheduler, cost tracking, auth.
- Site (`site/test/`): **70 tests** — CF API client, deploy orchestrator, crypto, deployments repo, push updates, session-claim ledger + signed-cookie helpers, mergeBindings, listStuckDeployments.
- All `npm run typecheck` and `npm test` green across root + site + bridge-worker.
