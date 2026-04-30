/**
 * Deploy orchestrator — runs the user's deploy in steps and returns a
 * structured result the UI can render.
 *
 * v1 (this file): does the parts the marketing-site Worker CAN do without
 * carrying the full Helm bundle:
 *   1. Verify the token
 *   2. Create a D1 database in their account (optional)
 *   3. Create a Cloudflare Access app + owner policy (optional)
 *   4. Compose a wrangler.toml with the IDs we just got
 *   5. Render the final `wrangler deploy` command + secret-set commands
 *
 * The user finishes by pasting the wrangler.toml into their fork and running
 * one `wrangler deploy` from their terminal. That's still a 90% reduction in
 * setup steps.
 *
 * v2 (later): pre-built Helm bundle hosted as a static asset, and we call
 * `uploadWorkerScript` ourselves — fully terminal-free deploy.
 */

import {
  createAccessApp,
  createAccessPolicy,
  ensureD1Database,
  flattenMigrationsForCfApi,
  getAccessOrganization,
  listAccounts,
  putWorkerSecret,
  uploadWorkerScript,
  verifyToken
} from "./cfApi";
import { encryptCfToken } from "./crypto";
import {
  appendPushLog,
  insertDeployment,
  issueManageToken,
  recordPushSuccess
} from "./deployments";
import { fetchManifest, fetchModuleBytes } from "./manifest";
import type {
  CfAccount,
  DeployRequest,
  DeployResponse,
  DeployStepResult
} from "./types";

interface FlowOptions {
  fetchImpl?: typeof fetch;
  /**
   * When set, runDeploy ALSO uploads the bundle directly to the customer's
   * Worker via the CF API and sets every secret — eliminating the
   * "now run wrangler deploy locally" step. Without it, runDeploy stops
   * after composing wrangler.toml + commands (the local-deploy fallback).
   */
  directDeploy?: {
    /** URL of the Helm bundle manifest. Same source the cron uses. */
    manifestUrl: string;
  };
}

/**
 * Optional persistence input — when present, runDeploy stores the deployment
 * + encrypted token in D1 so the cron can push updates. Absent → the deploy
 * is one-shot (free OSS path) and we throw the token away after the request.
 */
export interface SubscriptionPersistInput {
  db: D1Database;
  masterKey: string;
  customerId: string;
  /** Optional — used to derive sane defaults for the manage email. */
  customerEmail?: string;
}

function step(
  kind: DeployStepResult["kind"],
  ok: boolean,
  summary: string,
  data?: Record<string, unknown>,
  error?: string
): DeployStepResult {
  return { kind, ok, summary, data, error };
}

/**
 * Verify the token and return the accounts the caller can deploy into.
 * The UI calls this first, then asks the user to pick an account.
 */
export async function verifyAndListAccounts(
  token: string,
  options: FlowOptions = {}
): Promise<{ ok: boolean; accounts: CfAccount[]; error?: string }> {
  const verify = await verifyToken(token, options);
  if (!verify.success) {
    return {
      ok: false,
      accounts: [],
      error: verify.errors?.[0]?.message ?? "token verification failed"
    };
  }
  const accounts = await listAccounts(token, options);
  if (!accounts.success) {
    return {
      ok: false,
      accounts: [],
      error: accounts.errors?.[0]?.message ?? "could not list accounts (token missing Account Settings:Read?)"
    };
  }
  return { ok: true, accounts: accounts.result ?? [] };
}

/**
 * Run the full deploy. Each step accumulates into `steps`; on the first
 * failure we stop and return what we have so the UI can show a clean
 * "stopped at step N" view.
 *
 * Pass `persist` (a Helm-Cloud subscriber path) to also encrypt + store the
 * customer's CF token in `cloud_deployments`. The token never lives at rest
 * outside that one ciphertext column.
 */
export async function runDeploy(
  req: DeployRequest,
  options: FlowOptions & { persist?: SubscriptionPersistInput } = {}
): Promise<DeployResponse> {
  const steps: DeployStepResult[] = [];
  const acc = req.accountId;
  const name = req.workerName;

  // --- 1. Verify the token works against the chosen account ---
  const verify = await verifyToken(req.token, options);
  if (!verify.success) {
    const apiMsg = verify.errors?.[0]?.message ?? "unknown";
    const apiCode = verify.errors?.[0]?.code;
    const recovery = explainCfError(apiMsg, apiCode, "User Details:Read", acc);
    steps.push(step("verify-token", false, `token rejected · ${apiMsg}`, undefined,
      `${apiMsg}\n\n${recovery}`));
    return { ok: false, accountId: acc, workerName: name, steps, error: "verify-token failed" };
  }
  steps.push(step("verify-token", true, `token ok (id ${verify.result?.id ?? "unknown"})`, {
    tokenId: verify.result?.id,
    expiresOn: verify.result?.expires_on
  }));

  // --- 2. Optional: create a D1 database for the PA stack ---
  let d1Id: string | undefined;
  let d1Name: string | undefined;
  if (req.enableD1) {
    const dbName = `${name}-pa`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
    // ensureD1Database is idempotent: on "already exists" it falls back to
    // looking up the existing DB by name + returns its uuid. Lets users
    // retry a partial deploy without manually deleting the D1 first.
    const d1 = await ensureD1Database(req.token, acc, dbName, options);
    if (!d1.success) {
      const apiMsg = d1.errors?.[0]?.message ?? "unknown";
      const apiCode = d1.errors?.[0]?.code;
      const recovery = explainCfError(apiMsg, apiCode, "D1:Edit", acc);
      steps.push(step("create-d1", false, `D1 create failed · ${apiMsg}`, undefined,
        `${apiMsg}\n\n${recovery}`));
      return finalize(steps, false, acc, name, "create-d1 failed");
    }
    d1Id = d1.result?.uuid;
    d1Name = d1.result?.name;
    const summary = d1.reused
      ? `D1 \`${d1Name}\` already existed · reusing (uuid ${d1Id?.slice(0, 8)}…)`
      : `D1 \`${d1Name}\` created`;
    steps.push(step("create-d1", true, summary, {
      uuid: d1Id,
      name: d1Name,
      reused: d1.reused === true
    }));
  }

  // --- 3. Optional: create the Cloudflare Access app + owner policy ---
  // We skip Access if the user didn't pick it OR if they're missing an owner
  // email (we need to scope the policy to someone). The Access org's
  // `auth_domain` becomes their `CF_ACCESS_TEAM_DOMAIN`.
  let accessAud: string | undefined;
  let accessTeamDomain: string | undefined;
  if (req.enableAccess && req.secrets?.OWNER_EMAIL) {
    // First, get the team domain.
    const org = await getAccessOrganization(req.token, acc, options);
    if (!org.success || !org.result?.auth_domain) {
      const apiMsg = org.errors?.[0]?.message ?? "no auth_domain";
      const apiCode = org.errors?.[0]?.code;
      // 200-with-empty-auth_domain = Zero Trust not yet configured.
      // Anything else (400/403/etc.) = scope or account-resources problem.
      const isEmptyDomain = org.success && !org.result?.auth_domain;
      const detail = isEmptyDomain
        ? "Zero Trust team name not set. Visit dash → Zero Trust → Settings → General → set a Team name. Free tier; takes ~1 minute."
        : `${apiMsg}\n\n${explainCfError(apiMsg, apiCode, "Access: Apps and Policies:Edit", acc)}`;
      steps.push(step("create-access-app", false,
        isEmptyDomain
          ? "Access org has no team domain — set one at dash → Zero Trust → Settings"
          : `Access org lookup failed · ${apiMsg}`,
        undefined,
        detail));
      // Don't abort — Access is optional. Continue without it.
    } else {
      accessTeamDomain = `https://${org.result.auth_domain}`;
      // Worker URL we'll gate. workers.dev is the default.
      const workerDomain = `${name}.workers.dev`;
      const app = await createAccessApp(
        req.token,
        acc,
        { name: `Helm — ${name}`, domain: workerDomain, sessionDuration: "24h" },
        options
      );
      if (!app.success || !app.result?.aud) {
        const apiMsg = app.errors?.[0]?.message ?? "unknown";
        const apiCode = app.errors?.[0]?.code;
        const isWorkersDev = name && /\.workers\.dev$/i.test(`${name}.workers.dev`);
        const isDomainZoneError = /domain does not belong to zone/i.test(apiMsg);
        const recovery = isDomainZoneError
          ? [
              `Cloudflare's API doesn't allow Self-hosted Access apps to be created against *.workers.dev URLs via this endpoint — the domain has to be on a zone in your account.`,
              ``,
              `Three paths forward:`,
              `  1. Skip Access for now (recommended quick path): re-deploy with the "Create a Cloudflare Access app" checkbox UNCHECKED. Your Worker still runs — auth is in first-run permissive mode and the /app UI shows a yellow banner reminding you to lock it down later. The same workers.dev limit applies to the in-app wizard, so see (2) or (3) for actually locking down.`,
              `  2. Add a custom domain to your Worker first (cleanest). Dash → Workers & Pages → ${name} → Settings → Triggers → "Add Custom Domain". Re-run this deploy form with that domain — Access app creation works against your zones.`,
              `  3. Create the Access app manually in the dashboard. Zero Trust → Access → Applications → Add → Self-hosted → enter "${name}.workers.dev" as the application domain. The dashboard uses an internal mechanism that works on workers.dev where the public API doesn't.`
            ].join("\n")
          : explainCfError(apiMsg, apiCode, "Access: Apps and Policies:Edit", acc);
        steps.push(step("create-access-app", false, `Access app create failed · ${apiMsg}`, undefined,
          `${apiMsg}\n\n${recovery}`));
        // Continue without Access.
      } else {
        accessAud = app.result.aud;
        await createAccessPolicy(req.token, acc, app.result.id, req.secrets.OWNER_EMAIL, options);
        steps.push(step("create-access-app", true,
          `Access app created · AUD=${accessAud.slice(0, 12)}…`, {
            appId: app.result.id,
            aud: accessAud,
            teamDomain: accessTeamDomain,
            domain: workerDomain
          }));
      }
    }
  }

  // --- 4. Compose wrangler.toml ---
  const wranglerToml = composeWranglerToml({
    workerName: name,
    accountId: acc,
    d1: d1Id ? { uuid: d1Id, name: d1Name ?? `${name}-pa` } : null,
    access: accessAud && accessTeamDomain
      ? { aud: accessAud, teamDomain: accessTeamDomain }
      : null,
    ownerEmail: req.secrets?.OWNER_EMAIL,
    fromEmail: req.secrets?.FROM_EMAIL
  });
  steps.push(step("compose-wrangler-toml", true, "wrangler.toml composed", {
    bytes: wranglerToml.length
  }));

  // --- 5. Render the CLI commands the user runs to finish ---
  // Always rendered as a fallback / "wanna do this locally instead?" reference.
  // When directDeploy succeeds (step 6 below), the UI hides these.
  const commands = renderFinalCommands({
    workerName: name,
    secrets: { ...(req.secrets ?? {}) } as Record<string, string | undefined>
  });
  steps.push(step("render-cli-commands", true, `${commands.length} commands ready to paste (local fallback)`, {
    count: commands.length
  }));

  // --- 6. Direct deploy: fetch bundle + upload + set secrets ---
  // When `directDeploy.manifestUrl` is set, we finish the deploy in this
  // request — no `wrangler deploy` required from the user. The flow:
  //   a. Fetch the manifest (sha + module URL + abstract bindings)
  //   b. Fetch the bundle bytes
  //   c. Compose customer-specific bindings (D1 ID, vars from secrets)
  //   d. PUT the script to api.cloudflare.com via uploadWorkerScript
  //   e. Set each sensitive secret via putWorkerSecret
  //
  // Failures degrade to the local-fallback path: the user still has the
  // wrangler.toml + commands to deploy themselves.
  let directDeployed = false;
  let buildSha: string | undefined;
  if (options.directDeploy?.manifestUrl) {
    const directResult = await runDirectDeploy({
      token: req.token,
      accountId: acc,
      workerName: name,
      manifestUrl: options.directDeploy.manifestUrl,
      d1: d1Id ? { uuid: d1Id, name: d1Name ?? `${name}-pa` } : null,
      access: accessAud && accessTeamDomain
        ? { aud: accessAud, teamDomain: accessTeamDomain }
        : null,
      secrets: { ...(req.secrets ?? {}) } as Record<string, string | undefined>,
      ownerEmail: req.secrets?.OWNER_EMAIL,
      fromEmail: req.secrets?.FROM_EMAIL,
      fetchImpl: options.fetchImpl
    });
    steps.push(...directResult.steps);
    if (directResult.ok) {
      directDeployed = true;
      buildSha = directResult.buildSha;
    }
  }

  // --- 7. Optional persistence: Helm Cloud subscriber path ---
  // Only runs when the caller explicitly opted into a managed deploy. The
  // CF token is encrypted under CLOUD_MASTER_KEY before it touches D1; this
  // function never returns the plaintext token to anyone.
  let persistedDeploymentId: string | undefined;
  let manageToken: string | undefined;
  if (options.persist) {
    try {
      const encrypted = await encryptCfToken(req.token, options.persist.masterKey);
      const id = crypto.randomUUID();
      await insertDeployment(options.persist.db, {
        id,
        customerId: options.persist.customerId,
        accountId: acc,
        workerName: name,
        encryptedTokenB64: encrypted.ciphertextB64,
        encryptionIvB64: encrypted.ivB64,
        workerUrl: `https://${name}.workers.dev`,
        // When direct-deploy succeeded, seed last_pushed_at + build_sha so
        // the cron knows this customer is already on the latest bundle
        // and won't re-push within the next hour.
        buildSha: directDeployed ? buildSha : null
      });
      await appendPushLog(options.persist.db, id, "deploy-created", buildSha ?? null, null);
      // Seed last_pushed_at when direct-deploy succeeded so the manage page
      // shows the correct timestamp + the cron sees an up-to-date deploy.
      if (directDeployed && buildSha) {
        await recordPushSuccess(options.persist.db, id, buildSha);
      }
      manageToken = await issueManageToken(options.persist.db, id);
      persistedDeploymentId = id;
    } catch (err) {
      // Persistence failure shouldn't void a successful deploy — log it but
      // return ok=true so the user still gets their wrangler.toml.
      steps.push(step(
        "render-cli-commands",
        false,
        `subscription record save failed (deploy still succeeded)`,
        undefined,
        (err as Error).message
      ));
    }
  }

  return {
    ok: true,
    accountId: acc,
    workerName: name,
    steps,
    wranglerToml,
    commands,
    deploymentId: persistedDeploymentId,
    manageToken,
    directDeployed,
    workerUrl: `https://${name}.workers.dev`,
    buildSha
  };
}

/* ---------------- Direct deploy (server-side wrangler-equivalent) ---------------- */

interface DirectDeployInput {
  token: string;
  accountId: string;
  workerName: string;
  manifestUrl: string;
  d1: { uuid: string; name: string } | null;
  access: { aud: string; teamDomain: string } | null;
  secrets: Record<string, string | undefined>;
  ownerEmail?: string;
  fromEmail?: string;
  fetchImpl?: typeof fetch;
}

interface DirectDeployResult {
  ok: boolean;
  steps: DeployStepResult[];
  buildSha?: string;
}

/**
 * The CF API equivalent of `wrangler deploy` — fetch the published bundle,
 * compose metadata with customer-specific values, PUT, then loop over
 * secret_text bindings via the secrets endpoint.
 *
 * Why secrets via a separate endpoint and not inline in metadata.bindings?
 * Inline secret_text values get echoed back in some CF API responses; the
 * dedicated `/secrets` endpoint keeps them out of the script-settings
 * read path. Also matches what `wrangler secret put` does.
 */
async function runDirectDeploy(input: DirectDeployInput): Promise<DirectDeployResult> {
  const steps: DeployStepResult[] = [];
  const fetchImpl = input.fetchImpl ?? fetch;

  // a. Fetch manifest.
  let manifest;
  try {
    manifest = await fetchManifest(input.manifestUrl, fetchImpl);
  } catch (err) {
    steps.push(step("fetch-bundle", false, "manifest fetch failed", undefined, (err as Error).message));
    return { ok: false, steps };
  }
  steps.push(step("fetch-bundle", true, `manifest ok · sha=${manifest.sha.slice(0, 8)} v=${manifest.version ?? "?"}`, {
    sha: manifest.sha,
    version: manifest.version,
    moduleUrl: manifest.moduleUrl,
    moduleSize: manifest.moduleSize
  }));

  // a2. Fetch the actual module bytes.
  let bytes: ArrayBuffer;
  try {
    bytes = await fetchModuleBytes(manifest.moduleUrl, fetchImpl);
  } catch (err) {
    steps.push(step("fetch-bundle", false, "bundle bytes fetch failed", undefined, (err as Error).message));
    return { ok: false, steps };
  }

  // c. Compose bindings — manifest's abstract list, plus customer-specific
  // entries (D1 with the database_id we just created, plain_text vars from
  // the form). Sensitive secrets are NOT in this list; they get set via
  // putWorkerSecret in step (e).
  const bindings: Array<Record<string, unknown>> = [...manifest.metadata.bindings];

  if (input.d1) {
    bindings.push({
      type: "d1",
      name: "DB",
      id: input.d1.uuid
    });
  }

  // Plain-text vars (non-sensitive) — these match what composeWranglerToml
  // would have written under [vars].
  const vars: Record<string, string> = {
    MODEL_DEFAULT: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ENABLED_PLUGINS: "admin,workers-ai,memory,email,notifier",
    ALLOWED_HOSTS: "",
    AGENT_NAME: "Helm"
  };
  if (input.ownerEmail) {
    vars.AGENT_OWNER_EMAIL = input.ownerEmail;
    vars.OWNER_EMAIL = input.ownerEmail;
  }
  if (input.fromEmail) vars.FROM_EMAIL = input.fromEmail;
  if (input.access) vars.CF_ACCESS_TEAM_DOMAIN = input.access.teamDomain;
  for (const [k, v] of Object.entries(vars)) {
    bindings.push({ type: "plain_text", name: k, text: v });
  }

  // d. PUT the script.
  // Note: CF's Workers Scripts API expects metadata.migrations as a SINGLE
  // migration object (the diff to apply), not the array our manifest carries
  // verbatim from wrangler.toml. flattenMigrationsForCfApi collapses the
  // historical [v1, v2, v3] into one {new_tag, new_classes, new_sqlite_classes}.
  const metadata: Record<string, unknown> = {
    main_module: manifest.metadata.main_module,
    compatibility_date: manifest.metadata.compatibility_date,
    compatibility_flags: manifest.metadata.compatibility_flags,
    bindings
  };
  const flatMigrations = flattenMigrationsForCfApi(
    manifest.metadata.migrations as Array<Record<string, unknown>> | undefined
  );
  if (flatMigrations) metadata.migrations = flatMigrations;

  const upload = await uploadWorkerScript(
    input.token,
    input.accountId,
    input.workerName,
    {
      metadata,
      mainModule: { name: manifest.metadata.main_module, bytes }
    },
    { fetchImpl }
  );
  if (!upload.success) {
    const errMsg = upload.errors?.[0]?.message ?? "upload failed";
    steps.push(step("upload-worker", false, "Worker upload failed", undefined, errMsg));
    return { ok: false, steps };
  }
  steps.push(step("upload-worker", true,
    `Worker live at ${input.workerName}.workers.dev`,
    { id: upload.result?.id, etag: upload.result?.etag }
  ));

  // e. Set sensitive secrets one at a time. We stop on the first failure
  // and let the caller decide — the script is already deployed and live;
  // missing secrets are recoverable via the manage page.
  // CF_ACCESS_AUD lives here too (Access app aud is sensitive).
  const secretsToSet: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.secrets)) {
    if (!v) continue;
    // OWNER_EMAIL + FROM_EMAIL are non-sensitive vars (already inlined).
    if (k === "OWNER_EMAIL" || k === "AGENT_OWNER_EMAIL" || k === "FROM_EMAIL") continue;
    secretsToSet[k] = v;
  }
  if (input.access?.aud) secretsToSet.CF_ACCESS_AUD = input.access.aud;

  for (const [k, v] of Object.entries(secretsToSet)) {
    const r = await putWorkerSecret(input.token, input.accountId, input.workerName, k, v, { fetchImpl });
    if (!r.success) {
      const errMsg = r.errors?.[0]?.message ?? "secret put failed";
      steps.push(step("set-secret", false, `secret ${k}: failed`, undefined, errMsg));
      // Don't bail — the Worker is up. Continue setting the rest.
    } else {
      steps.push(step("set-secret", true, `secret ${k}: set`));
    }
  }

  return { ok: true, steps, buildSha: manifest.sha };
}

function finalize(
  steps: DeployStepResult[],
  ok: boolean,
  accountId: string,
  workerName: string,
  error?: string
): DeployResponse {
  return { ok, accountId, workerName, steps, error };
}

/* ---------------- wrangler.toml composition ---------------- */

interface WranglerComposeInput {
  workerName: string;
  accountId: string;
  d1: { uuid: string; name: string } | null;
  access: { aud: string; teamDomain: string } | null;
  ownerEmail?: string;
  fromEmail?: string;
}

export function composeWranglerToml(input: WranglerComposeInput): string {
  const lines: string[] = [];
  lines.push(`name = "${input.workerName}"`);
  lines.push(`main = "src/index.ts"`);
  lines.push(`account_id = "${input.accountId}"`);
  lines.push(`compatibility_date = "2026-04-16"`);
  lines.push(`compatibility_flags = ["nodejs_compat_v2"]`);
  lines.push("");
  lines.push("[observability]");
  lines.push("enabled = true");
  lines.push("");
  lines.push("[vars]");
  lines.push(`MODEL_DEFAULT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"`);
  lines.push(`ENABLED_PLUGINS = "admin,workers-ai,memory,email,notifier"`);
  lines.push(`ALLOWED_HOSTS = ""`);
  lines.push(`AGENT_NAME = "Helm"`);
  if (input.ownerEmail) lines.push(`AGENT_OWNER_EMAIL = "${input.ownerEmail}"`);
  if (input.ownerEmail) lines.push(`OWNER_EMAIL = "${input.ownerEmail}"`);
  if (input.fromEmail) lines.push(`FROM_EMAIL = "${input.fromEmail}"`);
  if (input.access) lines.push(`CF_ACCESS_TEAM_DOMAIN = "${input.access.teamDomain}"`);
  // CF_ACCESS_AUD goes in via `wrangler secret put` — see commands.
  lines.push("");
  lines.push("[ai]");
  lines.push(`binding = "AI"`);
  lines.push("");
  lines.push("[[durable_objects.bindings]]");
  lines.push(`name = "AGENT_SESSIONS"`);
  lines.push(`class_name = "AgentSessionDO"`);
  lines.push("");
  lines.push("[[durable_objects.bindings]]");
  lines.push(`name = "STREAM_HUBS"`);
  lines.push(`class_name = "StreamHubDO"`);
  lines.push("");
  lines.push("[[migrations]]");
  lines.push(`tag = "v1"`);
  lines.push(`new_sqlite_classes = ["AgentSessionDO"]`);
  lines.push("");
  lines.push("[[migrations]]");
  lines.push(`tag = "v2"`);
  lines.push(`new_classes = ["StreamHubDO"]`);
  if (input.d1) {
    lines.push("");
    lines.push("[[d1_databases]]");
    lines.push(`binding = "DB"`);
    lines.push(`database_name = "${input.d1.name}"`);
    lines.push(`database_id = "${input.d1.uuid}"`);
  }
  return lines.join("\n") + "\n";
}

/* ---------------- CLI command rendering ---------------- */

interface CommandRenderInput {
  workerName: string;
  secrets: Record<string, string | undefined>;
}

/**
 * Returns a list of paste-ready commands the user runs locally to finish.
 * Order matters: secrets must be set before the first wrangler deploy if
 * the Worker code reads them at module-init time.
 */
export function renderFinalCommands(input: CommandRenderInput): string[] {
  const out: string[] = [];
  out.push("# 1. From your fork's repo root, paste the wrangler.toml above into wrangler.toml.");
  out.push("");
  out.push("# 2. Set every secret you supplied. Each command prompts for the value.");
  for (const [name, value] of Object.entries(input.secrets)) {
    if (!value) continue;
    out.push(`echo "${shellEscape(value)}" | wrangler secret put ${name}`);
  }
  out.push("");
  out.push("# 3. Deploy.");
  out.push("npx wrangler deploy");
  return out;
}

function shellEscape(value: string): string {
  // Conservative — strips characters that would terminate a double-quoted string.
  // The user can always edit the command if they have a fancier secret.
  return value.replace(/[`"$\\]/g, "");
}

/**
 * Map a Cloudflare API error message + code into actionable recovery copy.
 *
 * Three top error patterns we see, all showing as "Authentication error" or
 * similar generic text:
 *   1. Token missing the required permission group, because the
 *      "create custom token" pre-fill URL silently dropped it. Until
 *      v0.7.0 our URL used the dotted format
 *      `com.cloudflare.api.account.d1:edit` which CF's dash does NOT parse —
 *      it silently produces an empty form. CF's actual contract is a
 *      URL-encoded JSON array of `{key, type}` objects with SHORT keys
 *      (`d1`, `workers_scripts`, `access`, etc).
 *      Users on stale token links: re-create from the current deploy page.
 *   2. Token DOES have the right scope but is restricted to the wrong
 *      account under "Account Resources" during token creation.
 *   3. Token is genuinely valid for verify but lacks the per-feature scope
 *      (e.g. token has Workers Scripts but not D1).
 *
 * The user's CF dash provides no easy way to inspect a token's scopes
 * after creation, so we recommend re-creating from the current pre-filled
 * link rather than trying to debug the existing token.
 */
export function explainCfError(
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
  const acctTail = accountId.slice(0, 8);
  if (looksLikeAuth) {
    return [
      `This usually means the token doesn't have "${expectedScope}".`,
      ``,
      `If you created the token before v0.7.0, the pre-fill URL we used was`,
      `silently broken — CF's dash dropped most/all of the scopes and you got`,
      `an empty token form. Re-create from the deploy form's link (it now uses`,
      `the correct JSON format) and you should see all 5 perms pre-filled.`,
      ``,
      `Other possibilities:`,
      `  • Token's "Account Resources" filter excludes account ${acctTail}….`,
      `    During token creation set Account Resources → Include → All accounts.`,
      `  • CF API code: ${apiCode ?? "n/a"}.`
    ].join("\n");
  }
  if (lower.includes("not found") || lower.includes("does not exist")) {
    return `Resource not found for this token. Most likely cause: token's "Account Resources" filter excludes account ${acctTail}… Re-create with Account Resources → All accounts.`;
  }
  return `If retrying doesn't help: re-create the token with the deploy form's pre-filled scope link, and set Account Resources → All accounts.`;
}
