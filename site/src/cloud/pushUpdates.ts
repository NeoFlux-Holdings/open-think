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
}

export interface PushSummary {
  ok: boolean;
  manifestSha?: string;
  considered: number;
  pushed: number;
  skippedUpToDate: number;
  failures: Array<{ deploymentId: string; error: string }>;
  /** Deployments that have failed 3+ pushes since their last success. */
  stuck?: string[];
  error?: string;
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

  const deployments = await listActiveDeployments(env.DB);
  const failures: PushSummary["failures"] = [];
  let pushed = 0;
  let skipped = 0;

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
      await pushOne({
        env,
        deployment,
        manifest,
        moduleBytes: bundleBytes,
        fetchImpl
      });
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

interface PushOneInput {
  env: PushEnv;
  deployment: CloudDeploymentRow;
  manifest: BundleManifest;
  moduleBytes: ArrayBuffer;
  fetchImpl: typeof fetch;
}

async function pushOne(input: PushOneInput): Promise<void> {
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

  // Read the customer's existing bindings so we don't clobber their D1 ID,
  // secret_text values, or any extras they added. If the GET fails (script
  // missing — happens on a deploy that hasn't actually run yet), fall
  // through with manifest-only bindings.
  let mergedBindings = manifest.metadata.bindings;
  try {
    const settings = await getWorkerSettings(
      token,
      deployment.accountId,
      deployment.workerName,
      { fetchImpl }
    );
    if (settings.success && settings.result?.bindings) {
      mergedBindings = mergeBindings(
        manifest.metadata.bindings,
        settings.result.bindings
      );
    }
  } catch (err) {
    // Non-fatal — push proceeds with the manifest-only view.
    console.warn(
      `[cloud-push] could not read existing bindings for ${deployment.workerName}: ${(err as Error).message}`
    );
  }

  // Flatten the manifest's migrations array (wrangler.toml-shape) into the
  // single-object shape CF's Workers Scripts API expects. Without this,
  // upload fails with "json: cannot unmarshal array into Go struct field
  // Metadata.migrations of type reader.ActorMigrations".
  const flatMigrations = flattenMigrationsForCfApi(
    manifest.metadata.migrations as Array<Record<string, unknown>> | undefined
  );
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
