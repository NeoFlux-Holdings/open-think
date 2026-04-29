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

export interface TokenPreflightOk {
  ok: true;
  tokenId: string;
  expiresOn?: string;
  /** Accounts this token can touch — UI shows a picker iff > 1. */
  accounts: Array<{ id: string; name: string }>;
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
  if (!orgRes.success || !orgRes.result?.auth_domain) {
    const msg =
      orgRes.errors?.[0]?.message ??
      "No team domain — enable Zero Trust at dash → Zero Trust → Settings.";
    steps.push(step("team-domain", false, "team domain unavailable", undefined, msg));
    return {
      ok: false,
      steps,
      error: msg,
      recovery:
        "Enable Zero Trust on your Cloudflare account first (free), then retry. Visit dash → Zero Trust → Settings → set a team name."
    };
  }
  const teamDomain = `https://${orgRes.result.auth_domain}`;
  steps.push(
    step("team-domain", true, `team domain ${orgRes.result.auth_domain}`, {
      teamDomain
    })
  );

  // 2. Create the Self-hosted Access app for this Worker's domain.
  const appRes = await cfCall<AccessAppResult>(
    input.token,
    `/accounts/${input.accountId}/access/apps`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.appName,
        domain: input.workerHost,
        type: "self_hosted",
        session_duration: input.sessionDuration ?? "24h",
        auto_redirect_to_identity: false
      }),
      fetchImpl
    }
  );
  if (!appRes.success || !appRes.result) {
    const msg = appRes.errors?.[0]?.message ?? "Access app creation failed.";
    steps.push(step("create-app", false, "Access app creation failed", undefined, msg));
    return {
      ok: false,
      steps,
      error: msg,
      recovery:
        "Token may be missing 'Access: Apps and Policies:Edit'. Recreate token with the pre-filled URL and retry."
    };
  }
  const appId = appRes.result.id;
  const aud = appRes.result.aud;
  steps.push(
    step(
      "create-app",
      true,
      `Access app live · aud=${aud.slice(0, 12)}…`,
      { appId, aud, domain: input.workerHost }
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
    const msg = polRes.errors?.[0]?.message ?? "Policy creation failed.";
    steps.push(step("create-policy", false, "policy creation failed", undefined, msg));
    return {
      ok: false,
      steps,
      error: msg,
      recovery:
        "Access app was created but no policy was attached — anyone is rejected. Delete the app at dash → Zero Trust → Access → Apps and retry.",
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
      const msg = r.errors?.[0]?.message ?? `setting ${s.name} failed`;
      steps.push(step(s.kind, false, `${s.name}: failed`, undefined, msg));
      return {
        ok: false,
        steps,
        error: msg,
        recovery: `Access app + policy created (aud=${aud.slice(0, 12)}…) but secrets weren't persisted. Add CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, and CF_ACCESS_ALLOWED_EMAILS manually at dash → Workers & Pages → ${input.scriptName} → Settings → Variables. Or delete the Access app at dash → Zero Trust → Access → Apps to retry from scratch.`,
        appId,
        aud,
        teamDomain
      };
    }
    steps.push(step(s.kind, true, `${s.name} set`, { name: s.name }));
  }

  return { ok: true, steps, teamDomain, aud, appId };
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
 * The four scopes are the minimum needed for runLockdown.
 */
export const ACCESS_WIZARD_TOKEN_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=" +
  [
    "com.cloudflare.api.account.workers.scripts:edit",
    "com.cloudflare.api.account.zerotrust.access:edit",
    "com.cloudflare.api.account.settings:read",
    "com.cloudflare.api.user.details:read"
  ].join(",");

export const ACCESS_WIZARD_SCOPES = [
  { resource: "Account", permission: "Workers Scripts:Edit" },
  { resource: "Account", permission: "Access: Apps and Policies:Edit" },
  { resource: "Account", permission: "Account Settings:Read" },
  { resource: "User", permission: "User Details:Read" }
] as const;
