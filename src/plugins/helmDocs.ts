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
  helm-clone                 — mint Artifacts token + emit git-clone command
  helm-clone <dest>          — actually clone the canonical Artifacts repo
  helm-clone --read          — same but with a READ-only token
  helm-clone --token         — print just the minted token (15 min ttl)

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

helm-artifacts (PRIMARY source-of-truth — no GitHub needed):
  helm-artifacts-status         binding + REST + repo accessibility
  helm-artifacts-init           create / import a repo (idempotent)
  helm-artifacts-clone          ensure container has a fresh clone
  helm-artifacts-pull           git pull --ff-only
  helm-artifacts-read-file      read any file from the checkout
  helm-artifacts-write-file     atomic edit + commit + push
  helm-artifacts-sync-toml      drift-fix wrangler.toml against live Worker
  helm-artifacts-deploy         redeploy live Worker from the checkout
  helm-artifacts-mint-token     scoped time-bounded token (for user's git clone)
  helm-artifacts-cron-sync      scheduled drift detector + notify

helm-github (LEGACY fallback when GitHub is the user's canonical):
  helm-github-status / read-file / write-file / create-branch / open-pr / sync-toml

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
WHAT THE AGENT CAN AND CAN'T DO ANYMORE — updated.

CAN do (via skills):
  - Patch live Worker bindings (cf-patch-binding): R2, D1, KV, AI, queues,
    plain_text vars (e.g. ENABLED_PLUGINS). CF auto-redeploys ~15s later.
  - Set/rotate Worker secrets (cf-put-secret).
  - Provision new infra (cf-create-d1/kv/r2, helm-setup-deploy).
  - Edit files + run shell commands inside the container (helm-exec).
    Pre-installed: bash, git, vim, sed, jq, node, python3, gh, WRANGLER.
  - Edit wrangler.toml DURABLY: helm-exec to git clone the user's repo,
    sed/python the file, then \`wrangler deploy --cwd /workspace/repo\`.
    Wrangler picks up CLOUDFLARE_API_TOKEN from env automatically.
  - Open a PR with \`gh pr create\` instead of direct deploy.

GENUINELY MANUAL (still on the user):
  - VAPID keys: crypto material that should never leave the user's machine.
    Tell them to run \`npm run vapid:generate\` locally and paste the keys
    via cf-put-secret.
  - Provider keys (OpenRouter / Anthropic / OpenAI): the user pays. Suggest
    where to get them (helm-secrets-status returns docsUrl per slot), then
    cf-put-secret once pasted.
`.trim(),

  /* --------------------- keep-in-sync (drift) --------------------- */
  "keep-in-sync": `
THE WRANGLER.TOML DRIFT PROBLEM (and how to avoid it).

What happens without sync:
  1. Agent calls cf-patch-binding to add an R2 bucket binding live
  2. Live Worker now has env.WORKSPACE wired ✓
  3. The canonical wrangler.toml does NOT have [[r2_buckets]]
  4. User (or agent) runs \`wrangler deploy\` from the canonical source
  5. wrangler reads wrangler.toml, sees no R2 binding, REMOVES IT
     from the live Worker
  6. Silent regression

PRIMARY PATH — helm-artifacts (Cloudflare Artifacts canonical):
  1. cf-patch-binding {type, name, config}    ← updates live Worker
  2. capture result.tomlSnippet                ← exact 3-line block
  3. helm-artifacts-sync-toml {apply:true}    ← merges + commits + pushes to Artifacts
  4. (optional) helm-artifacts-deploy          ← redeploy from Artifacts source

Why Artifacts is canonical:
  - One source of truth on Cloudflare's platform — not behind a separate
    GitHub auth boundary.
  - Both the user (local clone) and the agent (helm-shell container clone)
    push to the same remote.
  - Tokens are scoped + short-lived, minted on demand. No PAT management.

LEGACY PATHS (only for migration / power users):
  - helm-toml-* operates on a clone INSIDE the helm-shell container at
    /workspace/repo. Useful when you want to drive 'wrangler deploy'
    from inside the container with a non-Artifacts remote.
  - helm-github-* operates against api.github.com. Useful when the user
    chose GitHub as canonical instead of Artifacts.

Env var overrides:
  ARTIFACTS_REPO          repo name (default env.AGENT_NAME)
  ARTIFACTS_NAMESPACE     namespace (default "default")
  ARTIFACTS_BRANCH        branch (default "main")
  ARTIFACTS_CHECKOUT_PATH /workspace/<repo>
  ARTIFACTS_AUTO_SYNC     "1" → scheduled() runs cron-sync on cron firing
`.trim(),

  /* --------------------- canonical source-of-truth via Artifacts --------------------- */
  "artifacts": `
HELM-ARTIFACTS — Cloudflare Artifacts as the canonical source of truth
for wrangler.toml + Worker source. PRIMARY path. No GitHub required.

What it is:
  Cloudflare Artifacts (public beta May 2026) is a real git remote backed
  by Cloudflare's storage. Each repo has an HTTPS smart-Git URL like
    https://<account-id>.artifacts.cloudflare.net/git/<namespace>/<repo>.git
  The user clones it locally with stock \`git\`. The agent clones it inside
  the helm-shell container. Both push to the same canonical place.

Why over GitHub:
  - Zero external auth: tokens are scoped + short-lived, minted on demand
    by the binding or the CF REST API. No PAT to manage.
  - Per-tenant isolation: one repo per Worker (or per project); scoped
    tokens; no cross-talk.
  - Native to the platform: same account, same dashboard, same API token.

Setup (one-time):
  Easiest: run helm-setup-deploy. The deploy chain provisions an Artifacts
  repo automatically (named after scriptName, namespace "default") and
  persists ARTIFACTS_REPO as a Worker secret. Pass artifactsBootstrapUrl
  to seed from a public git URL on first init.

  Manual:
  1. Set CLOUDFLARE_API_TOKEN with the "Artifacts:Edit" scope.
  2. helm-artifacts-init {bootstrapUrl?:"https://github.com/you/repo.git"}
     — creates the repo, optionally seeds it from any public git URL.
     Idempotent.
  3. cf-put-secret ARTIFACTS_REPO=<name> + ARTIFACTS_NAMESPACE=default
     so subsequent calls skip discovery.

The /app#/settings UI exposes the same surface in the "Cloudflare Artifacts"
card: status pill, Initialize button, Mint token + clone command button,
drift checker, and a one-shot "import from a public git URL" form.

Skills:
  helm-artifacts-status        binding + REST + repo accessibility
  helm-artifacts-init          create / import (idempotent)
  helm-artifacts-list-repos    list repos in the namespace
  helm-artifacts-repo-info     metadata for one repo
  helm-artifacts-mint-token    mint a scoped time-bounded token
  helm-artifacts-clone         ensure container clone is fresh
  helm-artifacts-pull          git pull --ff-only on the clone
  helm-artifacts-read-file     read any file from the checkout
  helm-artifacts-write-file    atomic edit + commit + push
  helm-artifacts-ls            list tracked files
  helm-artifacts-history       last N commits
  helm-artifacts-diff          ref-to-ref diff
  helm-artifacts-sync-toml     drift-fix wrangler.toml against live Worker
  helm-artifacts-deploy        re-deploy live Worker from the checkout
  helm-artifacts-import-github one-shot bootstrap from a public GitHub URL
  helm-artifacts-cron-sync     scheduled drift detector + notify

Local user workflow:
  $ git clone https://x:<read-token>@<acct>.artifacts.cloudflare.net/git/default/<repo>.git
  $ cd <repo>
  $ <edit wrangler.toml>
  $ git push    # pushes back to Artifacts

Three ways to get a fresh token:
  1. /app#/settings → Cloudflare Artifacts card → "Mint write token + clone command"
     (one-click, copy-paste; 15-min TTL by default)
  2. In the helm-shell container:
       $ helm-clone               # prints clone command (write scope)
       $ helm-clone <dest>        # actually clones into <dest>
       $ helm-clone --read        # read-only token instead
       $ helm-clone --token       # just the bare token
  3. From the agent:
       helm-artifacts-mint-token {scope:"write", ttl:900}

Auto-sync on cron:
  Set ARTIFACTS_AUTO_SYNC=1 + define [triggers].crons in wrangler.toml.
  The scheduled() handler will invoke helm-artifacts-cron-sync; if drift
  is detected, the notifier plugin is fanned out (email or Web Push).
`.trim(),

  /* --------------------- legacy / fallback repo ops --------------------- */
  "github": `
HELM-GITHUB — container-free wrangler.toml sync via the GitHub REST API.
LEGACY / FALLBACK path. Most users should use helm-artifacts (above)
instead. helm-github only matters when:
  (a) the user explicitly wants GitHub as source-of-truth, OR
  (b) Artifacts isn't yet provisioned and we need a stop-gap.

Setup:
  1. Create a fine-grained PAT at https://github.com/settings/personal-access-tokens
     Scopes: Contents (read+write), Pull requests (read+write)
  2. Set GITHUB_TOKEN, GITHUB_REPO ("owner/repo"), optionally
     GITHUB_DEFAULT_BRANCH and HELM_WRANGLER_TOML_PATH.

Skills:
  helm-github-status        verify token + repo accessibility
  helm-github-read-file     fetch wrangler.toml (or any file)
  helm-github-write-file    commit a file change
  helm-github-create-branch idempotent branch creation
  helm-github-open-pr       open a PR
  helm-github-sync-toml     drift-fix mirroring helm-artifacts-sync-toml

When in doubt: use helm-artifacts-*. helm-github-* is kept around for
users with existing GitHub-centric flows.
`.trim(),

  /* --------------------- agent-can-deploy playbook --------------------- */
  "deploy-from-agent": `
HOW THE AGENT DEPLOYS CODE/CONFIG CHANGES DURABLY.

Three patterns, in order of preference:

1. Live patch (no wrangler.toml change needed):
   When the change is purely bindings/secrets/vars, use cf-patch-binding
   or cf-put-secret. CF auto-redeploys. The user's local wrangler.toml
   should EVENTUALLY get the same change (otherwise their next local
   deploy will drop your patches), but the live Worker is correct now.
   Surface the wranglerTomlAdditions for them to commit at leisure.

2. Edit + deploy via helm-exec (durable, automatic):
   When the user wants the change reflected in their git-tracked
   wrangler.toml AND deployed, do this in helm-exec:

     # Once per fresh container — clone (idempotent if already there):
     git -C /workspace/repo pull || git clone <repo> /workspace/repo

     # Edit (use python or node for non-trivial TOML):
     python3 -c "
     import re, sys, pathlib
     p = pathlib.Path('/workspace/repo/wrangler.toml')
     s = p.read_text()
     # ... insert / modify blocks ...
     p.write_text(new_s)
     "

     # Verify:
     cat /workspace/repo/wrangler.toml | head -50

     # Deploy:
     cd /workspace/repo && wrangler deploy

   Wrangler reads CLOUDFLARE_API_TOKEN from env (already forwarded).

3. PR-only (when you want review before deploy):
   git -C /workspace/repo checkout -b helm/<change-name>
   git -C /workspace/repo add wrangler.toml
   git -C /workspace/repo -c user.name=Helm -c user.email=helm@... commit -m "..."
   git -C /workspace/repo push -u origin helm/<change-name>
   gh -R /workspace/repo pr create --title "..." --body "..."

When choosing: 1 for binding/var changes the user will accept on faith;
2 when you have authority and the user said "deploy"; 3 when reviewing.
`.trim(),

  /* --------------------- the update-flow loop --------------------- */
  "update-flow": `
HOW HELM STAYS UP TO DATE — AND HOW IT DIVERGES.

Mental model: every Helm deployment lives at the intersection of two
sources:
  upstream open-think     (NeoFlux-Holdings/open-think)  — the public release
  customer's Artifacts    (private CF Artifacts repo)    — their fork
  live Worker             (the running CF Worker)        — what users hit

There are three pathways for changes to flow:

  ┌──────────────────────┐   helm-setup-update     ┌──────────────────┐
  │  upstream manifest   │  ─────────────────────▶ │    live Worker   │
  │ (opentink.dev .json) │   cron pushUpdates      └──────────────────┘
  └──────────┬───────────┘                                  ▲
             │ helm-artifacts-pull-upstream                 │
             ▼                                              │ helm-artifacts-deploy
  ┌──────────────────────┐                                  │  (or reconcile)
  │ customer's Artifacts │ ─────────────────────────────────┘
  │   (their fork repo)  │
  └──────────────────────┘

The two modes:

  1. UPSTREAM MODE (default)
     The hourly cron pushes the latest opentink.dev bundle to the live
     Worker. Customer never touches code. Their secrets/bindings ride
     through (mergeBindings preserves D1 IDs, secrets, custom KV, etc.).
     env.BUILD_SHA is stamped on every push so the Worker knows its
     own version.
     Manual "Push now" button on the manage page does the same thing
     out of band.
     Customer can also run helm-setup-update from chat to pull upstream
     on demand — same effect as Push now but agent-initiated.

  2. SELF-MANAGED MODE
     Customer (or agent) ran helm-artifacts-deploy, which deploys their
     own code from their Artifacts repo via 'wrangler deploy' inside the
     helm-shell container. Side effect: HELM_CUSTOM_DEPLOY=1 is set as
     a Worker secret. The cron checks for this binding's NAME on every
     pushOne and SKIPS the deployment if found. The customer's custom
     code is now safe from upstream cron clobbering.

     The Push now button still works but warns the user before
     overwriting their custom code with upstream bytes.

     helm-setup-update also still works — it's the explicit "go back
     to upstream" handle. After a successful upload it clears
     HELM_CUSTOM_DEPLOY so the cron resumes.

THE DIVERGE-AND-RECONCILE LOOP

Customer wants to evolve their fork while keeping up with upstream:

  a. EDIT (in shell or locally):
     The customer or agent edits files in the Artifacts checkout.
     Use helm-artifacts-write-file (atomic edit + commit + push) for
     small changes, or helm-exec into the container for multi-file
     edits + 'git commit' + 'git push'.

  b. DEPLOY (Artifacts → live Worker):
     helm-artifacts-deploy — runs 'wrangler deploy' from the checkout.
     Auto-sets HELM_CUSTOM_DEPLOY=1 so the upstream cron skips them
     going forward. Pass {claimCanonical: false} for one-shot tests
     you want overwritten by the next cron tick.

  c. RECONCILE BINDINGS (both directions):
     helm-artifacts-reconcile — picks up wrangler.toml drift in either
     direction:
       • TOML has bindings the live Worker lacks → runs deploy
       • Live Worker has bindings the TOML lacks → commits them back
     Idempotent — no drift = single git pull + settings GET, no writes.

  d. PULL UPSTREAM (sync with open-think):
     helm-artifacts-pull-upstream — adds the open-think repo as the
     'upstream' remote, fetches, and merges into the local branch.
     Reports behindBy/aheadBy on dry-run (apply:false). On clean merge
     pushes back to Artifacts. On conflict aborts the merge and
     surfaces conflicting paths so the agent or user can resolve.

     After a successful pull, run reconcile or deploy to roll the
     merged code forward to the live Worker.

  e. PR UPSTREAM (optional):
     The customer's Artifacts repo is just a git remote — they can
     'git remote add github https://github.com/them/their-fork' from
     their local clone, push, and open a PR via gh. Nothing in the
     update-flow assumes Artifacts is the only mirror.

KEY ENV VARS

  BUILD_SHA                 stamped on every cron / direct deploy / self-update
  HELM_BUNDLE_MANIFEST_URL  where to fetch the upstream manifest from
  HELM_UPSTREAM_URL         git URL for pull-upstream (default: open-think canonical)
  HELM_UPSTREAM_BRANCH      upstream branch (default: "main")
  HELM_CUSTOM_DEPLOY        secret value "1" → cron skips this Worker
  ARTIFACTS_REPO            this Worker's Artifacts repo name
  ARTIFACTS_AUTO_SYNC       "1" → cron-sync runs every cron firing
`.trim(),

  /* --------------------- divergence quickstart --------------------- */
  "divergence": `
QUICKSTART: HOW TO DIVERGE FROM UPSTREAM AND THEN KEEP UP.

The agent can evolve its own code while staying in sync with the
open-think project. Three commands cover the loop:

  # 1. Customize. Edits live in the Artifacts repo (canonical).
  helm-artifacts-write-file {path: "src/myCustom.ts", content: "..."}
  helm-artifacts-deploy
       — runs 'wrangler deploy' from Artifacts
       — sets HELM_CUSTOM_DEPLOY=1 so the cron stops overwriting

  # 2. Pull upstream fixes when they land.
  helm-artifacts-pull-upstream {apply: false}
       — dry-run: shows behindBy / aheadBy
  helm-artifacts-pull-upstream
       — applies the merge; pushes to Artifacts on success
       — surfaces conflict paths if merge fails

  # 3. After pull, roll forward.
  helm-artifacts-deploy
       — re-deploy from the merged Artifacts source

To go back to upstream-managed mode (give up your customizations):

  helm-setup-update
       — fetches upstream bundle bytes, uploads
       — clears HELM_CUSTOM_DEPLOY so the cron resumes

Or, more nuclear, restore from a known-good upstream tag:

  helm-artifacts-pull-upstream {branch: "v0.6.0", strategy: "rebase"}
  helm-artifacts-deploy

GOTCHAS

  • The upstream cron's 'Push now' button on the manage page is
    DESIGNED to overwrite custom deploys (it bypasses the flag with
    confirmation). If the customer doesn't want that, they should
    pause the deployment OR rely on their Artifacts pipeline.

  • Conflicts on pull-upstream abort the merge — the working tree is
    left clean. To resolve, helm-exec into the container and run
    'git pull upstream main', resolve in vim, 'git commit', 'git push'.
    Or clone locally and resolve there.

  • helm-artifacts-deploy uses 'wrangler deploy', which respects the
    customer's wrangler.toml. If the toml drifted from the live Worker
    (helm-artifacts-sync-toml shows missingFromToml > 0), deploy will
    DROP those bindings. Run reconcile first, then deploy.

  • BUILD_SHA only tracks the upstream manifest sha. After a custom
    deploy, BUILD_SHA reflects whatever was in wrangler.toml's vars at
    the time — which might not be the customer's git sha. The agent
    can stamp its own version (e.g. 'wrangler deploy --var
    BUILD_SHA:custom-\\$(git rev-parse HEAD)') if it cares.
`.trim()
};
