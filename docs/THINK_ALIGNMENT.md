# Project Think Alignment

This document maps Cloudflare's Project Think primitives to Open Think's current implementation, and lays out what's next.

## Mapping

| Think concept | Cloudflare primitive | Open Think delivery | Status |
| --- | --- | --- | --- |
| Per-agent identity + state | Durable Objects | `AgentSessionDO extends DurableObject<Env>`, keyed by session name | shipped |
| Transactional agent storage | DO SQLite | `ctx.storage.sql` with `messages` + `fibers` tables; declared via `new_sqlite_classes` migration | shipped |
| Session API (tree, fork, compact, search) | — | `/sessions/{name}/*` HTTP surface | shipped |
| Durable execution / fibers | Workflow-style checkpointing | `POST /sessions/{name}/fibers` upserts by idempotency key; first writer wins, replays return cached result | shipped (caller-driven); self-executing variant roadmap |
| Facets (sub-agents) | DO sub-namespaces | `fork` copies a session path; isolated namespace sub-ids roadmap | partial |
| Model inference (Cloudflare) | Workers AI | `workers-ai` plugin with AI Gateway routing | shipped |
| Model inference (external) | — | `anthropic`, `openai-compatible` provider plugins | shipped |
| Tool servers | MCP | `mcp-client` plugin (outbound, streamable-HTTP + SSE fallback) + `cloudflare-api-mcp` (inbound) | shipped |
| Tier-0 filesystem | R2 / workspace | `WORKSPACE` R2 binding documented in `wrangler.toml` | scaffolded |
| Tier-1 code exec | Dynamic Workers | `sandbox` plugin (tier-4 today); compile-deploy-on-the-fly roadmap | partial |
| Tier-2 MCP tool calls | MCP | `mcp-client` plugin | shipped |
| Tier-3 browser | Browser Rendering | `browser` plugin | shipped |
| Tier-4 full OS | Cloudflare Sandbox | `sandbox` plugin (service-binding) | shipped |
| Self-authored extensions | runtime tool authoring | plugin SDK + `npm run plugin:new` scaffold | shipped (human-authored); LLM-authored + Dynamic-Worker deploy is roadmap |
| Typed client | — | `src/sdk/client.ts` (`OpenThinkClient`, `SessionHandle`) | shipped |
| Meta-agent / control plane | — | `Helm` (`POST /conductor/message`) + `admin` plugin + `/app` UI | shipped |
| Full-text search | DO SQLite + FTS5 | `messages_fts` virtual table, trigger-synced | shipped |

## Relationship to the Cloudflare Agents SDK

Cloudflare ships an official [`agents`](https://developers.cloudflare.com/agents/) npm package with `Agent` / `AIChatAgent` base classes, `routeAgentRequest`, `@callable()` RPC over WebSockets, built-in scheduling and SQL.

Open Think is deliberately **orthogonal** to that SDK:

- The Agents SDK is opinionated (extend `Agent`, use `this.state`, use `@callable()` RPC).
- Open Think is a **plugin bus**: bring your own provider (Workers AI, Anthropic, OpenAI-compatible), bring your own tools (MCP, Browser, Sandbox, Artifacts), keep a clean HTTP surface.

Both can coexist. A natural roadmap step is an `agents-sdk-compat` plugin so projects already using `agents` can adopt Open Think's plugin catalog without rewriting their agent class.

## Why these choices

- **Durable Objects + SQL over Queues/Workflows for session state.** Sessions are conversational and branching, not pipeline-y. DO SQLite gives identity + isolation + structured queries in one primitive.
- **Plugins over a monolithic base class.** Teams can mix Workers AI with Anthropic + any OpenAI-compatible endpoint, add MCP servers, or plug in custom tools — without forking the runtime.
- **Restricted fetch, not sandboxing-by-default.** We lean on Cloudflare's native isolation and add a host allow-list. Sandboxes are opt-in via the `sandbox` plugin.
- **Idempotent fibers over complex workflow machinery.** Any caller can submit a durable job with an idempotency key; retries are deduped at the storage layer. This covers the 80% case for LLM tool-call durability without needing a separate Workflow engine.

## Roadmap

### Phase 7.x — Durable execution polish

1. Move `LIKE` substring search → FTS5 virtual table for real full-text search.
2. Add `POST /sessions/{name}/fibers/{id}/execute` — the DO calls a registered fiber handler (Worker service binding or internal plugin) and stores the result.
3. Cross-session `alarms` + scheduled fiber runs.

### Phase 8 — Self-authored extensions

1. `POST /sessions/{name}/extensions` with a typed TypeScript source blob scoped to the session.
2. Compile at request time via `@cloudflare/worker-bundler`, deploy to a per-session Dynamic Worker.
3. Emit audit events for each extension deploy + invocation; require capability claims.

### Phase 9 — Ecosystem

- Drop-in Claude Code / OpenClaw / Hermes connector plugins so users can point existing agent flows at Cloudflare.
- `agents-sdk-compat` plugin that bridges Open Think's plugin catalog to Cloudflare's `Agent` base class.
- Community plugin registry with verified publisher badges and `schema.json` typed input/output contracts.
- WebSocket streaming chat (`GET /sessions/{name}/chat` → hibernation-friendly DO WebSocket).

## Security boundaries preserved

- No plugin gets direct `fetch`; they use the runtime's restricted fetch (`ALLOWED_HOSTS`).
- Enabling Browser / Sandbox / Artifacts each requires an explicit binding in `wrangler.toml` — the plugin refuses to initialize otherwise.
- Fiber/extension flows (roadmap) will require the session DO to accept a signed request from the main Worker, preventing cross-session tampering.
- All session state lives inside a per-session DO with SQLite isolation — no shared mutable storage, no cross-agent leakage.
