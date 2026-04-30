/**
 * Curated documentation snippets that ship with the runtime so Helm can
 * self-reference its architecture from inside a tool-use loop. The
 * `helm-docs` skill takes a topic and returns the matching content.
 *
 * Topics are kept short on purpose — the model needs accurate facts,
 * not a manual. When the user asks "set me up", the model can call
 * `helm-docs {topic: "setup"}` to remind itself which skills to call
 * in which order.
 *
 * If you change architecture, update the relevant snippet here AND in
 * docs/SETUP.md / docs/WORKER_VS_CONTAINER.md (kept in sync by
 * convention; nothing automated yet).
 */

export const HELM_DOCS: Record<string, string> = {
  /* --------------------- canonical setup flow --------------------- */
  "setup": `
DEPLOY-EVERYTHING IN ONE CALL: helm-setup-deploy.

What "set me up" means:
  helm-setup-deploy — full provisioning in a single skill call:
    1. Auto-resolves accountId from /accounts (cached after first call)
    2. Auto-resolves scriptName from env.AGENT_NAME or "helm"
    3. Runs Access lockdown if CF_ACCESS_* not yet set (creates app +
       email-allowlist policy, persists team-domain + aud secrets)
    4. Mints HELM_INTERNAL_TOKEN if missing
    5. Creates D1 \${scriptName}-pa, R2 \${scriptName}-persist, KV \${scriptName}-cache
       (idempotent — reuses if any already exist)
    6. PATCHES live Worker bindings: DB (d1), WORKSPACE (r2), CACHE (kv)
    7. PATCHES ENABLED_PLUGINS plain_text binding to merge in memory,
       mcp-client, notifier, email, calendar, scheduler
    8. Sets CLOUDFLARE_ACCOUNT_ID secret so future requests skip /accounts
    9. Returns wranglerTomlAdditions: the snippet for the user to commit
       (so their next 'wrangler deploy' doesn't drop the patches)

NO 'wrangler deploy' needed — CF auto-redeploys on settings change (~15s).
THE ONLY THING THE USER MUST DO: paste the wranglerTomlAdditions into
their local wrangler.toml when they're ready to make it durable.

Lighter path: helm-setup-auto — only does Access lockdown + R2 bucket +
HELM_INTERNAL_TOKEN. Use only if helm-setup-deploy is overkill.

Default naming conventions:
  R2 bucket        \${scriptName}-persist     (mounted as env.WORKSPACE)
  D1 PA stack      \${scriptName}-pa          (mounted as env.DB)
  D1 memory        \${scriptName}-memory      (mounted as env.MEMORY_DB)
  KV cache         \${scriptName}-cache       (mounted as env.CACHE)
  Access app name  Helm — \${scriptName}

scriptName defaults to env.AGENT_NAME ?? "helm". You should NEVER need
to ask the user for it.
`.trim(),

  /* --------------------- topology --------------------- */
  "topology": `
WORKER vs CONTAINER (the two primitives Open Think runs on):

  Worker  (src/index.ts, V8 isolate, JS/TS only)
    - Where ALL HTTP routing, auth, conductor, plugins, DOs live
    - Has access to every CF binding: D1, KV, R2, AI, DOs, Workflows
    - 5ms cold start, 128MB RAM, 5min wall, $0 free tier
    - The "brain"

  Container  (docker/shell/, Linux + bash + node-pty bridge)
    - One DO instance (ShellContainerDO) per session name
    - Real Linux, FUSE-capable, 256MB-12GB RAM, ephemeral disk
    - 5-10s cold start, sleeps after 15min idle, ~$0.07/hr awake
    - Pre-installed: bash, git, curl, jq, vim, tmux, htop, node, python3,
      rclone (for FUSE-mount of R2 if R2_* keys are forwarded)
    - The "hands"

State boundaries:
  Plugin/skill catalog       Worker (in-memory + DO storage)
  Chat history               AgentSessionDO (DO SQLite)
  Cost rollup, scheduler     D1 (env.DB)
  Workspace files            R2 (env.WORKSPACE), shown in /app#/files
  Snapshots                  R2 sessions/<email>/workspace-*.tar.gz
  Container scratch          /workspace (ephemeral)
  Container persist mount    /persist (R2 FUSE, optional)

Container talks to Worker via HTTPS using HELM_INTERNAL_TOKEN bearer
(set by helm-setup-auto). The in-shell \`helm\` REPL uses this. So does
helm-fetch, helm-save, helm-load.
`.trim(),

  /* --------------------- bindings --------------------- */
  "bindings": `
WORKER BINDINGS — what the Worker has access to.

Read current bindings via cf-list-bindings (returns the array CF
returns from /workers/scripts/<name>/settings).

Add a binding via cf-patch-binding:
  type ∈ { r2_bucket, d1, kv_namespace, ai, queue, hyperdrive, plain_text }
  name = the binding name (e.g. "WORKSPACE", "DB", "AI")
  config = type-specific:
    r2_bucket:    { bucket_name: "..." }
    d1:           { database_name: "...", database_id: "<uuid>" }
    kv_namespace: { namespace_id: "<id>" }
    ai:           {} (Workers AI; just needs a name)
    queue:        { queue_name: "..." }
    hyperdrive:   { id: "<config-id>" }

cf-patch-binding ALWAYS returns a tomlSnippet showing what to paste
into the user's local wrangler.toml. Surface it verbatim so they can
make the change durable.

Default binding NAMES our runtime knows about:
  AI                Workers AI binding
  WORKSPACE         R2 bucket (used by /persist proxy)
  DB                D1 database (PA stack)
  AGENT_SESSIONS    DO namespace (auto-provisioned)
  STREAM_HUBS       DO namespace (auto-provisioned)
  CHAT_SESSIONS     DO namespace (auto-provisioned)
  SHELL_CONTAINER   Container DO (auto-provisioned)
  SHELL_REGISTRY    Singleton DO (auto-provisioned)
  CLI_AUTH          Singleton DO (auto-provisioned)
`.trim(),

  /* --------------------- secrets --------------------- */
  "secrets": `
WORKER SECRETS — what the Worker has access to (write-only via CF API;
values never returned).

Read which secrets are SET (names only) via cf-list-secrets.
Read full slot catalog (description, group, required-for-what) via
helm-secrets-status.

Set / rotate via cf-put-secret:
  scriptName, name, text (the secret value)

Common slots and what they unlock:
  CLOUDFLARE_API_TOKEN     The agent operating CF on its own behalf
  HELM_INTERNAL_TOKEN      In-shell helm REPL bearer (auto-minted by helm-setup-auto)
  R2_BUCKET                Bucket name for /persist proxy
  AGENT_OWNER_EMAIL        Who Cloudflare Access lets through
  CF_ACCESS_TEAM_DOMAIN    Set by helm-setup-auto
  CF_ACCESS_AUD            Set by helm-setup-auto
  OPENROUTER_API_KEY       Best default chat provider when set
  ANTHROPIC_API_KEY        Direct Claude
  AI_GATEWAY_ID            Cloudflare AI Gateway analytics + BYOK

Setting a secret triggers an auto-redeploy by CF (~15s). The next
container cold-start picks up the new env vars.
`.trim(),

  /* --------------------- shell + files --------------------- */
  "shell": `
HELM SHELL — bash session in a CF Container, accessible at /app#/shell
or via 'npm run shell -- --host <worker-host>'.

Per-user containers (auth-derived session name "u-<8-hex>"). 15-min
idle sleep. Disk:
  /workspace  ephemeral SSD (fast, wiped on sleep)
  /persist    R2 (durable, optional)

In-shell helpers (always in PATH):
  helm "<prompt>"            — talk to your conductor over HTTPS+bearer
  helm-save                  — tar /workspace → R2 sessions/<you>/...
  helm-load                  — restore latest snapshot
  helm-fetch <key>           — pull a file from /persist into /workspace
  helm-fetch --list          — list all your files
  helm-fetch --search <s>    — find files by substring

Files tab at /app#/files: drag-drop upload, browse, download, delete.
Per-user prefix files/u-<hash>/. Backed by env.WORKSPACE R2 binding via
the /persist proxy — no R2 access keys in the container.

Sessions panel at /app#/shell → click 'Sessions': live/idle status,
awake time, est. cost, attach/forget.
`.trim(),

  /* --------------------- skills inventory --------------------- */
  "skills": `
SKILL CATALOG — what Helm can call.

cf-admin (Cloudflare API plumbing):
  cf-verify              token sanity check
  cf-list-accounts       accounts visible to the token
  cf-list-workers        Workers in an account
  cf-list-bindings       current Worker's bindings (read)
  cf-list-secrets        Worker's secret NAMES (no values)
  cf-list-d1             D1 databases
  cf-create-d1           create D1 [dangerous]
  cf-query-d1            run SQL [dangerous]
  cf-list-kv             KV namespaces
  cf-create-kv           create KV [dangerous]
  cf-kv-put/get/delete   KV operations
  cf-list-r2             R2 buckets
  cf-create-r2           create R2 bucket [dangerous]
  cf-put-secret          set a Worker secret [dangerous]
  cf-patch-binding       add/replace a binding on the live Worker [dangerous]
  cf-list-access-apps    Access applications
  cf-create-access-app   create Access app [dangerous]
  cf-api                 generic CF API escape hatch [dangerous]

helm-setup (high-level wrappers):
  helm-setup-status      capability matrix (drives /app#/settings)
  helm-setup-secrets-status  secret slot inventory + which are set
  helm-setup-auto        one-call full setup (lockdown + token + bucket)
  helm-docs              read curated documentation (this very catalog)

admin (introspection):
  admin-introspect       runtime config + plugin metadata
  admin-health-check     deep capability check
  admin-suggest-plugins  recommend plugins for a goal
  admin-env-template     emit a .dev.vars template
  admin-cost-today       today's cost from D1 cost_daily

Plus model-call skills: ai-chat, cf-gateway-chat, anthropic-chat, etc.
See \`admin-introspect\` for the live list of enabled plugins.
`.trim(),

  /* --------------------- intentionally manual --------------------- */
  "manual-steps": `
WHAT'S INTENTIONALLY MANUAL (the agent should not promise to do these).

Editing wrangler.toml: the file is git-tracked. We don't silently rewrite
it. The agent can:
  - Patch the LIVE Worker via cf-patch-binding (drift on next deploy)
  - Show the user the exact TOML snippet to paste

Triggering 'wrangler deploy' from the user's machine: needs CI/local.
The agent can advise and verify post-deploy state.

Generating VAPID keys: these are crypto material; we do it locally
(\`npm run vapid:generate\`) so the private key never touches our
server. Agent should advise the user to run that command.

Provider keys (OpenRouter, Anthropic, OpenAI): the user pays for these.
Agent should suggest where to get them (URL) and offer to set the
secret via cf-put-secret AFTER the user pastes it.
`.trim()
};
