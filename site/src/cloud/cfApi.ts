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

export interface UserDetails {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * `GET /user` — returns the token owner's profile (email, id, name).
 * Requires the `User Details:Read` scope, which our token-creation URL
 * already includes. The deploy form uses this to pre-fill the owner-email
 * field so the user doesn't have to type their address — one less step
 * before they can hit Deploy.
 *
 * Best-effort: callers should treat a non-success result as "no email
 * available" and fall through to whatever the user types manually.
 */
export async function getUserDetails(
  token: string,
  options: FetchOptions = {}
): Promise<CfApiResult<UserDetails>> {
  return call<UserDetails>(token, "/user", { method: "GET", ...options });
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

/**
 * `GET /accounts/{id}/d1/database?name=<name>` — finds an existing D1 by
 * name. Used by the deploy flow to recover the uuid when create returns
 * "already exists" (e.g., a partial deploy that finished D1 but failed
 * later, then the user retries).
 */
export async function findD1DatabaseByName(
  token: string,
  accountId: string,
  databaseName: string,
  options: FetchOptions = {}
): Promise<CfApiResult<D1Database[]>> {
  return call<D1Database[]>(
    token,
    `/accounts/${accountId}/d1/database?name=${encodeURIComponent(databaseName)}&per_page=50`,
    { method: "GET", ...options }
  );
}

/**
 * Idempotent D1 creation: try to create, fall back to lookup-by-name if
 * the name already exists. Returns a normalized `{ uuid, name }`.
 *
 * Why: deploys often partially succeed (D1 created, Worker upload fails),
 * then the user retries. Without this, the retry's createD1Database call
 * fails with "database name already taken" and the wizard can't recover.
 */
export async function ensureD1Database(
  token: string,
  accountId: string,
  databaseName: string,
  options: FetchOptions = {}
): Promise<CfApiResult<D1Database> & { reused?: boolean }> {
  const created = await createD1Database(token, accountId, databaseName, options);
  if (created.success) return created;
  // Look for "already exists" / 7501 / similar — if matched, recover the uuid.
  const errorMsg = (created.errors?.[0]?.message ?? "").toLowerCase();
  const errorCode = created.errors?.[0]?.code;
  const looksLikeNameTaken =
    errorMsg.includes("already") ||
    errorMsg.includes("exists") ||
    errorMsg.includes("name is taken") ||
    errorCode === 7501 ||
    errorCode === 7402; // CF "name already in use" range
  if (!looksLikeNameTaken) return created;
  // Try to find the existing one by name.
  const found = await findD1DatabaseByName(token, accountId, databaseName, options);
  if (found.success && found.result && found.result.length > 0) {
    const existing = found.result.find((d) => d.name === databaseName) ?? found.result[0];
    return { success: true, result: existing, reused: true };
  }
  // Couldn't recover; surface the original error.
  return created;
}

/**
 * Provision a D1 database with auto-suffix on collision. Tries `baseName`,
 * then `baseName-2`, `baseName-3`, …, up to `maxAttempts` (default 10).
 * Use this when the database name is auto-derived (e.g., from the Worker
 * name) and the account may already have an unrelated DB at that name
 * from a prior install.
 *
 * Returns the actual name used + the database uuid. Different from
 * `ensureD1Database` which always reuses on collision (intended for
 * user-explicit names where reuse is the right call).
 */
export async function ensureD1WithSuffix(
  token: string,
  accountId: string,
  baseName: string,
  options: FetchOptions & { maxAttempts?: number } = {}
): Promise<CfApiResult<D1Database> & { actualName?: string; suffixed?: boolean }> {
  const maxAttempts = options.maxAttempts ?? 10;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = i === 0 ? baseName : `${baseName}-${i + 1}`;
    const created = await createD1Database(token, accountId, candidate, options);
    if (created.success) {
      return { ...created, actualName: candidate, suffixed: i > 0 };
    }
    const errorMsg = (created.errors?.[0]?.message ?? "").toLowerCase();
    const errorCode = created.errors?.[0]?.code;
    const looksLikeNameTaken =
      errorMsg.includes("already") ||
      errorMsg.includes("exists") ||
      errorMsg.includes("name is taken") ||
      errorCode === 7501 ||
      errorCode === 7402;
    if (!looksLikeNameTaken) return created;
    // collision — try next suffix
  }
  return {
    success: false,
    errors: [{ code: 7501, message: `${baseName} and ${maxAttempts - 1} suffix variants all collided — try a different base name` }]
  };
}

/* ---------- R2 buckets ---------- */

export interface R2Bucket {
  name: string;
  creation_date?: string;
  location?: string;
}

/**
 * `POST /accounts/{id}/r2/buckets` — provisions an R2 bucket. The
 * deployed Worker's `/persist/*` endpoint reads `env.WORKSPACE` (an R2
 * binding); without a bucket, every persist call 503s with
 * E_WORKSPACE_BINDING_MISSING.
 *
 * Bucket names are global within an account but lowercase + hyphens.
 * We normalize the input the same way `createAiGateway` does.
 */
export async function createR2Bucket(
  token: string,
  accountId: string,
  name: string,
  options: FetchOptions = {}
): Promise<CfApiResult<R2Bucket>> {
  return call<R2Bucket>(token, `/accounts/${accountId}/r2/buckets`, {
    method: "POST",
    body: JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63)
    }),
    ...options
  });
}

/**
 * Idempotent R2 bucket creation. Tries `createR2Bucket`; on "already
 * exists" returns success with `reused: true`. Same dance as
 * ensureAiGateway / ensureD1Database.
 */
export async function ensureR2Bucket(
  token: string,
  accountId: string,
  name: string,
  options: FetchOptions = {}
): Promise<CfApiResult<R2Bucket> & { reused?: boolean }> {
  const created = await createR2Bucket(token, accountId, name, options);
  if (created.success) return created;
  const msg = (created.errors?.[0]?.message ?? "").toLowerCase();
  const code = created.errors?.[0]?.code;
  const looksLikeAlreadyExists =
    msg.includes("already exists") ||
    msg.includes("already_exists") ||
    msg.includes("name is taken") ||
    msg.includes("duplicate") ||
    code === 10004 || // observed CF "bucket already exists"
    code === 409;
  if (!looksLikeAlreadyExists) return created;
  // Bucket name is unique within the account; "already exists" means
  // the same bucket — reuse silently.
  const normalized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
  return {
    success: true,
    result: { name: normalized },
    reused: true
  };
}

/* ---------- AI Gateway ---------- */

export interface AiGateway {
  id: string;
  name?: string;
  account_id?: string;
}

/**
 * `POST /accounts/{id}/ai-gateway/gateways` — provision an AI Gateway in
 * the user's account. The gateway is what gives the deployed Worker
 * out-of-the-box chat with Workers AI (and 23+ other providers via BYOK)
 * without the user having to paste any API key.
 *
 * The gateway `id` becomes part of the streaming URL the Worker hits:
 *   https://gateway.ai.cloudflare.com/v1/{account}/{id}/compat/chat/completions
 */
export async function createAiGateway(
  token: string,
  accountId: string,
  id: string,
  options: FetchOptions = {}
): Promise<CfApiResult<AiGateway>> {
  return call<AiGateway>(token, `/accounts/${accountId}/ai-gateway/gateways`, {
    method: "POST",
    body: JSON.stringify({
      // The CF API rejects ids with uppercase / underscores — normalize to
      // lowercase + hyphens just in case the caller passed a raw worker name.
      id: id.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64),
      // CF's AI Gateway create endpoint requires SIX fields — `id` plus
      // five booleans/numbers. Omitting any of the numeric ones returns
      // "Expected number, received nan" (code 7001) because the runtime
      // can't coerce undefined into a number. Defaults below are CF's
      // own "no caching, no rate limit, log every request" baseline.
      // (Source: docs at /api/operations/aig-config-create-gateway.)
      cache_invalidate_on_update: true,
      cache_ttl: 0,
      collect_logs: true,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0
    }),
    ...options
  });
}

/**
 * Idempotent AI Gateway creation. Tries `createAiGateway`; on a conflict
 * (gateway with that id already exists in the account), returns success
 * with `reused: true` — the existing gateway is what we'd have referenced
 * anyway, no need to fail the deploy. Same shape as `ensureD1Database`.
 */
export async function ensureAiGateway(
  token: string,
  accountId: string,
  id: string,
  options: FetchOptions = {}
): Promise<CfApiResult<AiGateway> & { reused?: boolean }> {
  const created = await createAiGateway(token, accountId, id, options);
  if (created.success) return created;
  const msg = (created.errors?.[0]?.message ?? "").toLowerCase();
  const code = created.errors?.[0]?.code;
  const looksLikeAlreadyExists =
    msg.includes("already") ||
    msg.includes("duplicate") ||
    msg.includes("exists") ||
    code === 5403 || // CF "ai gateway already exists" code observed in practice
    code === 409;
  if (!looksLikeAlreadyExists) return created;
  // Resource already exists at that id — that's the same end state we want.
  // We don't need to re-fetch; the id we tried to create IS the id to use.
  return {
    success: true,
    result: { id: id.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64) },
    reused: true
  };
}

/* ---------- Migration shape transformation ---------- */

/**
 * Cloudflare's Workers Scripts API accepts `metadata.migrations` as a
 * SINGLE migration object describing the diff to apply, not as the array
 * of historical migrations that wrangler.toml uses.
 *
 *   wrangler.toml + our manifest:
 *     [
 *       { tag: "v1", new_sqlite_classes: ["AgentSessionDO"] },
 *       { tag: "v2", new_classes: ["StreamHubDO"] },
 *       { tag: "v3", new_classes: ["ChatSessionDO"] }
 *     ]
 *
 *   What CF API expects (for a fresh upload that needs all classes set up):
 *     { new_tag: "v3", new_sqlite_classes: ["AgentSessionDO"], new_classes: ["StreamHubDO", "ChatSessionDO"] }
 *
 * For a script that's already on v3, sending this same object is a no-op
 * (CF detects the tag matches). For first-time uploads, all classes get
 * applied in one step. This is the same flattening wrangler does.
 */
export interface ApiMigration {
  new_tag?: string;
  old_tag?: string;
  new_classes?: string[];
  new_sqlite_classes?: string[];
  deleted_classes?: string[];
  renamed_classes?: Array<{ from: string; to: string }>;
  transferred_classes?: Array<{ from: string; from_script: string; to: string }>;
}

export function flattenMigrationsForCfApi(
  migrations: Array<Record<string, unknown>> | ApiMigration | undefined
): ApiMigration | undefined {
  if (!migrations) return undefined;
  // If it's already an object (not an array), pass through — caller
  // already gave us the API shape.
  if (!Array.isArray(migrations)) return migrations;
  if (migrations.length === 0) return undefined;

  const newClasses: string[] = [];
  const newSqliteClasses: string[] = [];
  let latestTag: string | undefined;
  for (const m of migrations) {
    if (Array.isArray(m.new_classes)) newClasses.push(...(m.new_classes as string[]));
    if (Array.isArray(m.new_sqlite_classes)) newSqliteClasses.push(...(m.new_sqlite_classes as string[]));
    if (typeof m.tag === "string") latestTag = m.tag;
  }
  const out: ApiMigration = {};
  if (latestTag) out.new_tag = latestTag;
  if (newClasses.length > 0) out.new_classes = newClasses;
  if (newSqliteClasses.length > 0) out.new_sqlite_classes = newSqliteClasses;
  return Object.keys(out).length > 0 ? out : undefined;
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
 *
 * Payload uses the modern `destinations` array (CF, 2024) instead of the
 * legacy `domain` string. `destinations` doesn't run the zone-ownership
 * validation that historically rejected `*.workers.dev` URLs with
 * "domain does not belong to zone" — it just gates the URI. The dashboard's
 * Access app creator uses the same shape; the public API has caught up.
 *
 * `input.domain` is treated as either a host (`my.workers.dev`) or a full
 * URL — we normalize to a full https URI for the destination entry.
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
  const destinationUri = input.domain.startsWith("http")
    ? input.domain
    : `https://${input.domain}`;
  return call<AccessApp>(token, `/accounts/${accountId}/access/apps`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      type: "self_hosted",
      destinations: [{ type: "public", uri: destinationUri }],
      session_duration: input.sessionDuration ?? "24h",
      auto_redirect_to_identity: false
    }),
    ...options
  });
}

/**
 * `GET /accounts/{id}/access/apps` — list every Access app on the account
 * and return the first one whose `destinations[].uri` (or legacy `domain`)
 * normalizes to the same host as `destinationUri`.
 *
 * Used by `ensureAccessApp` to recover when `createAccessApp` fails with
 * `access.api.error.application_already_exists` — same pattern as
 * `ensureD1Database` for the D1 case. Without it, a re-deploy after a
 * partial failure (Access app was created, secrets failed, user retries)
 * would never get past the create step.
 *
 * Match is forgiving: legacy apps stored their target as `domain` rather
 * than `destinations[]`, and CF's URIs sometimes carry a trailing slash
 * the caller's host doesn't. We strip scheme + trailing slash both sides.
 */
export async function findAccessAppByDestination(
  token: string,
  accountId: string,
  destinationUri: string,
  options: FetchOptions = {}
): Promise<CfApiResult<AccessApp | null>> {
  const list = await call<Array<AccessApp & {
    domain?: string;
    destinations?: Array<{ type?: string; uri?: string }>;
  }>>(token, `/accounts/${accountId}/access/apps?per_page=100`, {
    method: "GET",
    ...options
  });
  if (!list.success || !Array.isArray(list.result)) {
    return { success: list.success, errors: list.errors, result: null };
  }
  const normalize = (s: string) =>
    s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const target = normalize(destinationUri);
  for (const app of list.result) {
    if (Array.isArray(app.destinations)) {
      for (const d of app.destinations) {
        if (typeof d.uri === "string" && normalize(d.uri) === target) {
          return { success: true, result: app };
        }
      }
    }
    if (typeof app.domain === "string" && normalize(app.domain) === target) {
      return { success: true, result: app };
    }
  }
  return { success: true, result: null };
}

/**
 * Idempotent Access-app creation: try to create; if CF returns
 * `application_already_exists` (or any "already / conflict / duplicate"
 * shape), look up the existing app whose destinations point at the same
 * Worker host and reuse its `aud`.
 *
 * Why not always look up first? On the happy path (fresh account, no
 * prior app) the create call is one round-trip; the find call is a
 * full list. We pay the find only when we have to.
 *
 * On reuse, sets `reused: true` so the caller can adjust UI copy
 * ("Access app reused" vs "Access app live").
 */
export async function ensureAccessApp(
  token: string,
  accountId: string,
  input: {
    name: string;
    domain: string;
    sessionDuration?: string;
  },
  options: FetchOptions = {}
): Promise<CfApiResult<AccessApp> & { reused?: boolean }> {
  const created = await createAccessApp(token, accountId, input, options);
  if (created.success) return created;

  // Inspect the error. CF's modern Access endpoints return either
  // `access.api.error.application_already_exists` as the message OR a
  // generic "already exists" / "duplicate" phrasing depending on which
  // edge handled the request. Cover all the variants we've seen.
  const errorMsg = (created.errors?.[0]?.message ?? "").toLowerCase();
  const errorCode = created.errors?.[0]?.code;
  const looksLikeAlreadyExists =
    errorMsg.includes("application_already_exists") ||
    errorMsg.includes("already exists") ||
    errorMsg.includes("already_exists") ||
    errorMsg.includes("duplicate") ||
    errorMsg.includes("conflict") ||
    errorCode === 12109 || // historical "app exists" code
    errorCode === 409;
  if (!looksLikeAlreadyExists) return created;

  const destinationUri = input.domain.startsWith("http")
    ? input.domain
    : `https://${input.domain}`;
  const found = await findAccessAppByDestination(token, accountId, destinationUri, options);
  if (found.success && found.result) {
    return { success: true, result: found.result, reused: true };
  }
  // The create said "exists" but our list-by-destination didn't see it.
  // Most likely cause: a stale app at the same host registered under a
  // different normalization, OR the token doesn't have read scope on
  // the apps list. Surface the original create error so the user sees
  // a CF-shaped recovery message instead of a confusing "we know it
  // exists but can't find it" loop.
  return created;
}

/**
 * Create the default "allow" policy on an Access app. Accepts either a
 * single email (legacy path; one-element list) or an array of emails.
 * Without a policy the app exists but rejects everyone.
 *
 * Each email becomes its own `include` entry — Cloudflare's policy
 * shape requires that, not a list of strings inside one entry.
 */
export async function createAccessPolicy(
  token: string,
  accountId: string,
  appId: string,
  emailOrEmails: string | string[],
  options: FetchOptions = {}
): Promise<CfApiResult<{ id: string }>> {
  const emails = (Array.isArray(emailOrEmails) ? emailOrEmails : [emailOrEmails])
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes("@"));
  if (emails.length === 0) {
    return {
      success: false,
      errors: [{ code: 400, message: "createAccessPolicy: no valid emails supplied" }]
    };
  }
  return call<{ id: string }>(
    token,
    `/accounts/${accountId}/access/apps/${appId}/policies`,
    {
      method: "POST",
      body: JSON.stringify({
        name: emails.length === 1 ? "Helm owner" : `Helm allowlist (${emails.length})`,
        decision: "allow",
        include: emails.map((email) => ({ email: { email } }))
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

/**
 * `POST /accounts/{id}/workers/scripts/{name}/subdomain` — enable the
 * `<name>.<account-subdomain>.workers.dev` URL for the script. CF leaves
 * this disabled on fresh uploads in many account configurations, which
 * means the deploy succeeds but the URL the UI advertises is dead (522).
 * Idempotent — calling on an already-enabled subdomain is a no-op.
 */
export async function enableWorkersDevSubdomain(
  token: string,
  accountId: string,
  scriptName: string,
  options: FetchOptions = {}
): Promise<CfApiResult<{ enabled: boolean }>> {
  return call<{ enabled: boolean }>(
    token,
    `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
    {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
      ...options
    }
  );
}

/**
 * `GET /accounts/{id}/workers/subdomain` — fetch the account's workers.dev
 * subdomain (e.g. "thomas-zarebczan"). CF Workers live at
 *   <script-name>.<account-subdomain>.workers.dev
 * NOT just `<script-name>.workers.dev` — that pattern doesn't resolve.
 *
 * On a brand-new account that's never had a Worker, this can return an
 * empty `subdomain`. The caller should treat that as "user must visit
 * dash → Workers & Pages → set up subdomain" and surface the link.
 */
export async function getAccountWorkersSubdomain(
  token: string,
  accountId: string,
  options: FetchOptions = {}
): Promise<CfApiResult<{ subdomain: string }>> {
  return call<{ subdomain: string }>(
    token,
    `/accounts/${accountId}/workers/subdomain`,
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

/**
 * Idempotent secret-set: try `putWorkerSecret`; on code 10053 ("Binding
 * name already in use"), inspect the existing binding via
 * `getWorkerSettings` and recover gracefully.
 *
 * 10053 happens when a NON-secret binding (typically `plain_text` from
 * `vars`) already occupies that name. The legacy /secrets endpoint can't
 * overwrite a different binding type, so the PUT fails. But for our
 * use-case this often means the value is already correct (the deploy
 * upload pre-set it as plain_text) — in which case we should treat the
 * 10053 as success instead of breaking the wizard.
 *
 * Returns `reused`:
 *   - "value-match-plain-text" — plain_text binding has the same value
 *   - "already-secret"         — secret_text binding exists; trust it
 *   undefined                  — fresh write succeeded
 *
 * On real conflicts (different value or unexpected binding type) returns
 * a non-success result with `recovery` populated.
 */
export async function ensureWorkerSecret(
  token: string,
  accountId: string,
  scriptName: string,
  name: string,
  text: string,
  options: FetchOptions = {}
): Promise<CfApiResult<{ name: string; type: string }> & {
  reused?: "value-match-plain-text" | "already-secret";
  recovery?: string;
}> {
  const put = await putWorkerSecret(token, accountId, scriptName, name, text, options);
  if (put.success) return put;

  const errMsg = put.errors?.[0]?.message ?? "";
  const errCode = put.errors?.[0]?.code;
  const looksLikeBindingConflict =
    errCode === 10053 ||
    /binding name.*already in use/i.test(errMsg) ||
    /already exists/i.test(errMsg);
  if (!looksLikeBindingConflict) return put;

  const settings = await getWorkerSettings(token, accountId, scriptName, options);
  if (!settings.success || !Array.isArray(settings.result?.bindings)) {
    return {
      ...put,
      recovery: `A binding named ${name} already exists on the Worker but we couldn't read settings to inspect it (token may be missing "Workers Scripts:Edit"). Resolve at dash → Workers & Pages → ${scriptName} → Settings → Variables (delete the existing ${name}), then retry.`
    };
  }
  const existing = settings.result!.bindings!.find((b) => b.name === name) as
    | { name: string; type: string; text?: string }
    | undefined;
  if (!existing) return put;
  if (existing.type === "plain_text" && typeof existing.text === "string") {
    if (existing.text === text) {
      return { success: true, result: { name, type: "plain_text" }, reused: "value-match-plain-text" };
    }
    return {
      ...put,
      recovery: `${name} already exists as a plain_text variable with a different value. Wanted: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}". Found: "${String(existing.text).slice(0, 80)}". Edit or delete it at dash → Workers & Pages → ${scriptName} → Settings → Variables, then retry.`
    };
  }
  if (existing.type === "secret_text") {
    return { success: true, result: { name, type: "secret_text" }, reused: "already-secret" };
  }
  return {
    ...put,
    recovery: `${name} exists as a "${existing.type}" binding, which the secrets endpoint can't overwrite. Delete it at dash → Workers & Pages → ${scriptName} → Settings, then retry.`
  };
}
