# Codex app-server bridge

The `codex` plugin's `app-server` auth mode bridges your Worker to a running [Codex app-server](https://developers.openai.com/codex/app-server) via JSON-RPC. This is the **recommended path for ChatGPT Plus/Pro subscription auth** — the app-server owns the OAuth flow and refreshes tokens on your host, and the Worker just forwards RPCs.

## When to use it

- You want Helm to use your ChatGPT subscription for Codex models.
- You don't want to paste + refresh `CODEX_ACCESS_TOKEN` manually every time tokens expire.
- You need the full Codex surface: threads, turns, model listing, command execution, skills.

## Architecture

```
┌─────────────────────────────┐    Worker outbound fetch
│  Open Think Worker          │────────┐
│  codex plugin (app-server)  │        │ wss:// or https://
└─────────────────────────────┘        │
                                       ▼
                        ┌─────────────────────────────┐
                        │  codex app-server           │  authenticated against
                        │  (CLI subprocess)           │  your ChatGPT subscription
                        │  JSON-RPC over WS / stdio   │  via `codex login`
                        └─────────────────────────────┘
```

The plugin auto-detects transport by URL scheme:

- `wss://…` / `ws://…` — direct WebSocket to `codex app-server --listen ws://host:port`. One-shot request/response per RPC.
- `https://…` / `http://…` — POST JSON-RPC envelopes to a small HTTP shim that wraps the stdio app-server.

## Recipe 1 — Local dev with cloudflared tunnel

Fastest path if your laptop is the machine paying for the ChatGPT subscription.

```bash
# 1. One-time: sign in.
codex login

# 2. Start the app-server on a local port (WebSocket transport).
codex app-server --listen ws://127.0.0.1:4500

# 3. In another terminal, expose that port with cloudflared.
cloudflared tunnel --url http://127.0.0.1:4500

#    → prints a public URL like https://random-slug.trycloudflare.com
#    → for WebSocket, use wss://random-slug.trycloudflare.com
```

Then on your Worker:

```bash
wrangler secret put CODEX_APP_SERVER_URL       # e.g. wss://random-slug.trycloudflare.com
wrangler secret put CODEX_APP_SERVER_TOKEN     # optional — add one via tunnel auth middleware
```

Add `*.trycloudflare.com` (or your specific tunnel host) to `ALLOWED_HOSTS` and enable `codex` in `ENABLED_PLUGINS`.

Test: `curl -X POST https://<worker>/skills/invoke/codex-status -d '{}'` — should report `authMode: "app-server"`, `appServerTransport: "websocket"`, and an `appServerProbe` result with `account/read` data.

> ⚠️ Anyone who learns the tunnel URL can call your app-server. Always set `CODEX_APP_SERVER_TOKEN` and configure your tunnel (Cloudflare Access or a reverse-proxy auth header) to enforce it.

## Recipe 2 — Companion bridge container (recommended, portable)

Open Think ships a ready-to-deploy Node.js bridge at [`companion/codex-bridge/`](../companion/codex-bridge/). It's a ~250-line HTTP + SSE server that wraps `codex app-server` stdio into two endpoints:

- `POST /rpc`    — single JSON-RPC request/response
- `POST /stream` — JSON-RPC request → `text/event-stream` of every frame (notifications + terminal)
- `GET /healthz` — liveness check

Deploy it once; point Open Think at it forever.

### Deploy to Cloudflare Containers

```bash
cd companion/codex-bridge
docker build -t open-think-codex-bridge .
docker tag open-think-codex-bridge registry.example.com/you/open-think-codex-bridge:latest
docker push registry.example.com/you/open-think-codex-bridge:latest

# In a separate Worker project's wrangler.toml:
# [[containers]]
# class_name = "CodexBridge"
# image = "registry.example.com/you/open-think-codex-bridge:latest"
# instances = 1
# env.BRIDGE_TOKEN = "<long-random-string>"
# (mount a volume at /root/.codex so auth survives restarts)

# Then on Open Think:
wrangler secret put CODEX_APP_SERVER_URL       # https://<container-url>
wrangler secret put CODEX_APP_SERVER_TOKEN     # same BRIDGE_TOKEN value
```

### Deploy to Fly.io / Render / any container host

```bash
cd companion/codex-bridge
docker build -t open-think-codex-bridge .

# Fly example:
fly launch --image open-think-codex-bridge --region iad
fly secrets set BRIDGE_TOKEN=<random>
fly volumes create codex_home --size 1 --region iad
fly deploy

# One-time OAuth:
fly ssh console -C "codex login"
```

See [companion/codex-bridge/README.md](../companion/codex-bridge/README.md) for the full env var reference and alternative deployment paths.

### Note on using `/conductor/stream`

If you deploy the bridge with `wss://` transport (a small change to `CODEX_ARGS` in the container), Open Think's `POST /conductor/stream` endpoint will pipe the app-server's JSON-RPC notifications directly into a browser SSE — real-time `turn/delta` deltas, tool-call visibility, and progress events. If you stick with HTTP `/rpc`, Helm works but tops out at buffered request/response turns. The bridge's own `/stream` endpoint supports SSE either way.

## Recipe 3 — Remote dev box

Any SSH-reachable machine that can run the `codex` CLI works:

```bash
# On the dev box:
codex login
codex app-server --listen ws://0.0.0.0:4500

# Behind an auth-protected reverse proxy (caddy, nginx, cloudflared):
#   https://codex.example.com → proxied to ws://127.0.0.1:4500
```

Set `CODEX_APP_SERVER_URL=wss://codex.example.com` and a bearer token in `CODEX_APP_SERVER_TOKEN`.

## Skills exposed by the app-server mode

| Skill id | JSON-RPC method | Purpose |
| --- | --- | --- |
| `codex-status` | `account/read` | Verify connection + subscription state |
| `codex-thread-start` | `thread/start` | Begin a new conversation thread |
| `codex-thread-list` | `thread/list` | Enumerate existing threads |
| `codex-models` | `model/list` | Show models the app-server can drive |
| `codex-chat` | `thread/start` + `turn/start` | High-level chat convenience |
| `codex-rpc` (dangerous) | any | Raw passthrough for anything not wrapped above |

The low-level `codex-rpc` skill is marked `dangerous` so selective-mode auto loops halt before invoking arbitrary RPCs. Approve it manually when you need features not covered by the named skills.

## Request lifecycle (WebSocket)

1. Worker opens a WS upgrade via `fetch(url, { headers: { Upgrade: "websocket" } })`.
2. Sends a single `{ jsonrpc: "2.0", id, method, params }` frame.
3. Waits (up to `CODEX_APP_SERVER_TIMEOUT_MS`, default 30s) for a response frame whose `id` matches.
4. Closes the connection cleanly with code 1000.

Long-lived WebSockets that stream `turn/start` progress notifications are roadmap — they require moving the WS into a Durable Object so they survive request boundaries. For now, each RPC is a fresh upgrade/send/receive/close cycle.

## Diagnostics

```bash
# Status with app-server probe
curl -X POST https://<worker>/skills/invoke/codex-status -d '{}'

# Raw RPC passthrough
curl -X POST https://<worker>/skills/invoke/codex-rpc -H 'content-type: application/json' \
  -d '{"input":{"method":"model/list","params":{}}}'
```

If `appServerProbe.ok === false`, the most common causes are:

- Tunnel URL not reachable (test from a browser)
- Token mismatch between Worker secret and the shim/proxy
- App-server died — check `codex app-server` logs on the host
- `ALLOWED_HOSTS` missing the tunnel hostname (Worker's restricted-fetch blocks it)
