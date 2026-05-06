/**
 * Types shared across the Cloud Deploy module — see `cfApi.ts` for the
 * Cloudflare API client and `deployFlow.ts` for the orchestrator.
 *
 * Naming convention: anything starting with `Cf*` is a literal Cloudflare
 * API shape (we trust their docs); anything else is our own.
 */

export interface CfAccount {
  id: string;
  name: string;
}

export interface CfZone {
  id: string;
  name: string;
  account: { id: string };
}

export interface CfApiResult<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

export interface DeployRequestSecrets {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OWNER_EMAIL?: string;
  FROM_EMAIL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface DeployRequest {
  /** User-pasted CF API token. NEVER stored at rest in this MVP. */
  token: string;
  /** CF account id the user picked out of `verifyToken` results. */
  accountId: string;
  /** Worker script name — becomes `<name>.<account>.workers.dev`. */
  workerName: string;
  /** Optional D1 database (memory + scheduler etc. live here). */
  enableD1: boolean;
  /** Optional Access app — strongly recommended for any non-localhost use. */
  enableAccess: boolean;
  /**
   * Additional emails to include in the Access app's allow policy, on top
   * of `secrets.OWNER_EMAIL`. Use this to invite collaborators (e.g. the
   * other person on a shared PA, a co-founder, or a support handoff
   * address). Each becomes its own `include` entry in the CF policy. Empty
   * strings + non-email values are filtered out server-side.
   */
  additionalAllowedEmails?: string[];
  /** Optional secrets to set after Worker upload. */
  secrets?: DeployRequestSecrets;
  /**
   * When OPENROUTER_API_KEY is set in `secrets`, this is the model id
   * MODEL_DEFAULT will resolve to. Defaults to "openrouter/auto" when
   * unset (OR's auto-router picks the best model per prompt).
   */
  openRouterDefaultModel?: string;
  /**
   * High-level chat model preset selected on the deploy form. Drives the
   * auto-resolution of MODEL_DEFAULT to the right provider+model combo:
   *
   *   - "kimi-k2.6"   — default; works zero-key via cf-ai-gateway →
   *                     `workers-ai/@cf/moonshotai/kimi-k2.6`. If the
   *                     user pasted an OpenRouter key, prefers
   *                     `moonshotai/kimi-k2.6` (better latency).
   *   - "gpt-5.5"     — needs OpenRouter (OPENROUTER_API_KEY) since we
   *                     don't ship a direct-OpenAI provider yet.
   *                     Resolves to `openai/gpt-5.5`.
   *   - "opus-4.7"    — prefers ANTHROPIC_API_KEY (`claude-opus-4-7`),
   *                     falls back to OpenRouter (`anthropic/claude-opus-4-7`).
   *   - "sonnet-4.6"  — same fallback chain as opus, with `claude-sonnet-4-6`.
   *   - "custom"      — uses `customModelId` verbatim. Provider auto-detected
   *                     by selectProvider's standard precedence.
   *
   * When undefined, runDeploy falls back to the legacy
   * `openRouterDefaultModel` field (when an OR key is present) or the
   * cf-ai-gateway zero-key default.
   */
  modelPreset?: "kimi-k2.6" | "gpt-5.5" | "opus-4.7" | "sonnet-4.6" | "custom";
  /** Used when modelPreset === "custom". Validated as a non-empty string. */
  customModelId?: string;
  /**
   * Optional reasoning effort. Routed through to the provider request:
   *   - GPT-5.5 → `reasoning.effort` (none|low|medium|high|xhigh)
   *   - Anthropic models → `extended_thinking` toggle (treats "off" as
   *     disabled, anything else as enabled)
   *   - Kimi K2.6 → not yet supported by Moonshot/OpenRouter; ignored.
   *
   * The runtime conductor needs to consume MODEL_REASONING_EFFORT to make
   * this take effect end-to-end. For now the deploy form persists it as
   * a Worker var so future bundles can plug it in without redeploying.
   */
  modelReasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  /**
   * When true, the deploy will NOT persist CLOUDFLARE_API_TOKEN +
   * CLOUDFLARE_ACCOUNT_ID + WORKER_SCRIPT_NAME as Worker secrets. Default
   * false — persisting these is what lets the deployed Worker
   * self-administer (run cf-* skills, the lockdown wizard, helm-setup-deploy
   * from /app). Opt out only when you don't want the runtime to be able
   * to mutate your CF account.
   */
  skipSelfAdminToken?: boolean;
}

export type DeployStepKind =
  | "verify-token"
  | "create-d1"
  | "create-ai-gateway"
  | "create-access-app"
  | "compose-wrangler-toml"
  | "render-cli-commands"
  | "fetch-bundle"
  | "upload-worker"
  | "set-secret"
  | "enable-subdomain"
  | "verify-strict";

export interface DeployStepResult {
  kind: DeployStepKind;
  ok: boolean;
  /** Human-readable summary line shown in the UI. */
  summary: string;
  /** JSON-able payload (resource IDs, snippets, etc.). */
  data?: Record<string, unknown>;
  /** Set when `ok === false`. */
  error?: string;
  /**
   * Set when ok=true but something didn't work as planned (e.g. AI Gateway
   * creation failed but the deploy continues without it). The UI renders
   * these with an amber ⚠ marker instead of a red ✗ — they're informational,
   * not blocking. Distinct from `error` (which always implies ok=false).
   */
  warning?: string;
}

export interface DeployResponse {
  ok: boolean;
  workerName: string;
  accountId: string;
  /** Ordered list of every step we attempted, success or fail. */
  steps: DeployStepResult[];
  /** Composed wrangler.toml the user can paste into their fork. */
  wranglerToml?: string;
  /** Final commands to run locally (paste-ready). */
  commands?: string[];
  /** Set when one step failed and we stopped. */
  error?: string;
  /** Helm Cloud only: id of the persisted cloud_deployments row. */
  deploymentId?: string;
  /** Helm Cloud only: signed handle to embed in the manage URL. */
  manageToken?: string;
  /**
   * True when the bundle was uploaded server-side and the Worker is live —
   * the user does NOT need to run `wrangler deploy` locally. Set only when
   * the caller passed `directDeploy.manifestUrl` and the upload succeeded.
   */
  directDeployed?: boolean;
  /** Final URL the deployed Worker is reachable at. */
  workerUrl?: string;
  /** SHA of the bundle that was pushed (for the cron's "is this stale?" check). */
  buildSha?: string;
}

/**
 * Required scopes for the CF API token. We surface this list to the user
 * verbatim and link them to the dashboard's "Create custom token" page
 * pre-filled with these permissions.
 *
 * The deployed Worker uses this same token to self-administer (run
 * cf-* skills, helm-setup-deploy, helm-artifacts-*, the lockdown wizard
 * post-deploy), so it has to cover the full provisioning chain — not
 * just what the deploy form itself calls. R2/KV/Artifacts edit make the
 * difference between "Worker deploys but can't run /setup/auto" and
 * "Worker deploys and self-administers cleanly".
 */
export const TOKEN_SCOPES = [
  { resource: "Account", permission: "Workers Scripts:Edit" },
  { resource: "Account", permission: "Access: Apps and Policies:Edit" },
  { resource: "Account", permission: "Cloudflare Zero Trust:Read" },
  { resource: "Account", permission: "D1:Edit" },
  { resource: "Account", permission: "Workers R2 Storage:Edit" },
  { resource: "Account", permission: "Workers KV Storage:Edit" },
  { resource: "Account", permission: "Artifacts:Edit" },
  // AI Gateway:Edit is what lets the deploy auto-create a CF AI Gateway
  // for the Worker. Without it, chat needs an API key (OpenRouter etc.)
  // because the conductor's stream-tools has no provider to route through.
  { resource: "Account", permission: "AI Gateway:Edit" },
  { resource: "Account", permission: "Account Settings:Read" },
  { resource: "User", permission: "User Details:Read" }
] as const;

/**
 * Pre-filled URL the deploy page links to. CF's dash supports query-string
 * pre-population for custom-token templates, but you have to send FOUR
 * query params, not just one:
 *
 *   permissionGroupKeys = URL-encoded JSON array of {key, type} objects
 *                         using SHORT keys (`d1`, not the legacy dotted
 *                         form which the dash silently drops)
 *   accountId           = "*"     pre-selects "All accounts"
 *   zoneId              = "all"   pre-selects "All zones"
 *   name                = string  pre-fills the token-name field
 *
 * Without the last three, the dash opens an empty custom-token page even
 * with a well-formed permissionGroupKeys — the URL appears broken.
 *
 * Reference: https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/
 */
const TOKEN_TEMPLATE_PERMISSIONS = encodeURIComponent(
  JSON.stringify([
    { key: "workers_scripts", type: "edit" },
    { key: "access", type: "edit" },
    // `teams:read` (NOT `cloudflare_zero_trust`) — that's the dash's
    // URL key for "Zero Trust:Read", which is what /access/organizations
    // requires. The longer name gets silently dropped by the parser.
    { key: "teams", type: "read" },
    { key: "d1", type: "edit" },
    // `workers_r2` (no _storage suffix) — yes, inconsistent with KV
    // below. Verified against shipped CLIs (nuxt-hub/core,
    // orange-framework). `workers_r2_storage` is silently dropped.
    { key: "workers_r2", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
    { key: "artifacts", type: "edit" },
    // `aig:edit` — short key the dash recognizes for "AI Gateway:Edit".
    // CF's permission group catalog labels these `aig_read` / `aig_edit`
    // / `aig_run`; the dash strips the `_<type>` suffix and uses `aig`
    // as the URL key. Verified against nuxt-hub/core's create-token
    // template + the public permission_groups catalog. The longer
    // `ai_gateway` (the Terraform resource name) is silently dropped
    // by the dashboard URL parser, same way `cloudflare_zero_trust`
    // and `workers_r2_storage` were.
    { key: "aig", type: "edit" },
    { key: "account_settings", type: "read" },
    { key: "user_details", type: "read" }
  ])
);

export const TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens" +
  `?permissionGroupKeys=${TOKEN_TEMPLATE_PERMISSIONS}` +
  `&accountId=*` +
  `&zoneId=all` +
  `&name=${encodeURIComponent("Open Think")}`;
