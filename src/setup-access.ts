/**
 * Lock-it-down wizard — automates Cloudflare Access setup for a deployed
 * Helm Worker. Reduces 10+ dashboard hops to a single token paste.
 *
 * Three callable surfaces:
 *
 *   1. preflightToken()   — verify a CF API token has the four scopes the
 *                            wizard needs, before we ask the user for more.
 *   2. listAccountsFor()  — return account picker rows when the token has
 *                            access to >1 account.
 *   3. runLockdown()      — orchestrate: create Access app + policy → set
 *                            CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD +
 *                            CF_ACCESS_ALLOWED_EMAILS as Worker secrets.
 *                            Returns step-by-step results so the UI can
 *                            stream progress.
 *
 * The token never lives at rest. It rides only the request that creates
 * the Access app + sets the secrets, and is dropped at end of request.
 *
 * The runtime worker can call its own deploy account's API only if the
 * user supplies a token. CF doesn't expose third-party OAuth for
 * arbitrary apps, so paste-once-discard is the friction floor.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CfApiResult<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

interface CallOptions {
  fetchImpl?: typeof fetch;
}

async function cfCall<T>(
  token: string,
  path: string,
  init: RequestInit & CallOptions = {}
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
  const text = await resp.text();
  try {
    return JSON.parse(text) as CfApiResult<T>;
  } catch {
    return {
      success: false,
      errors: [
        { code: resp.status, message: text.slice(0, 200) || resp.statusText }
      ]
    };
  }
}

/* ---------------- Token preflight ---------------- */

export interface ScopeProbeResult {
  /** Logical scope name, mapped to a human-readable permission group. */
  scope: string;
  /** True if the token can hit the endpoint we tested for this scope. */
  ok: boolean;
  /** API error message when ok=false. */
  error?: string;
}

export interface TokenPreflightOk {
  ok: true;
  tokenId: string;
  expiresOn?: string;
  /** Accounts this token can touch — UI shows a picker iff > 1. */
  accounts: Array<{ id: string; name: string }>;
  /** Per-scope probe results when an accountId is supplied; empty otherwise. */
  scopes?: ScopeProbeResult[];
}
export interface TokenPreflightErr {
  ok: false;
  /** Stable code the UI maps to a friendly message + recovery action. */
  code:
    | "shape"
    | "verify-failed"
    | "list-accounts-failed"
    | "no-accounts";
  error: string;
  /** Empty when shape-failed; populated when the token *did* verify but
   *  the wizard can't proceed (e.g. zero accounts). */
  tokenId?: string;
}

/**
 * Sanity-check the token + enumerate accounts. We can't directly query
 * "what scopes does this token have" — CF doesn't expose that. We can
 * only verify the token works, then surface scope errors at the *next*
 * step (when an actual API call returns 9109 = no permission).
 *
 * The UI displays the token-creation URL with the right scopes pre-
 * filled, so token shape errors should be rare. The real recovery path
 * is the per-step error during runLockdown.
 */
export async function preflightToken(
  token: string,
  options: CallOptions = {}
): Promise<TokenPreflightOk | TokenPreflightErr> {
  if (typeof token !== "string" || token.length < 20) {
    return {
      ok: false,
      code: "shape",
      error: "Token looks malformed (less than 20 chars)."
    };
  }
  const verify = await cfCall<{ id: string; status: string; expires_on?: string }>(
    token,
    "/user/tokens/verify",
    { method: "GET", ...options }
  );
  if (!verify.success || !verify.result) {
    return {
      ok: false,
      code: "verify-failed",
      error:
        verify.errors?.[0]?.message ??
        "Cloudflare rejected the token. Double-check it was copied in full."
    };
  }
  const accountsRes = await cfCall<Array<{ id: string; name: string }>>(
    token,
    "/accounts?per_page=50",
    { method: "GET", ...options }
  );
  if (!accountsRes.success) {
    return {
      ok: false,
      code: "list-accounts-failed",
      error:
        accountsRes.errors?.[0]?.message ??
        "Token couldn't list accounts. The token needs Account Settings:Read.",
      tokenId: verify.result.id
    };
  }
  const accounts = accountsRes.result ?? [];
  if (accounts.length === 0) {
    return {
      ok: false,
      code: "no-accounts",
      error: "Token doesn't have access to any accounts.",
      tokenId: verify.result.id
    };
  }
  return {
    ok: true,
    tokenId: verify.result.id,
    expiresOn: verify.result.expires_on,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name }))
  };
}

/**
 * Probe the four scopes the lockdown wizard needs against a specific
 * account. Each probe is a cheap read-only call; failures here predict
 * failures in runLockdown so the UI can warn before submit.
 *
 * Note: there's no perfect "test this exact permission" CF API. We use
 * representative read endpoints that require each scope.
 */
export async function probeScopes(
  token: string,
  accountId: string,
  options: CallOptions = {}
): Promise<ScopeProbeResult[]> {
  const probes: Array<{ scope: string; path: string }> = [
    {
      scope: "Access: Apps and Policies (Edit) — read-probe",
      path: `/accounts/${accountId}/access/apps`
    },
    {
      scope: "Account Settings (Read) — Access organization",
      path: `/accounts/${accountId}/access/organizations`
    },
    {
      scope: "Workers Scripts (Edit) — read-probe",
      path: `/accounts/${accountId}/workers/scripts`
    }
  ];
  const results = await Promise.all(
    probes.map(async (p) => {
      const r = await cfCall<unknown>(token, p.path, { method: "GET", ...options });
      return {
        scope: p.scope,
        ok: r.success,
        error: r.success ? undefined : r.errors?.[0]?.message ?? "unknown"
      };
    })
  );
  return results;
}

/* ---------------- Lockdown orchestrator ---------------- */

export interface LockdownInput {
  token: string;
  accountId: string;
  /** The Worker's own script name. Derived from request host or env. */
  scriptName: string;
  /** Friendly Access-app name (e.g. "Helm — tomtom-agent"). */
  appName: string;
  /** Domain the Access app should gate (e.g. tomtom-agent.acct.workers.dev). */
  workerHost: string;
  /** One or more email addresses allowed in. */
  allowedEmails: string[];
  /** Session length, defaults to 24h. */
  sessionDuration?: string;
}

export type LockdownStepKind =
  | "team-domain"
  | "create-app"
  | "create-policy"
  | "set-secret-team-domain"
  | "set-secret-aud"
  | "set-secret-allowed-emails";

export interface LockdownStep {
  kind: LockdownStepKind;
  ok: boolean;
  /** Human-readable summary; goes into UI rows. */
  summary: string;
  /** Set when ok=false. */
  error?: string;
  /** Free-form payload — appId, AUD, etc. */
  data?: Record<string, unknown>;
}

export interface LockdownResult {
  ok: boolean;
  steps: LockdownStep[];
  /** Populated when each step succeeds. The UI uses these to confirm. */
  teamDomain?: string;
  aud?: string;
  appId?: string;
  /** Overall failure reason when ok=false. */
  error?: string;
  /** When `aud`/`appId` are set but a later step failed, the user can
   *  manually delete the app from the dash to retry clean. */
  recovery?: string;
}

interface AccessOrgResult {
  auth_domain: string;
  name: string;
}
interface AccessAppResult {
  id: string;
  uid: string;
  aud: string;
  name: string;
  domain: string;
  type: string;
}

function step(
  kind: LockdownStepKind,
  ok: boolean,
  summary: string,
  data?: Record<string, unknown>,
  error?: string
): LockdownStep {
  return { kind, ok, summary, ...(data ? { data } : {}), ...(error ? { error } : {}) };
}

/**
 * Run the full wizard. Sequential; abort on first failure but return all
 * steps attempted so the UI can show partial progress.
 */
export async function runLockdown(
  input: LockdownInput,
  options: CallOptions = {}
): Promise<LockdownResult> {
  const steps: LockdownStep[] = [];
  const fetchImpl = options.fetchImpl;

  // 1. Team domain (must come before app create — confirms Zero Trust is on).
  const orgRes = await cfCall<AccessOrgResult>(
    input.token,
    `/accounts/${input.accountId}/access/organizations`,
    { method: "GET", fetchImpl }
  );
  if (!orgRes.success) {
    // CF returned an error — most often this means the token can't read
    // Access organizations. Disambiguate from "Zero Trust not configured".
    const apiMsg = orgRes.errors?.[0]?.message ?? "team domain lookup failed";
    const apiCode = orgRes.errors?.[0]?.code;
    steps.push(step("team-domain", false, `team domain lookup failed · ${apiMsg}`, { apiCode }, apiMsg));
    return {
      ok: false,
      steps,
      error: apiMsg,
      recovery: classifyAccessOrgFailure(apiMsg, apiCode, input.accountId)
    };
  }
  if (!orgRes.result?.auth_domain) {
    // 200 OK but empty auth_domain — Zero Trust really isn't set up.
    const msg = "team domain is empty — enable Zero Trust + set a team name.";
    steps.push(step("team-domain", false, "Zero Trust team name not set", undefined, msg));
    return {
      ok: false,
      steps,
      error: msg,
      recovery:
        "Visit dash → Zero Trust → Settings → General → set a Team name. Free tier; takes ~1 minute. Then retry."
    };
  }
  const teamDomain = `https://${orgRes.result.auth_domain}`;
  steps.push(
    step("team-domain", true, `team domain ${orgRes.result.auth_domain}`, {
      teamDomain
    })
  );

  // 2. Create the Self-hosted Access app for this Worker's domain.
  //
  // We send the modern `destinations` array (CF added it in 2024) instead
  // of the legacy `domain` string. `destinations` doesn't run the
  // zone-ownership validation that historically rejected `*.workers.dev`
  // URLs with "domain does not belong to zone" — it just gates the URI.
  //
  // Dedupe: before creating, list existing apps and reuse one whose
  // destinations point at our worker host. This makes the wizard
  // idempotent across re-runs, AND avoids creating duplicate Access apps
  // when the user re-runs setup-deploy (the previous behavior would 409
  // or silently double up depending on CF's mood).
  const destinationUri = input.workerHost.startsWith("http")
    ? input.workerHost
    : `https://${input.workerHost}`;
  const existingApp = await findAccessAppByDestination(
    input.token,
    input.accountId,
    destinationUri,
    fetchImpl
  );
  let appRes: CfApiResult<AccessAppResult>;
  let dedupedExisting = false;
  if (existingApp) {
    appRes = { success: true, result: existingApp };
    dedupedExisting = true;
  } else {
    appRes = await cfCall<AccessAppResult>(
      input.token,
      `/accounts/${input.accountId}/access/apps`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.appName,
          type: "self_hosted",
          destinations: [{ type: "public", uri: destinationUri }],
          session_duration: input.sessionDuration ?? "24h",
          auto_redirect_to_identity: false
        }),
        fetchImpl
      }
    );
  }
  if (!appRes.success || !appRes.result) {
    const apiMsg = appRes.errors?.[0]?.message ?? "Access app creation failed.";
    const apiCode = appRes.errors?.[0]?.code;
    steps.push(step("create-app", false, `Access app creation failed · ${apiMsg}`, { apiCode }, apiMsg));
    return {
      ok: false,
      steps,
      error: apiMsg,
      recovery: classifyApiFailure(apiMsg, apiCode, "Access: Apps and Policies:Edit", input.accountId)
    };
  }
  const appId = appRes.result.id;
  const aud = appRes.result.aud;
  steps.push(
    step(
      "create-app",
      true,
      dedupedExisting
        ? `Access app reused · aud=${aud.slice(0, 12)}… (existing app already gates ${destinationUri})`
        : `Access app live · aud=${aud.slice(0, 12)}…`,
      { appId, aud, domain: input.workerHost, deduped: dedupedExisting }
    )
  );

  // 3. Email allowlist policy.
  const cleanedEmails = input.allowedEmails
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes("@"));
  if (cleanedEmails.length === 0) {
    steps.push(
      step(
        "create-policy",
        false,
        "no valid emails supplied",
        undefined,
        "Provide at least one valid email address."
      )
    );
    return {
      ok: false,
      steps,
      error: "no valid emails",
      recovery: "Delete the Access app at dash → Zero Trust → Access → Apps before retrying.",
      appId,
      aud,
      teamDomain
    };
  }
  const includeRules = cleanedEmails.map((email) => ({ email: { email } }));
  const polRes = await cfCall<{ id: string }>(
    input.token,
    `/accounts/${input.accountId}/access/apps/${appId}/policies`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Helm owner",
        decision: "allow",
        include: includeRules
      }),
      fetchImpl
    }
  );
  if (!polRes.success) {
    const apiMsg = polRes.errors?.[0]?.message ?? "Policy creation failed.";
    const apiCode = polRes.errors?.[0]?.code;
    steps.push(step("create-policy", false, `policy creation failed · ${apiMsg}`, { apiCode }, apiMsg));
    return {
      ok: false,
      steps,
      error: apiMsg,
      recovery: `${classifyApiFailure(apiMsg, apiCode, "Access: Apps and Policies:Edit", input.accountId)}\n\nAlso: the Access app (id ${appId}) was created without a policy — it currently rejects everyone. Delete it at dash → Zero Trust → Access → Apps before retrying.`,
      appId,
      aud,
      teamDomain
    };
  }
  steps.push(
    step(
      "create-policy",
      true,
      `policy allows ${cleanedEmails.length} email${cleanedEmails.length === 1 ? "" : "s"}`,
      { policyId: polRes.result?.id, emails: cleanedEmails }
    )
  );

  // 4-6. Set the three secrets on the Worker.
  const secretsToSet: Array<{ kind: LockdownStepKind; name: string; text: string }> = [
    { kind: "set-secret-team-domain", name: "CF_ACCESS_TEAM_DOMAIN", text: teamDomain },
    { kind: "set-secret-aud", name: "CF_ACCESS_AUD", text: aud },
    {
      kind: "set-secret-allowed-emails",
      name: "CF_ACCESS_ALLOWED_EMAILS",
      text: cleanedEmails.join(",")
    }
  ];
  for (const s of secretsToSet) {
    const r = await cfCall<{ name: string; type: string }>(
      input.token,
      `/accounts/${input.accountId}/workers/scripts/${input.scriptName}/secrets`,
      {
        method: "PUT",
        body: JSON.stringify({ name: s.name, text: s.text, type: "secret_text" }),
        fetchImpl
      }
    );
    if (!r.success) {
      const apiMsg = r.errors?.[0]?.message ?? `setting ${s.name} failed`;
      const apiCode = r.errors?.[0]?.code;
      steps.push(step(s.kind, false, `${s.name}: ${apiMsg}`, { apiCode }, apiMsg));
      const scopeRecovery = classifyApiFailure(apiMsg, apiCode, "Workers Scripts:Edit", input.accountId);
      return {
        ok: false,
        steps,
        error: apiMsg,
        recovery: `${scopeRecovery}\n\nThe Access app + policy were created OK (aud=${aud.slice(0, 12)}…) but the Worker secrets didn't persist. Once the token is fixed: (a) retry the wizard, OR (b) add CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, and CF_ACCESS_ALLOWED_EMAILS by hand at dash → Workers & Pages → ${input.scriptName} → Settings → Variables. To start over from scratch instead, delete the Access app at dash → Zero Trust → Access → Apps.`,
        appId,
        aud,
        teamDomain
      };
    }
    steps.push(step(s.kind, true, `${s.name} set`, { name: s.name }));
  }

  return { ok: true, steps, teamDomain, aud, appId };
}

/* ---------------- Failure classification ---------------- */

/**
 * Map a CF API error message + code into actionable recovery copy.
 *
 * The two top error patterns we see are:
 *   1. Token missing the right permission group ("Authentication error",
 *      "Insufficient permissions", code 9109/10000/9106 etc.)
 *   2. Token has the right scope but is restricted to the wrong account
 *      under "Account Resources" during token creation.
 *
 * Distinguishing between them is hard from the error text alone, so we
 * recommend the user verify BOTH.
 */
export function classifyApiFailure(
  apiMsg: string,
  apiCode: number | undefined,
  expectedScope: string,
  accountId: string
): string {
  const lower = apiMsg.toLowerCase();
  const looksLikeAuth =
    lower.includes("auth") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("unauthorized") ||
    apiCode === 9109 ||
    apiCode === 9106 ||
    apiCode === 10000 ||
    apiCode === 10001;
  if (looksLikeAuth) {
    return [
      `Cloudflare returned: "${apiMsg}". Two likely causes — check both:`,
      `  1. Token is missing the "${expectedScope}" permission group.`,
      `     Re-create at dash → Profile → API Tokens with the link in the wizard.`,
      `  2. Token's "Account Resources" was scoped to a different account than ${accountId.slice(0, 8)}…`,
      `     During token creation, set Account Resources → Include → All accounts (or pick the right one).`
    ].join("\n");
  }
  if (lower.includes("not found") || lower.includes("does not exist")) {
    return `Cloudflare returned: "${apiMsg}". The resource (account ${accountId.slice(0, 8)}…) wasn't found by this token. Most often: token's "Account Resources" filter excludes this account. Re-create the token with Account Resources → All accounts.`;
  }
  return `Cloudflare returned: "${apiMsg}" (code ${apiCode ?? "n/a"}). If retrying doesn't help, recreate the token with the wizard's pre-filled scope link.`;
}

/**
 * Specifically diagnose /access/organizations failure. Distinguishes:
 *   - auth/scope (token can't read Access)
 *   - resource-not-found (account scope filter)
 *   - empty auth_domain (Zero Trust not actually set up)
 */
export function classifyAccessOrgFailure(
  apiMsg: string,
  apiCode: number | undefined,
  accountId: string
): string {
  const lower = apiMsg.toLowerCase();
  if (
    lower.includes("auth") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    apiCode === 9109 ||
    apiCode === 10000
  ) {
    return [
      `Cloudflare returned: "${apiMsg}". This is an AUTH failure, not a Zero Trust setup issue.`,
      `  1. Verify your token has BOTH "Access: Apps and Policies:Edit" AND "Account Settings:Read".`,
      `  2. Verify the token's "Account Resources" includes account ${accountId.slice(0, 8)}…`,
      `     (during token creation, pick All accounts or specifically include this one).`,
      `  3. If both look right, regenerate the token using the wizard's pre-filled link.`
    ].join("\n");
  }
  return `Cloudflare returned: "${apiMsg}". If Zero Trust IS already set up, this is likely a token-scope or token-account issue rather than a Zero Trust one. Double-check the token has "Access: Apps and Policies:Edit" + "Account Settings:Read" and includes account ${accountId.slice(0, 8)}…`;
}

/* ---------------- Helpers ---------------- */

/**
 * Strip the script name out of a Worker host header.
 *  - tomtom-agent.thomas-zarebczan.workers.dev → "tomtom-agent"
 *  - helm.workers.dev                          → "helm"
 *  - my-worker.example.com (custom domain)     → null (caller must specify)
 */
export function deriveScriptName(host: string): string | null {
  if (!host) return null;
  // Either <name>.<account>.workers.dev or <name>.workers.dev
  if (host.endsWith(".workers.dev")) {
    const parts = host.split(".");
    return parts[0] || null;
  }
  return null;
}

/**
 * Build the pre-filled token-creation URL the wizard links to.
 *
 * The wizard token covers BOTH:
 *   - runLockdown (the original 4: workers_scripts + access + account + user)
 *   - helm-setup-deploy's full chain: D1 + R2 + KV + Artifacts (canonical
 *     wrangler.toml source-of-truth via Cloudflare Artifacts)
 *
 * One paste, every downstream skill works. Tokens with fewer scopes still
 * work for the lockdown half — helm-setup-deploy gracefully reports any
 * 403s on individual provisioning steps.
 *
 * IMPORTANT — CF's dash needs FOUR query params, not just one, to actually
 * pre-populate the form:
 *
 *   permissionGroupKeys = URL-encoded JSON array of {key, type} objects
 *                          with SHORT keys (`workers_scripts`, not the
 *                          legacy dotted form which is silently dropped)
 *   accountId           = "*"     pre-selects "All accounts"
 *   zoneId              = "all"   pre-selects "All zones"
 *   name                = string  pre-fills the token-name field
 *
 * Without the last three the dash opens an empty custom-token page even
 * when permissionGroupKeys is well-formed — the URL appears broken to
 * the user. See:
 *   https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/
 *   (and a community thread documenting the full URL contract)
 */
const ACCESS_WIZARD_TOKEN_PERMISSIONS = encodeURIComponent(
  JSON.stringify([
    { key: "workers_scripts", type: "edit" },
    { key: "access", type: "edit" },
    // `cloudflare_zero_trust:read` is needed for `/access/organizations` —
    // the lockdown wizard's first call. Without it the user gets
    // "Authentication error" even when the access:edit scope is granted,
    // because organization lookup lives under Zero Trust, not Apps and
    // Policies. (Yes, CF's permission split is unintuitive.)
    { key: "cloudflare_zero_trust", type: "read" },
    { key: "d1", type: "edit" },
    { key: "workers_r2_storage", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
    { key: "artifacts", type: "edit" },
    { key: "account_settings", type: "read" },
    { key: "user_details", type: "read" }
  ])
);

export const ACCESS_WIZARD_TOKEN_URL =
  "https://dash.cloudflare.com/profile/api-tokens" +
  `?permissionGroupKeys=${ACCESS_WIZARD_TOKEN_PERMISSIONS}` +
  `&accountId=*` +
  `&zoneId=all` +
  `&name=${encodeURIComponent("Helm")}`;

/**
 * Look up an existing self-hosted Access app whose destinations cover the
 * given URI. Returns the first match or null. Used by `runLockdown` to
 * dedupe across re-runs — instead of failing or duplicating, we reuse the
 * existing app's `aud` so the user's secrets stay coherent.
 *
 * Match is forgiving: legacy apps stored their target as `domain` rather
 * than `destinations[]`, and CF's destinations URIs sometimes carry a
 * trailing slash that the caller's host doesn't. We normalize both sides
 * by stripping the scheme + trailing slash before comparing.
 */
async function findAccessAppByDestination(
  token: string,
  accountId: string,
  destinationUri: string,
  fetchImpl?: typeof fetch
): Promise<AccessAppResult | null> {
  const list = await cfCall<Array<AccessAppResult & {
    domain?: string;
    destinations?: Array<{ type?: string; uri?: string }>;
  }>>(token, `/accounts/${accountId}/access/apps?per_page=100`, {
    method: "GET",
    fetchImpl
  });
  if (!list.success || !list.result || !Array.isArray(list.result)) return null;
  const normalize = (s: string) =>
    s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const target = normalize(destinationUri);
  for (const app of list.result) {
    if (Array.isArray(app.destinations)) {
      for (const d of app.destinations) {
        if (typeof d.uri === "string" && normalize(d.uri) === target) return app;
      }
    }
    if (typeof app.domain === "string" && normalize(app.domain) === target) return app;
  }
  return null;
}

export const ACCESS_WIZARD_SCOPES = [
  { resource: "Account", permission: "Workers Scripts:Edit" },
  { resource: "Account", permission: "Access: Apps and Policies:Edit" },
  { resource: "Account", permission: "Cloudflare Zero Trust:Read" },
  { resource: "Account", permission: "D1:Edit" },
  { resource: "Account", permission: "Workers R2 Storage:Edit" },
  { resource: "Account", permission: "Workers KV Storage:Edit" },
  { resource: "Account", permission: "Artifacts:Edit" },
  { resource: "Account", permission: "Account Settings:Read" },
  { resource: "User", permission: "User Details:Read" }
] as const;
