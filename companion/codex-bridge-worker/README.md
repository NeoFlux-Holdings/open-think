# codex-bridge-worker

A Cloudflare-native Codex bridge that runs as its own Worker — no Docker, no tunnel, no separate host. Companion to the Node-based `../codex-bridge/` for users who want to stay entirely on Cloudflare.

## When to choose this vs. `codex-bridge/`

| Need | Pick |
| --- | --- |
| Zero infra to maintain, all on Cloudflare | **codex-bridge-worker** (this) |
| Self-refreshing tokens via `codex app-server` subprocess | `codex-bridge/` (Node + Docker) |
| Full thread / turn semantics (multi-agent flows) | `codex-bridge/` |
| Only chat completions against your ChatGPT subscription | **codex-bridge-worker** (this) |

This Worker does **not** run the `codex` CLI — it just proxies requests from Open Think's `codex` plugin to the ChatGPT backend API using paste-in tokens. When tokens expire, rotate them via `POST /auth/rotate`.

## Deploy

### One-command (from this directory)

```bash
cd companion/codex-bridge-worker
npm install
npx wrangler deploy
```

You'll get a `.workers.dev` URL — copy it. That's `CODEX_APP_SERVER_URL` for your main Open Think runtime.

### Set the bridge bearer token

```bash
npx wrangler secret put BRIDGE_TOKEN       # pick any long random string; shared with the main Worker
```

### First-time token seeding

**Option A — Secrets (simple, manual rotation):**
```bash
# On your local machine, after running `codex login`:
cat ~/.codex/auth.json   # find accessToken + idToken fields

npx wrangler secret put CODEX_ACCESS_TOKEN
npx wrangler secret put CODEX_ID_TOKEN     # optional but recommended
```

**Option B — Durable Object (recommended, rotate via API):**

Skip the secret put. Instead, POST once:

```bash
curl -X POST https://<bridge>.workers.dev/auth/rotate \
  -H "Authorization: Bearer <BRIDGE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "eyJ…",
    "idToken": "eyJ…",
    "note": "initial seed"
  }'
```

When tokens expire, re-run `codex login` locally and POST again — no redeploy, no secret shuffle.

## Wire to your main Open Think Worker

```bash
cd ../..  # back to the main project
npx wrangler secret put CODEX_APP_SERVER_URL   # https://<bridge>.workers.dev
npx wrangler secret put CODEX_APP_SERVER_TOKEN  # same value as BRIDGE_TOKEN above
```

Add the bridge hostname to `ALLOWED_HOSTS` in your main Worker's `wrangler.toml`, include `codex` in `ENABLED_PLUGINS`, and redeploy.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness + token-presence probe (no auth) |
| `POST` | `/rpc` | Single `codex/responses` request → buffered response |
| `POST` | `/stream` | Same, but SSE stream |
| `POST` | `/auth/rotate` | Rotate stored tokens (bearer-auth'd) |
| `GET` | `/auth/status` | `{ configured, tokenPreview, rotatedAt, source }` |

All non-`/healthz` endpoints require `Authorization: Bearer <BRIDGE_TOKEN>`.

## Expected request shape

```json
POST /rpc
Authorization: Bearer <BRIDGE_TOKEN>

{
  "method": "codex/responses",
  "params": {
    "model": "gpt-5-codex",
    "input": [{ "role": "user", "content": "Say hi." }],
    "max_output_tokens": 512
  }
}
```

The `params` object is forwarded verbatim to `chatgpt.com/backend-api/codex/responses` with `stream: false` (or `stream: true` on `/stream`). That backend URL is internal to OpenAI and has changed before — we expose `CODEX_BACKEND_URL` as an override.

## Token lifecycle

1. **Rotate** — `POST /auth/rotate` when your tokens are 80% through their TTL
2. **Probe** — `GET /auth/status` to see the last rotation time + token preview
3. **Refresh** — when `/rpc` returns 401, the bridge tells you exactly which step (rerun `codex login`, rotate)

This is the same lifecycle the Node bridge handles automatically — here you automate it yourself via a scheduled job or a human reminder.

## Limitations we're honest about

- **No token auto-refresh.** The Node bridge runs `codex app-server` which manages its own OAuth; this Worker does not. Tokens expire; you rotate manually.
- **Chat only.** Thread / turn / steer / interrupt — all the rich `codex app-server` JSON-RPC surface — is NOT here. If you need that, run `codex-bridge/`.
- **Backend URL is undocumented.** ChatGPT's backend is internal to OpenAI. If they change the path, fix `CODEX_BACKEND_URL` and you're back.

## Security posture

- `BRIDGE_TOKEN` gates every endpoint except `/healthz`
- Tokens stored in a Durable Object are encrypted at rest by Cloudflare
- Tokens stored as `wrangler secret put` secrets are encrypted at rest by Cloudflare
- Only the `auth/rotate` and `auth/status` endpoints touch token material
- Upstream calls to `chatgpt.com` happen over TLS inside Cloudflare's network

## Deploy to Cloudflare button (roadmap)

Once this directory has a stable GitHub location, replace the README header with:

```
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think/tree/main/companion/codex-bridge-worker)
```

so the whole flow becomes a single click.
