# Open Think · setup

This is the single source of truth for going from "fresh fork" to "fully
configured agent runtime with shell, persistence, and Cloudflare Access".

> **TL;DR**: deploy → click `Auto-setup with CF API ⚡` in `/app#/settings`
> → add one `[[r2_buckets]]` block to `wrangler.toml` → redeploy. Done.

## Step 0 — what you get with zero config

```bash
npx wrangler deploy
```

That alone gives you, with no secrets:

- A working chat at `/app#/conductor` running on Workers AI
- A bash shell at `/app#/shell` (Cloudflare Container, ephemeral disk)
- A `/app#/settings` panel showing readiness + `Auto-setup` button
- Per-user shell sessions (auth-derived; first-run-permissive until lockdown)

The "first-run permissive" mode means anyone with the URL can talk to your
agent. The yellow banner at the top of `/app` reminds you to lock it down.

## Step 1 — auto-setup (one click)

This is the canonical path. It does in 30 seconds what used to be a
multi-page checklist.

### Prerequisites

You need the deploy form's two fields (or the equivalents already pasted
during `Deploy to Cloudflare`):

| Var | What | Why |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | scoped CF API token | so `Auto-setup` can call the CF API on your behalf |
| `AGENT_OWNER_EMAIL` (or `OWNER_EMAIL`) | your email | the only address Cloudflare Access will let through |

If you already pasted them in the deploy form, you're done with this
step. If not, go to `/app#/settings` and paste them — the wizard prompts
clearly.

The token URL the wizard links to is pre-filled with the right scopes
(it uses CF's modern URL format — see `site/src/cloud/types.ts`). Five
boxes should be checked when the dash opens:

```
☑ Workers Scripts: Edit
☑ D1: Edit
☑ Access: Edit
☑ Account Settings: Read
☑ User Details: Read
```

Set **Account Resources → Include → All accounts** (or pick yours
explicitly). Click `Continue to summary` → `Create Token` → copy.

### Run the auto-setup

Visit `/app#/settings`. If both env vars are pre-set you'll see:

```
⚡ One-click ready
Token + owner email already configured on this Worker.
[Auto-setup with CF API ⚡]
```

Click it. The endpoint `POST /setup/auto` runs:

1. **Verify token** against `/user/tokens/verify`
2. **Pick account** (env override → first visible)
3. **Lockdown**: create Access app + email-allowlist policy, persist
   `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` as Worker secrets
4. **Mint** a 32-byte `HELM_INTERNAL_TOKEN` if missing (used by the
   in-shell `helm` REPL — eliminates one manual `wrangler secret put`)
5. **Auto-create R2 bucket** named `${scriptName}-persist` if missing,
   set `R2_BUCKET` as a secret
6. **Return** a `nextSteps` checklist showing what's still needed

CF auto-redeploys the Worker as soon as new secrets are written
(typically ~15 seconds). The auth banner flips from yellow to green.

### One last manual step

The R2 bucket is created, but you still need a `[[r2_buckets]]` binding
in `wrangler.toml` so `env.WORKSPACE` is wired in the Worker. The
auto-setup response shows exactly what to paste:

```toml
[[r2_buckets]]
binding = "WORKSPACE"
bucket_name = "helm-persist"   # whatever bucket /setup/auto created
```

Then `wrangler deploy` once more. **This is the only manual TOML edit
in the whole flow** — we'd auto-write it but `wrangler.toml` is
git-tracked and we don't want to silently rewrite it under you.

You're done. The "Auth · first-run permissive" banner is gone, the
`helm` command works inside `/app#/shell`, and `helm-save` writes
durable snapshots to R2.

## Step 2 — verify

`/app#/settings` → Runtime readiness should show ≥ 80%. The capabilities
table lists each piece in green. The Helm Shell tab connects in ~10s
(cold start), prompt shows MOTD, `helm "what plugins are enabled?"`
returns a real answer.

```bash
# From a terminal:
npm run shell -- --host helm.your-domain.workers.dev
# Same shell, browser-equivalent.
```

## Setup matrix — what each var unlocks

| Env var | Set by auto-setup? | What it unlocks |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | manual (paste in deploy form) | everything below — the agent uses this token to operate CF on your behalf |
| `AGENT_OWNER_EMAIL` | manual (paste in deploy form) | who Access lets through |
| `CF_ACCESS_TEAM_DOMAIN` | ✅ | strict-mode auth (kicks first-run permissive) |
| `CF_ACCESS_AUD` | ✅ | ditto |
| `HELM_INTERNAL_TOKEN` | ✅ | in-shell `helm` REPL bearer |
| `R2_BUCKET` | ✅ | bucket name for `/persist` |
| `[[r2_buckets]]` binding | manual (paste TOML, redeploy) | wires `env.WORKSPACE` for the `/persist` proxy |
| `OPENROUTER_API_KEY` | manual | better default chat model (`openrouter/auto`) |
| `ANTHROPIC_API_KEY` | manual | direct Claude |
| `OPENAI_COMPATIBLE_URL` + `OPENAI_COMPATIBLE_KEY` | manual | Groq / Together / Ollama / etc. |
| `DB` D1 binding | manual | PA stack (memory, scheduler, cost rollup) |
| `[[send_email]]` binding | manual | outbound email |
| `VAPID_*` | `npm run vapid:generate` | Web Push |

## Persistence

The Helm Shell container has a two-disk model:

- `/workspace` — fast SSD, **ephemeral** (wiped on container sleep ~15
  min idle). Use for active work.
- `/persist` — durable, optional.

Two ways to populate `/persist`:

### A. Worker-proxied R2 (default after auto-setup) ✅

Zero R2 access keys in the container. The container's `helm-save` /
`helm-load` scripts call the Worker's `/persist/*` endpoint with the
internal bearer; the Worker uses `env.WORKSPACE` to read/write the
bucket. Auto-restore on container start fetches the latest snapshot.

```bash
# inside the shell:
helm-save              # tar /workspace → r2:sessions/<you>/workspace-<ts>.tar.gz
helm-load              # restore the latest snapshot
helm-save --full       # include caches (slower, more R2 ops)
```

### B. FUSE-mounted /persist (power-user)

For users who want `/persist` as a real filesystem — vim editing,
streaming reads, etc. Set these Worker secrets and they'll be
forwarded into the container; `entrypoint.sh` will mount `/persist`
via rclone:

```bash
wrangler secret put R2_ACCESS_KEY_ID       # from dash → R2 → Manage R2 API Tokens
wrangler secret put R2_SECRET_ACCESS_KEY   # ditto
# R2_ACCOUNT_ID is read from CLOUDFLARE_ACCOUNT_ID (already set)
# R2_BUCKET is set by /setup/auto
```

The two paths coexist — the Worker proxy is preferred when both
work, FUSE is the fallback when the proxy can't reach the bucket.

> **Cost note**: R2 storage is $0.015/GB/month. Class A operations
> (PUT/LIST) are $4.50/million; Class B (GET) is $0.36/million.
> `helm-save` excludes `node_modules`, `.git/objects`, `target`,
> `dist`, `.cache`, `.next` to keep ops affordable. A typical
> agent workspace costs **under $1/month** to keep persisted.

## CLI auth (device-code flow)

`npm run shell -- --host helm.your-domain.workers.dev` (with no other
auth flags) does this on first run:

1. POSTs `/cli-auth/start` — gets a 10-min device code + a short
   user-code (e.g. `7XKM-Q3BD`)
2. Prints both the verification URL and the user-code
3. You open the URL in your browser. Cloudflare Access gates it, so
   we know who you are. The page shows the user-code; you confirm it
   matches what your CLI printed and click `Approve this CLI`
4. CLI polls `/cli-auth/poll`, picks up a 30-day bearer
5. Bearer is saved at `~/.config/open-think/auth-<host>.json` (mode `0600`)
6. Subsequent runs use the cached bearer — no browser dance

Other paths: pass `--service-token-id`/`--service-token-secret` for CI,
or `--cf-access-jwt` for raw JWT injection. `--logout` drops the cached
bearer; `--print-token` writes it to stdout (handy for `curl`).

## Files tab — give the agent files to work with

`/app#/files` is a per-user file area backed by R2 (via the same
`/persist` proxy as snapshots — no R2 keys needed in the container).

- **Drag-and-drop** to upload; chunked progress per file
- **Folders** for organization (R2 has no real folders; we use a
  `.keep` marker convention for empty ones)
- **Per-file actions**: download, copy R2 path, delete
- **Per-user prefix** auto-derived from your authenticated email
  (`files/u-<8-hex>/...`) so other users don't see your files

The agent reads files from inside the Helm Shell with `helm-fetch`:

```bash
helm-fetch --list                 # list all your files
helm-fetch --search invoice       # find by substring
helm-fetch files/u-XXXXXXXX/sales.csv      # download to /workspace/sales.csv
helm-fetch files/u-XXXXXXXX/sales.csv data/sales.csv    # explicit path
```

Combine with the `helm` REPL to ask the agent to do something with
the file:

```bash
helm-fetch files/u-XXXXXXXX/sales.csv
helm "use cf-query-d1 to ingest /workspace/sales.csv into the leads table"
```

## Sessions panel + cost meter

`/app#/shell` → click `Sessions` to see every recent shell session in
the registry: name, owner email, live/idle state, awake time, est.
cost, last seen.

- **Attach** flips your localStorage to that session and reloads — useful
  when you want to drop into a teammate's session (or one of your own
  from a different device).
- **Forget** removes the session from the registry. The container
  itself sleeps on its own; this is just registry hygiene.
- **Show everyone's sessions** unchecks the email filter. Anyone with
  `/app` access can see everyone — tighten with `CF_ACCESS_ALLOWED_EMAILS`.

## Manage secrets in the browser

`/app#/settings` → **Manage secrets** lists every known Worker secret
slot (auth + CF + providers + persistence + PA stack), shows whether
each is configured, and lets you paste-and-save without `wrangler
secret put`. Writes go through the CF API using your
`CLOUDFLARE_API_TOKEN`. Names are bounded to a known allowlist (see
`src/setup-secrets.ts`) — a stolen `/app` session can't set arbitrary
env vars.

After each save the Worker auto-redeploys (~15 seconds); the readiness
panel updates automatically.

## In-shell `helm` REPL

Once `HELM_INTERNAL_TOKEN` is set (auto-setup does this), the `helm`
command in PATH talks back to your conductor:

```bash
helm "what plugins are enabled?"
helm "create a D1 database called my-app, then put its uuid as a secret"
helm --plan "describe what you would do to set up Web Push"
```

Auth flow: container reads `HELM_INTERNAL_TOKEN` from its env (forwarded
by `ShellContainerDO.envVars`), curls the Worker with `Authorization:
Bearer <token>`. The Worker's `verifyAccessJwt` accepts this bearer as
an alternative to the CF Access JWT — see `src/auth.ts`.

## Troubleshooting

### "Auto-setup with CF API ⚡" button doesn't appear

The card only shows when **both** `CLOUDFLARE_API_TOKEN` AND
`AGENT_OWNER_EMAIL` (or `OWNER_EMAIL`) are pre-set. Without one of
them, the lock-down form appears instead. Paste the missing value in
the form and submit.

### "no accounts visible to this token" (E_LIST_ACCOUNTS_FAILED)

Token is missing the `Account Settings: Read` scope OR is restricted
to a different account. Re-create from the wizard's link (the URL
format is correct as of v0.7.0; older tokens were silently empty).

### `helm` command in shell says "HELM_INTERNAL_TOKEN not set"

Run `/setup/auto` and refresh. Or set it manually:

```bash
HEX=$(openssl rand -hex 32)
echo "$HEX" | wrangler secret put HELM_INTERNAL_TOKEN
```

CF redeploys the Worker (~15s); the new container instance picks up
the env var on its next cold start.

### `helm-save` says "no persistence wired up yet"

You're missing the `[[r2_buckets]]` binding. After `/setup/auto`
created the bucket, paste the binding into `wrangler.toml` and
redeploy. The wizard returns the exact snippet in `nextSteps`.

### Container takes 30+ seconds to start

First cold start pulls the image (~150 MB). Subsequent cold starts
should be 5–10s. If consistently slow, check container logs in the CF
dashboard (Worker tail does NOT show container stdout).

### Browser shell shows "container ready (8.3s)" — is that normal?

Yes. The bridge sends its motd as soon as the PTY is ready; that's the
first byte we measure against. 5–15s is the normal cold-start window.

## Cost estimate

| Tier | Monthly cost |
|---|---|
| Workers AI baseline | $0 (free tier covers light use) |
| Cloudflare Access (≤50 users) | $0 |
| Container `basic` instance, idle 95% of the day | **~$2** |
| R2 bucket with ~1 GB of session snapshots | **<$0.05** |
| Workers requests (typical home use) | $0 |
| **Total typical solo use** | **~$2–5/month** |

Containers bill per-second when **awake**. Idle (sleeping) = $0. A
solo developer who fires up the shell a few times a day pays roughly
the cost of a coffee. Heavy use (always-on `tail -f`) can climb fast —
the `sleepAfter` setting in `ShellContainerDO` defaults to 15 min for
this reason.

## What's intentionally NOT automated (and what now is)

Status as of v0.10.0:

| Was manual in v0.9.x | v0.10.0 status |
|---|---|
| `wrangler secret put` for every provider key | ✅ **Manage secrets** UI in `/app#/settings` |
| Cached CLI bearer (had to paste JWT manually) | ✅ device-code login on first `npm run shell` |
| "where's my container running" visibility | ✅ Sessions panel in `/app#/shell` |
| Adding the R2 binding to wrangler.toml | ⚠️ "Patch live Worker" button (one-click on auto-setup success), but you still need to commit the `[[r2_buckets]]` block to wrangler.toml so the next `wrangler deploy` doesn't drop it |

Remaining intentionally manual:

1. **`[[r2_buckets]]` etc. bindings in `wrangler.toml`** — git-tracked
   file; we won't silently rewrite it. The "Patch live Worker" button
   updates the *deployed* Worker via CF API but the local `wrangler.toml`
   stays in your control. Drift is surfaced in the success banner.
2. **D1 / send_email / browser / sandbox bindings** — same reason.
3. **VAPID keys** — generated locally so the private key never touches
   our infra (`npm run vapid:generate`).

## Where each setting lives

```
.dev.vars         local-only secrets (NEVER committed)
wrangler.toml     [vars] (non-secret) + bindings (D1, R2, AI, etc.)
Worker secrets    secret material (use `wrangler secret put`)
DO storage        per-session state (chat history, fibers)
D1                cross-session state (memory, schedule, costs)
R2 (WORKSPACE)    durable workspace snapshots from helm-save
Container disk    ephemeral /workspace (fast); /persist (durable, optional)
```

---

## Reference: legacy "Settings tab + Guided Setup" doc

Earlier versions of Open Think had a separate "Settings + Guided Setup"
doc here. Its content is now folded into the sections above. The
underlying endpoints are unchanged:

- `GET /setup/access/discover` — what the wizard form needs
- `POST /setup/access/preflight` — verify token + list accounts + probe scopes
- `POST /setup/access/run` — manual lockdown (form path)
- `POST /setup/auto` — one-click lockdown + secret minting + R2 bucket
- `GET /setup/status` — capability matrix (drives the readiness panel)
- `POST /setup/snippet` — generate wrangler.toml + .dev.vars deltas
- `POST /setup/guided/start` — kick off a Helm session pre-loaded with
  setup context, suitable for "talk me through it" UX

If you'd rather drive the agent at the chat: visit `/app#/conductor`
and ask `set me up — use cf-* skills as needed`. The `cloudflare-admin`
plugin gives Helm the surface to do most of this directly.
