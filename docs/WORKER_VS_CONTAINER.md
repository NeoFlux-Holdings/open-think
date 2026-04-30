# Worker vs. Container — how to decide what goes where

Open Think runs on two complementary Cloudflare primitives:

| | **Worker** (`src/`) | **Container** (`docker/shell/`) |
|---|---|---|
| **What** | V8 isolate, JS/TS only | Linux userland, real processes |
| **Cold start** | ~5 ms | ~5–10 s (image pull + boot) |
| **Persistent process** | No (per-request invocation) | Yes (until idle sleep) |
| **Filesystem** | None | ephemeral SSD + optional R2 FUSE |
| **Native binaries** | No (only what V8 ships) | Anything you can `apk add` |
| **Memory ceiling** | 128 MB / request | 256 MB–12 GB / instance (configurable) |
| **CPU time** | 50 ms unbounded, 5 min wall | unbounded (hourly billed) |
| **Cost when idle** | $0 | $0 (sleeps); ~$0.000017/s when awake |
| **Bindings** | All of CF — D1, KV, R2, AI, DOs, Queues, Workflows | env vars only (mediated by the Worker) |
| **Auth** | CF Access JWT | inherited via the Worker that proxies to it |
| **Deploys** | seconds | minutes (Docker build + push) |
| **Best for** | request handling, orchestration, AI calls, anything stateless | shell, compilers, native tools, long-running jobs |

## The mental model

> **Worker = the brain. Container = the hands.**

The Worker is fast, stateless, knows about every binding, and is what the
internet talks to first. The Container is slow to wake but can do everything
the Worker can't — run `git`, compile code, mount FUSE, run python ML, hold a
WebSocket open for hours under heavy I/O.

## Use the Worker for

1. **HTTP routing + auth** — every request lands here first.
2. **The plugin bus** — provider plugins (Anthropic, OpenRouter, …),
   skill catalog, rollback registry, all live as TS modules.
3. **The conductor** — model orchestration, tool-use loops, streaming.
   Workers are perfect: short-lived, parallel, no shell needed.
4. **Bindings access** — D1 / KV / R2 / AI / Queues / Workflows /
   Email / Browser Rendering / Sandboxes / DOs are only reachable
   from a Worker. The Container can't hit `env.DB.prepare(...)`.
5. **Stateless ops** — anything that takes < 5 min and < 128 MB.
6. **Auth-gated SPA** — the `/app` page itself.
7. **WebSocket hubs (DOs)** — `ChatSessionDO`, `StreamHubDO` —
   long-lived in DO terms but stateless per request.

## Use the Container for

1. **Interactive shell** — bash, with PTY, that the user types into.
2. **`git clone` / `npm install` / `cargo build`** — anything that
   forks processes or touches a real FS.
3. **Tools that ship as native binaries** — ffmpeg, ImageMagick, gcc,
   python ML stacks (with `pip install`), `gh` CLI, `kubectl`, etc.
4. **Long-lived sessions** — REPLs, dev servers, anything that needs
   process state to persist between requests.
5. **FUSE-mounted persistence** — R2 buckets, S3, GCS via rclone /
   geesefs / s3fs. Workers can't mount filesystems.
6. **CPU-heavy work** — image processing, codec work, big regex
   passes. Workers will throttle; containers won't.
7. **Tools the agent itself wants to run** — when the agent says
   "let me try compiling this and see what happens", that's the
   container. The Worker proposes, the container executes.

## How they talk to each other

```
                  ┌─────────────────────────────────────────┐
   public web →   │  Worker  (src/index.ts)                 │
                  │  - auth, routing, bindings              │
                  │  - conductor + plugins                  │
                  │  - DO namespaces (Chat, Stream, Shell)  │
                  └────────────────┬────────────────────────┘
                                   │  DO-RPC / WS upgrade
                                   ▼
                  ┌─────────────────────────────────────────┐
                  │  Container DO  (ShellContainerDO)       │
                  │  - per-session lifecycle (sleep/wake)   │
                  │  - envVars forwarded into container     │
                  │  - WS upgrade proxied to :7681          │
                  └────────────────┬────────────────────────┘
                                   │  HTTP/WS to :7681
                                   ▼
                  ┌─────────────────────────────────────────┐
                  │  Container  (docker/shell/)             │
                  │  - bash + node-pty + ws bridge          │
                  │  - /workspace (ephemeral SSD)           │
                  │  - /persist  (R2 FUSE, optional)        │
                  │  - helm CLI → calls Worker conductor    │
                  └─────────────────────────────────────────┘
```

- **Browser → Worker**: WebSocket on `/shell/ws` (auth-gated).
- **Worker → Container DO**: `stub.fetch(req)` on the Hibernation API.
- **Container DO → Container**: built-in by the `@cloudflare/containers`
  SDK; the WebSocket upgrade is forwarded transparently to port 7681.
- **Container → Worker** (the `helm` REPL): plain `curl` to the public
  hostname with `Authorization: Bearer ${HELM_INTERNAL_TOKEN}`. Auth is
  the same path as the browser, just via an internal bearer instead of
  a CF Access JWT (see `verifyAccessJwt` in `src/auth.ts`).

## State boundaries

| State | Where it lives |
|---|---|
| Plugin catalog, skill catalog, runtime config | Worker (in-memory + DO-storage) |
| Chat sessions, message history, fibers | DO SQLite (`AgentSessionDO`) |
| Daily cost rollup, scheduler state, memory | D1 (`env.DB`) |
| Artifacts (git-for-agents) | R2 / Cloudflare Artifacts binding |
| Editor scratch, git checkouts, build outputs | `/workspace` in container (ephemeral) |
| Things you want to survive container sleep | `/persist` in container (R2 FUSE) **or** D1/KV via `cloudflare-admin` skills |
| Secrets (provider keys, R2 creds, internal token) | Worker secrets, forwarded to the container as envVars |

## Decision flow when adding a new feature

1. **Does it need a shell, a native binary, or > 128 MB RAM?** → Container.
2. **Does it talk to a CF binding (D1, KV, R2, AI, Queue)?** → Worker.
3. **Does it respond in < 5 min, with no FS state?** → Worker.
4. **Does it need a long-lived process?** → Container.
5. **Both?** → split: orchestrate from the Worker, do the work in the
   Container, surface the result back via the Worker.

A useful heuristic: if you'd write it as a Worker route and find yourself
typing `// TODO: figure out how to run X without a shell`, move it to the
container. If you'd write it as a container script and find yourself
typing `// TODO: figure out how to call D1`, move that *piece* to the
Worker and have the container `curl` it via the `helm` CLI.

## What this means for the agent

The agent itself (Helm) is a Worker construct — its loop, prompt, plugin
bus, conductor all live there. When it needs to "do something with files
or processes" (e.g. clone a repo, run a test suite, save a snapshot to
R2), it has two paths:

- **Direct**: invoke a `cloudflare-admin` skill from the conductor (no
  container needed; e.g. `cf-create-d1`).
- **Hands**: emit a shell command for the user to run in `/app#/shell`,
  or have the in-shell `helm` REPL drive a sub-task. The container is
  the right place when the work is "messy unix-y" rather than
  "structured CF API call".

Both paths use the same auth, the same plugins, and end up in the same
session log. Pick whichever is simpler for the task.
