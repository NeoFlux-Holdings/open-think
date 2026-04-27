/**
 * Cloudflare API client — minimum surface needed for Helm Cloud deploys.
 *
 * Every call is a thin wrapper around `https://api.cloudflare.com/client/v4`
 * with the user's API token. We never log the token, never store it, and
 * pass it only via `Authorization: Bearer` headers.
 *
 * All methods accept an optional `fetchImpl` so tests can mock without
 * touching `globalThis.fetch`.
 *
 * Architecture II (paid Helm Cloud) re-uses every function here — the only
 * additions there are persistent token storage and a release-push hook.
 */

import type { CfAccount, CfApiResult, CfZone } from "./types";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface FetchOptions {
  fetchImpl?: typeof fetch;
}

async function call<T>(
  token: string,
  path: string,
  init: RequestInit & FetchOptions = {}
): Promise<CfApiResult<T>> {
  const { fetchImpl, ...rest } = init;
  const f = fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    ...((rest.headers as Record<string, string>) ?? {})
  };
  if (rest.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const resp = await f(`${CF_API_BASE}${path}`, { ...rest, headers });
  // CF returns `{ success, result, errors }` for almost every endpoint, even
  // on 4xx — but some auth failures come back as plain HTML. Handle both.
  const text = await resp.text();
  let parsed: CfApiResult<T>;
  try {
    parsed = JSON.parse(text) as CfApiResult<T>;
  } catch {
    return {
      success: false,
      errors: [{ code: resp.status, message: text.slice(0, 200) || resp.statusText }]
    };
  }
  return parsed;
}

/* ---------- Token introspection ---------- */

export interface TokenInfo {
  id: string;
  status: string;
  not_before?: string;
  expires_on?: string;
}

/**
 * `GET /user/tokens/verify` — returns the token's id + status + expiry.
 * Cheap, no scopes implied. We use this as the "is this even a valid token?"
 * check before showing the user the account picker.
 */
export async function verifyToken(
  token: string,
  options: FetchOptions = {}
): Promise<CfApiResult<TokenInfo>> {
  return call<TokenInfo>(token, "/user/tokens/verify", { method: "GET", ...options });
}

/* ---------- Accounts ---------- */

/**
 * `GET /accounts` — lists every account this token can touch. Most users
 * only have one; some agencies have many. We let them pick.
 */
export async function listAccounts(
  token: string,
  options: FetchOptions = {}
): Promise<CfApiResult<CfAccount[]>> {
  return call<CfAccount[]>(token, "/accounts?per_page=50", { method: "GET", ...options });
}

/* ---------- Zones (only if attaching a custom domain) ---------- */

export async function listZones(
  token: string,
  accountId: string,
  options: FetchOptions = {}
): Promise<CfApiResult<CfZone[]>> {
  return call<CfZone[]>(
    token,
    `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`,
    { method: "GET", ...options }
  );
}

/* ---------- D1 ---------- */

export interface D1Database {
  uuid: string;
  name: string;
  version?: string;
  created_at?: string;
}

/**
 * `POST /accounts/{id}/d1/database` — creates a D1. Returns the uuid we
 * embed in the user's wrangler.toml as `database_id`.
 */
export async function createD1Database(
  token: string,
  accountId: string,
  databaseName: string,
  options: FetchOptions = {}
): Promise<CfApiResult<D1Database>> {
  return call<D1Database>(token, `/accounts/${accountId}/d1/database`, {
    method: "POST",
    body: JSON.stringify({ name: databaseName }),
    ...options
  });
}

/* ---------- Cloudflare Access ---------- */

export interface AccessApp {
  id: string;
  uid: string;
  aud: string;
  name: string;
  domain: string;
  type: "self_hosted";
}

/**
 * `POST /accounts/{id}/access/apps` — creates an Access self-hosted app for
 * the deployed Worker URL. The `aud` field returned here is what the user
 * sets as `CF_ACCESS_AUD` in the Worker.
 */
export async function createAccessApp(
  token: string,
  accountId: string,
  input: {
    name: string;
    domain: string;
    sessionDuration?: string; // e.g. "24h"
  },
  options: FetchOptions = {}
): Promise<CfApiResult<AccessApp>> {
  return call<AccessApp>(token, `/accounts/${accountId}/access/apps`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      domain: input.domain,
      type: "self_hosted",
      session_duration: input.sessionDuration ?? "24h",
      auto_redirect_to_identity: false
    }),
    ...options
  });
}

/**
 * Create a default policy on the Access app so a single email is allowed in.
 * Without a policy the app exists but rejects everyone.
 */
export async function createAccessPolicy(
  token: string,
  accountId: string,
  appId: string,
  email: string,
  options: FetchOptions = {}
): Promise<CfApiResult<{ id: string }>> {
  return call<{ id: string }>(
    token,
    `/accounts/${accountId}/access/apps/${appId}/policies`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Helm owner",
        decision: "allow",
        include: [{ email: { email } }]
      }),
      ...options
    }
  );
}

/* ---------- Account team domain (for Cloudflare Access) ---------- */

export interface AccessOrganization {
  auth_domain: string;
  name: string;
}

/**
 * The team domain is `https://<auth_domain>` for `auth_domain` returned here.
 * Required because the Worker needs `CF_ACCESS_TEAM_DOMAIN` to validate JWTs.
 * If the org doesn't have a team domain yet (rare on free Zero Trust), we'll
 * surface a friendly error — the user can create one in dash → Zero Trust →
 * Settings.
 */
export async function getAccessOrganization(
  token: string,
  accountId: string,
  options: FetchOptions = {}
): Promise<CfApiResult<AccessOrganization>> {
  return call<AccessOrganization>(
    token,
    `/accounts/${accountId}/access/organizations`,
    { method: "GET", ...options }
  );
}

/* ---------- Worker settings (read existing bindings before overwrite) ---------- */

export interface WorkerSettings {
  compatibility_date?: string;
  compatibility_flags?: string[];
  /** Each binding has at minimum `name` + `type`; type-specific fields too. */
  bindings?: Array<Record<string, unknown> & { name: string; type: string }>;
  logpush?: boolean;
  migrations?: Array<Record<string, unknown>>;
  /** Cloudflare echoes other fields too; we accept any JSON object. */
  [key: string]: unknown;
}

/**
 * `GET /accounts/{id}/workers/scripts/{name}/settings` — returns the script's
 * current bindings + compat without revealing secret values.
 *
 * The cron uses this BEFORE pushing a new bundle so it can preserve the
 * customer's D1 IDs, secret-text bindings, and any other per-script
 * configuration. Without this read, a cron push would wipe the customer's
 * `DB` binding and every `secret_text` set via `wrangler secret put`.
 */
export async function getWorkerSettings(
  token: string,
  accountId: string,
  scriptName: string,
  options: FetchOptions = {}
): Promise<CfApiResult<WorkerSettings>> {
  return call<WorkerSettings>(
    token,
    `/accounts/${accountId}/workers/scripts/${scriptName}/settings`,
    { method: "GET", ...options }
  );
}

/* ---------- Worker upload (skeleton — see deployFlow for status) ---------- */

/**
 * `PUT /accounts/{id}/workers/scripts/{name}` — uploads a Worker bundle.
 *
 * For Helm specifically, the bundle includes:
 *   - the entry module (compiled from src/index.ts)
 *   - all its imports inlined or as additional form parts
 *   - bindings metadata (DOs, D1, AI, etc.)
 *   - migrations (for new DO classes)
 *
 * Building that bundle from inside another Worker is non-trivial — the
 * marketing-site Worker can't run esbuild. The realistic v1 flow is:
 *   1. We pre-build the bundle in CI and host it as a static asset
 *   2. This function fetches the asset, then forwards the multipart body
 *
 * Until that bundle pipeline lands, the deploy orchestrator emits a
 * paste-ready `wrangler.toml` + a one-line `wrangler deploy` command and
 * lets the user finish from their terminal — still a huge UX win because
 * D1 + Access + secrets are all done.
 *
 * This function is a skeleton that the bundle pipeline will plug into.
 */
export async function uploadWorkerScript(
  token: string,
  accountId: string,
  scriptName: string,
  bundle: { metadata: object; mainModule: { name: string; bytes: ArrayBuffer } },
  options: FetchOptions = {}
): Promise<CfApiResult<{ id: string; etag?: string }>> {
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(bundle.metadata)], { type: "application/json" })
  );
  form.append(
    bundle.mainModule.name,
    new Blob([bundle.mainModule.bytes], { type: "application/javascript+module" }),
    bundle.mainModule.name
  );
  const { fetchImpl, ...rest } = options;
  const f = fetchImpl ?? fetch;
  const resp = await f(
    `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${scriptName}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: form,
      ...rest
    }
  );
  const text = await resp.text();
  try {
    return JSON.parse(text) as CfApiResult<{ id: string; etag?: string }>;
  } catch {
    return {
      success: false,
      errors: [{ code: resp.status, message: text.slice(0, 200) || resp.statusText }]
    };
  }
}

/**
 * `PUT /accounts/{id}/workers/scripts/{name}/secrets` — sets a single secret
 * on an already-uploaded Worker. Uses the legacy single-secret endpoint
 * because it's simplest; bulk secrets require multipart and the same script
 * upload.
 */
export async function putWorkerSecret(
  token: string,
  accountId: string,
  scriptName: string,
  name: string,
  text: string,
  options: FetchOptions = {}
): Promise<CfApiResult<{ name: string; type: string }>> {
  return call<{ name: string; type: string }>(
    token,
    `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
    {
      method: "PUT",
      body: JSON.stringify({ name, text, type: "secret_text" }),
      ...options
    }
  );
}
