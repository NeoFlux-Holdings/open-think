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
  createAccessPolicy,
  enableWorkersDevSubdomain,
  ensureAccessApp,
  ensureAiGateway,
  ensureD1Database,
  ensureR2Bucket,
  ensureWorkerSecret,
  flattenMigrationsForCfApi,
  getAccessOrganization,
  getAccountWorkersSubdomain,
  getUserDetails,
  listAccounts,
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
  /**
   * Optional progress callback fired after each `steps.push(...)` (whether
   * the step succeeded, failed, or warned). Used by the streaming deploy
   * endpoint to flush each step to the client as it lands instead of
   * holding the whole result until the end. Errors thrown by the callback
   * are swallowed — progress is best-effort and shouldn't break a deploy.
   *
   * Also fires before-the-step with `phase: "running"` for long-running
   * stages (Worker upload, secret loop, strict-mode poll) so the UI can
   * show what we're currently waiting on instead of a silent pause.
   */
  onProgress?: (event: ProgressEvent) => void | Promise<void>;
}

/**
 * Event shape emitted to onProgress. Two variants:
 *   - `{ phase: "step", step }` — a step has been pushed; render it.
 *   - `{ phase: "running", kind, summary }` — a long-running stage just
 *     started. The UI can show a pulsing "currently doing X" row that
 *     gets replaced when the matching step lands.
 */
export type ProgressEvent =
  | { phase: "step"; step: DeployStepResult }
  | { phase: "running"; kind: DeployStepResult["kind"]; summary: string };

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

/**
 * Resolve the deploy form's model-preset selection into a final
 * MODEL_DEFAULT id (with provider prefix when routed through OpenRouter).
 *
 * Provider precedence inside the conductor's selectProvider is:
 *   openrouter > anthropic > workers-ai > cf-ai-gateway > openai-compatible
 *
 * So we shape MODEL_DEFAULT to match whichever credential the user
 * actually pasted. When their preset can't be reached with what they
 * provided, we fall back to a working alternative + return a `warning`
 * the caller surfaces in the deploy log.
 *
 * Workers AI Kimi K2.6 default: `@cf/moonshotai/kimi-k2.6` IS in CF's
 * catalogue and supports tools. We default to it for the zero-key path
 * because it's the best free-tier chat model on Workers AI. We use the
 * BARE id (no `workers-ai/` prefix) so the request goes direct via the
 * Workers AI binding (`env.AI`) instead of through cf-ai-gateway. AI
 * Gateway adds an HTTP hop + occasionally surfaces transient
 * `code:2019 "Chat completion bad format"` errors that the direct
 * binding doesn't have. Customers who want gateway-style observability
 * can prefix the model id manually — the runtime honors both.
 *
 * Examples:
 *   preset=kimi-k2.6,  hasOR=true   → "moonshotai/kimi-k2.6" (OR direct, lower latency)
 *   preset=kimi-k2.6,  !hasOR       → "@cf/moonshotai/kimi-k2.6" (Workers AI direct, free)
 *   preset=opus-4.7,   hasAnth=true → "claude-opus-4-7" (Anthropic direct)
 *   preset=opus-4.7,   hasOR=true   → "anthropic/claude-opus-4-7" (via OR)
 *   preset=gpt-5.5,    hasOR=true   → "openai/gpt-5.5"
 *   preset=gpt-5.5,    !hasOR       → fallback to Kimi direct + warning
 */
export function resolveModelPreset(input: {
  preset?: "kimi-k2.6" | "gpt-5.5" | "opus-4.7" | "sonnet-4.6" | "custom";
  customModelId?: string;
  /** Legacy field — kept so existing test fixtures keep working. */
  legacyOpenRouterModel?: string;
  hasOpenRouter: boolean;
  hasAnthropic: boolean;
  /**
   * Kept for back-compat with the deploy form's input shape, but no
   * longer affects the model id we choose: the bare `@cf/...` id always
   * wins over the `workers-ai/@cf/...` gateway-routed form. Customers
   * who want AI Gateway observability can prefix manually.
   */
  hasAiGateway: boolean;
}): { modelId: string; warning?: string } {
  // Workers AI direct via env.AI binding. The `workers-ai/` prefix
  // would route through cf-ai-gateway, which is an extra HTTP hop AND
  // the code:2019 source we've been chasing — bypassing AI Gateway
  // makes chat work out of the box.
  const fallbackKimi = "@cf/moonshotai/kimi-k2.6";

  // Custom branch: trust the user's input verbatim. They picked the
  // advanced path; let them pin whatever id they want.
  if (input.preset === "custom") {
    if (input.customModelId && input.customModelId.trim()) {
      return { modelId: input.customModelId.trim() };
    }
    return {
      modelId: fallbackKimi,
      warning: "Custom model selected but no id provided — falling back to Kimi K2.6 via Workers AI."
    };
  }

  // No preset specified: respect the legacy openRouterDefaultModel
  // field first (older clients that hadn't migrated to presets), then
  // fall through to Kimi.
  if (input.preset === undefined) {
    if (input.legacyOpenRouterModel && input.hasOpenRouter) {
      return { modelId: input.legacyOpenRouterModel };
    }
    if (input.hasOpenRouter) return { modelId: "moonshotai/kimi-k2.6" };
    return { modelId: fallbackKimi };
  }

  // Kimi K2.6: prefer OR direct (lower latency, better caching) when a
  // key is pasted; otherwise the free CF Workers AI path.
  if (input.preset === "kimi-k2.6") {
    if (input.hasOpenRouter) return { modelId: "moonshotai/kimi-k2.6" };
    return { modelId: fallbackKimi };
  }

  if (input.preset === "gpt-5.5") {
    if (input.hasOpenRouter) return { modelId: "openai/gpt-5.5" };
    return {
      modelId: fallbackKimi,
      warning: "GPT-5.5 needs an OpenRouter API key (we don't ship a direct-OpenAI provider yet). Falling back to Kimi K2.6 via Workers AI for now — paste an OpenRouter key + re-deploy to switch."
    };
  }

  if (input.preset === "opus-4.7") {
    if (input.hasAnthropic) return { modelId: "claude-opus-4-7" };
    if (input.hasOpenRouter) return { modelId: "anthropic/claude-opus-4-7" };
    return {
      modelId: fallbackKimi,
      warning: "Claude Opus 4.7 needs an Anthropic or OpenRouter API key. Falling back to Kimi K2.6 via Workers AI."
    };
  }

  if (input.preset === "sonnet-4.6") {
    if (input.hasAnthropic) return { modelId: "claude-sonnet-4-6" };
    if (input.hasOpenRouter) return { modelId: "anthropic/claude-sonnet-4-6" };
    return {
      modelId: fallbackKimi,
      warning: "Claude Sonnet 4.6 needs an Anthropic or OpenRouter API key. Falling back to Kimi K2.6 via Workers AI."
    };
  }

  // Legacy field: respected when no preset was sent (older clients).
  if (input.legacyOpenRouterModel && input.hasOpenRouter) {
    return { modelId: input.legacyOpenRouterModel };
  }
  return { modelId: fallbackKimi };
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
 * Non-fatal "step succeeded with a caveat" helper. The deploy continues;
 * the UI renders these with ⚠ (amber) instead of ✗ (red).
 *
 * Use this for things like AI Gateway / Access org lookup that we'd LIKE
 * to do but don't strictly need — the user can ignore the warning, paste
 * an API key, and chat still works.
 */
function warningStep(
  kind: DeployStepResult["kind"],
  summary: string,
  warning: string,
  data?: Record<string, unknown>
): DeployStepResult {
  return { kind, ok: true, summary, data, warning };
}

/**
 * Verify the token and return the accounts the caller can deploy into.
 * The UI calls this first, then asks the user to pick an account.
 *
 * Also returns the token-owner's email when the token has the
 * "User Details:Read" scope (which our pre-filled token URL includes).
 * The deploy form pre-fills the owner-email field with this so the user
 * doesn't have to type their address — they can just hit Deploy.
 * Best-effort: a missing/redacted email isn't an error.
 */
export async function verifyAndListAccounts(
  token: string,
  options: FlowOptions = {}
): Promise<{ ok: boolean; accounts: CfAccount[]; userEmail?: string; error?: string }> {
  const verify = await verifyToken(token, options);
  if (!verify.success) {
    return {
      ok: false,
      accounts: [],
      error: verify.errors?.[0]?.message ?? "token verification failed"
    };
  }
  // Fire account-list and user-details in parallel — both cheap reads,
  // shaves ~150-300ms off the verify-token round-trip on a clean run.
  const [accounts, user] = await Promise.all([
    listAccounts(token, options),
    getUserDetails(token, options)
  ]);
  if (!accounts.success) {
    return {
      ok: false,
      accounts: [],
      error: accounts.errors?.[0]?.message ?? "could not list accounts (token missing Account Settings:Read?)"
    };
  }
  return {
    ok: true,
    accounts: accounts.result ?? [],
    // /user requires User Details:Read; if the token's missing it,
    // user.success is false and we just don't pre-fill — not an error.
    ...(user.success && user.result?.email ? { userEmail: user.result.email } : {})
  };
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

  /**
   * Wrap `steps.push` so each step is also flushed to the progress
   * channel as it lands. Avoids touching every call site (~40 of them).
   * Fire-and-forget: the next step won't await the progress write, but
   * the underlying TransformStream queues writes in order so the client
   * still sees them in the right sequence.
   */
  if (options.onProgress) {
    const origPush = Array.prototype.push.bind(steps) as (...items: DeployStepResult[]) => number;
    (steps as { push: typeof origPush }).push = (...items: DeployStepResult[]) => {
      const r = origPush(...items);
      for (const s of items) {
        Promise.resolve(options.onProgress!({ phase: "step", step: s })).catch(() => undefined);
      }
      return r;
    };
  }

  /**
   * Announce a long-running stage. The UI renders a pulsing row with
   * this summary; when the matching `step` event arrives, the row gets
   * replaced. No-op when no progress channel is hooked up.
   */
  async function announceRunning(kind: DeployStepResult["kind"], summary: string): Promise<void> {
    if (options.onProgress) {
      try {
        await options.onProgress({ phase: "running", kind, summary });
      } catch {
        /* progress is best-effort */
      }
    }
  }

  // --- 1. Verify the token works against the chosen account ---
  await announceRunning("verify-token", "Verifying Cloudflare token…");
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

  // --- 1.5. Resolve the account's workers.dev subdomain ---
  // CF Workers live at <script>.<account-subdomain>.workers.dev — NOT
  // <script>.workers.dev (a common bug we used to ship). Look it up once
  // here and reuse the full host downstream for: the Access destination
  // URI, the success message, the workerUrl response field, the wrangler.toml
  // we hand back, and the post-deploy "visit it at" link.
  const subRes = await getAccountWorkersSubdomain(req.token, acc, options);
  let workerHost = `${name}.workers.dev`; // pessimistic fallback
  let workerSubdomain = "";
  if (subRes.success && subRes.result?.subdomain) {
    workerSubdomain = subRes.result.subdomain;
    workerHost = `${name}.${workerSubdomain}.workers.dev`;
  } else {
    // Account hasn't initialized its workers.dev subdomain yet (rare on
    // an account that's deployed Workers before; common on fresh CF
    // accounts). Surface a clear pointer; deploy continues and the URL
    // we advertise may need a manual subdomain init via the dash.
    steps.push(step("verify-token", true,
      `couldn't resolve account workers.dev subdomain — using fallback`,
      { fallback: workerHost },
      `GET /accounts/${acc}/workers/subdomain returned no subdomain. Visit dash → Workers & Pages → click any worker → Settings → Triggers and pick a subdomain. Then redeploy or open ${name}.<your-subdomain>.workers.dev directly.`
    ));
  }

  await announceRunning("create-d1", "Looking up Workers subdomain…");

  // --- 2. Optional: create a D1 database for the PA stack ---
  let d1Id: string | undefined;
  let d1Name: string | undefined;
  if (req.enableD1) {
    const dbName = `${name}-pa`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
    await announceRunning("create-d1", `Provisioning D1 database \`${dbName}\`…`);
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
    steps.push(step("create-d1", true, `D1 database: ${d1Name}`, {
      uuid: d1Id,
      name: d1Name,
      reused: d1.reused === true
    }));
  }

  // --- 3. Optional: look up the Access team domain ---
  // We don't create the Access app here. Empirically CF's API requires
  // the Worker script to exist before it accepts an Access destination
  // pointing at the Worker's URL — a fresh `*.workers.dev` URL with no
  // script behind it hits "domain does not belong to zone". So we defer
  // the actual app creation until AFTER the Worker upload (see step 6 →
  // runDirectDeploy → access creation). Step 3 just resolves the team
  // domain once so we have it ready to attach when we create the app.
  let accessAud: string | undefined;
  let accessTeamDomain: string | undefined;
  if (req.enableAccess && req.secrets?.OWNER_EMAIL) {
    await announceRunning("create-access-app", "Looking up Cloudflare Access team domain…");
    const org = await getAccessOrganization(req.token, acc, options);
    if (!org.success || !org.result?.auth_domain) {
      const apiMsg = org.errors?.[0]?.message ?? "no auth_domain";
      const apiCode = org.errors?.[0]?.code;
      const isEmptyDomain = org.success && !org.result?.auth_domain;
      // Non-fatal: Access is optional. Surface as a warning so the UI
      // shows ⚠ (continue) rather than ✗ (broken). Recovery copy is
      // terse — links the user to the most-likely fix.
      const warning = isEmptyDomain
        ? "Zero Trust team name not set. Set one at dash → Zero Trust → Settings → General (free tier, ~1 minute), then re-deploy."
        : apiCode === 10000 || /authentication|permission|forbidden/i.test(apiMsg)
          ? `Token missing "Cloudflare Zero Trust:Read" or its Account Resources excludes account ${acc.slice(0, 8)}…. Re-create the token from the deploy form's link (it pre-fills the right scopes), set Account Resources → Include All accounts, then re-deploy.`
          : `Cloudflare returned: "${apiMsg}" (code ${apiCode ?? "n/a"}). Access setup skipped; deploy continues.`;
      steps.push(warningStep("create-access-app",
        isEmptyDomain
          ? "Access skipped — team name not set in Zero Trust"
          : `Access skipped — org lookup failed (${apiMsg})`,
        warning));
      // Don't abort — Access is optional. Continue without it.
    } else {
      accessTeamDomain = `https://${org.result.auth_domain}`;
    }
  }

  // --- 3.5. AI Gateway: provision so chat works without an API key ---
  // Without a gateway, the deployed Worker has no streaming-tool provider
  // unless the user pasted an OpenRouter / Anthropic / OpenAI key. The
  // gateway path uses Workers AI free quota — `MODEL_DEFAULT =
  // workers-ai/@cf/openai/gpt-oss-120b` routes through this gateway via
  // the cf-ai-gateway plugin's compat endpoint. Idempotent across re-runs.
  //
  // Best-effort: if the token's missing "AI Gateway:Edit" we render a
  // ⚠ and continue. Chat will still work if the user pasted any other
  // provider key (or they can re-create the token + re-deploy).
  let aiGatewayId: string | undefined;
  {
    // Use the worker name as the gateway id for findability — one Worker
    // → one gateway. ensureAiGateway normalizes (lowercase, hyphens) +
    // recovers on "already exists".
    await announceRunning("create-ai-gateway", "Provisioning Cloudflare AI Gateway…");
    const gw = await ensureAiGateway(req.token, acc, name, options);
    if (gw.success && gw.result?.id) {
      aiGatewayId = gw.result.id;
      steps.push(step("create-ai-gateway", true,
        `AI Gateway: ${aiGatewayId}`,
        { gatewayId: aiGatewayId, reused: gw.reused === true }));
    } else {
      const apiMsg = gw.errors?.[0]?.message ?? "unknown";
      const apiCode = gw.errors?.[0]?.code;
      // Common case: the user's token predates the v0.13 deploy form, so
      // it doesn't have the "AI Gateway:Edit" scope. Show one terse line
      // pointing them at the fix; chat still works if they pasted an
      // OpenRouter / Anthropic / OpenAI key.
      const isAuthError =
        apiCode === 10000 || apiCode === 9109 ||
        /authentication|permission|forbidden|unauthorized/i.test(apiMsg);
      const warning = isAuthError
        ? `Token missing "AI Gateway:Edit". Re-create the token from the deploy form's link (it now pre-fills this scope) and re-deploy. Alternative: paste an OPENROUTER_API_KEY in the form — chat works without the gateway when any provider key is set.`
        : `Cloudflare returned: "${apiMsg}" (code ${apiCode ?? "n/a"}). Without the gateway, chat needs OPENROUTER_API_KEY (or another provider key).`;
      steps.push(warningStep("create-ai-gateway",
        `AI Gateway skipped — chat will need an API key`,
        warning));
    }
  }

  // --- 3.7. R2 bucket: provision so /persist/* works out of the box ---
  // The deployed Worker's /persist/* endpoint reads env.WORKSPACE (R2);
  // without a bucket, the Files tab in /app + the Helm Shell's file
  // browser both 503 with E_WORKSPACE_BINDING_MISSING. R2 has a 10 GB
  // free tier so always-on auto-provisioning is the right default.
  //
  // Best-effort: Workers R2 Storage:Edit is in TOKEN_SCOPES, but stale
  // tokens may be missing it. We render a ⚠ and continue — the Worker
  // still deploys, /persist just stays inert until the bucket is added.
  let r2BucketName: string | undefined;
  {
    const bucketName = `${name}-workspace`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
    await announceRunning("set-secret", `Provisioning R2 bucket \`${bucketName}\` for /persist…`);
    const r2 = await ensureR2Bucket(req.token, acc, bucketName, options);
    if (r2.success && r2.result?.name) {
      r2BucketName = r2.result.name;
      steps.push(step("set-secret", true,
        `R2 bucket: ${r2BucketName}`,
        { bucketName: r2BucketName, reused: r2.reused === true }));
    } else {
      const apiMsg = r2.errors?.[0]?.message ?? "unknown";
      const apiCode = r2.errors?.[0]?.code;
      const isAuthError =
        apiCode === 10000 || apiCode === 9109 ||
        /authentication|permission|forbidden|unauthorized/i.test(apiMsg);
      const warning = isAuthError
        ? `Token missing "Workers R2 Storage:Edit". Re-create the token from the deploy form's link (it pre-fills this scope) and re-deploy. Without R2, /persist + the Files tab in /app will return 503 — chat still works.`
        : `Cloudflare returned: "${apiMsg}" (code ${apiCode ?? "n/a"}). /persist + Files will be inert until a bucket is provisioned manually at dash → R2 → Create bucket, named "${bucketName}".`;
      steps.push(warningStep("set-secret",
        `R2 bucket skipped — /persist + Files tab will 503`,
        warning));
    }
  }

  // --- 3.9. Resolve model preset → MODEL_DEFAULT id ---
  // Done before composeWranglerToml so the local-fallback wrangler.toml
  // matches what the direct upload would have set. Surface a warning
  // step when the user picked a preset their pasted keys can't reach
  // (e.g. "GPT-5.5 selected but no OpenRouter key" → falls back to Kimi).
  const resolvedModel = resolveModelPreset({
    preset: req.modelPreset,
    customModelId: req.customModelId,
    legacyOpenRouterModel: req.openRouterDefaultModel,
    hasOpenRouter: !!req.secrets?.OPENROUTER_API_KEY,
    hasAnthropic: !!req.secrets?.ANTHROPIC_API_KEY,
    hasAiGateway: !!aiGatewayId
  });
  if (resolvedModel.warning) {
    steps.push(warningStep("set-secret",
      `Default model fallback · using ${resolvedModel.modelId}`,
      resolvedModel.warning));
  }

  // --- 4. Compose wrangler.toml ---
  const wranglerToml = composeWranglerToml({
    workerName: name,
    accountId: acc,
    d1: d1Id ? { uuid: d1Id, name: d1Name ?? `${name}-pa` } : null,
    r2BucketName,
    access: accessAud && accessTeamDomain
      ? { aud: accessAud, teamDomain: accessTeamDomain }
      : null,
    ownerEmail: req.secrets?.OWNER_EMAIL,
    fromEmail: req.secrets?.FROM_EMAIL,
    openRouterDefaultModel: resolvedModel.modelId
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
  // This is the slow part: fetch the bundle from GitHub Releases (~1-3s)
  // then PUT the multipart form to api.cloudflare.com (~10-30s on big
  // bundles). The announceRunning hint here gives the UI a "uploading
  // bundle…" placeholder for the longest single phase of the deploy.
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
    await announceRunning("fetch-bundle", "Fetching the latest Helm bundle…");
    const directResult = await runDirectDeploy({
      onProgress: options.onProgress,
      token: req.token,
      accountId: acc,
      workerName: name,
      manifestUrl: options.directDeploy.manifestUrl,
      d1: d1Id ? { uuid: d1Id, name: d1Name ?? `${name}-pa` } : null,
      r2BucketName,
      // Pass teamDomain only — accessAud doesn't exist yet. The aud is
      // created post-upload (step 6.5 below) once the Worker script is
      // registered with CF, which is when the Access API will accept a
      // workers.dev destination.
      access: accessTeamDomain ? { aud: undefined, teamDomain: accessTeamDomain } : null,
      secrets: { ...(req.secrets ?? {}) } as Record<string, string | undefined>,
      ownerEmail: req.secrets?.OWNER_EMAIL,
      fromEmail: req.secrets?.FROM_EMAIL,
      fetchImpl: options.fetchImpl,
      modelDefault: resolvedModel.modelId,
      modelReasoningEffort: req.modelReasoningEffort,
      skipSelfAdminToken: req.skipSelfAdminToken,
      aiGatewayId,
      workerHost
    });
    steps.push(...directResult.steps);
    if (directResult.ok) {
      directDeployed = true;
      buildSha = directResult.buildSha;
    }
  }

  // --- 6.5. Post-upload Access creation ---
  // The Worker script now exists. CF's Access API will accept a
  // workers.dev destination only when the script is registered — that's
  // why creating the Access app pre-upload returned "domain does not
  // belong to zone". Now that the Worker is live, try the create.
  if (directDeployed && req.enableAccess && accessTeamDomain && req.secrets?.OWNER_EMAIL) {
    await announceRunning("create-access-app", "Creating Cloudflare Access app + email policy…");
    const app = await ensureAccessApp(
      req.token,
      acc,
      { name: `Helm — ${name}`, domain: workerHost, sessionDuration: "24h" },
      { fetchImpl: options.fetchImpl }
    );
    if (!app.success || !app.result?.aud) {
      const apiMsg = app.errors?.[0]?.message ?? "unknown";
      const apiCode = app.errors?.[0]?.code;
      const isDomainZoneError = /domain does not belong to zone/i.test(apiMsg);
      const isAlreadyExists = /application_already_exists|already exists/i.test(apiMsg);
      const recovery = isDomainZoneError
        ? [
            `Cloudflare returned "domain does not belong to zone" for ${workerHost} even though the Worker is live. This sometimes happens on the first deploy of a new account.`,
            ``,
            `Two ways to recover:`,
            `  1. Visit dash → Workers & Pages → ${name} → Settings → Domains & Routes → "Enable Cloudflare Access". The dashboard's one-click button uses an internal API that always works on workers.dev.`,
            `  2. Re-run the lockdown wizard at https://${workerHost}/app#/settings — it talks to the same API but from inside the running Worker, which sometimes succeeds where the deploy form doesn't.`,
            `  3. Skip Access; the Worker keeps running in first-run permissive mode.`
          ].join("\n")
        : isAlreadyExists
          ? [
              `An Access app already exists at ${workerHost}, but we couldn't read it back to reuse its AUD. The most likely cause is the API token missing "Access: Apps and Policies:Edit" read scope on this account.`,
              ``,
              `Two ways to recover:`,
              `  1. Recreate the token with the deploy form's pre-filled scope link, set Account Resources → "Include All accounts", and retry. The wizard will then list + reuse the existing app instead of trying to create a duplicate.`,
              `  2. Delete the existing app at dash → Zero Trust → Access → Applications → "Helm — ${name}" → Delete, then retry. (Only if you don't have other agents pointing at the same app.)`
            ].join("\n")
          : explainCfError(apiMsg, apiCode, "Access: Apps and Policies:Edit", acc);
      steps.push(step("create-access-app", false, `Access app create failed · ${apiMsg}`, undefined,
        `${apiMsg}\n\n${recovery}`));
    } else {
      accessAud = app.result.aud;
      const reused = app.reused === true;
      // Build the full allowlist: owner email first, then any extras the
      // user typed in the deploy form. De-dupe + drop empties so a user
      // who typed their own email twice doesn't generate a duplicate
      // policy include entry.
      const additionalEmails = Array.isArray(req.additionalAllowedEmails)
        ? req.additionalAllowedEmails
        : [];
      const policyEmails = Array.from(new Set(
        [req.secrets.OWNER_EMAIL, ...additionalEmails]
          .map((e) => (typeof e === "string" ? e.trim() : ""))
          .filter((e) => e.length > 0 && e.includes("@"))
      ));
      const emailSummary = policyEmails.length === 1
        ? policyEmails[0]
        : `${policyEmails[0]} +${policyEmails.length - 1} more`;

      // When the Access app was reused (i.e. it already existed), assume
      // the policy is already in place too — re-running createAccessPolicy
      // would either 409 (policy duplicate) or quietly add a redundant
      // include entry. Skip the round-trip entirely for re-deploys.
      // We only POST a policy on FIRST app creation.
      let policyOk = true;
      let policyErrMsg = "";
      let policyErrCode: number | undefined;
      let policyId: string | undefined;
      if (!reused) {
        // CRITICAL: without a policy, CF Access rejects ALL emails by
        // default — the user sees the login page, types their email,
        // and never gets an OTP. Silent failure mode; we ALWAYS attach
        // a policy to a freshly-created app.
        const policy = await createAccessPolicy(
          req.token, acc, app.result.id, policyEmails,
          { fetchImpl: options.fetchImpl }
        );
        const polMsg = policy.errors?.[0]?.message ?? "";
        const isPolicyDuplicate = /already_exists|already exists|duplicate/i.test(polMsg);
        // Treat duplicate as success — same end state.
        policyOk = policy.success || isPolicyDuplicate;
        policyId = policy.result?.id;
        policyErrMsg = polMsg;
        policyErrCode = policy.errors?.[0]?.code;
      }

      if (!policyOk) {
        steps.push(step("create-access-app", false,
          `Access app created but policy FAILED · ${policyErrMsg}`,
          { appId: app.result.id, aud: accessAud, teamDomain: accessTeamDomain, domain: workerHost, reused },
          `${policyErrMsg}\n\nThe Access app exists (aud=${accessAud.slice(0, 12)}…) but has NO policy attached, which means CF Access rejects ALL emails by default — including yours. That's why you're not getting a verification email.\n\nFix:\n  1. Dash → Zero Trust → Access → Applications → "Helm — ${name}" → Policies → Add policy → Allow → Include ${policyEmails.map((e) => `"${e}"`).join(", ")} → Save.\n  2. Or delete the app and re-run the lockdown wizard at https://${workerHost}/app#/settings.\n\n${explainCfError(policyErrMsg, policyErrCode, "Access: Apps and Policies:Edit", acc)}`
        ));
      } else {
        // Single concise summary: "Access ready" for re-deploys (app was
        // reused), "Access set up" on first deploy. The detailed payload
        // (aud, app id, allowed emails) is in step.data for debugging.
        steps.push(step("create-access-app", true,
          reused
            ? `Access ready · gates ${emailSummary}`
            : `Access set up · gates ${emailSummary}`,
          {
            appId: app.result.id,
            aud: accessAud,
            policyId,
            teamDomain: accessTeamDomain,
            domain: workerHost,
            allowedEmails: policyEmails,
            reused
          }));
      }
      // Push CF_ACCESS_AUD as a secret on the live Worker. Without this
      // the deployed agent can't enforce Access (CF_ACCESS_TEAM_DOMAIN
      // alone isn't enough — auth.ts checks both). Uses ensureWorkerSecret
      // so a stale plain_text binding (rare; possible if the user
      // hand-edited Variables to debug) gets a clear recovery message
      // instead of an opaque 10053.
      const audPut = await ensureWorkerSecret(
        req.token, acc, name, "CF_ACCESS_AUD", accessAud,
        { fetchImpl: options.fetchImpl }
      );
      if (!audPut.success) {
        const errMsg = audPut.errors?.[0]?.message ?? "secret put failed";
        steps.push(step("set-secret", false,
          `secret CF_ACCESS_AUD: failed · ${errMsg}`,
          undefined,
          audPut.recovery ?? `Access app was created (aud=${accessAud.slice(0, 12)}…) but persisting CF_ACCESS_AUD as a Worker secret failed. Set it via /app#/settings → Manage secrets, or run \`wrangler secret put CF_ACCESS_AUD\` locally with the value above.`
        ));
      }
      // Push the full allowlist to the Worker as CF_ACCESS_ALLOWED_EMAILS.
      // auth.ts uses this as a defence-in-depth check on top of CF Access
      // (CF Access is the primary gate; the env-var check catches a misconfigured
      // policy that accidentally lets in extra emails). Not strictly required —
      // a missing allowlist falls through to the OWNER_EMAIL solo path.
      if (policyEmails.length > 0) {
        const emailsPut = await ensureWorkerSecret(
          req.token, acc, name, "CF_ACCESS_ALLOWED_EMAILS", policyEmails.join(","),
          { fetchImpl: options.fetchImpl }
        );
        if (!emailsPut.success) {
          const errMsg = emailsPut.errors?.[0]?.message ?? "secret put failed";
          steps.push(step("set-secret", false,
            `secret CF_ACCESS_ALLOWED_EMAILS: failed · ${errMsg}`,
            undefined,
            emailsPut.recovery ?? `The Access app + policy were created (allowing ${policyEmails.length} email${policyEmails.length === 1 ? "" : "s"}), but persisting CF_ACCESS_ALLOWED_EMAILS to the Worker failed. CF Access still gates the URL — the Worker just won't enforce a defence-in-depth email check on top. Set it manually at dash → Workers & Pages → ${name} → Settings → Variables (value: ${policyEmails.join(",")}).`
          ));
        }
      }
      // Note: success row for CF_ACCESS_AUD is now folded into the
      // create-access-app step's summary above (clearer narrative
      // when both succeed) — only push a separate step on failure.
    }
  } else if (req.enableAccess && req.secrets?.OWNER_EMAIL && !directDeployed) {
    // User asked for Access + we have an owner email + but Worker upload
    // didn't happen (local-fallback mode). Defer with a clear message.
    steps.push(step("create-access-app", true,
      `Access deferred — run the lockdown wizard at /app#/settings after \`wrangler deploy\` finishes`,
      { deferred: true, workerHost },
      `The Worker has to exist before CF will let us create an Access app for its workers.dev URL. Once your local \`wrangler deploy\` finishes, visit https://${workerHost}/app#/settings → Lock it down — same wizard, runs from inside the deployed Worker.`
    ));
  }

  // --- 6.7. Wait for strict-mode propagation ---
  // Setting CF_ACCESS_AUD (and the rest) triggers an automatic Worker
  // redeploy. Until that completes, the new env isn't visible to the
  // running process — `auth.configured` stays false on /setup/status, and
  // the user sees the open-deploy welcome page instead of the Access
  // login. This used to require the user to manually refresh; now we
  // poll up to 90s and surface the current state.
  if (directDeployed && req.enableAccess && accessAud) {
    await announceRunning("verify-strict", "Waiting for Cloudflare to redeploy the Worker (strict mode propagation)…");
    const ready = await pollForStrictMode(workerHost, options.fetchImpl);
    if (ready.ok) {
      steps.push(step("verify-strict", true,
        `Strict mode active (${(ready.elapsedMs / 1000).toFixed(0)}s)`,
        { elapsedMs: ready.elapsedMs }));
    } else {
      // Don't fail the deploy — the secrets are persisted, the redeploy
      // just hasn't landed yet. Surface a clear "give it another minute"
      // message instead of a scary error. Use the warning state so the
      // UI renders ⚠ instead of ✓ — the user needs to know to refresh.
      steps.push(warningStep("verify-strict",
        `Strict mode still propagating`,
        `Cloudflare is still rolling the new secrets to the Worker (~30s left). Once the welcome page is gone, /app will show the Access login. Refresh in a minute.`,
        { timedOut: true, elapsedMs: ready.elapsedMs }));
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
        workerUrl: `https://${workerHost}`,
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
    workerUrl: `https://${workerHost}`,
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
  /**
   * R2 bucket name (provisioned upstream by ensureR2Bucket). When set,
   * the upload adds an `r2_bucket` binding named WORKSPACE so the
   * deployed Worker's /persist + Files tab work without manual setup.
   */
  r2BucketName?: string;
  /**
   * Access info to bake into the upload. `teamDomain` may be present
   * before `aud` because we now create the Access app AFTER the Worker
   * upload (CF requires the script to exist). When only `teamDomain` is
   * present, the upload sets CF_ACCESS_TEAM_DOMAIN as a plain_text var;
   * CF_ACCESS_AUD is set as a secret post-creation in the caller.
   */
  access: { aud?: string; teamDomain: string } | null;
  secrets: Record<string, string | undefined>;
  ownerEmail?: string;
  fromEmail?: string;
  fetchImpl?: typeof fetch;
  /**
   * Progress channel forwarded from the parent runDeploy. When set,
   * each step pushed inside runDirectDeploy (fetch-bundle, upload-worker,
   * set-secret, enable-subdomain) is flushed to the streaming endpoint
   * as it lands instead of being held until runDirectDeploy returns.
   */
  onProgress?: FlowOptions["onProgress"];
  /**
   * Resolved MODEL_DEFAULT (e.g. `workers-ai/@cf/moonshotai/kimi-k2.6`,
   * `openai/gpt-5.5`, `claude-opus-4-7`). Computed upstream from the
   * deploy form's preset + which keys were pasted; runDirectDeploy
   * trusts it as the final value.
   */
  modelDefault?: string;
  /**
   * Optional reasoning effort. When set, written as MODEL_REASONING_EFFORT
   * plain_text var on the Worker. The runtime conductor consumes this when
   * it routes a chat request through providers that accept it (GPT-5.5,
   * Anthropic models with extended thinking).
   */
  modelReasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  /** Opt out of persisting CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / WORKER_SCRIPT_NAME secrets. */
  skipSelfAdminToken?: boolean;
  /**
   * AI Gateway id (provisioned upstream by ensureAiGateway). When set,
   * the upload writes AI_GATEWAY_ID + CLOUDFLARE_ACCOUNT_ID as
   * plain_text vars and adds `cf-ai-gateway` to ENABLED_PLUGINS so
   * the deployed Worker has a streaming-tools provider available
   * out of the box (no API key required — uses Workers AI).
   */
  aiGatewayId?: string;
  /**
   * The full Worker host: `<name>.<account-subdomain>.workers.dev` for
   * a default deploy, or a custom domain. Resolved upstream by runDeploy
   * via getAccountWorkersSubdomain so direct-deploy doesn't repeat the
   * /workers/subdomain lookup. Used in the success message + when the
   * caller advertises the URL.
   */
  workerHost: string;
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
  // Same monkey-patch as runDeploy: flush each step to the progress
  // channel as it's pushed so the streaming UI sees it in real time.
  if (input.onProgress) {
    const origPush = Array.prototype.push.bind(steps) as (...items: DeployStepResult[]) => number;
    (steps as { push: typeof origPush }).push = (...items: DeployStepResult[]) => {
      const r = origPush(...items);
      for (const s of items) {
        Promise.resolve(input.onProgress!({ phase: "step", step: s })).catch(() => undefined);
      }
      return r;
    };
  }
  async function announce(kind: DeployStepResult["kind"], summary: string): Promise<void> {
    if (input.onProgress) {
      try { await input.onProgress({ phase: "running", kind, summary }); } catch { /* ignore */ }
    }
  }

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

  if (input.r2BucketName) {
    // CF Workers Scripts API r2_bucket binding shape — same field name
    // (`bucket_name`) as wrangler.toml, just inside the `bindings` array.
    bindings.push({
      type: "r2_bucket",
      name: "WORKSPACE",
      bucket_name: input.r2BucketName
    });
  }

  // Plain-text vars (non-sensitive) — these match what composeWranglerToml
  // would have written under [vars]. Defaults are tuned so the deployed
  // Worker can self-administer immediately:
  //   - ALLOWED_HOSTS: canonical hostlist (Worker fails to boot when empty)
  //   - ENABLED_PLUGINS: full self-admin stack (cloudflare-admin +
  //     helm-setup + helm-artifacts + mcp-client) so /app can run
  //     Auto-setup, drift sync, and helm-* skills out of the box
  //   - MODEL_DEFAULT: openrouter/auto when an OPENROUTER_API_KEY was
  //     pasted (best chat default), else Workers AI as the no-key fallback
  // MODEL_DEFAULT comes pre-resolved from runDeploy (see resolveModelPreset
  // below). The legacy fallback chain (openrouter/auto if key, else CF
  // Workers AI) lives there now so the deploy form can also surface a
  // warning step when the user picks a model their key can't reach.
  // hasAiGateway only gates whether `cf-ai-gateway` joins the plugin
  // list below — NOT what model id we default to. Since we're now
  // sending bare `@cf/...` ids that route through the direct Workers
  // AI binding, the gateway plugin's only job is providing optional
  // observability for customers who explicitly opt in via a prefixed
  // model id at runtime.
  const hasAiGateway = !!input.aiGatewayId;
  // Default chat model: bare `@cf/moonshotai/kimi-k2.6` so requests
  // go through the direct Workers AI binding (env.AI) instead of
  // through cf-ai-gateway. The gateway path was the source of the
  // `code:2019 "Chat completion bad format"` errors we hit on
  // tomtom-claude. Customers who want AI Gateway observability can
  // prefix the model id manually — the conductor honors both shapes.
  const modelDefault = input.modelDefault ?? "@cf/moonshotai/kimi-k2.6";
  // ENABLED_PLUGINS must list ONLY plugin ids the published bundle
  // actually contains. The runtime throws E_PLUGIN_UNKNOWN on bootstrap
  // if it sees an enabled id with no registered plugin (older bundles
  // don't have the warn-and-filter tolerance fix from v0.11+).
  //
  // Bundle-aware: when the manifest exposes its `plugins` array
  // (build-bundle.mjs scans src/plugins/*.ts and emits the list), we
  // intersect our preferred default with what the bundle ships. That
  // way an older bundle silently drops newer plugin ids instead of
  // bricking the Worker; a newer bundle gets the full preferred set.
  //
  // Manifests built before the `plugins` field landed lack the array —
  // fall back to a v0.10.x-safe minimal set.
  // cf-ai-gateway is conditionally included: only when we successfully
  // provisioned a gateway (so AI_GATEWAY_ID + CLOUDFLARE_ACCOUNT_ID are
  // both set as vars). Without those, the plugin's initialize() throws
  // "AI_GATEWAY_ID required" and the runtime returns E_INTERNAL on every
  // chat request. Better to drop the plugin entirely than to ship the
  // Worker in a broken state.
  const preferredPlugins = [
    "admin",
    "helm-setup",
    "helm-artifacts",
    "helm-toml",
    "helm-github",
    "cloudflare-admin",
    "mcp-client",
    "workers-ai",
    ...(hasAiGateway ? ["cf-ai-gateway"] : []),
    "openrouter",
    "memory",
    "email",
    "notifier"
  ];
  const v010SafeFallback = [
    "admin",
    "helm-setup",
    "helm-toml",
    "helm-github",
    "cloudflare-admin",
    "mcp-client",
    "workers-ai",
    ...(hasAiGateway ? ["cf-ai-gateway"] : []),
    "openrouter",
    "memory",
    "email",
    "notifier"
  ];
  const enabledPluginsList = Array.isArray(manifest.plugins) && manifest.plugins.length > 0
    ? preferredPlugins.filter((p) => manifest.plugins!.includes(p))
    : v010SafeFallback;
  const vars: Record<string, string> = {
    MODEL_DEFAULT: modelDefault,
    ENABLED_PLUGINS: enabledPluginsList.join(","),
    ALLOWED_HOSTS:
      "api.cloudflare.com,mcp.cloudflare.com,api.anthropic.com,api.openai.com,openrouter.ai,api.github.com",
    AGENT_NAME: input.workerName
  };
  if (input.ownerEmail) {
    vars.AGENT_OWNER_EMAIL = input.ownerEmail;
    vars.OWNER_EMAIL = input.ownerEmail;
  }
  if (input.fromEmail) vars.FROM_EMAIL = input.fromEmail;
  if (input.access) vars.CF_ACCESS_TEAM_DOMAIN = input.access.teamDomain;
  // cf-ai-gateway plugin needs both AI_GATEWAY_ID + CLOUDFLARE_ACCOUNT_ID
  // to route chat through Workers AI on the user's account. Both are
  // public identifiers (not credentials) so plain_text is fine.
  // CLOUDFLARE_ACCOUNT_ID may also be set as a secret_text further down
  // (for self-admin); the secret_text would override at runtime — but
  // the conductor reads it via env.CLOUDFLARE_ACCOUNT_ID either way.
  if (input.aiGatewayId) {
    vars.AI_GATEWAY_ID = input.aiGatewayId;
    vars.CLOUDFLARE_ACCOUNT_ID = input.accountId;
  }
  // Helm Shell + helm REPL bindings. The Sandbox DO forwards these into
  // the sandbox container as env vars. With them set, the in-shell
  // `helm` command can call back into the Worker with bearer auth, and
  // (if a bucket exists) rclone-mounts /persist for cross-session files.
  //
  //   HELM_WORKER_HOST  — public hostname; the container uses this for
  //                       its callback URL. Public info, plain_text.
  //   R2_BUCKET         — name of the WORKSPACE bucket so rclone knows
  //                       what to mount. Public info, plain_text.
  //   R2_ACCOUNT_ID     — same as CLOUDFLARE_ACCOUNT_ID (rclone needs it
  //                       under this name specifically). Public info.
  //
  // R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY are NOT auto-provisioned
  // here yet — CF doesn't expose long-lived R2 S3 credentials via API.
  // The container falls back to ephemeral disk without them. Manual fix:
  // dash → R2 → Manage R2 API Tokens → create one for the bucket, then
  // `wrangler secret put R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`.
  vars.HELM_WORKER_HOST = input.workerHost;
  if (input.r2BucketName) {
    vars.R2_BUCKET = input.r2BucketName;
    if (!vars.CLOUDFLARE_ACCOUNT_ID) vars.CLOUDFLARE_ACCOUNT_ID = input.accountId;
  }
  // Stamp BUILD_SHA so the deployed Worker can introspect its own
  // version. helm-setup-update reads env.BUILD_SHA to decide whether
  // the upstream manifest is newer than what's running. The cloud-push
  // cron also re-stamps this on every push (see pushUpdates.ts).
  vars.BUILD_SHA = manifest.sha;
  // Reasoning effort for thinking-capable models. The runtime conductor
  // reads MODEL_REASONING_EFFORT and forwards it as `reasoning.effort`
  // (OpenAI/GPT-5.5) or maps it to `extended_thinking.budget` (Anthropic).
  // Only persist when explicitly set — empty/undefined means "use the
  // provider's default behavior", which is what we want for Kimi etc.
  if (input.modelReasoningEffort && input.modelReasoningEffort !== "none") {
    vars.MODEL_REASONING_EFFORT = input.modelReasoningEffort;
  }
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
  // Container metadata — ties DO classes (Sandbox, etc.) to their
  // container images so CF can materialize the DOs on first call. Without
  // this, env.Sandbox is bound but instantiation fails with "no container
  // associated with class". The image is a public registry ref resolved
  // by build-bundle.mjs from the canonical wrangler.toml's [[containers]]
  // blocks; we forward it verbatim so customer accounts pull directly.
  if (manifest.metadata.containers && manifest.metadata.containers.length > 0) {
    metadata.containers = manifest.metadata.containers;
  }

  await announce("upload-worker", `Uploading Worker bundle to Cloudflare (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)…`);
  let upload = await uploadWorkerScript(
    input.token,
    input.accountId,
    input.workerName,
    {
      metadata,
      mainModule: { name: manifest.metadata.main_module, bytes }
    },
    { fetchImpl }
  );

  // Migration tag auto-recovery. CF rejects the upload with
  //   "Actor migration tag precondition failed, got tag '' when expected tag is 'v6'"
  // when the script ALREADY exists at v6 but our metadata sends only
  // `new_tag` (no `old_tag`). We don't have a clean way to read the
  // current tag up-front, so we parse the expected tag out of the
  // error message and retry. Two cases:
  //   1. expected === new_tag → script is on the latest tag; drop the
  //      migrations field entirely (no migration to apply, just code).
  //   2. expected !== new_tag → script is on an older tag; set old_tag
  //      = expected so CF applies the diff.
  if (!upload.success) {
    const firstErr = upload.errors?.[0]?.message ?? "";
    const tagMismatch = /migration tag precondition failed.*expected tag is ['"]([^'"]+)['"]/i.exec(firstErr);
    if (tagMismatch && flatMigrations) {
      const expectedTag = tagMismatch[1];
      const newMetadata = { ...metadata };
      if (expectedTag === flatMigrations.new_tag) {
        // Same tag — script's already migrated. Just upload the code.
        delete (newMetadata as { migrations?: unknown }).migrations;
      } else {
        // Older tag — apply the diff with old_tag set.
        newMetadata.migrations = { ...flatMigrations, old_tag: expectedTag };
      }
      await announce("upload-worker", `Re-uploading with corrected migration tag (script already at ${expectedTag})…`);
      upload = await uploadWorkerScript(
        input.token,
        input.accountId,
        input.workerName,
        {
          metadata: newMetadata,
          mainModule: { name: manifest.metadata.main_module, bytes }
        },
        { fetchImpl }
      );
    }
  }

  if (!upload.success) {
    const errMsg = upload.errors?.[0]?.message ?? "upload failed";
    steps.push(step("upload-worker", false, "Worker upload failed", undefined, errMsg));
    return { ok: false, steps };
  }
  steps.push(step("upload-worker", true,
    `Worker live at ${input.workerHost}`,
    { id: upload.result?.id, etag: upload.result?.etag, workerUrl: `https://${input.workerHost}` }
  ));

  // e. Set sensitive secrets one at a time. We stop on the first failure
  // and let the caller decide — the script is already deployed and live;
  // missing secrets are recoverable via the manage page.
  // CF_ACCESS_AUD lives here too (Access app aud is sensitive).
  //
  // CRITICAL: we ALSO persist the deploy token + account id + script name
  // so the deployed Worker can self-administer (run cf-* skills, the
  // lockdown wizard, helm-setup-deploy from /app). Without these, the
  // Worker starts in a state where /app#/settings can't do anything and
  // the user has to paste their token a SECOND time. The token is
  // already privileged enough to deploy this Worker; persisting it for
  // self-admin is the same scope.
  const secretsToSet: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.secrets)) {
    if (!v) continue;
    // OWNER_EMAIL + FROM_EMAIL are non-sensitive vars (already inlined).
    if (k === "OWNER_EMAIL" || k === "AGENT_OWNER_EMAIL" || k === "FROM_EMAIL") continue;
    secretsToSet[k] = v;
  }
  if (input.access?.aud) secretsToSet.CF_ACCESS_AUD = input.access.aud;

  // Self-admin enablement secrets (opt-out via input.skipSelfAdminToken).
  if (!input.skipSelfAdminToken) {
    secretsToSet.CLOUDFLARE_API_TOKEN = input.token;
    secretsToSet.CLOUDFLARE_ACCOUNT_ID = input.accountId;
    secretsToSet.WORKER_SCRIPT_NAME = input.workerName;
  }

  // HELM_INTERNAL_TOKEN — high-entropy random secret used by:
  //   1. The Helm Shell container's `helm` CLI to call back into the
  //      conductor with bearer auth (bypasses the CF Access JWT path
  //      since the container doesn't have one).
  //   2. The CLI device-code login flow as the parent token to mint
  //      session tokens against.
  //   3. Any future "internal automation" path where we need a stable
  //      bearer that's NOT the customer's CF API token.
  //
  // Auto-generated per-deploy from 32 bytes of CSPRNG output, hex-encoded
  // (64 chars). We never log it; once stored as a Worker secret it lives
  // only inside the customer's account.
  if (!secretsToSet.HELM_INTERNAL_TOKEN) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    secretsToSet.HELM_INTERNAL_TOKEN = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  const secretCount = Object.keys(secretsToSet).length;
  if (secretCount > 0) {
    await announce("set-secret", `Setting ${secretCount} Worker secret${secretCount === 1 ? "" : "s"}…`);
  }
  for (const [k, v] of Object.entries(secretsToSet)) {
    const r = await ensureWorkerSecret(input.token, input.accountId, input.workerName, k, v, { fetchImpl });
    if (!r.success) {
      const errMsg = r.errors?.[0]?.message ?? "secret put failed";
      steps.push(step("set-secret", false, `secret ${k}: failed`, undefined, r.recovery ?? errMsg));
      // Don't bail — the Worker is up. Continue setting the rest.
    } else {
      const noteRe = r.reused === "value-match-plain-text"
        ? " (already a plain_text var with same value)"
        : r.reused === "already-secret"
          ? " (already a secret)"
          : "";
      steps.push(step("set-secret", true, `secret ${k}: set${noteRe}`));
    }
  }

  // f. Enable the workers.dev subdomain. Without this, the deploy
  // succeeds but the URL the UI shows (helm.workers.dev) returns 522.
  // Idempotent — calling it on an already-enabled Worker is a no-op.
  const subRes = await enableWorkersDevSubdomain(
    input.token,
    input.accountId,
    input.workerName,
    { fetchImpl }
  );
  if (subRes.success) {
    steps.push(step("enable-subdomain", true, `${input.workerHost} URL enabled`));
  } else {
    const errMsg = subRes.errors?.[0]?.message ?? "subdomain enable failed";
    steps.push(step("enable-subdomain", false,
      `couldn't enable workers.dev URL · ${errMsg}`,
      undefined,
      `${errMsg}\n\nThe Worker is deployed but its URL may be off. Visit dash → Workers & Pages → ${input.workerName} → Settings → Triggers → toggle the workers.dev subdomain on.`
    ));
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
  /** R2 bucket name. When set, emits a `[[r2_buckets]] WORKSPACE` block so
   *  the deployed Worker's /persist + Files tab work. */
  r2BucketName?: string;
  access: { aud: string; teamDomain: string } | null;
  ownerEmail?: string;
  fromEmail?: string;
  /**
   * Model id MODEL_DEFAULT resolves to. Defaults to "openrouter/auto"
   * — best when the user pasted an OPENROUTER_API_KEY. Pass another
   * id (e.g. "openrouter/moonshotai/kimi-k2-0905") to pin a specific
   * model.
   */
  openRouterDefaultModel?: string;
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
  // The browser-deploy flow ships an agent that can self-administer
  // (cf-* skills, helm-setup-deploy, helm-artifacts-* etc.). That needs
  // ENABLED_PLUGINS to include the full self-admin stack and ALLOWED_HOSTS
  // to be non-empty (or the Worker errors on every request).
  // Default to Kimi K2.6 (free via Workers AI) for the local-fallback
  // wrangler.toml. Users with an OpenRouter key can pin a specific model
  // by editing this line — the runtime resolves provider precedence
  // independently of the model id format.
  const modelDefault = input.openRouterDefaultModel ?? "@cf/moonshotai/kimi-k2.6";
  lines.push(`MODEL_DEFAULT = "${modelDefault}"`);
  lines.push(
    // Keep in sync with the runtime defaults in deployFlow runDirectDeploy.
    // helm-artifacts is intentionally absent until the published manifest
    // bundle catches up to v0.11.
    `ENABLED_PLUGINS = "admin,helm-setup,helm-toml,helm-github,cloudflare-admin,mcp-client,workers-ai,cf-ai-gateway,openrouter,memory,email,notifier"`
  );
  lines.push(
    `ALLOWED_HOSTS = "api.cloudflare.com,mcp.cloudflare.com,api.anthropic.com,api.openai.com,openrouter.ai,api.github.com"`
  );
  lines.push(`AGENT_NAME = "${input.workerName}"`);
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
  lines.push("[[durable_objects.bindings]]");
  lines.push(`name = "CHAT_SESSIONS"`);
  lines.push(`class_name = "ChatSessionDO"`);
  lines.push("");
  // Sandbox DO + container — required for /shell/ws and helm-exec.
  // Image is the public CF-hosted sandbox base; customer accounts pull
  // it from docker.io/cloudflare on first instantiation. No local
  // Docker daemon required for `wrangler deploy`.
  lines.push("[[durable_objects.bindings]]");
  lines.push(`name = "Sandbox"`);
  lines.push(`class_name = "Sandbox"`);
  lines.push("");
  lines.push("[[durable_objects.bindings]]");
  lines.push(`name = "CLI_AUTH"`);
  lines.push(`class_name = "CliAuthDO"`);
  lines.push("");
  lines.push("[[containers]]");
  lines.push(`class_name = "Sandbox"`);
  lines.push(`image = "docker.io/cloudflare/sandbox:0.10.0"`);
  lines.push(`max_instances = 10`);
  lines.push(`instance_type = "lite"`);
  lines.push(`name = "helm-sandbox"`);
  lines.push("");
  lines.push("[[migrations]]");
  lines.push(`tag = "v1"`);
  lines.push(`new_sqlite_classes = ["AgentSessionDO"]`);
  lines.push("");
  lines.push("[[migrations]]");
  lines.push(`tag = "v2"`);
  lines.push(`new_classes = ["StreamHubDO"]`);
  lines.push("");
  lines.push("[[migrations]]");
  lines.push(`tag = "v3"`);
  lines.push(`new_classes = ["ChatSessionDO"]`);
  lines.push("");
  lines.push("[[migrations]]");
  lines.push(`tag = "v4"`);
  lines.push(`new_sqlite_classes = ["Sandbox", "CliAuthDO"]`);
  if (input.d1) {
    lines.push("");
    lines.push("[[d1_databases]]");
    lines.push(`binding = "DB"`);
    lines.push(`database_name = "${input.d1.name}"`);
    lines.push(`database_id = "${input.d1.uuid}"`);
  }
  if (input.r2BucketName) {
    lines.push("");
    lines.push("[[r2_buckets]]");
    lines.push(`binding = "WORKSPACE"`);
    lines.push(`bucket_name = "${input.r2BucketName}"`);
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
 * Poll the deployed Worker's `/setup/status` until `auth.configured`
 * flips to true, signaling that CF has rolled the new secret bindings
 * (CF_ACCESS_AUD + co.) into the running script.
 *
 * Why we need this: setting a Worker secret triggers an automatic
 * redeploy on Cloudflare's side, but the new env isn't visible to the
 * running process for ~5-30s after the API call returns. If the user
 * hits /app immediately, they see the open-deploy welcome page (auth_mode
 * = welcome) instead of the strict-mode Access login. Polling here means
 * we don't show "deploy done" until the Worker is actually using the new
 * secrets — same UX guarantee `/app#/settings` provides today.
 *
 * Strategy: 1s for first 5s, then 2s for the next 30s, then 4s after.
 * Aggressive early polling keeps the median wait short; the fallback is
 * gentle on busy workers. 90s deadline total.
 *
 * Returns `{ ok, elapsedMs }` — never throws. Calling code should treat
 * `ok: false` as "not failed, just not ready yet" and surface guidance.
 */
async function pollForStrictMode(
  workerHost: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; elapsedMs: number }> {
  const f = fetchImpl ?? fetch;
  const start = Date.now();
  const deadline = start + 90_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const r = await f(`https://${workerHost}/setup/status`, {
        headers: { accept: "application/json" }
      });
      // Even a 401/403 means "Worker is up + auth IS gating" — that's
      // exactly the strict-mode signal we want.
      if (r.status === 401 || r.status === 403) {
        return { ok: true, elapsedMs: Date.now() - start };
      }
      if (r.ok) {
        const text = await r.text();
        try {
          const json = JSON.parse(text) as {
            data?: { capabilities?: Array<{ id?: string; configured?: boolean }> };
          };
          const auth = json.data?.capabilities?.find((c) => c.id === "auth");
          if (auth?.configured) {
            return { ok: true, elapsedMs: Date.now() - start };
          }
        } catch {
          /* keep polling — stale bundle may not return JSON yet */
        }
      }
    } catch {
      /* network blips during redeploy — keep polling */
    }
    // Adaptive backoff: 1s for first 5 attempts, 2s next 15, 4s after.
    const delay = attempts <= 5 ? 1_000 : attempts <= 20 ? 2_000 : 4_000;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  return { ok: false, elapsedMs: Date.now() - start };
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
