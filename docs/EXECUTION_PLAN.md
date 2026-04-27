# Execution Plan: Community-Ready, Security-First Runtime

This plan prioritizes contributor experience and quality controls while expanding Cloudflare-native integrations and Project Think primitives.

## Phase 1 — Governance and contribution quality (Week 1) ✅

1. ✅ Published contribution standards and anti-slop rules.
2. ✅ Added issue and PR templates requiring scope, tests, and security impact.
3. ✅ Defined maintainer review checklist and ownership model.

## Phase 2 — Runtime hardening (Weeks 1-2) ✅

1. ✅ Enforced outbound host allow-list in plugin HTTP helpers.
2. ✅ Added startup validation that each enabled plugin has required secrets.
3. ✅ Added request schema validation for `/invoke/{pluginId}` payloads.
4. ✅ Added structured error IDs for easier debugging/support.

## Phase 3 — Plugin SDK and examples (Weeks 2-3) ✅

1. ✅ Added a plugin authoring guide with a minimal template plugin.
2. ✅ Added test utilities/mocks for plugin integration tests.
3. ✅ Published compatibility contract for capabilities and metadata.
4. ✅ Fixed scaffold template bug (`create_plugin.mjs`).

## Phase 4 — Integrations and MCP expansion (Weeks 3-4) ✅

1. ✅ Expanded Cloudflare API MCP plugin to cover common ops workflows.
2. ✅ Deepened `mpp.dev` plugin (model listing, health checks, error mapping).
3. ✅ Added Artifacts plugin (Git-for-agents).
4. ✅ Added connector architecture for additional CF-native services.
5. ✅ Added `workers-ai`, `mcp-client`, `browser`, `sandbox` first-party plugins.

## Phase 5 — Release and operations readiness (Week 4) ✅

1. ✅ CI for typecheck/tests and required PR checks.
2. ✅ Versioning and changelog policy.
3. ✅ Deployment runbook for Cloudflare Workers.

## Phase 6 — Observability and reliability (Week 5) ✅

1. ✅ Structured audit logs for plugin/skill invocations and request failures.
2. ✅ Error-rate counters + alert-check endpoint with optional webhook fanout.
3. ✅ Incident response playbook templates.

## Phase 7 — Project Think primitives (Weeks 6-7) ✅

**Shipped**

1. ✅ `AgentSessionDO` extends `DurableObject<Env>` with real SQLite storage (`ctx.storage.sql`).
2. ✅ `messages` + `fibers` tables with indexes on `parent_id`, `created_at`, `status`.
3. ✅ `/sessions/{name}/*` HTTP surface: `init`, `messages`, `tree`, `fork`, `compact`, `search`.
4. ✅ Durable execution (`POST /sessions/{name}/fibers`) with idempotency-key upsert — first writer wins.
5. ✅ Workers AI plugin with AI Gateway routing (`AI_GATEWAY_ID`).
6. ✅ MCP client plugin (outbound JSON-RPC, SSE fallback).
7. ✅ Browser Rendering plugin (tier-3) and Sandbox plugin (tier-4).
8. ✅ Runtime instance cached per-env via WeakMap.
9. ✅ `/playground` HTML UI and `/openapi.json` document.

**Roadmap (Phase 7.x)**

- ✅ FTS5 virtual table with trigger-synced `messages_fts` (replaces `instr(lower(), lower())`).
- ⏳ `POST /sessions/{name}/fibers/{id}/execute` — DO invokes a registered handler (service binding) and stores the result, with retry via alarms.
- ⏳ WebSocket streaming for `chat` — hibernation-friendly DO WebSocket.

## Phase 8 — One-click deploy and DX polish (Week 8) ✅

**Shipped**

1. ✅ [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_ORG/open-think) button + `package.json#cloudflare.bindings` describing each binding (the official Cloudflare mechanism — no fictional manifest).
2. ✅ `nodejs_compat_v2` compatibility flag (current best practice).
3. ✅ `.dev.vars.example` drives secret prompting during deploy.
4. ✅ Cross-platform Node-based `cf:bootstrap` wizard.
5. ✅ Interactive `/playground` and `/openapi.json`.
6. ✅ Typed SDK client at `src/sdk/client.ts` (`OpenThinkClient`, `SessionHandle`).
7. ✅ Skill catalog covers all first-party plugins.

**Roadmap**

- ⏳ Publish `@open-think/sdk` as a standalone npm package.
- ⏳ `npx create-open-think@latest` scaffolding CLI.
- ⏳ VS Code extension reading `/openapi.json` for typed skill calls from the editor.

## Phase 9 — Ecosystem and migration paths (Week 9+)

**Shipped**

1. ✅ `anthropic` plugin (Claude Messages API).
2. ✅ `openai-compatible` plugin (Groq / Together / Ollama / any OpenAI-compatible endpoint).

**Roadmap**

- ⏳ Drop-in Claude Code / OpenClaw / Hermes connector plugins (bring your existing agent flows to Open Think without rewriting).
- ⏳ `agents-sdk-compat` plugin bridging to Cloudflare's official `agents` package.
- ⏳ Community plugin registry with verified publisher badges and `schema.json` typed contracts.
- ⏳ Self-authored extensions — LLM writes a TypeScript tool, we compile-and-deploy to a per-session Dynamic Worker.

## Phase 10 — Meta-agent + UI (Week 10) ✅

**Shipped**

1. ✅ `admin` plugin with `introspect`, `health-check`, `suggest-plugins`, `env-template` actions.
2. ✅ `RuntimeIntrospection` handle threaded through `PluginContext`.
3. ✅ **Conductor** meta-agent (`POST /conductor/message`) — reads the live skill catalog, proposes skill invocations via fenced `open-think-action` blocks, persists to `AgentSessionDO`.
4. ✅ New `/app` UI — editorial broadsheet aesthetic (Fraunces + Newsreader + JetBrains Mono, ivory paper, ink black, Cloudflare-orange accent), keyboard-nav (`g p`, `g c`, …), approve-to-run exhibit cards, debug dashboard, session inspector, skill runner.
5. ✅ API responses normalized to `{ ok, data }` (UI + SDK depend on consistent shape).

## Phase 17 — Cross-provider streaming + update-style rollback (Week 17) ✅

**Shipped**

1. ✅ [`src/tool-stream-types.ts`](../src/tool-stream-types.ts) — provider-agnostic `LoopEvent` union + `ToolLoopConfig` surface. Every streaming adapter emits the same shape so downstream consumers (HTTP/SSE handler, UI, durable hubs) are provider-free.
2. ✅ [`src/openai-stream.ts`](../src/openai-stream.ts) — `runOpenAICompatibleToolStream` parses OpenAI SSE, accumulates `tool_calls` across delta chunks (id only on first, arguments appended), drives the full multi-turn tool-use loop, honors the `finish_reason: "tool_calls"` signal, and supports per-turn extra headers (e.g. `cf-aig-authorization` for gateway BYOK).
3. ✅ [`src/anthropic-stream.ts`](../src/anthropic-stream.ts) refactored to import shared types; no behavior change, unlocks provider-polymorphic consumers.
4. ✅ [`src/conductor-tool-stream.ts`](../src/conductor-tool-stream.ts) gained a `selectProvider()` + `createGenerator()` dispatch. Default priority: `anthropic` → `cf-ai-gateway` → `openai-compatible`. Response headers carry `x-stream-id` + `x-stream-provider`. cf-ai-gateway path reuses the OpenAI adapter against the compat endpoint (`/v1/{acct}/{gw}/compat`).
5. ✅ `/app` UI — stream mode auto-picks the first capable provider from the enabled plugin set; label in the assistant bubble shows which one drove the turn.
6. ✅ [`src/rollback.ts`](../src/rollback.ts) — `RegistryEntry` promoted to a discriminated union of `CreateDeleteEntry` + `UpdateEntry`. Three update entries shipped: `dns_record_update`, `kv_namespace_update`, `hyperdrive_config_edit`.
7. ✅ New `getUpdateCaptureStrategy()` API returns `{captureCall, buildHint}`. The `mcp-client` plugin runs the capture tool before any registered update-style mutation, attaches a rollback hint that re-applies the captured fields. Capture-failure path leaves the mutation in place but skips the hint (non-fatal).
8. ✅ `listMcpRollbackSupport()` now tags each entry with its `kind` so the UI can render create-delete vs. restore Undo cards differently if desired.
9. ✅ 13 new tests (5 OpenAI streaming + 7 update-style rollback + 1 listMcpRollbackSupport shape) covering: text-only turn, tool_call chunk accumulation, dangerous-skill hold, extra-headers injection, `[DONE]` sentinel handling, update capture/restore for all three shipped entries, null-safety on missing ids + empty captures. Total tests 102 → 115.
10. ✅ [`docs/HELM.md`](./HELM.md) updated with cross-provider support; [`docs/ROLLBACK.md`](./ROLLBACK.md) adds update-style registry table + pre-mutation capture flow.

**Roadmap**

- ⏳ Google AI Studio native streaming adapter (Gemini SSE has its own shape).
- ⏳ Multi-subscriber tool-streaming — promote the streaming generators into the `StreamHubDO` so multi-tab works for stream-tools, not just `/conductor/stream`.
- ⏳ More update-style entries (`worker_settings_put`, `zone_setting_update`, `queue_settings_update`) once we verify CF MCP tool names.
- ⏳ Before/after diff renderer in the UI — show captured state side-by-side with current so "undo" is visually concrete.
- ⏳ Multi-step batch rollback.

## Phase 16 — Native tool-use streaming + MCP rollback (Week 16) ✅

**Shipped**

1. ✅ [`src/anthropic-stream.ts`](../src/anthropic-stream.ts) — async generator that talks to Anthropic's Messages API with `stream: true`, parses SSE frames, drives the tool-use loop end-to-end, and yields typed `LoopEvent` unions (text-delta, tool-use-start/input/stop, tool-result, tool-held, turn-start/stop, loop-done, error).
2. ✅ [`src/conductor-tool-stream.ts`](../src/conductor-tool-stream.ts) — HTTP handler that loads session history, primes the generator, and pipes every event into a browser SSE response. Persists the final assistant text back to the session DO on `loop-done`.
3. ✅ New route `POST /conductor/stream-tools`; the `/app` stream mode auto-picks it when `anthropic` is in the enabled plugins, falls back to `/conductor/stream` (codex app-server) otherwise.
4. ✅ Selective-mode **dangerous-skill hold**: the loop emits `tool-held` and continues without executing, letting the UI render an approve-to-run exhibit card mid-stream.
5. ✅ [`src/rollback.ts`](../src/rollback.ts) — registry of 8 Cloudflare MCP inverse operations (KV, D1, R2, Hyperdrive, AI Gateway, DNS, Workers, Queues) with `planMcpRollback(name, input, response)` that synthesises the inverse call or returns null.
6. ✅ `mcp-client` plugin now calls `planMcpRollback` on every successful `call-tool` and attaches `_rollback` to the result payload.
7. ✅ `SessionMessage` schema extended with `rollback?` + `rollbackStatus?`; `AgentSessionDO` columns added with `ALTER TABLE` guards so existing sessions migrate cleanly.
8. ✅ New session routes: `GET /sessions/:name/rollbacks`, `POST /sessions/:name/apply-rollback`, plus `GET /rollback/support` for registry introspection.
9. ✅ `/app` UI — stream mode distinguishes Anthropic (`stream-tools`) vs codex (`stream`) visually; text deltas land in the bubble as they arrive; dangerous tool-use blocks appear as exhibit cards mid-stream; post-turn rollback cards render with warn-colored borders and an **↻ Undo** button.
10. ✅ 11 new tests (4 Anthropic streaming + 7 rollback registry) covering SSE parse, text-only turn, tool-loop-with-feedback, selective-mode hold, missing-key error, 6 registry mappings. Total test count 89 → 100.
11. ✅ [`docs/ROLLBACK.md`](./ROLLBACK.md) (new) and streaming-tool-use section added to [`docs/HELM.md`](./HELM.md).

**Roadmap**

- ⏳ OpenAI-compatible streaming adapter emitting the same `LoopEvent` shape — unlocks Groq/Together/Ollama guided setup.
- ⏳ cf-ai-gateway adapter that routes Anthropic-native streaming through the gateway for observability + caching.
- ⏳ Multi-subscriber tool-streaming (current handler is single-sub) — requires moving the generator into `StreamHubDO` and promoting the event union to SSE.
- ⏳ Before/after diffing for update-style MCP mutations.
- ⏳ Multi-step rollback (undo last N as a batch).
- ⏳ Rollback preview / dry-run mode.

## Phase 15 — Multi-subscriber streaming + Settings panel (Week 15) ✅

**Shipped**

1. ✅ [`src/durable/eventBus.ts`](../src/durable/eventBus.ts) — bounded replay buffer + fan-out, fully unit-testable in isolation. 6 tests covering fan-out, late-joiner replay, buffer bounds, close semantics, post-close rejection, explicit disconnect.
2. ✅ [`src/durable/streamHub.ts`](../src/durable/streamHub.ts) — `StreamHubDO` owns one upstream WebSocket per turn, fans frames out via `EventBus`, persists final assistant text back to the session DO, retires cleanly on terminal frame or interrupt.
3. ✅ Wrangler migration `v2` adds `StreamHubDO` as a new (non-SQLite) DO class; types + binding (`STREAM_HUBS`) wired.
4. ✅ New stream routes: `POST /conductor/stream` creates a hub and opens first subscription (unchanged UX), `GET /conductor/stream/:id` reconnects, `POST /conductor/stream/:id/interrupt` cancels via `turn/interrupt`, `GET /conductor/stream/:id/state` peeks without subscribing.
5. ✅ UI — stream mode bubble gains a **◈ Cancel turn** button, stream id label for debugging, graceful cancellation event handling.
6. ✅ [`src/setup.ts`](../src/setup.ts) — `collectStatus()` aggregates 10 capability checks with configured/missing detection, `generateSnippet()` emits merge-friendly wrangler.toml + .dev.vars fragments, `guidedStart()` creates a setup session primed with full runtime context + MCP availability.
7. ✅ New routes `GET /setup/status`, `POST /setup/snippet`, `POST /setup/guided-start`.
8. ✅ New `/app` **Settings** tab (`g t` keyboard shortcut): readiness score bar, recommended actions callout, guided-setup CTA that primes the Conductor and jumps to `#/conductor`, capability checklist with per-card status + hints, live snippet generator with checkbox picker and two-column wrangler/.dev.vars panes.
9. ✅ 12 new tests covering EventBus (6) and setup (6). Total test count up to 93.
10. ✅ Docs: new [`docs/SETUP.md`](./SETUP.md), streaming section in [`docs/HELM.md`](./HELM.md) rewritten to reflect DO-backed hub + cancellation.

**Roadmap**

- ⏳ Stream the guided-setup session itself via `/conductor/stream` so MCP tool calls animate live.
- ⏳ Bulk-apply snippets — a button that calls CF API directly to create all listed resources in one shot (needs audit trail).
- ⏳ Rollback — capture pre-turn state so unintended MCP mutations can be reversed.
- ⏳ Hub idle eviction — currently DOs auto-retire on close; consider a hard TTL for safety.

## Phase 14 — Streaming + companion bridge (Week 14) ✅

**Shipped**

1. ✅ `rpcStream()` in [`src/oauth/codexRpc.ts`](../src/oauth/codexRpc.ts) — async generator that opens one outbound WebSocket and yields every incoming JSON-RPC frame until the terminal result/error for the request id.
2. ✅ [`src/conductor-stream.ts`](../src/conductor-stream.ts) — new `POST /conductor/stream` handler that:
   - Validates `CODEX_APP_SERVER_URL` is `ws(s)://`.
   - Persists the user message to the session DO.
   - Starts a thread via `thread/start`, then pipes `turn/start` frames into a Server-Sent Events response.
   - Emits five distinct SSE event types: `ready`, `thread`, `notification`, `result`, `error`, `done`.
   - Persists the final assistant text back to the session DO when the stream closes cleanly.
3. ✅ UI — new **stream** mode on the Conductor composer. Uses `fetch().body.getReader()` + SSE parsing, renders `turn/delta` text live into the assistant bubble while the full event ledger appears in the trace panel.
4. ✅ [`companion/codex-bridge/`](../companion/codex-bridge/) — portable Node.js bridge (~250 lines) that wraps `codex app-server` stdio:
   - `POST /rpc` — single JSON-RPC request/response
   - `POST /stream` — SSE stream of every response frame
   - `GET /healthz` — liveness check
   - Bearer-auth via `BRIDGE_TOKEN`
   - Graceful signal handling + 120s per-RPC timeout
5. ✅ Dockerfile + README — three deployment recipes (Cloudflare Containers, Fly.io / Render, local + cloudflared). Healthcheck baked into the image.
6. ✅ Docs: streaming section added to [`docs/HELM.md`](./HELM.md), companion deployment replaces the old stub in [`docs/CODEX_APPSERVER.md`](./CODEX_APPSERVER.md).

**Roadmap**

- ⏳ DO-held persistent WebSocket to the app-server — lets multiple browser tabs watch one turn and avoids re-upgrading per request.
- ⏳ Native Cloudflare Sandbox deployment (API is still in beta; the container recipe covers 95% of users in the meantime).
- ⏳ Turn-cancellation from the UI (forwards `turn/interrupt` over the live stream).
- ⏳ Client-side replay — resume an interrupted stream by session + threadId without losing progress.

## Phase 13 — Fallback chains + Codex app-server bridge (Week 13) ✅

**Shipped**

1. ✅ `cf-ai-gateway:chat-with-fallbacks` — pass an ordered `models: string[]`; each entry is `provider/model-name`; return on first success with a full `attempts[]` ledger. Per-model timeout supported.
2. ✅ New skill `cf-gateway-chat-fallbacks` with typed `inputSchema`.
3. ✅ Conductor `fallbackModels?: string[]` (+ `perModelTimeoutMs`) that bypasses the primary provider and routes through the fallback chain, with the winning model surfaced via `providerUsed: "cf-ai-gateway/<model>"`.
4. ✅ `codex` plugin gains `app-server` auth mode (takes precedence over api-key / chatgpt-tokens).
5. ✅ `src/oauth/codexRpc.ts` — JSON-RPC 2.0 client that auto-detects transport by URL scheme (`http(s)://` → POST, `ws(s)://` → single-shot WebSocket upgrade via `fetch(url, { headers: { Upgrade: "websocket" } })`).
6. ✅ Five new Codex skills: `codex-thread-start`, `codex-thread-list`, `codex-models`, `codex-rpc` (raw passthrough, `dangerous: true`), plus `codex-chat` transparently upgrades to `thread/start` + `turn/start` in app-server mode.
7. ✅ Env + binding metadata for `CODEX_APP_SERVER_URL`, `CODEX_APP_SERVER_TOKEN`, `CODEX_APP_SERVER_TIMEOUT_MS`.
8. ✅ [`docs/CODEX_APPSERVER.md`](./CODEX_APPSERVER.md) — three deployment recipes: cloudflared-tunneled local dev, companion Sandbox Worker (skeleton), remote dev box.

**Roadmap**

- ⏳ Durable-Object-held WebSocket so `turn/start` streaming progress notifications survive request boundaries.
- ⏳ Native Universal-endpoint dispatch (array-of-provider-requests body) for AI Gateway fallbacks — reduces Worker CPU by pushing retry into CF edge.
- ⏳ Companion Sandbox Worker reference implementation that actually wires `codex app-server` stdio into an HTTP `/rpc` handler.
- ⏳ Automatic `CODEX_APP_SERVER_URL` health-probe on Worker cold start, with fallback to paste-in tokens if the bridge is unreachable.

## Phase 12 — Cloudflare AI Gateway + Codex subscription auth (Week 12) ✅

**Shipped**

1. ✅ `cf-ai-gateway` plugin — one plugin, 23+ providers via Cloudflare AI Gateway. Two routing paths:
   - Binding path (`env.AI.run('provider/model', ..., { gateway: { id } })`) — preferred.
   - Compat REST path (`gateway.ai.cloudflare.com/v1/{acct}/{gw}/compat/chat/completions`) — fallback or `forceCompat: true`.
2. ✅ BYOK support via `cf-aig-authorization: KEY_NAME` (Secrets Store reference) or `Authorization: Bearer ...` (direct).
3. ✅ `provider/model-name` validation with a catalog of 23 known providers.
4. ✅ Three new skills: `cf-gateway-chat`, `cf-gateway-list-providers`, `cf-gateway-status`.
5. ✅ `codex` plugin — two working auth modes plus scaffolded OAuth:
   - `api-key` — classic `OPENAI_API_KEY` against `api.openai.com/v1/chat/completions`.
   - `chatgpt-tokens` — paste `CODEX_ACCESS_TOKEN` (+ `CODEX_ID_TOKEN`) from `~/.codex/auth.json` after `codex login`; routes to `chatgpt.com/backend-api/codex/responses` so calls bill against your ChatGPT Plus/Pro subscription.
   - `oauth-device` — roadmap; routes + handler scaffolded at `/oauth/codex/device/{start,poll}`.
6. ✅ Three new Codex skills: `codex-chat`, `codex-status`, `codex-setup-instructions`.
7. ✅ Conductor `ConductorProvider` union widened to include `cf-ai-gateway` and `codex`; auto-mode tool loop works against both (both speak OpenAI function-calling via the compat endpoint).
8. ✅ New `/app` Providers tab — one card per path, live enabled/not-enabled state, one-tap "Probe" against the plugin's `status` action, gateway provider catalog listing.
9. ✅ [`docs/PROVIDERS.md`](./PROVIDERS.md) — full five-path matrix with setup snippets for each.

**Roadmap**

- ⏳ Live OAuth device-code dispatch (needs registered OpenAI OAuth client id).
- ⏳ `cf-ai-gateway` universal endpoint with fallback chains across providers.
- ⏳ Cache-control exposure via `cf-aig-*` headers (cacheTtl, skipCache).
- ⏳ Streaming SSE passthrough for auto-mode (currently buffers entire response).
- ⏳ `codex app-server` bridge via Sandbox service binding — JSON-RPC passthrough for full Codex thread/turn API.

## Phase 11 — Native tool-use + three setup paths (Week 11) ✅

**Shipped**

1. ✅ `SkillDefinition` extended with optional `inputSchema` (JSON Schema) and `dangerous: boolean`. Schemas declared for every first-party skill.
2. ✅ `AnthropicPlugin` accepts `tools[]`, `tool_choice`, and rich content blocks (`tool_use`, `tool_result`).
3. ✅ `OpenAICompatiblePlugin` accepts `tools[]`, `tool_calls` on assistant messages, and `role: "tool"` result messages.
4. ✅ `buildAnthropicTools()` / `buildOpenAITools()` descriptor builders map the live catalog to each provider's tool shape.
5. ✅ Conductor gains three modes:
   - **`propose`** — plans only; returns `suggestedActions[]` as exhibit cards (default, works with every provider).
   - **`selective`** — auto-runs safe skills, halts on `dangerous: true` with a pending proposal.
   - **`auto`** — full end-to-end tool loop with `maxIterations` cap (default 6, ceiling 12).
6. ✅ Every tool call persisted as a `role: "tool"` message in the session DO (idempotent replay).
7. ✅ `ConductorReply` returns `trace[]` of `{ skill, input, ok, result|error, durationMs }` — same shape for the UI and external agents.
8. ✅ UI composer has a three-state mode toggle; trace steps render as a timeline under the assistant reply; halted bannners for iteration-cap and dangerous-skill.
9. ✅ External-agent pattern documented in [`HELM.md`](./HELM.md#external-agents) — Claude Code / OpenClaw can drive Helm as a planner without embedding the runtime.

**Roadmap**

- ⏳ Workers AI native tool-use (llama-3.3 via `env.AI.run`) — currently falls back to propose mode.
- ⏳ Streaming replies via DO WebSockets (`GET /sessions/{name}/chat` upgrade).
- ⏳ Multi-agent fork — Conductor spawns narrow task agents per plan step into their own session DOs.
- ⏳ Per-skill rate limits to cap token spend on an external provider during runaway loops.
- ⏳ Session browser UI with tree visualisation (D3 dendrogram) instead of raw JSON.
- ⏳ Settings panel with `wrangler secret put` orchestration via Cloudflare API MCP.

## Exit criteria summary

- Any developer with a Cloudflare account can deploy a fully working agent runtime in <5 minutes.
- New first-party plugins can be added in <30 minutes with tests.
- Sessions survive Worker restarts and can be forked/compacted without code changes.
- Every incoming request is traceable by `x-request-id` with structured audit logs.
- Projects migrating from other agent frameworks can point existing tool contracts at Open Think via MCP with no rewrites.
