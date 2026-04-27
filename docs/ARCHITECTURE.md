# Open Think — Architecture

A canonical, living description of how the Open Think system fits together.
Read this once and you should be able to find any code path in the repo
without grep'ing blind.

## Three Workers

Open Think runs as **three** Cloudflare Workers that talk to each other only
through standard HTTP. Each is independently deployable.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│    ┌──────────────────────┐         ┌──────────────────────────────┐      │
│    │  Marketing site      │  HTTPS  │  codex-bridge-worker         │      │
│    │  open-think.app      │ ──────▶ │  (Cloudflare-native shim     │      │
│    │  site/               │         │   for ChatGPT subscriptions) │      │
│    └──────────┬───────────┘         └──────────────┬───────────────┘      │
│               │                                    │                       │
│               │ deploy + scheduled push            │ /rpc + /stream        │
│               │ (Architecture II)                  │                       │
│               ▼                                    ▼                       │
│    ┌───────────────────────────────────────────────────────────────┐      │
│    │  Agent runtime  (the "Helm" worker)                           │      │
│    │  src/                                                         │      │
│    │                                                               │      │
│    │   ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐  │      │
│    │   │ AgentSession│  │ StreamHubs  │  │ MorningBriefing      │  │      │
│    │   │ DO (SQLite) │  │ DO (in-mem) │  │ Workflow             │  │      │
│    │   └────────────┘  └──────────────┘  └──────────────────────┘  │      │
│    │                                                               │      │
│    │   Plugin bus: 17 plugins (admin, providers, MCP, browser,     │      │
│    │   sandbox, memory, email, notifier, calendar, …) →            │      │
│    │   Skill catalog: ~50 skills the meta-agent can call           │      │
│    └───────────────────────────────────────────────────────────────┘      │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

| Worker | Lives at | What it does |
|---|---|---|
| **Agent runtime** (`src/`) | `<your-name>.workers.dev` (deployed by user) | The actual agent. Helm meta-agent, plugins, sessions, streaming, PA stack. |
| **Marketing site** (`site/`) | `beta.open-think.app` (operated by us) | Landing, docs, marketplace, pricing, browser deploy, Helm Cloud SaaS layer. |
| **codex-bridge-worker** (`companion/codex-bridge-worker/`) | optional, per-user | Pure-Cloudflare proxy for ChatGPT subscription tokens. Alternative to the Node `codex-bridge`. |

There is also a Node-based `companion/codex-bridge/` that wraps `codex
app-server` for full thread/turn semantics. Use it when the Cloudflare-native
bridge isn't enough.

## Plugin contract

Everything in the agent runtime is a plugin. The contract is in
[`src/core/plugin.ts`](../src/core/plugin.ts):

```ts
interface AgentPlugin {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: readonly PluginCapability[];
  initialize(context: PluginContext): Promise<void>;
  invoke(action: string, input: unknown): Promise<PluginResult>;
}
```

`PluginContext` carries `env`, a config snapshot, a *restricted* `fetch` (the
`ALLOWED_HOSTS` allowlist is enforced at the bus, not in user code), and an
optional runtime-introspection handle.

Plugins live under `src/plugins/`. The registry in `src/plugins/registry.ts`
is the single source of truth for which plugins exist; turning one on for a
deploy is a comma in `ENABLED_PLUGINS`.

## Skill catalog

`src/core/skills.ts` defines `SkillDefinition` — a typed wrapper over a
`{pluginId, action}` pair with a name, description, JSON schema, and a
`dangerous` flag. About 50 skills ship today across the 17 plugins.

The skill catalog is what the **meta-agent (Helm)** calls. Helm doesn't see
plugins; it sees skills. The catalog's `dangerous` flag is what makes
selective mode work — Helm halts before any dangerous skill and surfaces it
as an approve-to-run exhibit.

Skills are also what the streaming tool-use loop hands the model as `tools`
in Anthropic and `tool_calls` in OpenAI-compatible providers — same skill
list, two adapter shapes.

## Helm meta-agent

`src/conductor.ts` (file name kept for back-compat; the meta-agent is now
called Helm). Five providers, three modes:

```
                    ┌──────────────────────────────────┐
                    │            Helm                  │
                    │ propose / selective / auto       │
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────┬───────┴────────┬────────────┬───────────┐
              ▼            ▼                ▼            ▼           ▼
        cf-ai-gateway  workers-ai    anthropic   openai-compat   codex
        (23 providers)  (free)       (Claude)   (Groq/Together)  (sub or API)
```

`pickProvider` picks the first enabled provider, in priority order. Override
with `provider:` per request. Tool-use mode (`auto`/`selective`) requires a
provider that speaks native tools — workers-ai falls back to propose.

## PA stack (personal-assistant features)

Nine features built on native Cloudflare primitives. All optional; each
plugin loads even when its bindings are missing and degrades cleanly.

| # | Feature | CF primitive | Source |
|---|---|---|---|
| 1 | Auth | Cloudflare Access (Zero Trust) | `src/auth.ts` |
| 2 | Long-term memory | Cloudflare Agent Memory (private beta) + D1 fallback | `src/plugins/memory.ts` |
| 3 | Email in/out | Email Workers + Email Routing | `src/plugins/email.ts`, `src/emailHandler.ts` |
| 4 | Calendar | MCP-delegated (`CALENDAR_MCP_URL`) | `src/plugins/calendar.ts` |
| 5 | Scheduler | Workers Cron Triggers + D1 workflow table | `src/scheduler.ts` |
| 6 | Notifier | Email self-notify + Web Push (RFC 8292 + 8291) | `src/plugins/notifier.ts`, `src/webpush/` |
| 7 | Morning briefing | Cloudflare Workflows (4-step durable) | `src/workflows/morningBriefing.ts` |
| 8 | Bridge hardening | Cron rotation + audit log + DELETE /auth | `companion/codex-bridge-worker/src/index.ts` |
| 9 | Cost tracking | AI Gateway analytics + D1 daily rollup + spending cap | `src/costTracking.ts`, `src/costPricing.ts` |

The auth gate is **first-run permissive** by default — a fresh `wrangler
deploy` produces a working chat agent with zero secrets, with a yellow
banner reminding you to lock auth down before sharing the URL. Set
`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` to flip into strict mode.

The morning briefing fires on cron (`55 12 * * *` UTC), pulls inbox +
projects-from-memory, asks Helm for prose-only output, sends via the
notifier. Tightened prompt; tested fallbacks.

### Web Push (VAPID) — full RFC implementation

`src/webpush/` is a from-scratch implementation of:
- **RFC 8292** (VAPID) — ECDSA P-256 JWT signing, `Authorization: vapid t=…,k=…`
- **RFC 8291** (Web Push Encryption) — ECDH-ES + HKDF-SHA256 + AES-128-GCM
- **RFC 8188** (aes128gcm content encoding) — single-record framing

Generated entirely client-side: open `/app#/settings`, click "Generate VAPID
keys" — the private key never leaves the browser; we print three paste-ready
`wrangler secret put` commands. Service worker hosted at `/sw.js`.

## Helm Cloud (Architecture II — managed-deploy SaaS)

Lives in the **marketing site Worker** (`site/`), not the agent runtime.

```
                  ┌──────────────────────────────────────────┐
                  │ Customer's Cloudflare account            │
                  │                                          │
                  │   ┌──────────────────────────────┐       │
                  │   │ Their Helm Worker            │◀──┐   │
                  │   │ (their bindings, their data) │   │   │
                  │   └──────────────────────────────┘   │   │
                  └─────────────────────────────────────┼┘   │
                                                        │    │ Workers Scripts
              ┌────────────┐                            │    │ API push
              │ Stripe     │                            │    │ (cron)
              │ subscript. │                            │    │
              └─────┬──────┘                            │    │
                    │ webhook                           │    │
                    ▼                                   │    │
       ┌──────────────────────────────────────────────────────┐
       │  Marketing site Worker (open-think.app)              │
       │                                                      │
       │   D1 cloud_deployments                               │
       │     id, customer_id, account_id, worker_name,        │
       │     encrypted_token_b64,  ─── AES-256-GCM under ──┐  │
       │     encryption_iv_b64,    ─── CLOUD_MASTER_KEY ───┤  │
       │     build_sha, paused, last_pushed_at, …          │  │
       │                                                   │  │
       │   D1 cloud_manage_tokens   (signed handles, 30d)  │  │
       │   D1 cloud_session_claims  (replay-safe exchange) │  │
       │   D1 cloud_push_log        (audit)                │  │
       │                                                   │  │
       │   src/cloud/                                      │  │
       │     cfApi.ts          — Cloudflare API client     │  │
       │     deployFlow.ts     — verify → D1 → Access → … │  │
       │     crypto.ts         — token encrypt/decrypt    │  │
       │     deployments.ts    — D1 repo                   │  │
       │     sessions.ts       — claim ledger + signed     │  │
       │                          intent cookies           │  │
       │     manifest.ts       — fetch published bundle    │  │
       │     pushUpdates.ts    — cron-driven push +        │  │
       │                          mergeBindings + stuck    │  │
       │                                                   │  │
       │   Routes:                                         │  │
       │     /deploy/cloud           (form-style)          │  │
       │     /deploy/guided          (terminal walkthrough)│  │
       │     /cloud/manage?token=…   (subscriber dash)     │  │
       │     /cloud/recover          (lost-link form)      │  │
       │     /api/cloud/exchange-session                   │  │
       │     /api/cloud/current-intent                     │  │
       │     /api/cloud/forget-intent                      │  │
       │     /api/cloud/deploy                             │  │
       │     /api/cloud/manage/{pause,resume,              │  │
       │            rotate-token, billing-portal, forget}  │  │
       │     /api/cloud/recover                            │  │
       │     /api/cloud/health  (operator status)          │  │
       │     scheduled() → runUpdatePush  (hourly cron) ───┘  │
       └──────────────────────────────────────────────────────┘
```

### Two paths through the same code

- **Free OSS deploy** (`/deploy/cloud` or `/deploy/guided`, no Stripe): user
  pastes a scoped CF API token, we orchestrate D1 + Access + wrangler.toml,
  the user runs `wrangler deploy` locally. Token discarded after the request.

- **Helm Cloud subscriber** (`/pricing` → Stripe → `/deploy/cloud?session_id=…`):
  same flow, but after the deploy succeeds we encrypt the CF token under
  `CLOUD_MASTER_KEY` and store it in `cloud_deployments`. An hourly cron
  pulls a manifest at `HELM_BUNDLE_MANIFEST_URL`, fans out new bundles to
  every active deployment via the customer's stored token.

### Replay-safe session exchange

A Stripe Checkout `session_id` is **not** a secret — it leaks via URLs,
Referer headers, and analytics pixels. The naive `/api/cloud/exchange-
session?sessionId=…` would let any caller deploy as the legit subscriber.
The fix lives in `src/cloud/sessions.ts`:

1. **Claim ledger** — `cloud_session_claims` PK-on-session_id rejects
   second-attempts. Mallory racing Alice can win the claim, but only one
   browser ends up authorized.
2. **Signed intent cookie** — `oth_cloud_intent` (HttpOnly + Secure +
   SameSite=Lax + 30 min TTL). The cookie value is HMAC-SHA256 over
   `{customer_id, session_id, exp}` with a key derived from
   `CLOUD_MASTER_KEY`. The deploy endpoint reads `customer_id` from the
   cookie, never from the request body.
3. **Stripe-verified payment** — `lookupCheckoutSession` enforces
   `status: complete` AND `payment_status: paid` before issuing the
   cookie.

If the cookie expires before the user finishes the deploy, the persist
path silently degrades to a free-tier deploy with a clear "subscription
persistence skipped" step. The user can re-checkout and try again.

### Bundle pipeline

`scripts/build-bundle.mjs` runs `wrangler deploy --dry-run --outdir=dist`
to produce `dist/helm.mjs` (minified) + `dist/manifest.json`. The
`.github/workflows/release-bundle.yml` workflow runs it on every `v*` tag
push and uploads both as GitHub Release assets.

The marketing site's `HELM_BUNDLE_MANIFEST_URL` defaults to
`https://github.com/NeoFlux-Holdings/open-think/releases/latest/download/manifest.json`
which tracks the most recent tagged release automatically. To roll back,
point at a pinned `…/releases/download/v0.4.1/manifest.json`.

### Customer-binding preservation (mergeBindings)

The Workers Scripts API replaces a script's full bindings list on every
PUT. A naive cron push would clobber the customer's `DB` binding (their
D1 ID) and every secret_text they set with `wrangler secret put`. Before
each push, `pushUpdates.ts` calls `getWorkerSettings` to read the
script's current bindings, then `mergeBindings(manifest, customer)`:

- **Manifest is the floor** — every binding name we expect must exist.
- **Customer wins on type-specific fields** — D1 `database_id`,
  KV `namespace_id`, secret_text values are preserved.
- **Customer-extra bindings are kept** — KVs the customer added that
  the bundle doesn't reference get merged through (Workers ignores
  unused bindings).

### Operational visibility

- **GET /api/cloud/health** — returns `{ ready, config, deployments,
  cron, alerts }`. Green when all four config booleans are true and no
  deployments are stuck. Safe to leave open; never returns customer
  identifying fields or push detail.
- **listStuckDeployments** — finds deployments with 3+ failed pushes
  since their last success. Surfaced in `/api/cloud/health.alerts` and
  emitted as a structured `[cloud-cron] alert: …` warn line per cron
  run for Workers Tail / Logpush.
- **Manage page hardening** — Referrer-Policy: no-referrer + Cache-
  Control: no-store on `/cloud/manage` so the URL-embedded token never
  leaks via outbound clicks or CDN caches. Action POSTs send the token
  in the request body, not the URL.

### Why no in-browser terminal (yet)

We considered embedding a real terminal — [vercel-labs/wterm](https://github.com/vercel-labs/wterm)
is a beautiful Zig-WASM xterm emulator, ~12 KB. The challenge isn't the
UI; it's the backend. wterm needs a WebSocket-attached PTY with Node +
wrangler installed to be useful. Workers can't host PTYs. The realistic
options are:

- **WebContainers** (StackBlitz) — runs Node in-browser via WASM, ~50 MB
  download, license restrictions, complex auth.
- **Cloudflare Sandboxes** — per-session container with wrangler, beta,
  billable, complex setup.
- **Our own VPS** — always-on, manual ops.

For the deploy use-case, going directly through the CF API from the
marketing-site Worker is **simpler**, fully audited, and skips ~50 MB
of WASM payload. `/deploy/guided` therefore renders a styled
"terminal walkthrough" — each scene shows the wrangler command you'd
run, but [Run] hits our existing `/api/cloud/*` endpoints. Same outcome,
no install, full audit trail. If we ever need a real interactive shell
(e.g. for runtime debugging), Cloudflare Sandboxes is the most-likely
backend.

### Trust + threat model

What we can do with our customer's token:
- ✅ Push Worker code (the whole point — bundle updates)
- ✅ Read CF API responses to *the resources we created*
- ❌ Read their D1 contents — token scope doesn't include D1 read
- ❌ Read their DO storage — same
- ❌ See their prompts/responses — runtime data never crosses our Worker

What we **cannot** do even if we wanted to:
- Read runtime data — the agent runs in their isolate, not ours
- Read their other Workers' code — token scope is on the script we created
- Override their billing — they pay CF directly for usage; us only via Stripe

Failure modes:
- **Master key + D1 both leak** → attacker can decrypt tokens and push
  malicious code. Customer mitigation: revoke the token at
  `dash.cloudflare.com/profile/api-tokens`. Operator response: rotate
  `CLOUD_MASTER_KEY`, re-encrypt all rows, force token re-paste.
- **Customer token expires** → cron records `last_push_error`; manage page
  surfaces it. Customer pastes a fresh token via "Rotate Cloudflare token".
- **Subscription canceled** → Stripe webhook auto-pauses every deployment
  for that customer. Cron skips paused rows. Token + deployment row stay
  parked until they resub or hit "Forget my deployment".

## Streaming tool-use

`src/conductor-tool-stream.ts` implements the same tool-use loop as `auto`
mode but pipes every event into Server-Sent Events for the browser. Two
adapters under the hood:
- `src/anthropic-stream.ts` — native Anthropic Messages SSE
- `src/openai-stream.ts` — incremental `tool_calls` chunk accumulator

Both emit the same `LoopEvent` union from `src/tool-stream-types.ts`. The
`StreamHubDO` fans one upstream stream out to N browser tabs with a 500-event
replay buffer.

## Rollback registry

`src/rollback.ts` is a hand-curated table mapping destructive Cloudflare MCP
tool calls (`kv_namespace_create`, `d1_database_create`, etc.) to their
inverses (`kv_namespace_delete`, …). When Helm executes one of these, the
plugin attaches a `rollback` hint to the tool message; the UI renders it as
an "Undo" affordance after the turn.

Conservative by design — only fully reversible operations are registered.

## Marketplace

`site/src/marketplace/entries/` — one TypeScript file per entry, ~21 entries
today across types: `plugin`, `mcp-server`, `skill-pack`, `agent-template`,
`companion`. Aggregated by `data.ts` and rendered at `/marketplace`.

A validator (`site/scripts/validate_marketplace.mjs`) checks slug uniqueness,
plugin-id existence, and hostname shapes. Wire it into CI before opening
contributions.

## How to extend

- **New plugin**: `npm run plugin:new my-id` scaffolds the file + test, then
  add to `src/plugins/registry.ts`. See `docs/PLUGIN_SDK.md`.
- **New skill on an existing plugin**: append to `SKILL_CATALOG` in
  `src/core/skills.ts`, route to your action in the plugin.
- **New marketplace entry**: drop a file under
  `site/src/marketplace/entries/<slug>.ts` exporting `entry: MarketplaceEntry`
  and add the import to `data.ts`. `npm run marketplace:validate` gates it.
- **New Helm Cloud feature**: most additions land in `site/src/cloud/`.
  Schema changes go in a new `migrations/000N_*.sql`.

## Test counts (as of last sync)

- Main repo (`test/`): **194 tests** passing — runtime, plugins, conductor,
  streaming, rollback, web push, scheduler, cost tracking, auth.
- Site (`site/test/`): **70 tests** passing — CF API client, deploy
  orchestrator, crypto, deployments repository, push updates +
  mergeBindings + listStuckDeployments, session-claim ledger + signed
  intent cookie helpers.
- Bridge worker (`companion/codex-bridge-worker/test/`): smoke tests for
  `/healthz`, `/auth/rotate`, `/rpc`, audit log.

`npm run typecheck` and `npm test` both green across all three.
