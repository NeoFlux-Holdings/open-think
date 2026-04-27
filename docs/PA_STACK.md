# Personal-Assistant Stack

Open Think ships with nine features that turn the runtime from "agent toolkit" into "deployable personal assistant." Everything is Cloudflare-native — no third-party vendors, no vendor lock-in beyond Cloudflare itself.

| # | Feature | Cloudflare primitive | Binding / config |
| --- | --- | --- | --- |
| 1 | Auth | Cloudflare Access | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_ALLOWED_EMAILS` |
| 2 | Memory | Agent Memory (managed) + D1 fallback | `MEMORY` binding, `DB` binding |
| 3 | Email | Email Workers `send_email` + Email Routing | `SEB` binding, `email()` handler |
| 4 | Calendar | MCP-delegated | `CALENDAR_MCP_URL` |
| 5 | Scheduler | Workers Cron Triggers | `[triggers] crons = [...]` |
| 6 | Notifier | Email + Web Push (VAPID signed, aes128gcm encrypted) | `SEB` + `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` + `push_subscriptions` table |
| 7 | Morning briefing | Cloudflare Workflows | `BRIEFING_WORKFLOW` binding |
| 8 | Bridge hardening | Cron Triggers + DO SQLite | rotation cron in bridge worker |
| 9 | Cost tracking | AI Gateway analytics API + D1 | daily rollup cron |

## One-time setup

```bash
# 1. D1
npx wrangler d1 create tom-tom-pa
# copy database_id into wrangler.toml under [[d1_databases]]

# 2. Email Routing (on your domain)
#    dash → Email → Email Routing → Enable
#    Add a verified destination (your inbox)
#    Custom address catch-all → Send to Worker → pick tom-tom

# 3. Cloudflare Access (Zero Trust)
#    dash → Zero Trust → Access → Applications → Add an application
#    Type: Self-hosted; Application domain: your Worker URL
#    Policy: Include emails → you@example.com
#    Copy Application AUD tag → CF_ACCESS_AUD
#    Copy Team domain → CF_ACCESS_TEAM_DOMAIN

# 4. Env vars (wrangler.toml or `wrangler secret put`)
wrangler secret put CF_ACCESS_AUD
wrangler secret put CLOUDFLARE_API_TOKEN    # for cost rollup + account MCP
# vars in wrangler.toml [vars]:
#   CF_ACCESS_TEAM_DOMAIN, OWNER_EMAIL, FROM_EMAIL,
#   DEFAULT_TIMEZONE, DAILY_SPEND_CAP_USD, INBOUND_FORWARD_TO

# 5. Deploy
npm run deploy
```

## Schedule the morning briefing

The cron trigger `55 12 * * *` (12:55 UTC daily) fires every day. Wire it to the `morning-briefing` handler:

```bash
curl -X POST https://helm.your-domain.com/scheduler/workflows \
  -H "cf-access-jwt-assertion: $TOKEN" \
  -H "content-type: application/json" \
  -d '{ "name": "daily brief", "cron": "55 12 * * *", "handler": "morning-briefing" }'
```

## Test the briefing without waiting

```bash
curl -X POST https://helm.your-domain.com/scheduler/fire \
  -H "cf-access-jwt-assertion: $TOKEN" \
  -H "content-type: application/json" \
  -d '{ "cron": "55 12 * * *" }'
```

## Spending cap

Set `DAILY_SPEND_CAP_USD = "5"` in `[vars]`. Helm calls `enforceSpendingCap()` before any non-trivial model call; once today's total passes the cap it refuses the call until tomorrow (cap resets at 00:00 UTC when the daily rollup writes a fresh row). Check current state via `GET /cost/cap` or the `cost-cap` skill.

## Rotation discipline (bridge worker)

The bridge worker runs its own cron (`0 13 * * *` daily) that checks how old the stored Codex token is. If it's older than `ROTATE_MAX_AGE_DAYS` (default 30) it POSTs `ROTATE_ALERT_URL` — point that at Helm's `notify-user` skill (or any webhook) for a calm 30-day nag. Audit every access via `GET /auth/audit`.

Paired with `DELETE /auth` for incident response: if the bearer token ever leaks, `DELETE /auth` wipes the stored Codex token immediately (bridge returns 503 until you rotate fresh tokens). Audit log survives the delete so you can see what the attacker did.

## Operator routes

All gated behind Cloudflare Access (or `DEV_AUTH_BYPASS=1` for local).

| Route | Purpose |
| --- | --- |
| `GET /scheduler/workflows` | List scheduled workflows + registered handlers |
| `POST /scheduler/workflows` | Create/update a workflow row |
| `DELETE /scheduler/workflows/{id}` | Remove a workflow |
| `POST /scheduler/fire` | Manually fire a cron (testing) |
| `GET /cost/today` | Per-provider USD + tokens spent today |
| `GET /cost/range?start=YYYY-MM-DD&end=YYYY-MM-DD` | Historical spend |
| `GET /cost/cap` | Is the daily spend cap still OK? |
| `POST /cost/rollup` | Force-run yesterday's AI Gateway ingest now |

## Feature boundaries

- **What it does**: auth-gated agent that reads your email, recalls your projects, runs on schedule, reaches out via email or push, stays inside a spending cap.
- **What it doesn't do** (yet, deliberately): multi-user, SMS/voice, file attachments beyond inbound email, vector RAG, OAuth for inbound services (Google Calendar requires an MCP server).

## Web Push (VAPID)

Full RFC 8292 (VAPID) + RFC 8291 (aes128gcm encryption) implementation in `src/webpush/`. One-time setup:

```bash
# 1. Generate a VAPID key pair
npm run vapid:generate
# Copy the two values into secrets + pick a contact subject:
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT    # mailto:you@example.com

# 2. Redeploy
npm run deploy

# 3. From your browser / service worker, fetch the public key:
#    GET /webpush/public-key   (public, no auth)
# Then:
#    registration.pushManager.subscribe({
#      userVisibleOnly: true,
#      applicationServerKey: <Uint8Array from the public key base64url>
#    })
# POST the PushSubscription.toJSON() to:
#    POST /webpush/subscribe   (Access-gated)

# 4. Test the full path:
curl -X POST https://helm.<you>.com/webpush/test \
  -H "cf-access-jwt-assertion: $TOKEN"
```

Behaviour:

- `notify-user channel=web-push` signs an ES256 JWT per subscription (audience = scheme+host of the endpoint), encrypts the payload with AES-128-GCM + ECDH-ES, and POSTs to the push service with the canonical `Authorization: vapid t=…,k=…` header.
- 410/404 responses auto-prune the subscription from `push_subscriptions`.
- 429/5xx responses are classified as retryable but not retried in-process (the caller decides).
- Payload cap: 3072 chars of JSON (fits in one 4096-byte record with GCM overhead + VAPID).

## Trade-offs, honestly

- Cloudflare Agent Memory is in private beta; when your account is on the waitlist, the `MEMORY` binding activates and D1 fallback goes quiet. No code change.
- Cloudflare Workflows: the briefing is one workflow today. Add more handlers via `registerWorkflow(id, fn)` in `src/scheduler.ts`.
- Bridge worker's `BRIDGE_TOKEN` is still a single shared bearer — the rotation + audit + DELETE endpoints are harm-reduction, not prevention.
- Web Push retry for 429/503 isn't automatic — surface it to the caller via `retryable: true` so a higher-level queue can redrive.
