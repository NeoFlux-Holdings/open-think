# Providers

Open Think supports **five distinct paths to a model**. Pick whichever fits your ops posture and billing model; they can coexist.

| # | Plugin | Path | Best for |
| --- | --- | --- | --- |
| 1 | `cf-ai-gateway` | Cloudflare AI Gateway — 23+ providers behind one binding | BYOK, cached, metered, observable |
| 2 | `workers-ai` | Direct Cloudflare Workers AI (`env.AI`) | Free-tier / Cloudflare-hosted models |
| 3 | `anthropic` | Direct Anthropic Messages API | Bypass the gateway, raw path |
| 4 | `openai-compatible` | Direct to any OpenAI-compatible endpoint | Groq, Together, Ollama, self-hosted |
| 5 | `codex` | OpenAI Codex — API key OR ChatGPT subscription tokens | Existing Plus/Pro subscriptions |

All five expose the same Helm modes (`propose` / `selective` / `auto`) and are selectable per-call with `provider` in the `/conductor/message` request.

---

## 1 · Cloudflare AI Gateway (recommended default)

Covers **23+ providers** (Anthropic, OpenAI, Google AI Studio, Google Vertex, Amazon Bedrock, Azure OpenAI, Groq, Cerebras, Cohere, DeepSeek, Mistral, OpenRouter, Perplexity, xAI / Grok, HuggingFace, Cartesia, ElevenLabs, Fal AI, Deepgram, Replicate, Baseten, Ideogram, Parallel, Workers AI) behind one binding. Keys live in Cloudflare Secrets Store; calls are cached, logged, and metered.

### Setup

1. Create a gateway in the [CF dashboard](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway).
2. For each provider you want to use, add an entry under **Provider Keys** (Secrets Store backs these).
3. Set the Worker secrets:

   ```bash
   wrangler secret put AI_GATEWAY_ID       # e.g. "my-gateway"
   wrangler secret put CLOUDFLARE_ACCOUNT_ID
   ```

4. Enable the plugin: add `cf-ai-gateway` to `ENABLED_PLUGINS` and `gateway.ai.cloudflare.com` to `ALLOWED_HOSTS`.

### Usage

Model ids are `provider/model-name`:

```bash
curl -X POST https://<worker>/skills/invoke/cf-gateway-chat \
  -H 'content-type: application/json' \
  -d '{
    "input": {
      "model": "anthropic/claude-opus-4-6",
      "messages": [{"role": "user", "content": "hi"}]
    }
  }'
```

Or from Helm:

```bash
curl -X POST https://<worker>/conductor/message \
  -H 'content-type: application/json' \
  -d '{
    "content": "what zones do I have?",
    "provider": "cf-ai-gateway",
    "model": "anthropic/claude-haiku-4-5",
    "mode": "auto"
  }'
```

### How the call is routed

The plugin tries two paths in order:

1. **Binding path** — `env.AI.run('provider/model', { messages, ... }, { gateway: { id } })`.
   Requires the `[ai]` binding in `wrangler.toml`. This is the preferred path.
2. **Compat REST path** — POST to `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat/chat/completions`.
   Used when the binding is missing or when you pass `forceCompat: true`. Provider key is sent via `cf-aig-authorization: KEY_NAME` (Secrets Store reference) or `Authorization: Bearer ...` (direct).

### Why this path

- One plugin, one config, every provider Cloudflare supports.
- Provider keys never live in your Worker code — they live in Secrets Store and are referenced by name.
- Gateway observability: every request is logged, cacheable, and rate-limitable.
- Fallback chains: combine with the Universal endpoint to try multiple providers on failure.

---

## 2 · Workers AI (direct)

Cloudflare-hosted open models through `env.AI` without the gateway in front.

```toml
# wrangler.toml
[ai]
binding = "AI"
```

Skills: `ai-chat`, `ai-status`. Free tier is generous; no additional secrets needed for baseline models.

---

## 3 · Anthropic (direct)

Skips Cloudflare entirely. Use when you want the raw path for latency or to avoid gateway features.

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Add `api.anthropic.com` to `ALLOWED_HOSTS`. Skills: `anthropic-chat`, tool-use supported.

---

## 4 · OpenAI-compatible (direct)

Any endpoint that speaks OpenAI `/v1/chat/completions` — Groq, Together, Ollama, self-hosted vLLM, etc.

```bash
wrangler secret put OPENAI_COMPATIBLE_URL   # e.g. https://api.groq.com/openai/v1
wrangler secret put OPENAI_COMPATIBLE_KEY
```

Add the hostname to `ALLOWED_HOSTS`. Skills: `openai-compat-chat`, `openai-compat-list-models`, tool-use supported.

---

## 5 · Codex / ChatGPT subscription

Three auth modes for OpenAI's Codex (`gpt-5-codex` and friends):

### 5a. API key (classic)

```bash
wrangler secret put OPENAI_API_KEY
```

Billed at standard OpenAI API rates. Skill: `codex-chat`, mode: `api-key`.

### 5b. ChatGPT subscription tokens

Reuse your ChatGPT Plus / Pro subscription without paying for API access separately. The tokens come from your local `codex` CLI session.

```bash
# 1. On your local machine:
codex login

# 2. Read your tokens:
cat ~/.codex/auth.json

# 3. Copy them into Worker secrets:
wrangler secret put CODEX_ACCESS_TOKEN   # paste the access_token
wrangler secret put CODEX_ID_TOKEN       # paste the id_token (if present)
```

Add `chatgpt.com` to `ALLOWED_HOSTS`. Calls route to `chatgpt.com/backend-api/codex/responses` and count against your ChatGPT subscription quota.

**Trade-offs:** tokens expire (usually within days/weeks); when calls start returning 401, re-run `codex login` and refresh the secrets. The backend URL and request shape are internal to OpenAI and may change — we surface errors cleanly and fall back to configurable `CODEX_BACKEND_URL` if they ever relocate.

### 5c. Codex app-server bridge (recommended for subscriptions)

The cleanest way to use a ChatGPT Plus/Pro subscription end-to-end — the app-server runs on your host (or a companion Sandbox Worker), owns the OAuth flow, auto-refreshes tokens, and exposes the full Codex JSON-RPC surface. Our Worker forwards RPCs.

```bash
# One-time on the host with the subscription:
codex login
codex app-server --listen ws://127.0.0.1:4500

# Expose via cloudflared tunnel (or SSH-reachable proxy, or companion Sandbox Worker).
# Then on the Worker:
wrangler secret put CODEX_APP_SERVER_URL        # e.g. wss://tunnel-url
wrangler secret put CODEX_APP_SERVER_TOKEN      # optional bearer
```

Add the hostname to `ALLOWED_HOSTS`. Full recipe: [`docs/CODEX_APPSERVER.md`](./CODEX_APPSERVER.md).

Skills unlocked: `codex-thread-start`, `codex-thread-list`, `codex-models`, `codex-rpc` (raw passthrough; dangerous), plus `codex-chat` routes through `thread/start` + `turn/start` automatically.

### 5d. OAuth device-code flow (roadmap)

Routes are scaffolded at `POST /oauth/codex/device/start` + `POST /oauth/codex/device/poll`, but dispatch is gated on registering Open Think as an OpenAI OAuth client. When ready, set `CODEX_OAUTH_CLIENT_ID` and the flow becomes live without additional code changes. See [`src/oauth/codexOauth.ts`](../src/oauth/codexOauth.ts).

---

## Provider comparison cheatsheet

| Feature | cf-ai-gateway | workers-ai | anthropic | openai-compat | codex |
| --- | --- | --- | --- | --- | --- |
| Providers | 23+ | Workers AI only | Anthropic only | Any OpenAI-compatible | OpenAI (Codex) |
| Secrets in Secrets Store | yes | n/a | env | env | env |
| Observability via gateway | yes | optional | no | no | no |
| Native tool-use | yes | propose-only | yes | yes | yes |
| Auto mode (Helm) | yes | falls back to propose | yes | yes | yes |
| ChatGPT subscription billing | — | — | — | — | yes (5b) |

## When in doubt

- **New project?** Enable `cf-ai-gateway` + `workers-ai`. Use `cf-ai-gateway` for production, `workers-ai` for free Helm calls.
- **Already paying for Claude?** Add `anthropic` and skip the gateway overhead.
- **Have a ChatGPT Pro sub?** Use `codex` mode 5b — reuse the sub.
- **Running a local model server?** Use `openai-compatible` pointing at your LAN endpoint.
- **Want failover across providers?** Call `cf-gateway-chat-fallbacks` with an ordered `models` array — first success wins, attempts array tells you which retries happened. Or pass `fallbackModels: [...]` to `POST /conductor/message`.

Helm picks automatically: it prefers `cf-ai-gateway` when enabled, then falls through to `workers-ai`, `anthropic`, `openai-compatible`, `codex`. Override per-call with `provider` on `/conductor/message`.
