# open-think-codex-bridge

A ~250-line Node.js server that wraps [`codex app-server`](https://developers.openai.com/codex/app-server) in an HTTP + SSE surface that Open Think's [`codex` plugin](../../docs/CODEX_APPSERVER.md) can consume over `CODEX_APP_SERVER_URL`.

Why: the app-server natively speaks JSON-RPC over stdio (default) or WebSocket (experimental). Cloudflare Workers can't spawn subprocesses, and raw stdio isn't reachable from the edge. This bridge is the deployable middle layer — deploy it once on any host that can run Node, point Open Think at it, done.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/healthz` | `200 ok` if the subprocess is alive |
| `POST` | `/rpc`     | Single JSON-RPC request → single JSON-RPC response |
| `POST` | `/stream`  | JSON-RPC request → `text/event-stream` of every frame (notifications + terminal) |

All `POST` endpoints require `Authorization: Bearer $BRIDGE_TOKEN` when `BRIDGE_TOKEN` is set (strongly recommended).

## Deploy recipe 1 — Cloudflare Containers

Cloudflare Containers is the cleanest home for this bridge: it's bound to the edge, you get a stable HTTPS URL, and restarts keep the `~/.codex` volume.

```bash
# 1. Build the image
docker build -t open-think-codex-bridge ./companion/codex-bridge

# 2. Push to a registry Cloudflare Containers can read
#    (see docs.cloudflare.com on container registries)
docker tag open-think-codex-bridge registry.example.com/you/open-think-codex-bridge:latest
docker push registry.example.com/you/open-think-codex-bridge:latest

# 3. Create the container (wrangler.toml in a separate Worker project):
#    [[containers]]
#    class_name = "CodexBridge"
#    image = "registry.example.com/you/open-think-codex-bridge:latest"
#    instances = 1
#    env.BRIDGE_TOKEN = "<paste-a-long-random-string>"
#
#    Add a volume mount for /root/.codex so auth survives restarts.
#
# 4. Deploy and capture the container URL.
# 5. On your main Open Think Worker:
wrangler secret put CODEX_APP_SERVER_URL        # https://<container-url>
wrangler secret put CODEX_APP_SERVER_TOKEN      # same BRIDGE_TOKEN
```

Add the container hostname to `ALLOWED_HOSTS` in `wrangler.toml`.

## Deploy recipe 2 — Fly.io / Render / any container host

```bash
# From repo root:
docker build -t open-think-codex-bridge ./companion/codex-bridge

# Fly example (create fly.toml with volumes for /root/.codex):
fly launch --image open-think-codex-bridge --region iad
fly secrets set BRIDGE_TOKEN=<random-string>
fly volumes create codex_home --size 1 --region iad
fly deploy

# One-time auth (interactive login inside the container):
fly ssh console -C "codex login"
```

Then on Open Think: `CODEX_APP_SERVER_URL=https://your-app.fly.dev`.

## Deploy recipe 3 — Local dev + cloudflared tunnel

Fastest iteration loop:

```bash
cd companion/codex-bridge
npm start                    # starts on :8787; pipes to `codex app-server`
cloudflared tunnel --url http://127.0.0.1:8787
# prints: https://random-slug.trycloudflare.com
```

Set `CODEX_APP_SERVER_URL=https://random-slug.trycloudflare.com` and
`CODEX_APP_SERVER_TOKEN=<whatever-you-set-BRIDGE_TOKEN-to>` on the Worker.

The bridge auto-respects `HOME=~` so your existing `~/.codex/auth.json` is used — no re-login needed.

## One-time login

The `codex` CLI uses your ChatGPT subscription via OAuth. You must run `codex login` **once** inside the environment that owns `~/.codex/auth.json`:

```bash
# Host install:
codex login

# Container:
docker run --rm -it -v open-think-codex-bridge_codex_home:/root/.codex \
  open-think-codex-bridge codex login
```

The bridge does not manage auth itself — it assumes `codex app-server` can read the auth file.

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP listen port |
| `BRIDGE_TOKEN` | *(none)* | Required bearer token on all POST endpoints |
| `CODEX_BIN` | `codex` | Path to the codex binary |
| `CODEX_ARGS` | `app-server` | Space-separated args for the subprocess |
| `SUBPROCESS_TIMEOUT` | `120000` | Per-RPC timeout in ms |

## Protocol notes

- The subprocess runs **stdio-mode** (the default). Each line on its stdout is one JSON-RPC frame.
- `/rpc` matches responses to requests by `id`. Mid-stream notifications that arrive during a `/rpc` call are discarded — use `/stream` for anything that yields deltas.
- `/stream` uses Server-Sent Events. One event per JSON-RPC frame:
  - `event: ready`       — bridge received the request
  - `event: notification` — any frame with `method` (turn deltas, tool calls, progress)
  - `event: result`      — terminal frame with `result` matching the request id
  - `event: error`       — terminal frame with `error` matching the request id
  - `event: done`        — SSE stream closing cleanly

## Security

- **Never** expose the bridge on a public IP without `BRIDGE_TOKEN`. Anyone who reaches it can drive your ChatGPT subscription.
- Layer an authenticated proxy (Cloudflare Access, tunnel policy, nginx auth) in front for defense in depth.
- The bridge does not rotate tokens itself — the `codex` CLI inside the container/host handles OAuth refresh. If `codex login` expires, your bridge will start returning `-32000` errors until you re-auth.
- The restricted-fetch allow-list on Open Think (`ALLOWED_HOSTS`) is your last line of defense against a malicious/compromised bridge URL.

## Testing

```bash
# Health
curl http://127.0.0.1:8787/healthz

# Single RPC
curl -X POST http://127.0.0.1:8787/rpc \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -d '{"method":"model/list","params":{}}'

# Streaming turn
curl -N -X POST http://127.0.0.1:8787/stream \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -d '{"method":"turn/start","params":{"thread_id":"thr_xxx","input":"hi"}}'
```

## Caveats

- The exact `codex app-server` protocol is evolving (OpenAI marks WebSocket mode as experimental). This bridge tolerates unknown notification methods — they pass through as-is. If a future protocol change breaks things, the fix is almost always in `dispatchFrame()` in `server.mjs`.
- No multi-tenant support — one bridge instance = one ChatGPT subscription. For multiple users, deploy multiple instances with distinct auth volumes.
- No retry or circuit breaker — wrap the bridge in a supervisor (systemd, Docker `--restart=always`, CF Containers restart policy).
