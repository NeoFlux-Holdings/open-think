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
  /** Optional secrets to set after Worker upload. */
  secrets?: DeployRequestSecrets;
}

export type DeployStepKind =
  | "verify-token"
  | "create-d1"
  | "create-access-app"
  | "compose-wrangler-toml"
  | "render-cli-commands"
  | "fetch-bundle"
  | "upload-worker"
  | "set-secret";

export interface DeployStepResult {
  kind: DeployStepKind;
  ok: boolean;
  /** Human-readable summary line shown in the UI. */
  summary: string;
  /** JSON-able payload (resource IDs, snippets, etc.). */
  data?: Record<string, unknown>;
  /** Set when `ok === false`. */
  error?: string;
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
 */
export const TOKEN_SCOPES = [
  { resource: "Account", permission: "Workers Scripts:Edit" },
  { resource: "Account", permission: "D1:Edit" },
  { resource: "Account", permission: "Access: Apps and Policies:Edit" },
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
    { key: "d1", type: "edit" },
    { key: "access", type: "edit" },
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
