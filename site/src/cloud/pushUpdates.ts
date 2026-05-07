/**
 * Cron-driven update push.
 *
 * Once an hour the marketing-site Worker's `scheduled()` handler calls
 * `runUpdatePush(env)`. We:
 *   1. Fetch the latest bundle manifest.
 *   2. List active deployments (paused = 0).
 *   3. For each deployment whose `build_sha` doesn't match the manifest:
 *      a. Decrypt the customer's CF token
 *      b. PUT the bundle to their Worker via the CF API
 *      c. Record success/failure in `cloud_push_log` + update `last_pushed_at`
 *
 * Failures are per-deployment — one customer's broken token never blocks
 * pushes to others.
 *
 * The push uploads the bundle bytes WE host as a static asset; we never
 * read the customer's runtime data and we never see their plaintext tokens
 * outside this Worker's memory for the duration of the push.
 */

import { flattenMigrationsForCfApi, getWorkerSettings, uploadWorkerScript } from "./cfApi";
import { decryptCfToken } from "./crypto";
import {
  getDeployment,
  listActiveDeployments,
  recordPushFailure,
  recordPushSuccess,
  type CloudDeploymentRow
} from "./deployments";
import {
  fetchManifest,
  fetchModuleBytes,
  type BundleManifest
} from "./manifest";

/**
 * Merge the manifest's abstract bindings (DO classes, AI) with the customer's
 * existing per-script bindings (D1 ID, secret_text values, KV namespaces).
 *
 * Strategy:
 *   - For each binding NAME in the manifest, prefer the customer's existing
 *     binding if present (it has the right type-specific fields like
 *     `database_id`). Manifest is the source of truth for which names should
 *     exist.
 *   - For names ONLY in the customer's settings (D1 they added, secrets,
 *     services), keep them — they're customer-managed extensions. The
 *     bundle ignores any binding it doesn't reference.
 *   - For names in the manifest that the customer hasn't created yet (e.g.
 *     a new DO class we just added), fall through to the manifest value
 *     and CF API will create it on push.
 */
export function mergeBindings(
  manifestBindings: Array<Record<string, unknown> & { name?: unknown; type?: unknown }>,
  customerBindings: Array<Record<string, unknown> & { name?: unknown; type?: unknown }>
): Array<Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();
  // Start with the manifest as the floor — every name we expect must end up here.
  for (const b of manifestBindings) {
    if (typeof b.name === "string") byName.set(b.name, { ...b });
  }
  // Overlay customer-specific bindings — same name + type wins (preserves IDs);
  // additional names get added (e.g. customer-added KVs we don't know about).
  for (const b of customerBindings) {
    if (typeof b.name !== "string") continue;
    const existing = byName.get(b.name);
    if (existing) {
      if (existing.type === b.type) {
        // Merge: prefer customer values for type-specific fields.
        byName.set(b.name, { ...existing, ...b });
      } else {
        // Type mismatch — keep manifest's view; the customer's binding will
        // be replaced. Rare; log so it's visible at push time.
        console.warn(
          `[cloud-push] binding name=${b.name} type mismatch (manifest=${existing.type} vs script=${b.type}); using manifest`
        );
      }
    } else {
      byName.set(b.name, { ...b });
    }
  }
  return Array.from(byName.values());
}

export interface PushEnv {
  DB?: D1Database;
  CLOUD_MASTER_KEY?: string;
  HELM_BUNDLE_MANIFEST_URL?: string;
}

export interface PushOptions {
  fetchImpl?: typeof fetch;
  /** Override clock for tests; defaults to Date.now. */
  now?: () => number;
  /**
   * Limit the run to a single deployment id. Used by the admin "Push now"
   * action so a customer can trigger an update outside the hourly cadence
   * (e.g. just shipped a bug fix and don't want to wait an hour).
   *
   * Differences from the cron path:
   *   - Bypasses the `paused = 0` filter — single-deployment pushes are
   *     intentional, not bulk; the customer asked for it.
   *   - Skips the stuck-deployment scan; that's a global health metric,
   *     not relevant to a one-off push.
   */
  deploymentId?: string;
}

export interface PushSummary {
  ok: boolean;
  manifestSha?: string;
  considered: number;
  pushed: number;
  skippedUpToDate: number;
  /**
   * Deployments that flipped HELM_CUSTOM_DEPLOY=1 (or any binding by that
   * name) to claim canonical-source from the cron's perspective. The
   * customer is self-managing via Artifacts; the cron should NOT overwrite
   * their custom code with upstream. They can still trigger a manual
   * upstream push from the manage page.
   */
  skippedCustomDeploy?: number;
  failures: Array<{ deploymentId: string; error: string }>;
  /** Deployments that have failed 3+ pushes since their last success. */
  stuck?: string[];
  error?: string;
}

/**
 * Marker binding name. Any binding with this exact name on the live Worker
 * tells the upstream cron "I'm self-managing — skip me." Type doesn't
 * matter: we honor plain_text "1", secret_text (value hidden but presence
 * is the signal), even an oddly-named D1 binding (it'd be the user's
 * choice and we should respect it). Set by helm-artifacts-deploy on every
 * successful self-deploy; cleared by helm-setup-update.
 */
export const CUSTOM_DEPLOY_BINDING_NAME = "HELM_CUSTOM_DEPLOY";

/**
 * Exported so the manage-page handlers can mirror the same check (e.g.
 * to warn the user when they click "Push update now" while flagged).
 */
export function isCustomDeployFlagged(
  bindings: Array<Record<string, unknown> & { name?: unknown }>
): boolean {
  return bindings.some((b) => b.name === CUSTOM_DEPLOY_BINDING_NAME);
}

/**
 * Single entry point — called from the Worker's `scheduled()` handler.
 */
export async function runUpdatePush(
  env: PushEnv,
  options: PushOptions = {}
): Promise<PushSummary> {
  if (!env.DB) {
    return summary({ ok: false, error: "DB binding required" });
  }
  if (!env.CLOUD_MASTER_KEY) {
    return summary({ ok: false, error: "CLOUD_MASTER_KEY secret required" });
  }
  if (!env.HELM_BUNDLE_MANIFEST_URL) {
    return summary({ ok: false, error: "HELM_BUNDLE_MANIFEST_URL var required" });
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  let manifest: BundleManifest;
  try {
    manifest = await fetchManifest(env.HELM_BUNDLE_MANIFEST_URL, fetchImpl);
  } catch (err) {
    return summary({ ok: false, error: `manifest fetch: ${(err as Error).message}` });
  }

  // Single-deployment branch: customer-initiated "Push now". Skip the
  // active-only filter (the customer asked, even if their deployment is
  // paused) and skip the stuck-scan (one-off, not a fleet check).
  if (options.deploymentId) {
    const single = await getDeployment(env.DB, options.deploymentId);
    if (!single) {
      return summary({
        ok: false,
        manifestSha: manifest.sha,
        error: `deployment '${options.deploymentId}' not found`
      });
    }
    if (single.buildSha === manifest.sha) {
      return summary({
        ok: true,
        manifestSha: manifest.sha,
        considered: 1,
        pushed: 0,
        skippedUpToDate: 1
      });
    }
    try {
      const moduleBytes = await fetchModuleBytes(manifest.moduleUrl, fetchImpl);
      // Admin-initiated push BYPASSES the self-managed flag — the
      // customer explicitly clicked "Push now", they know what they're
      // doing. The button on the manage page surfaces a warning when
      // the flag is set so they can opt out before clicking.
      const result = await pushOne({
        env,
        deployment: single,
        manifest,
        moduleBytes,
        fetchImpl,
        bypassCustomDeployFlag: true
      });
      if (result.skipped) {
        // Shouldn't happen given bypass=true, but covered for completeness.
        return summary({
          ok: true,
          manifestSha: manifest.sha,
          considered: 1,
          pushed: 0,
          skippedCustomDeploy: 1
        });
      }
      return summary({
        ok: true,
        manifestSha: manifest.sha,
        considered: 1,
        pushed: 1,
        skippedUpToDate: 0
      });
    } catch (err) {
      const msg = (err as Error).message;
      try {
        await recordPushFailure(env.DB, single.id, manifest.sha, msg);
      } catch {
        /* never let audit-log failure mask the original error */
      }
      return summary({
        ok: false,
        manifestSha: manifest.sha,
        considered: 1,
        pushed: 0,
        skippedUpToDate: 0,
        failures: [{ deploymentId: single.id, error: msg }]
      });
    }
  }

  const deployments = await listActiveDeployments(env.DB);
  const failures: PushSummary["failures"] = [];
  let pushed = 0;
  let skipped = 0;
  let skippedCustomDeploy = 0;

  // Pre-fetch the bundle once and reuse it across every deployment.
  let bundleBytes: ArrayBuffer | null = null;

  for (const deployment of deployments) {
    if (deployment.buildSha === manifest.sha) {
      skipped += 1;
      continue;
    }
    try {
      if (!bundleBytes) {
        bundleBytes = await fetchModuleBytes(manifest.moduleUrl, fetchImpl);
      }
      const result = await pushOne({
        env,
        deployment,
        manifest,
        moduleBytes: bundleBytes,
        fetchImpl
      });
      if (result.skipped) {
        skippedCustomDeploy += 1;
        // Don't write a push-failure row — that would inflate the
        // stuck-detection counter. The skippedCustomDeploy counter on
        // PushSummary is what the operator dashboard reads. Customers
        // see the "self-managed" badge on the manage page.
        continue;
      }
      pushed += 1;
    } catch (err) {
      const msg = (err as Error).message;
      failures.push({ deploymentId: deployment.id, error: msg });
      try {
        await recordPushFailure(env.DB, deployment.id, manifest.sha, msg);
      } catch {
        /* never let an audit-log failure mask the original error */
      }
    }
  }

  // After the batch — surface deployments that have failed 3+ times in
  // a row since their last successful push. These are the ones an
  // operator needs to look at; the cron isn't going to recover on its own.
  const stuck = await listStuckDeployments(env.DB).catch(() => []);
  if (stuck.length > 0) {
    console.warn(
      `[cloud-cron] alert: ${stuck.length} deployment(s) failing 3+ pushes in a row: ${
        stuck.map((s) => `${s.deploymentId}(${s.consecutiveFailures})`).join(", ")
      }`
    );
  }

  return summary({
    ok: failures.length === 0,
    manifestSha: manifest.sha,
    considered: deployments.length,
    pushed,
    skippedUpToDate: skipped,
    skippedCustomDeploy,
    failures,
    stuck: stuck.map((s) => s.deploymentId)
  });
}

interface StuckDeployment {
  deploymentId: string;
  consecutiveFailures: number;
}

/**
 * Find deployments with N (default 3) or more push-failure rows since their
 * most recent push-success. Pure-read query against cloud_push_log; no
 * extra schema needed.
 *
 * Used by:
 *   - runUpdatePush: emits a structured WARN log per cron run (tail-able)
 *   - /api/cloud/health: surfaces in the operator dashboard
 */
export async function listStuckDeployments(
  db: D1Database,
  threshold = 3
): Promise<StuckDeployment[]> {
  const r = await db
    .prepare(
      `SELECT deployment_id AS deploymentId, COUNT(*) AS consecutiveFailures
         FROM cloud_push_log p
        WHERE p.kind = 'push-failure'
          AND p.ts > IFNULL(
            (SELECT MAX(ts) FROM cloud_push_log p2
              WHERE p2.deployment_id = p.deployment_id
                AND p2.kind = 'push-success'),
            '1970-01-01'
          )
        GROUP BY deployment_id
       HAVING consecutiveFailures >= ?`
    )
    .bind(threshold)
    .all<StuckDeployment>();
  return (r.results ?? []).map((s) => ({
    deploymentId: s.deploymentId,
    consecutiveFailures: Number(s.consecutiveFailures)
  }));
}

/**
 * Is this deployment currently self-managed? Decrypts the CF token, GETs
 * /workers/scripts/{name}/settings, and checks the bindings array for the
 * marker. Used by the manage page's push-now handler to gate the action
 * with a confirmation when pushing upstream would clobber custom code.
 *
 * Returns {ok: false, error} on token decrypt or CF API failure rather
 * than throwing — the caller can decide how loud to be about it. Without
 * this safeguard, "Push now" silently overwrites a customer's Artifacts
 * deploy with upstream bytes; with it, the UI gets a chance to warn.
 */
export async function isDeploymentSelfManaged(
  env: { CLOUD_MASTER_KEY?: string },
  deployment: CloudDeploymentRow,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<{ ok: true; selfManaged: boolean } | { ok: false; error: string }> {
  const masterKey = env.CLOUD_MASTER_KEY;
  if (!masterKey) return { ok: false, error: "CLOUD_MASTER_KEY missing" };
  const fetchImpl = options.fetchImpl ?? fetch;
  let token: string;
  try {
    token = await decryptCfToken(
      {
        ciphertextB64: deployment.encryptedTokenB64,
        ivB64: deployment.encryptionIvB64
      },
      masterKey
    );
  } catch (err) {
    return { ok: false, error: `token decrypt failed: ${(err as Error).message}` };
  }
  try {
    const settings = await getWorkerSettings(
      token,
      deployment.accountId,
      deployment.workerName,
      { fetchImpl }
    );
    if (!settings.success || !settings.result?.bindings) {
      // Treat unreadable settings as "not self-managed" — push proceeds.
      // Worst case: push succeeds and we missed the warning. Better than
      // refusing every push when the API is flaky.
      return { ok: true, selfManaged: false };
    }
    return { ok: true, selfManaged: isCustomDeployFlagged(settings.result.bindings) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

interface PushOneInput {
  env: PushEnv;
  deployment: CloudDeploymentRow;
  manifest: BundleManifest;
  moduleBytes: ArrayBuffer;
  fetchImpl: typeof fetch;
  /**
   * When true, ignore the HELM_CUSTOM_DEPLOY flag and push anyway. Set
   * by the admin "Push now" path so a customer who's self-managing can
   * still pull a fresh upstream snapshot when they explicitly ask for
   * one.
   */
  bypassCustomDeployFlag?: boolean;
}

interface PushOneResult {
  /** When true, the deployment was skipped without uploading. */
  skipped?: boolean;
  /** Human-readable reason when skipped. */
  reason?: string;
}

async function pushOne(input: PushOneInput): Promise<PushOneResult> {
  const { env, deployment, manifest, moduleBytes, fetchImpl } = input;
  const masterKey = env.CLOUD_MASTER_KEY;
  if (!masterKey) throw new Error("CLOUD_MASTER_KEY missing");

  // Decrypt the customer's token (lives in memory only for this push).
  let token: string;
  try {
    token = await decryptCfToken(
      {
        ciphertextB64: deployment.encryptedTokenB64,
        ivB64: deployment.encryptionIvB64
      },
      masterKey
    );
  } catch (err) {
    throw new Error(`token decrypt failed: ${(err as Error).message}`);
  }

  // Read the customer's existing bindings — used for two things:
  //   1. Detect HELM_CUSTOM_DEPLOY → skip if customer is self-managing.
  //   2. Merge customer's D1 IDs / secret_text values / extras into the
  //      upload so we don't clobber them.
  // If the GET fails (script missing — happens on a deploy that hasn't
  // actually run yet), fall through with manifest-only bindings; the
  // self-managed flag only matters for already-deployed Workers.
  let existingBindings: Array<Record<string, unknown> & { name?: unknown; type?: unknown }> = [];
  try {
    const settings = await getWorkerSettings(
      token,
      deployment.accountId,
      deployment.workerName,
      { fetchImpl }
    );
    if (settings.success && settings.result?.bindings) {
      existingBindings = settings.result.bindings;
    }
  } catch (err) {
    // Non-fatal — push proceeds with the manifest-only view.
    console.warn(
      `[cloud-push] could not read existing bindings for ${deployment.workerName}: ${(err as Error).message}`
    );
  }

  // Self-managed short-circuit. The customer flipped HELM_CUSTOM_DEPLOY
  // (typically via helm-artifacts-deploy auto-setting it on a custom
  // deploy). The upstream cron should NOT overwrite their custom code
  // with our manifest's bytes. They can still trigger a manual push
  // from the manage page (which sets bypassCustomDeployFlag=true).
  if (!input.bypassCustomDeployFlag && isCustomDeployFlagged(existingBindings)) {
    return {
      skipped: true,
      reason: `${CUSTOM_DEPLOY_BINDING_NAME} binding present — customer is self-managing via Artifacts.`
    };
  }

  let mergedBindings = manifest.metadata.bindings;
  if (existingBindings.length > 0) {
    mergedBindings = mergeBindings(manifest.metadata.bindings, existingBindings);
  }
  // Stamp BUILD_SHA on every push so the live Worker can introspect
  // its own version (helm-setup-update reads env.BUILD_SHA to decide
  // whether the upstream manifest is newer than what's running). We
  // replace any existing BUILD_SHA rather than relying on mergeBindings
  // because the cron is the canonical source of truth for the version.
  mergedBindings = mergedBindings.filter(
    (b) => !(b.type === "plain_text" && b.name === "BUILD_SHA")
  );
  mergedBindings.push({
    type: "plain_text",
    name: "BUILD_SHA",
    text: manifest.sha
  });

  // Flatten the manifest's migrations array (wrangler.toml-shape) into the
  // single-object shape CF's Workers Scripts API expects. Without this,
  // upload fails with "json: cannot unmarshal array into Go struct field
  // Metadata.migrations of type reader.ActorMigrations".
  const flatMigrations = flattenMigrationsForCfApi(
    manifest.metadata.migrations as Array<Record<string, unknown>> | undefined
  );
  // Spread `...manifest.metadata` first so `containers` (image refs for
  // DO classes like Sandbox) and `compatibility_*` flow through as-is.
  // Bindings get the customer's existing values merged on top
  // (D1 IDs, secret values) so the cron doesn't clobber them.
  const metadata: Record<string, unknown> = {
    ...manifest.metadata,
    bindings: mergedBindings
  };
  if (flatMigrations) {
    metadata.migrations = flatMigrations;
  } else {
    delete (metadata as { migrations?: unknown }).migrations;
  }

  // Upload to the customer's Worker.
  const result = await uploadWorkerScript(
    token,
    deployment.accountId,
    deployment.workerName,
    {
      metadata,
      mainModule: {
        name: manifest.metadata.main_module,
        bytes: moduleBytes
      }
    },
    { fetchImpl }
  );
  // Drop the decrypted token from this scope ASAP. JS doesn't let us zero
  // memory, but we can at least not hold the reference.
  token = "";

  if (!result.success) {
    const msg = result.errors?.[0]?.message ?? "upload failed";
    throw new Error(msg);
  }

  if (env.DB) {
    await recordPushSuccess(env.DB, deployment.id, manifest.sha);
  }
  return {};
}

function summary(partial: Partial<PushSummary>): PushSummary {
  return {
    ok: false,
    considered: 0,
    pushed: 0,
    skippedUpToDate: 0,
    failures: [],
    ...partial
  };
}
