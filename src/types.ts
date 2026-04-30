export interface ArtifactRepoHandle {
  remote: string;
  token: string;
  fork(name: string, options?: { readOnly?: boolean }): Promise<ArtifactRepoHandle>;
}

export interface ArtifactsBinding {
  create(name: string): Promise<ArtifactRepoHandle>;
  get(name: string): Promise<ArtifactRepoHandle>;
  import(input: {
    source: { url: string; branch?: string };
    target: { name: string };
  }): Promise<{ remote: string; token: string }>;
}

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
  ENABLED_PLUGINS: string;
  ALLOWED_HOSTS: string;
  MODEL_DEFAULT?: string;
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
