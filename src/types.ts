/**
 * Cloudflare Artifacts binding — public-beta API surface (May 2026).
 *
 * The binding only handles control plane (create / get / list / delete /
 * import / fork / token mint). All file ops (read, write, commit, push,
 * log) MUST go through the git smart-HTTP remote at
 *   https://<account-id>.artifacts.cloudflare.net/git/<namespace>/<repo>.git
 * using the token returned by createToken() in the Authorization header
 * (Bearer or HTTP Basic).
 *
 * Token format: `art_v1_<40-hex>?expires=<unix-seconds>`. The expiry is
 * encoded directly in the suffix; parse it to know when to mint a fresh
 * one. Tokens are scoped to a single repo with `read` or `write`.
 */
export interface ArtifactsCreateTokenResult {
  /** Internal token id (used for revoke). */
  id: string;
  /** The opaque token string (`art_v1_...?expires=...`). Treat as a secret. */
  plaintext: string;
  /** "read" | "write" — what this token can do. */
  scope: "read" | "write";
  /** ISO-8601 timestamp when the token stops working. */
  expiresAt: string;
}

export interface ArtifactsTokenInfo {
  id: string;
  scope: "read" | "write";
  state: "active" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
}

export interface ArtifactsRepoHandle {
  /** Stable internal repo id. */
  readonly id: string;
  /** Repo name (within the namespace). */
  readonly name: string;
  /** Full git smart-HTTP remote URL. */
  readonly remote: string;
  /** Default branch (usually "main"). */
  readonly defaultBranch: string;
  /**
   * Mint a scoped, time-bounded token for this repo. Default scope is
   * "write", default ttl is 86400s (24h). For drift-check crons prefer
   * scope:"read" + ttl:900 to minimize blast radius.
   */
  createToken(scope?: "read" | "write", ttl?: number): Promise<ArtifactsCreateTokenResult>;
  listTokens(): Promise<{ result: ArtifactsTokenInfo[] }>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(
    name: string,
    options?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }
  ): Promise<{ id: string; name: string; remote: string; token: string }>;
}

export interface ArtifactsRepoListItem {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  lastPushAt: string | null;
  source: string | null;
  readOnly: boolean;
  remote: string;
}

export interface ArtifactsBinding {
  /** Create an empty repo. Returns handle + initial write token. */
  create(
    name: string,
    opts?: { description?: string; defaultBranch?: string; readOnly?: boolean }
  ): Promise<{ id: string; name: string; remote: string; token: string }>;
  /** Fetch a handle for an existing repo. */
  get(name: string): Promise<ArtifactsRepoHandle>;
  /** List all repos in this namespace. */
  list(opts?: {
    limit?: number;
    cursor?: string;
    search?: string;
    sort?: "created_at" | "updated_at" | "last_push_at" | "name";
    direction?: "asc" | "desc";
  }): Promise<{ result: ArtifactsRepoListItem[]; result_info?: { cursor?: string; per_page?: number; count?: number } }>;
  /** Delete a repo (irreversible). */
  delete(name: string): Promise<boolean>;
  /** One-shot import: clone a public HTTPS git URL into a new Artifacts repo. */
  import(input: {
    source: { url: string; branch?: string; depth?: number; readOnly?: boolean };
    target: { name: string };
  }): Promise<{ id: string; name: string; remote: string; token: string }>;
}

/** @deprecated Use ArtifactsRepoHandle. Kept for backward compatibility. */
export type ArtifactRepoHandle = ArtifactsRepoHandle;

export interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AGENT_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  MPP_API_KEY?: string;
  MCP_DEFAULT_URL?: string;
  MCP_BEARER_TOKEN?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_AUTH_TOKEN?: string;
  CF_AI_GATEWAY_DEFAULT_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_COMPATIBLE_URL?: string;
  OPENAI_COMPATIBLE_KEY?: string;
  CODEX_ACCESS_TOKEN?: string;
  CODEX_ID_TOKEN?: string;
  CODEX_BACKEND_URL?: string;
  CODEX_OAUTH_CLIENT_ID?: string;
  CODEX_APP_SERVER_URL?: string;
  CODEX_APP_SERVER_TOKEN?: string;
  CODEX_APP_SERVER_TIMEOUT_MS?: string;
  OAUTH_SESSION_SECRET?: string;
  PERSONAL_CONTEXT?: string;
  AGENT_NAME?: string;
  AGENT_OWNER?: string;
  /**
   * Auto-resolved by helm-setup-deploy on first run via /workers/scripts.
   * Once persisted as a Worker secret, every subsequent cf-* skill skips
   * the script-name lookup entirely. The agent should never see a
   * "Worker does not exist" error after first setup.
   */
  WORKER_SCRIPT_NAME?: string;
  /**
   * Bundle sha of THIS running Worker. Stamped as a plain_text binding by
   * the cloud-push cron + the helm-setup-update self-update skill. Used by
   * helm-setup-update to short-circuit when the upstream manifest's sha
   * matches what's already running. Absent ⇒ unknown ⇒ assume out-of-date.
   */
  BUILD_SHA?: string;
  /**
   * Where helm-setup-update fetches the manifest describing the latest
   * upstream bundle. Defaults to the central opentink.dev manifest when
   * unset; override per-customer to pin to a fork or a beta channel.
   */
  HELM_BUNDLE_MANIFEST_URL?: string;
  /**
   * Upstream git URL for `helm-artifacts-pull-upstream`. The skill adds
   * this as the `upstream` remote in the customer's Artifacts checkout
   * and `git fetch`/`git merge`s into their canonical branch so they
   * can pull source-level fixes from open-think while keeping their own
   * customizations on top. Defaults to NeoFlux-Holdings/open-think
   * when unset; override to point at your own fork.
   */
  HELM_UPSTREAM_URL?: string;
  /** Default branch on the upstream remote for pull-upstream. Default "main". */
  HELM_UPSTREAM_BRANCH?: string;
  /**
   * GitHub PAT for helm-github (FALLBACK path — Cloudflare Artifacts is the
   * canonical source-of-truth now; see ARTIFACTS_* below). Fine-grained
   * tokens with repo: contents + pull-requests scopes are sufficient.
   * Most users won't need GitHub at all once Artifacts is wired up.
   */
  GITHUB_TOKEN?: string;
  /** "owner/repo" — fallback repo for wrangler.toml syncing when not using Artifacts. */
  GITHUB_REPO?: string;
  /** Default branch for commits + PR base (default "main"). */
  GITHUB_DEFAULT_BRANCH?: string;
  /** Path within the repo where wrangler.toml lives (default "wrangler.toml"). */
  HELM_WRANGLER_TOML_PATH?: string;
  /** Where the Helm Shell container clones the repo by default (default /workspace/repo). */
  HELM_REPO_PATH?: string;
  /* --- Cloudflare Artifacts: PRIMARY source-of-truth for wrangler.toml --- */
  /**
   * Artifacts namespace (defaults to "default"). Each Worker can have its
   * own namespace for tenant isolation.
   */
  ARTIFACTS_NAMESPACE?: string;
  /**
   * Repo name within the namespace. Defaults to env.AGENT_NAME ?? "helm".
   * The full remote URL is derived as
   *   https://<acct>.artifacts.cloudflare.net/git/<namespace>/<repo>.git
   */
  ARTIFACTS_REPO?: string;
  /**
   * Pre-minted long-lived token (`art_v1_...?expires=...`). Optional —
   * the plugin will mint short-lived tokens on demand via the binding or
   * REST API. Set this only when the binding isn't bound and you can't
   * grant the Worker an `Artifacts:Edit` API token.
   */
  ARTIFACTS_TOKEN?: string;
  /** Default branch for commits + auto-deploy (default "main"). */
  ARTIFACTS_BRANCH?: string;
  /**
   * Optional public git URL to seed the Artifacts repo from on first init.
   * Used by helm-artifacts-init when the repo doesn't exist yet. Skip to
   * start with an empty repo.
   */
  ARTIFACTS_BOOTSTRAP_URL?: string;
  /**
   * Where helm-artifacts-clone deposits the working tree inside the
   * shell container. Defaults to /workspace/<ARTIFACTS_REPO>. The agent
   * never has to clone twice — git pull updates an existing checkout.
   */
  ARTIFACTS_CHECKOUT_PATH?: string;
  /**
   * If "1", the scheduled() handler runs helm-artifacts-cron-sync once
   * per cron firing — drift-check the live Worker against the latest
   * wrangler.toml in Artifacts and notify the owner on drift. Off by
   * default so existing deployments don't suddenly start sending mail.
   */
  ARTIFACTS_AUTO_SYNC?: string;
  ENABLED_PLUGINS: string;
  ALLOWED_HOSTS: string;
  MODEL_DEFAULT?: string;
  /**
   * Set by the deploy form's "Default chat model" picker when the user
   * selects a thinking-capable preset (GPT-5.5, Claude Opus 4.7). The
   * conductor reads this and forwards it to the provider as
   * `reasoning.effort` (OpenAI-compat) or `thinking.budget_tokens`
   * (Anthropic native). One of: none / low / medium / high / xhigh.
   * Empty / absent = provider defaults apply.
   */
  MODEL_REASONING_EFFORT?: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_ERROR_RATE_PCT?: string;
  /* --- Auth (Cloudflare Access) --- */
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
  DEV_AUTH_BYPASS?: string;
  AGENT_OWNER_EMAIL?: string;
  /**
   * Optional internal bearer token. Anything authenticating with
   * `Authorization: Bearer <HELM_INTERNAL_TOKEN>` bypasses CF Access and is
   * treated as the agent itself. Used by the Helm Shell container's `helm`
   * command (and other in-network agents) so they can call /conductor/*
   * without needing a JWT. Set as a Worker secret with `wrangler secret put
   * HELM_INTERNAL_TOKEN` — pick a random 32-byte hex.
   */
  HELM_INTERNAL_TOKEN?: string;
  /**
   * Worker hostname (no scheme) the in-container `helm` REPL command
   * should call back to. Defaults to the same Worker that hosts the
   * container, but you may override (e.g. for staging) by setting
   * this as a Worker var or secret.
   */
  HELM_WORKER_HOST?: string;
  /**
   * R2 access credentials forwarded into the Helm Shell container so it
   * can rclone-mount /persist. Generate at dash → R2 → Manage R2 API
   * Tokens. The account-id is derived from CLOUDFLARE_ACCOUNT_ID.
   */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  /* --- Cost tracking --- */
  DAILY_SPEND_CAP_USD?: string;
  /* --- Web Push (VAPID) --- */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /* --- Inbound email routing --- */
  INBOUND_FORWARD_TO?: string;
  /* --- Calendar MCP --- */
  CALENDAR_MCP_URL?: string;
  ARTIFACTS?: ArtifactsBinding;
  AI?: Ai;
  AGENT_SESSIONS?: DurableObjectNamespace;
  STREAM_HUBS?: DurableObjectNamespace;
  /** WebSocket-backed chat session DO. One instance per session name. */
  CHAT_SESSIONS?: DurableObjectNamespace;
  /**
   * Cloudflare Container DO that hosts the Helm Shell — a bash session
   * accessible from /app#/shell (browser xterm.js) or scripts/open-think-shell.mjs (CLI).
   * Each session name resolves to its own container instance with ephemeral disk.
   */
  SHELL_CONTAINER?: DurableObjectNamespace;
  /** Singleton registry tracking active shell sessions for /shell/list. */
  SHELL_REGISTRY?: DurableObjectNamespace;
  /** Singleton DO that brokers the CLI device-code login flow. */
  CLI_AUTH?: DurableObjectNamespace;
  /** OpenRouter API key (optional). When set, OR is the default provider. */
  OPENROUTER_API_KEY?: string;
  /** Optional override for OpenRouter base URL. Defaults to https://openrouter.ai/api/v1 */
  OPENROUTER_BASE_URL?: string;
  /** Optional default model. When unset, OR plugin uses "openrouter/auto" router. */
  OPENROUTER_DEFAULT_MODEL?: string;
  /** Optional referer URL for OpenRouter attribution headers. */
  OPENROUTER_HTTP_REFERER?: string;
  /** Optional title for OpenRouter attribution headers. */
  OPENROUTER_X_TITLE?: string;
  BROWSER?: Fetcher;
  SANDBOX?: Fetcher;
  WORKSPACE?: R2Bucket;
  /* --- PA bindings --- */
  DB?: D1Database;
  MEMORY?: unknown; // Cloudflare Agent Memory (opaque until GA)
  SEB?: SendEmail; // Email Workers send_email binding
  BRIEFING_WORKFLOW?: unknown; // Cloudflare Workflows binding (opaque)
  OWNER_EMAIL?: string;
  FROM_EMAIL?: string;
  DEFAULT_TIMEZONE?: string;
}

/**
 * Minimal SendEmail shape from `cloudflare:email`. Workers-types will override
 * this once we import from `cloudflare:email` directly.
 */
export interface SendEmail {
  send(message: unknown): Promise<void>;
}

export interface InvokeRequest {
  action: string;
  input?: unknown;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface SessionMessageRollback {
  skill: string;
  input: unknown;
  label: string;
  notes?: string;
  producedBy?: string;
}

export interface SessionMessage {
  id: string;
  parentId: string | null;
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  createdAt: string;
  rollback?: SessionMessageRollback | null;
  rollbackStatus?: "available" | "applied" | "failed";
}

export interface SessionMeta {
  id: string;
  createdAt: string;
  title?: string;
  rootId: string | null;
  compactedParentId?: string | null;
}
