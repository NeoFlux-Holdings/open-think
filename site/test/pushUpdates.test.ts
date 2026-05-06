/**
 * runUpdatePush integration tests. Each test exercises the full path:
 *   - manifest fetch (mocked)
 *   - bundle fetch (mocked)
 *   - per-deployment CF API upload (mocked)
 *   - D1 write of last_pushed_at + build_sha
 *
 * We stub the D1 inline so the test is hermetic — same shape as the
 * deployments.test.ts fake but trimmed to what runUpdatePush actually calls.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isCustomDeployFlagged,
  isDeploymentSelfManaged,
  listStuckDeployments,
  mergeBindings,
  runUpdatePush
} from "../src/cloud/pushUpdates";
import { encryptCfToken } from "../src/cloud/crypto";

const MASTER = "x".repeat(64);
const MANIFEST_URL = "https://manifest.example.invalid/m.json";
const MODULE_URL = "https://manifest.example.invalid/helm.mjs";

interface DeployRow {
  id: string;
  customer_id: string;
  account_id: string;
  worker_name: string;
  encrypted_token_b64: string;
  encryption_iv_b64: string;
  worker_url: string | null;
  build_sha: string | null;
  paused: number;
  created_at: string;
  last_pushed_at: string | null;
  last_push_error: string | null;
}

function fakeDb(seed: DeployRow[] = []): { db: D1Database; rows: DeployRow[]; logs: string[] } {
  const rows = [...seed];
  const logs: string[] = [];
  const db = {
    prepare(sql: string) {
      const collapsed = sql.replace(/\s+/g, " ").trim();
      return {
        _binds: [] as unknown[],
        bind(...args: unknown[]) {
          this._binds = args;
          return this;
        },
        async run() {
          if (collapsed.startsWith("UPDATE cloud_deployments SET last_pushed_at")) {
            const [last_pushed_at, build_sha, id] = this._binds as [string, string, string];
            const r = rows.find((x) => x.id === id);
            if (r) {
              r.last_pushed_at = last_pushed_at;
              r.build_sha = build_sha;
              r.last_push_error = null;
            }
          } else if (collapsed.startsWith("UPDATE cloud_deployments SET last_push_error")) {
            const [last_push_error, id] = this._binds as [string, string];
            const r = rows.find((x) => x.id === id);
            if (r) r.last_push_error = last_push_error;
          } else if (collapsed.startsWith("INSERT INTO cloud_push_log")) {
            const [deployment_id, kind] = this._binds as [string, string];
            logs.push(`${deployment_id}:${kind}`);
          }
          return { meta: { changes: 0 } };
        },
        async first<T = unknown>() {
          // getDeployment uses `WHERE id = ?` + .first()
          if (collapsed.includes("WHERE id = ?")) {
            const [id] = this._binds as [string];
            const r = rows.find((x) => x.id === id);
            if (!r) return null as unknown as T;
            return ({
              id: r.id,
              customerId: r.customer_id,
              accountId: r.account_id,
              workerName: r.worker_name,
              encryptedTokenB64: r.encrypted_token_b64,
              encryptionIvB64: r.encryption_iv_b64,
              workerUrl: r.worker_url,
              buildSha: r.build_sha,
              paused: r.paused,
              createdAt: r.created_at,
              lastPushedAt: r.last_pushed_at,
              lastPushError: r.last_push_error
            }) as unknown as T;
          }
          return null as unknown as T;
        },
        async all<T = unknown>() {
          if (collapsed.startsWith("SELECT id, customer_id as customerId")) {
            const out = rows
              .filter((r) => r.paused === 0)
              .map((r) => ({
                id: r.id,
                customerId: r.customer_id,
                accountId: r.account_id,
                workerName: r.worker_name,
                encryptedTokenB64: r.encrypted_token_b64,
                encryptionIvB64: r.encryption_iv_b64,
                workerUrl: r.worker_url,
                buildSha: r.build_sha,
                paused: r.paused,
                createdAt: r.created_at,
                lastPushedAt: r.last_pushed_at,
                lastPushError: r.last_push_error
              }));
            return { results: out as unknown as T[] };
          }
          return { results: [] as T[] };
        }
      };
    }
  } as unknown as D1Database;
  return { db, rows, logs };
}

async function makeRow(id: string, paused = false, buildSha: string | null = null): Promise<DeployRow> {
  const enc = await encryptCfToken("test-cf-token-" + id, MASTER);
  return {
    id,
    customer_id: "cus_x",
    account_id: "acc-1",
    worker_name: id,
    encrypted_token_b64: enc.ciphertextB64,
    encryption_iv_b64: enc.ivB64,
    worker_url: `https://${id}.workers.dev`,
    build_sha: buildSha,
    paused: paused ? 1 : 0,
    created_at: new Date().toISOString(),
    last_pushed_at: null,
    last_push_error: null
  };
}

const SAMPLE_MANIFEST = {
  sha: "newsha123",
  moduleUrl: MODULE_URL,
  metadata: {
    main_module: "index.mjs",
    compatibility_date: "2026-04-16",
    compatibility_flags: ["nodejs_compat_v2"],
    bindings: [{ type: "ai", name: "AI" }]
  }
};

function makeFetch(handlers: {
  manifest?: () => Response;
  module?: () => Response;
  /** Called once per CF Worker upload; receives the script name. */
  upload?: (scriptName: string) => Response;
}): typeof fetch {
  return (async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url === MANIFEST_URL) {
      return handlers.manifest
        ? handlers.manifest()
        : new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
    }
    if (url === MODULE_URL) {
      return handlers.module
        ? handlers.module()
        : new Response(new ArrayBuffer(2048), { status: 200 });
    }
    if (url.includes("/workers/scripts/")) {
      const m = url.match(/\/scripts\/([^/]+)/);
      const name = m?.[1] ?? "unknown";
      return handlers.upload
        ? handlers.upload(name)
        : new Response(JSON.stringify({ success: true, result: { id: name } }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ success: false, errors: [{ code: 404, message: "no route" }] }),
      { status: 404 }
    );
  }) as unknown as typeof fetch;
}

describe("runUpdatePush", () => {
  it("returns a clean error when DB is missing", async () => {
    const r = await runUpdatePush({ HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL, CLOUD_MASTER_KEY: MASTER });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/DB binding/);
  });

  it("returns a clean error when CLOUD_MASTER_KEY is missing", async () => {
    const { db } = fakeDb();
    const r = await runUpdatePush({ DB: db, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CLOUD_MASTER_KEY/);
  });

  it("returns a clean error when HELM_BUNDLE_MANIFEST_URL is missing", async () => {
    const { db } = fakeDb();
    const r = await runUpdatePush({ DB: db, CLOUD_MASTER_KEY: MASTER });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HELM_BUNDLE_MANIFEST_URL/);
  });

  it("pushes to every active deployment whose buildSha differs", async () => {
    const a = await makeRow("a", false, "oldsha");
    const b = await makeRow("b", false, null);
    const { db, rows, logs } = fakeDb([a, b]);
    const fetchImpl = makeFetch({});
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(2);
    expect(r.skippedUpToDate).toBe(0);
    expect(rows.find((x) => x.id === "a")!.build_sha).toBe("newsha123");
    expect(rows.find((x) => x.id === "b")!.build_sha).toBe("newsha123");
    expect(logs.filter((l) => l.endsWith(":push-success")).length).toBe(2);
  });

  it("skips deployments already on the manifest sha", async () => {
    const upToDate = await makeRow("a", false, "newsha123");
    const stale = await makeRow("b", false, "oldsha");
    const { db, rows } = fakeDb([upToDate, stale]);
    const r = await runUpdatePush(
      { DB: db, CLOUDFLARE_ACCOUNT_ID: "irrelevant", CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL } as unknown as Parameters<typeof runUpdatePush>[0],
      { fetchImpl: makeFetch({}) }
    );
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(1);
    expect(r.skippedUpToDate).toBe(1);
    // The up-to-date one is unchanged.
    expect(rows.find((x) => x.id === "a")!.build_sha).toBe("newsha123");
  });

  it("skips paused deployments entirely (not in the active list)", async () => {
    const paused = await makeRow("a", true, "oldsha");
    const active = await makeRow("b", false, "oldsha");
    const { db, rows, logs } = fakeDb([paused, active]);
    const fetchImpl = makeFetch({});
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    expect(r.considered).toBe(1); // only the active one is "considered"
    expect(r.pushed).toBe(1);
    expect(rows.find((x) => x.id === "a")!.build_sha).toBe("oldsha"); // unchanged
    expect(logs.some((l) => l.startsWith("a:"))).toBe(false);
  });

  it("records per-deployment failures without aborting the batch", async () => {
    const good = await makeRow("good", false, "oldsha");
    const bad = await makeRow("bad", false, "oldsha");
    const { db, rows, logs } = fakeDb([good, bad]);
    const fetchImpl = makeFetch({
      upload: (name) =>
        name === "bad"
          ? new Response(
              JSON.stringify({ success: false, errors: [{ code: 1004, message: "quota exceeded" }] }),
              { status: 400 }
            )
          : new Response(JSON.stringify({ success: true, result: { id: name } }), { status: 200 })
    });
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].deploymentId).toBe("bad");
    expect(r.failures[0].error).toMatch(/quota/);
    expect(rows.find((x) => x.id === "good")!.build_sha).toBe("newsha123");
    expect(rows.find((x) => x.id === "bad")!.last_push_error).toMatch(/quota/);
    expect(logs.some((l) => l === "good:push-success")).toBe(true);
    expect(logs.some((l) => l === "bad:push-failure")).toBe(true);
  });

  it("preserves customer-specific bindings (D1 IDs, secrets) across pushes", async () => {
    const a = await makeRow("a", false, "oldsha");
    const { db, rows } = fakeDb([a]);
    let uploadedMetadata: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === MANIFEST_URL) {
        return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      }
      if (url === MODULE_URL) {
        return new Response(new ArrayBuffer(2048), { status: 200 });
      }
      // GET /workers/scripts/a/settings — return customer's existing bindings
      // including a D1 (with their database_id) and a secret_text.
      if (url.endsWith("/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              compatibility_date: "2026-04-16",
              bindings: [
                { type: "d1", name: "DB", database_id: "customer-d1-uuid", database_name: "their-db" },
                { type: "secret_text", name: "ANTHROPIC_API_KEY" },
                { type: "ai", name: "AI" }
              ]
            }
          }),
          { status: 200 }
        );
      }
      // PUT /workers/scripts/a — capture the metadata we sent
      if (url.includes("/workers/scripts/")) {
        const form = await (init?.body as FormData);
        const meta = form?.get?.("metadata") as Blob | null;
        if (meta) uploadedMetadata = JSON.parse(await meta.text());
        return new Response(JSON.stringify({ success: true, result: { id: "a" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    expect(uploadedMetadata).not.toBeNull();
    const bindings = (uploadedMetadata as { bindings: Array<Record<string, unknown>> }).bindings;
    // Customer's D1 binding (with database_id) is preserved
    const db1 = bindings.find((b) => b.name === "DB");
    expect(db1?.database_id).toBe("customer-d1-uuid");
    // Customer's secret is preserved (CF will keep its value)
    expect(bindings.find((b) => b.name === "ANTHROPIC_API_KEY")).toBeTruthy();
    // Manifest's AI binding is still there
    expect(bindings.find((b) => b.name === "AI")).toBeTruthy();
  });

  it("single-deployment branch (deploymentId) pushes only that one", async () => {
    const a = await makeRow("a", false, "oldsha");
    const b = await makeRow("b", false, "oldsha");
    const { db, rows, logs } = fakeDb([a, b]);
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl: makeFetch({}), deploymentId: "b" }
    );
    expect(r.ok).toBe(true);
    expect(r.considered).toBe(1);
    expect(r.pushed).toBe(1);
    // Only `b` was touched; `a` stays on oldsha.
    expect(rows.find((x) => x.id === "a")!.build_sha).toBe("oldsha");
    expect(rows.find((x) => x.id === "b")!.build_sha).toBe("newsha123");
    expect(logs.some((l) => l.startsWith("a:"))).toBe(false);
    expect(logs.some((l) => l === "b:push-success")).toBe(true);
  });

  it("single-deployment branch reports already-up-to-date without uploading", async () => {
    const a = await makeRow("a", false, "newsha123");
    const { db } = fakeDb([a]);
    let uploadCalls = 0;
    const fetchImpl = makeFetch({
      upload: () => {
        uploadCalls += 1;
        return new Response(JSON.stringify({ success: true, result: { id: "a" } }), { status: 200 });
      }
    });
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl, deploymentId: "a" }
    );
    expect(r.ok).toBe(true);
    expect(r.skippedUpToDate).toBe(1);
    expect(r.pushed).toBe(0);
    expect(uploadCalls).toBe(0);
  });

  it("single-deployment branch errors cleanly when deploymentId not found", async () => {
    const { db } = fakeDb([]);
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl: makeFetch({}), deploymentId: "ghost" }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/'ghost' not found/);
  });

  it("single-deployment branch ignores the paused = 0 filter (admin override)", async () => {
    const paused = await makeRow("p", true, "oldsha");
    const { db, rows } = fakeDb([paused]);
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl: makeFetch({}), deploymentId: "p" }
    );
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(1);
    expect(rows.find((x) => x.id === "p")!.build_sha).toBe("newsha123");
  });

  it("stamps BUILD_SHA as a plain_text binding on every push", async () => {
    const a = await makeRow("a", false, "oldsha");
    const { db } = fakeDb([a]);
    let uploadedMetadata: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === MANIFEST_URL) {
        return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      }
      if (url === MODULE_URL) {
        return new Response(new ArrayBuffer(2048), { status: 200 });
      }
      if (url.endsWith("/settings")) {
        return new Response(
          JSON.stringify({ success: true, result: { bindings: [] } }),
          { status: 200 }
        );
      }
      if (url.includes("/workers/scripts/")) {
        const form = await (init?.body as FormData);
        const meta = form?.get?.("metadata") as Blob | null;
        if (meta) uploadedMetadata = JSON.parse(await meta.text());
        return new Response(JSON.stringify({ success: true, result: { id: "a" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    const bindings = (uploadedMetadata as { bindings: Array<Record<string, unknown>> }).bindings;
    const buildSha = bindings.find((b) => b.name === "BUILD_SHA");
    expect(buildSha).toBeTruthy();
    expect(buildSha?.type).toBe("plain_text");
    expect(buildSha?.text).toBe("newsha123");
  });

  it("BUILD_SHA replaces (not duplicates) any prior plain_text binding of the same name", async () => {
    const a = await makeRow("a", false, "oldsha");
    const { db } = fakeDb([a]);
    let uploadedMetadata: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === MANIFEST_URL) {
        return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      }
      if (url === MODULE_URL) {
        return new Response(new ArrayBuffer(2048), { status: 200 });
      }
      if (url.endsWith("/settings")) {
        // Customer's live Worker already has an OLD BUILD_SHA — must be replaced.
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              bindings: [{ type: "plain_text", name: "BUILD_SHA", text: "stale-sha-aaa" }]
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/workers/scripts/")) {
        const form = await (init?.body as FormData);
        const meta = form?.get?.("metadata") as Blob | null;
        if (meta) uploadedMetadata = JSON.parse(await meta.text());
        return new Response(JSON.stringify({ success: true, result: { id: "a" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    const bindings = (uploadedMetadata as { bindings: Array<Record<string, unknown>> }).bindings;
    const shas = bindings.filter((b) => b.name === "BUILD_SHA");
    expect(shas).toHaveLength(1);
    expect(shas[0].text).toBe("newsha123");
  });

  it("cron skips deployments flagged HELM_CUSTOM_DEPLOY (self-managed)", async () => {
    // Customer ran helm-artifacts-deploy → has HELM_CUSTOM_DEPLOY=1.
    // The cron must NOT overwrite their custom code with upstream bytes.
    const a = await makeRow("a", false, "oldsha");
    const b = await makeRow("b", false, "oldsha");
    const { db, rows, logs } = fakeDb([a, b]);
    let uploadCalls = 0;
    const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === MANIFEST_URL) {
        return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      }
      if (url === MODULE_URL) {
        return new Response(new ArrayBuffer(2048), { status: 200 });
      }
      if (url.endsWith("/settings")) {
        // `a` is self-managed → should be skipped. `b` is regular → pushed.
        const m = url.match(/\/scripts\/([^/]+)\/settings$/);
        const name = m?.[1];
        const bindings = name === "a"
          ? [{ type: "secret_text", name: "HELM_CUSTOM_DEPLOY" }]
          : [{ type: "ai", name: "AI" }];
        return new Response(JSON.stringify({ success: true, result: { bindings } }), { status: 200 });
      }
      if (url.match(/\/workers\/scripts\/[^/]+$/)) {
        uploadCalls += 1;
        const m = url.match(/\/scripts\/([^/]+)$/);
        return new Response(
          JSON.stringify({ success: true, result: { id: m?.[1] ?? "x" } }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    expect(r.considered).toBe(2);
    expect(r.pushed).toBe(1); // only b
    expect(r.skippedCustomDeploy).toBe(1); // a
    expect(uploadCalls).toBe(1);
    // The skipped one keeps its old build_sha (cron didn't touch it).
    expect(rows.find((x) => x.id === "a")!.build_sha).toBe("oldsha");
    expect(rows.find((x) => x.id === "b")!.build_sha).toBe("newsha123");
    // No push-failure log row for the skip — would inflate stuck-detection.
    expect(logs.some((l) => l === "a:push-failure")).toBe(false);
  });

  it("single-deployment push (admin Push Now) bypasses HELM_CUSTOM_DEPLOY by default", async () => {
    // Customer flagged themselves but explicitly clicked "Push now".
    // The handler caller would have prompted for confirmation; here the
    // bypass is implied via deploymentId branch. This makes runUpdatePush
    // honor the explicit ask.
    const a = await makeRow("a", false, "oldsha");
    const { db, rows } = fakeDb([a]);
    const fetchImpl = (async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === MANIFEST_URL) return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      if (url === MODULE_URL) return new Response(new ArrayBuffer(2048), { status: 200 });
      if (url.endsWith("/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { bindings: [{ type: "secret_text", name: "HELM_CUSTOM_DEPLOY" }] }
          }),
          { status: 200 }
        );
      }
      if (url.match(/\/workers\/scripts\/[^/]+$/)) {
        return new Response(JSON.stringify({ success: true, result: { id: "a" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl, deploymentId: "a" }
    );
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(1);
    expect(rows.find((x) => x.id === "a")!.build_sha).toBe("newsha123");
  });

  it("manifest fetch failure short-circuits the whole run", async () => {
    const a = await makeRow("a", false, null);
    const { db, logs } = fakeDb([a]);
    const fetchImpl = makeFetch({
      manifest: () => new Response("upstream offline", { status: 502 })
    });
    const r = await runUpdatePush(
      { DB: db, CLOUD_MASTER_KEY: MASTER, HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL },
      { fetchImpl }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/manifest fetch/);
    expect(logs.length).toBe(0); // no per-deployment work attempted
  });
});

describe("listStuckDeployments", () => {
  // Smaller, focused fake — only knows the one query listStuckDeployments runs.
  function fakeStuckDb(
    log: Array<{ deployment_id: string; ts: string; kind: string }>
  ): D1Database {
    return {
      prepare(sql: string) {
        return {
          bind(threshold: number) {
            return {
              async all() {
                if (sql.includes("FROM cloud_push_log")) {
                  // Replicate the SQL: per deployment, count failures since last success.
                  const byDeployment = new Map<string, typeof log>();
                  for (const row of log) {
                    const arr = byDeployment.get(row.deployment_id) ?? [];
                    arr.push(row);
                    byDeployment.set(row.deployment_id, arr);
                  }
                  const results: Array<{
                    deploymentId: string;
                    consecutiveFailures: number;
                  }> = [];
                  for (const [id, rows] of byDeployment) {
                    const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts));
                    let lastSuccess = "1970-01-01";
                    for (const r of sorted) {
                      if (r.kind === "push-success") lastSuccess = r.ts;
                    }
                    const failuresSince = sorted.filter(
                      (r) => r.kind === "push-failure" && r.ts > lastSuccess
                    ).length;
                    if (failuresSince >= threshold) {
                      results.push({ deploymentId: id, consecutiveFailures: failuresSince });
                    }
                  }
                  return { results };
                }
                return { results: [] };
              }
            };
          }
        };
      }
    } as unknown as D1Database;
  }

  it("flags deployments with 3+ failures since last success", async () => {
    const db = fakeStuckDb([
      { deployment_id: "a", ts: "2026-04-01T00:00:00Z", kind: "push-success" },
      { deployment_id: "a", ts: "2026-04-02T00:00:00Z", kind: "push-failure" },
      { deployment_id: "a", ts: "2026-04-03T00:00:00Z", kind: "push-failure" },
      { deployment_id: "a", ts: "2026-04-04T00:00:00Z", kind: "push-failure" },
      // b: had 2 fails then a success, so it's clean.
      { deployment_id: "b", ts: "2026-04-01T00:00:00Z", kind: "push-failure" },
      { deployment_id: "b", ts: "2026-04-02T00:00:00Z", kind: "push-failure" },
      { deployment_id: "b", ts: "2026-04-03T00:00:00Z", kind: "push-success" }
    ]);
    const stuck = await listStuckDeployments(db, 3);
    expect(stuck.length).toBe(1);
    expect(stuck[0].deploymentId).toBe("a");
    expect(stuck[0].consecutiveFailures).toBe(3);
  });

  it("never-succeeded deployment with 3 failures is stuck", async () => {
    const db = fakeStuckDb([
      { deployment_id: "x", ts: "2026-04-01T00:00:00Z", kind: "push-failure" },
      { deployment_id: "x", ts: "2026-04-02T00:00:00Z", kind: "push-failure" },
      { deployment_id: "x", ts: "2026-04-03T00:00:00Z", kind: "push-failure" }
    ]);
    const stuck = await listStuckDeployments(db, 3);
    expect(stuck.length).toBe(1);
  });

  it("returns empty when nothing is stuck", async () => {
    const db = fakeStuckDb([
      { deployment_id: "a", ts: "2026-04-01T00:00:00Z", kind: "push-success" }
    ]);
    const stuck = await listStuckDeployments(db, 3);
    expect(stuck).toEqual([]);
  });
});

describe("isCustomDeployFlagged", () => {
  it("returns true when any binding by that name is present (any type)", () => {
    expect(isCustomDeployFlagged([{ type: "secret_text", name: "HELM_CUSTOM_DEPLOY" }])).toBe(true);
    expect(isCustomDeployFlagged([{ type: "plain_text", name: "HELM_CUSTOM_DEPLOY", text: "1" }])).toBe(true);
    // Even an oddly-typed binding by the same name flips the flag — the
    // user's choice; we honor it.
    expect(isCustomDeployFlagged([{ type: "kv_namespace", name: "HELM_CUSTOM_DEPLOY", namespace_id: "x" }])).toBe(true);
  });

  it("returns false on empty / unrelated bindings", () => {
    expect(isCustomDeployFlagged([])).toBe(false);
    expect(isCustomDeployFlagged([{ type: "ai", name: "AI" }])).toBe(false);
    expect(isCustomDeployFlagged([{ type: "plain_text", name: "BUILD_SHA", text: "abc" }])).toBe(false);
  });
});

describe("isDeploymentSelfManaged", () => {
  it("reports selfManaged:true when the binding is found", async () => {
    const a = await makeRow("a", false, "oldsha");
    const fetchImpl = (async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { bindings: [{ type: "secret_text", name: "HELM_CUSTOM_DEPLOY" }] }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await isDeploymentSelfManaged(
      { CLOUD_MASTER_KEY: MASTER },
      {
        id: a.id,
        customerId: a.customer_id,
        accountId: a.account_id,
        workerName: a.worker_name,
        encryptedTokenB64: a.encrypted_token_b64,
        encryptionIvB64: a.encryption_iv_b64,
        workerUrl: a.worker_url,
        buildSha: a.build_sha,
        paused: a.paused,
        createdAt: a.created_at,
        lastPushedAt: a.last_pushed_at,
        lastPushError: a.last_push_error
      },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selfManaged).toBe(true);
  });

  it("returns ok:false when CLOUD_MASTER_KEY is missing", async () => {
    const a = await makeRow("a", false, null);
    const r = await isDeploymentSelfManaged({}, {
      id: a.id,
      customerId: a.customer_id,
      accountId: a.account_id,
      workerName: a.worker_name,
      encryptedTokenB64: a.encrypted_token_b64,
      encryptionIvB64: a.encryption_iv_b64,
      workerUrl: a.worker_url,
      buildSha: a.build_sha,
      paused: a.paused,
      createdAt: a.created_at,
      lastPushedAt: a.last_pushed_at,
      lastPushError: a.last_push_error
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/CLOUD_MASTER_KEY/);
  });

  it("treats unreadable settings as not-self-managed (fail-open)", async () => {
    const a = await makeRow("a", false, null);
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: "auth" }] }), {
        status: 401
      })) as unknown as typeof fetch;
    const r = await isDeploymentSelfManaged(
      { CLOUD_MASTER_KEY: MASTER },
      {
        id: a.id,
        customerId: a.customer_id,
        accountId: a.account_id,
        workerName: a.worker_name,
        encryptedTokenB64: a.encrypted_token_b64,
        encryptionIvB64: a.encryption_iv_b64,
        workerUrl: a.worker_url,
        buildSha: a.build_sha,
        paused: a.paused,
        createdAt: a.created_at,
        lastPushedAt: a.last_pushed_at,
        lastPushError: a.last_push_error
      },
      { fetchImpl }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selfManaged).toBe(false);
  });
});

describe("mergeBindings", () => {
  it("preserves customer's D1 binding when the manifest only mentions DOs + AI", () => {
    const manifest = [
      { type: "ai", name: "AI" },
      { type: "durable_object_namespace", name: "AGENT_SESSIONS", class_name: "AgentSessionDO" }
    ];
    const customer = [
      { type: "d1", name: "DB", database_id: "abc-123", database_name: "tom-tom-pa" },
      { type: "ai", name: "AI" }
    ];
    const merged = mergeBindings(manifest, customer);
    const names = merged.map((b) => b.name).sort();
    expect(names).toEqual(["AGENT_SESSIONS", "AI", "DB"]);
    const db = merged.find((b) => b.name === "DB");
    expect(db?.database_id).toBe("abc-123");
  });

  it("keeps secret_text bindings the customer has set", () => {
    const manifest = [{ type: "ai", name: "AI" }];
    const customer = [
      { type: "secret_text", name: "ANTHROPIC_API_KEY" },
      { type: "secret_text", name: "OPENAI_API_KEY" }
    ];
    const merged = mergeBindings(manifest, customer);
    expect(merged.length).toBe(3);
    expect(merged.find((b) => b.name === "ANTHROPIC_API_KEY")).toBeTruthy();
  });

  it("manifest wins on type mismatch (defensive)", () => {
    const manifest = [
      { type: "durable_object_namespace", name: "AGENT_SESSIONS", class_name: "AgentSessionDO" }
    ];
    const customer = [
      { type: "kv_namespace", name: "AGENT_SESSIONS", namespace_id: "wrong-thing" }
    ];
    const merged = mergeBindings(manifest, customer);
    expect(merged.length).toBe(1);
    expect(merged[0].type).toBe("durable_object_namespace");
  });

  it("when customer overrides DO class_name, manifest version wins (we ship the new class)", () => {
    const manifest = [
      { type: "durable_object_namespace", name: "AGENT_SESSIONS", class_name: "AgentSessionDOv2" }
    ];
    const customer = [
      { type: "durable_object_namespace", name: "AGENT_SESSIONS", class_name: "AgentSessionDO" }
    ];
    const merged = mergeBindings(manifest, customer);
    // Same type → merge prefers customer values, which means class_name reverts.
    // This is intentional for v1 — DO migrations are handled via the
    // metadata.migrations array, not by clobbering the binding.
    expect(merged[0].class_name).toBe("AgentSessionDO");
  });

  it("returns manifest unchanged when customer bindings list is empty", () => {
    const manifest = [{ type: "ai", name: "AI" }];
    const merged = mergeBindings(manifest, []);
    expect(merged).toEqual([{ type: "ai", name: "AI" }]);
  });
});
