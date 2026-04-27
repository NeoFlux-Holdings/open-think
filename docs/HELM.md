# Helm

**Helm** is Open Think's meta-agent: a chat-first surface that reads your runtime's plugin catalog, plans skill invocations, and can either (a) hand you approve-to-run exhibit cards, (b) auto-execute only safe skills, or (c) run end-to-end autonomously. Three modes, one API.

> Helm was previously called "the Conductor". API routes and session names still use `conductor` for backward compatibility; the name was changed to avoid collision with [conductor.build](https://conductor.build).

- Routing: `POST /conductor/message` (the `/helm/*` alias is planned; the `/conductor/*` path remains the canonical routing for now)
- UI: [`/app`](../src/app.ts) → §10 Helm
- Session storage: any `AgentSessionDO` (default name `conductor:default`)

## Three setup paths

Open Think deliberately supports three ways to stand up an agent stack — pick whichever fits:

| Path | Who drives | Best for |
| --- | --- | --- |
| **Manual / wizard** | User runs `npm run cf:bootstrap`, edits `wrangler.toml`, sets secrets via `wrangler secret put`. | You want maximum control and auditability. |
| **Helm — propose mode** | Chat with Helm; it suggests skill invocations as exhibit cards; you tap Execute on each. | You want a guided setup that still lets you inspect every step. |
| **Helm — auto mode** | Chat with Helm; it runs the plan end-to-end via native tool-use. | You want the fastest path; you trust Helm's judgment or the task is read-only. |

There is also a fourth: **another agent drives Helm**. Your Claude Code / OpenClaw / custom agent calls `POST /conductor/message` with `mode: "propose"` to get a plan, then invokes `POST /skills/invoke/{skillId}` for the steps it chooses. See [External agents](#external-agents) below.

## Modes

```json
POST /conductor/message
{
  "sessionName": "conductor:default",
  "content": "check runtime health and enable Anthropic if missing",
  "mode": "propose" | "selective" | "auto",
  "provider": "workers-ai" | "anthropic" | "openai-compatible",
  "model": "claude-haiku-4-5-20251001",
  "maxIterations": 6
}
```

### `propose` — the safe default

Helm plans but never executes. It emits one or more fenced JSON blocks:

    ```open-think-action
    {"skill": "admin-health-check", "input": {}}
    ```

The server parses these into `suggestedActions[]`. The UI renders each as an Exhibit card; you tap Execute to run that single skill. This works with every provider — no native tool-use required, so it's the only mode available for Workers AI today.

### `selective` — auto-run safe skills, halt on dangerous

Helm calls skills directly using the provider's native tool-use API. When it tries to call a skill marked `dangerous` in the catalog, the loop halts, the pending tool call becomes a `suggestedActions[]` entry, and you see a banner in the UI:

> ◈ Selective mode halted on a dangerous skill. Approve the exhibit below to continue.

This is the "best of both" mode — autonomous for reads and introspection, human-in-the-loop for anything that mutates state.

### `auto` — end-to-end

Full autonomous tool loop. Helm calls any skill, including dangerous ones, until it either produces a final reply or hits `maxIterations` (default 6, ceiling 12). Every tool call is persisted as a `role: "tool"` message in the session DO, so subsequent turns see the full history.

Requires `anthropic` or `openai-compatible` provider — Workers AI falls back to `propose` mode automatically.

## Dangerous skills

A skill is `dangerous: true` if it mutates account state or performs tier-4 execution. Current catalog:

- `sandbox-exec` — arbitrary shell/code execution
- `artifacts-create-repo` / `import-repo` / `fork-repo` — account mutations
- `mcp-call-tool` — opaque; the invoked MCP tool may do anything

The rest (`admin-*`, `cf-list-*`, `ai-chat`, `browser-fetch`, `mcp-list-tools`, etc.) are safe — read-only or idempotent. Add `dangerous: true` to your own skills if they write state.

## Flow (auto mode)

```
user message → POST /conductor/message { content, mode: "auto" }
   │
   ▼
AgentSessionDO.init()
   │  append user message
   │  load history
   ▼
build tools[] from SkillManager.listSkills()  (Anthropic or OpenAI shape)
build system prompt with skill catalog + mode preamble
   │
   ▼
loop while iterations < maxIter:
   runtime.invoke(provider, { action: "chat", input: { messages, tools, tool_choice: "auto" } })
   │
   ├─ assistant text only → break, return
   │
   └─ tool_use / tool_calls →
       for each:
         find skill by id
         if (mode === "selective" && skill.dangerous) → halt loop, add to suggestedActions
         else runtime.invoke(skill.pluginId, { action, input }) → store in trace + session
       append tool results to messages, continue loop
   ▼
append final assistant text to session
return { assistantMessage, suggestedActions[], trace[], iterationsUsed, halted }
```

## Streaming native tool-use (Anthropic)

`POST /conductor/stream-tools` runs the full tool-use loop **while the provider streams deltas back**, piping every stage into Server-Sent Events:

```
event: ready              { streamId, provider, sessionName }
event: turn-start         { turn: 1 }
event: text-start         { index: 0 }
event: text-delta         { text: "I'll check " }
event: text-delta         { text: "your runtime." }
event: text-stop          { index: 0, text: "I'll check your runtime." }
event: tool-use-start     { id, name: "admin-health-check" }
event: tool-use-input     { id, partial: "{}" }
event: tool-use-stop      { id, name, input: {} }
event: tool-result        { toolUseId, skill, ok, durationMs, data }
event: turn-stop          { turn, stopReason: "tool_use" }
event: turn-start         { turn: 2 }
event: text-delta         { text: "All clear!" }
event: loop-done          { reason: "end-turn", finalText: "..." }
event: done               { finalText }
```

The `/app` UI's **stream** mode auto-picks this route whenever `anthropic` is in the enabled plugin set — guided-setup sessions animate with live text deltas and exhibit cards for any held dangerous skills. In `selective` mode (the default for stream-tools), each dangerous tool call emits a `tool-held` event and the UI renders an approve-to-run card while the loop proceeds without blocking.

**Supported providers**: `anthropic` (native `tool_use` blocks), `openai-compatible` (Groq / Together / Ollama / any endpoint with OpenAI-style `tool_calls`), and `cf-ai-gateway` (compat endpoint fronting any of the 23+ providers via `provider/model` strings). Every adapter emits the same `LoopEvent` union from [`src/tool-stream-types.ts`](../src/tool-stream-types.ts); the SSE frames the browser sees are identical regardless of which model served the turn.

Default selection priority: `anthropic` → `cf-ai-gateway` → `openai-compatible`. Override per-call with `{"provider": "..."}` in the request body.

## Undo (rollback)

Successful destructive MCP operations now attach a rollback hint that the UI surfaces as a **↻ Undo** card after the turn. See [docs/ROLLBACK.md](./ROLLBACK.md) for the shipped registry, endpoints, and the design rationale.

## Streaming (SSE over a codex app-server WebSocket)

Streaming is now backed by the `StreamHubDO` — a per-turn Durable Object that owns the upstream WebSocket and fans frames out to any number of SSE subscribers with a bounded replay buffer. Multiple browser tabs can watch one turn; a browser refresh mid-turn picks up from the last ~500 buffered frames automatically.

`POST /conductor/stream` turns a conductor turn into a live Server-Sent Events feed. Requires `CODEX_APP_SERVER_URL` pointing at a `ws(s)://` endpoint (the [codex-bridge companion](./CODEX_APPSERVER.md) is the recommended target).

Additional routes (all backed by the same `StreamHubDO`):

| Route | Method | Purpose |
| --- | --- | --- |
| `/conductor/stream` | POST | Create a new turn + open the first SSE subscription. Returns `x-stream-id` header. |
| `/conductor/stream/:id` | GET | Subscribe to an existing turn (replay buffer + live events). |
| `/conductor/stream/:id/interrupt` | POST | Cancel the in-flight turn via `turn/interrupt`. |
| `/conductor/stream/:id/state` | GET | Peek at status, subscriber count, turn id, etc. without subscribing. |

### Cancellation

Every streaming assistant bubble gets a **◈ Cancel turn** button (wired in `/app`). Clicking it POSTs to `/conductor/stream/:id/interrupt`, which:

1. Sets the DO's `interruptRequested` flag so the `rpcStream` generator exits cleanly on its next frame.
2. Sends a separate `turn/interrupt` JSON-RPC over a short-lived WebSocket to the app-server.
3. Publishes a `cancelled` SSE event to every active subscriber.
4. The terminal frame from the app-server flows through as usual; the DO retires.

```
POST /conductor/stream
Body: { sessionName?, content, threadId?, model? }
Response: text/event-stream
```

Event sequence:

```
event: ready              { sessionName, appServer, mode }
event: thread             { threadId }
event: notification       { method: "turn/delta", params: { text: "Hello " } }
event: notification       { method: "turn/delta", params: { text: "world" } }
event: notification       { method: "turn/tool_call", params: { ... } }
event: result             { turn_id, output: [{ type: "text", text: "..." }] }
event: done               { frames }
```

Browsers consume it with `fetch(...).body.getReader()` and accumulate `turn/delta` events as the assistant's streaming text. The `/app` Helm has a **stream** mode toggle that does exactly this — delta text is appended to the bubble in real time, and the full event trace is rendered below for debugging.

The session DO also records the final assistant text as a `role: "assistant"` message so subsequent non-streaming turns see continuous history.

Plain HTTP bridges (no WebSocket) cannot stream — the endpoint returns `400 E_STREAM_NEEDS_WS`. In that case, use `/conductor/message` with `mode: "auto"` for buffered tool loops.

## Provider selection

Helm picks the first of these that is enabled (or honors an explicit `provider` field):

1. **`cf-ai-gateway`** — NEW. Cloudflare AI Gateway fronting 23+ providers with BYOK via Secrets Store. Model ids are `provider/model-name` (e.g. `anthropic/claude-opus-4-6`). Full native tool-use.
2. `workers-ai` — default free tier, no extra secrets. Auto/selective mode **not supported** yet → falls back to propose.
3. `anthropic` — direct Anthropic Messages API. Full native tool-use.
4. `openai-compatible` — direct to any OpenAI-compatible endpoint. Full native tool-use (Groq, Together, Ollama, etc.).
5. **`codex`** — NEW. OpenAI Codex via `OPENAI_API_KEY` (classic) or paste-in ChatGPT subscription tokens. Full native tool-use.

See [`docs/PROVIDERS.md`](./PROVIDERS.md) for the full matrix and setup instructions.

## External agents

Any external agent — Claude Code, OpenClaw, a custom script — can use Helm as a planner without embedding the runtime:

```ts
// From an external agent (pseudo-code):
async function askHelm(content: string) {
  const plan = await fetch("https://your-worker/conductor/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, mode: "propose" })
  }).then((r) => r.json());

  for (const action of plan.data.suggestedActions) {
    if (shouldApprove(action)) {
      const result = await fetch(
        \`https://your-worker/skills/invoke/\${action.skill}\`,
        { method: "POST", body: JSON.stringify({ input: action.input }) }
      ).then((r) => r.json());
      // Feed `result` back to your agent's context and continue.
    }
  }
}
```

Why this matters: your agent keeps its own reasoning loop and context budget. Helm supplies two things it's perfectly positioned for — the live skill catalog (what's currently enabled) and the planning for how to use it. The external agent stays in charge of execution policy.

## Action block protocol (propose mode + Workers AI fallback)

    ```open-think-action
    {"skill": "admin-health-check", "input": {}}
    ```

Multiple blocks allowed. Parsed by `parseActionBlocks()` and stripped from display via `stripActionBlocks()` — see [`src/conductor.ts`](../src/conductor.ts).

## Pairing with Cloudflare MCP

The combination that sells the whole stack: enable `mcp-client` + point it at `https://mcp.cloudflare.com/mcp`. Helm now has direct access to list zones, provision D1/KV/R2, search docs, etc.

In `auto` mode with Cloudflare MCP enabled, a message like "spin up a KV namespace called sessions" becomes a single round-trip: Helm calls `mcp-call-tool` with `{ name: "kv_namespace_create", arguments: { title: "sessions" } }`, stores the result, and replies with the new namespace id. Because `mcp-call-tool` is marked dangerous, you'll want `selective` mode for daily use — Helm plans + inspects, then asks you to approve any mutation.

```bash
# wrangler secret put MCP_DEFAULT_URL           → https://mcp.cloudflare.com/mcp
# wrangler secret put MCP_BEARER_TOKEN          → your CF API token (optional; OAuth works too)
# ensure ALLOWED_HOSTS includes mcp.cloudflare.com
# ensure ENABLED_PLUGINS includes mcp-client
```

## Schemas

Every skill has an optional `inputSchema` (JSON Schema). When present, Helm hands it to the provider as the tool's `input_schema` (Anthropic) or `parameters` (OpenAI) so the model emits well-shaped arguments. Schemas are declared in [`src/core/skills.ts`](../src/core/skills.ts); add one when you author a new skill so autonomous mode can use it reliably.

## Extending Helm

- Add skills to `SKILL_CATALOG` in `src/core/skills.ts` (give them a schema + `dangerous` flag).
- Add plugins via `npm run plugin:new -- <id>`; register in `src/plugins/registry.ts`.
- Adjust the system preamble in `src/conductor.ts` `SYSTEM_PREAMBLE` to narrow domain focus.

## Safety rails

- **Iteration cap** — `maxIterations` is clamped to 12. The loop halts and marks `halted: "iteration-cap"` if exceeded.
- **Dangerous flag** — the single source of truth for "requires approval in selective mode". Never rely on prompt wording alone.
- **Restricted fetch** — every provider and plugin call goes through the runtime's `ALLOWED_HOSTS` filter; Helm can't escape it even in auto mode.
- **Session persistence** — every tool call is recorded as `role: "tool"` in the DO, so replay / post-mortem is trivial.

## Roadmap

- Streaming replies via DO WebSockets.
- Workers AI auto-mode support once llama-3.3 tool-use is stable through the `env.AI.run` path.
- Multi-agent fork — Helm spawns narrow task agents per plan step into their own session DOs.
- Per-skill rate limits (prevent a runaway loop from exhausting token budget on an external provider).
