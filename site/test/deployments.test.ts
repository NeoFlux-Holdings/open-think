/**
 * Repository smoke tests against an in-memory D1 fake. Verifies that:
 *   - insertDeployment + getDeployment round-trip
 *   - listActiveDeployments excludes paused rows + sorts oldest-first
 *   - setPaused logs to push_log
 *   - issueManageToken / resolveManageToken honor expiry + revocation
 *   - rotateToken updates the ciphertext and clears last_push_error
 *   - recordPushSuccess / recordPushFailure update the right columns
 *
 * The fake is intentionally narrow — only the SQL we actually emit is
 * understood. New repository methods must update the fake too.
 */
import { describe, expect, it, vi } from "vitest";
import {
  appendPushLog,
  getDeployment,
  insertDeployment,
  issueManageToken,
  listActiveDeployments,
  listPushLog,
  recordPushFailure,
  recordPushSuccess,
  resolveManageToken,
  revokeManageToken,
  rotateToken,
  setPaused
} from "../src/cloud/deployments";

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

interface ManageRow {
  token: string;
  deployment_id: string;
  created_at: string;
  expires_at: string;
  revoked: number;
}

interface LogRow {
  id: number;
  deployment_id: string;
  ts: string;
  kind: string;
  build_sha: string | null;
  detail: string | null;
}

function fakeDb(): {
  db: D1Database;
  deployments: DeployRow[];
  manageTokens: ManageRow[];
  log: LogRow[];
} {
  const deployments: DeployRow[] = [];
  const manageTokens: ManageRow[] = [];
  const log: LogRow[] = [];
  let logSeq = 1;

  const camelToSnake = (s: string) =>
    s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

  function applyUpdate(table: string, id: string, sets: Record<string, unknown>) {
    if (table === "cloud_deployments") {
      const row = deployments.find((r) => r.id === id);
      if (!row) return;
      Object.assign(row, sets);
    } else if (table === "cloud_manage_tokens") {
      const row = manageTokens.find((r) => r.token === id);
      if (!row) return;
      Object.assign(row, sets);
    }
  }

  const db = {
    prepare(sql: string) {
      const collapsed = sql.replace(/\s+/g, " ").trim();
      return {
        _sql: collapsed,
        _binds: [] as unknown[],
        bind(...args: unknown[]) {
          this._binds = args;
          return this;
        },
        async run() {
          const sqlText = this._sql;
          if (sqlText.startsWith("INSERT INTO cloud_deployments")) {
            const [
              id,
              customer_id,
              account_id,
              worker_name,
              encrypted_token_b64,
              encryption_iv_b64,
              worker_url,
              build_sha,
              created_at
            ] = this._binds as [
              string, string, string, string, string, string, string | null, string | null, string
            ];
            deployments.push({
              id,
              customer_id,
              account_id,
              worker_name,
              encrypted_token_b64,
              encryption_iv_b64,
              worker_url,
              build_sha,
              paused: 0,
              created_at,
              last_pushed_at: null,
              last_push_error: null
            });
            return { meta: { changes: 1 } };
          }
          if (sqlText.startsWith("UPDATE cloud_deployments SET paused")) {
            const [paused, id] = this._binds as [number, string];
            applyUpdate("cloud_deployments", id, { paused });
          } else if (sqlText.startsWith("UPDATE cloud_deployments SET last_pushed_at")) {
            const [last_pushed_at, build_sha, id] = this._binds as [string, string, string];
            applyUpdate("cloud_deployments", id, {
              last_pushed_at,
              build_sha,
              last_push_error: null
            });
          } else if (sqlText.startsWith("UPDATE cloud_deployments SET last_push_error")) {
            const [last_push_error, id] = this._binds as [string, string];
            applyUpdate("cloud_deployments", id, { last_push_error });
          } else if (sqlText.startsWith("UPDATE cloud_deployments SET encrypted_token_b64")) {
            const [encrypted_token_b64, encryption_iv_b64, id] = this._binds as [
              string, string, string
            ];
            applyUpdate("cloud_deployments", id, {
              encrypted_token_b64,
              encryption_iv_b64,
              last_push_error: null
            });
          } else if (sqlText.startsWith("INSERT INTO cloud_manage_tokens")) {
            const [token, deployment_id, created_at, expires_at] = this._binds as [
              string, string, string, string
            ];
            manageTokens.push({
              token,
              deployment_id,
              created_at,
              expires_at,
              revoked: 0
            });
          } else if (sqlText.startsWith("UPDATE cloud_manage_tokens SET revoked")) {
            const [token] = this._binds as [string];
            applyUpdate("cloud_manage_tokens", token, { revoked: 1 });
          } else if (sqlText.startsWith("INSERT INTO cloud_push_log")) {
            const [deployment_id, kind, build_sha, detail] = this._binds as [
              string, string, string | null, string | null
            ];
            log.push({
              id: logSeq++,
              deployment_id,
              ts: new Date().toISOString(),
              kind,
              build_sha,
              detail
            });
          }
          return { meta: { changes: 0 } };
        },
        async first<T = unknown>() {
          if (sqlText().startsWith("SELECT id, customer_id as customerId")) {
            const id = this._binds[0] as string;
            const row = deployments.find((r) => r.id === id);
            if (!row) return null as unknown as T;
            return mapDeployment(row) as unknown as T;
          }
          if (sqlText().startsWith("SELECT token, deployment_id as deploymentId")) {
            const token = this._binds[0] as string;
            const row = manageTokens.find((r) => r.token === token);
            if (!row) return null as unknown as T;
            return mapManage(row) as unknown as T;
          }
          return null as unknown as T;
          function sqlText(): string {
            return collapsed;
          }
        },
        async all<T = unknown>() {
          if (collapsed.startsWith("SELECT id, customer_id as customerId")) {
            // listActiveDeployments — paused = 0 only.
            const rows = deployments
              .filter((r) => r.paused === 0)
              .sort((a, b) => {
                const aTs = a.last_pushed_at ?? "";
                const bTs = b.last_pushed_at ?? "";
                if (aTs === bTs) return a.created_at.localeCompare(b.created_at);
                return aTs.localeCompare(bTs);
              })
              .map(mapDeployment);
            return { results: rows as unknown as T[] };
          }
          if (collapsed.startsWith("SELECT id, ts, kind")) {
            const id = this._binds[0] as string;
            const limit = this._binds[1] as number;
            const rows = log
              .filter((r) => r.deployment_id === id)
              .sort((a, b) => b.ts.localeCompare(a.ts))
              .slice(0, limit)
              .map((r) => ({
                id: r.id,
                ts: r.ts,
                kind: r.kind,
                buildSha: r.build_sha,
                detail: r.detail
              }));
            return { results: rows as unknown as T[] };
          }
          return { results: [] as T[] };
        }
      };
    }
  } as unknown as D1Database;

  return { db, deployments, manageTokens, log };
}

function mapDeployment(r: DeployRow) {
  return {
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
  };
}
function mapManage(r: ManageRow) {
  return {
    token: r.token,
    deploymentId: r.deployment_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revoked: r.revoked
  };
}

function sampleInsert(id = "dep-1") {
  return {
    id,
    customerId: "cus_x",
    accountId: "acc-1",
    workerName: "helm",
    encryptedTokenB64: "ZW5jcnlwdGVk",
    encryptionIvB64: "aXY=",
    workerUrl: "https://helm.workers.dev"
  };
}

describe("deployments repository", () => {
  it("insertDeployment + getDeployment round-trip", async () => {
    const { db, deployments } = fakeDb();
    const d = await insertDeployment(db, sampleInsert());
    expect(d.paused).toBe(0);
    expect(d.lastPushedAt).toBeNull();
    expect(deployments).toHaveLength(1);
    const fetched = await getDeployment(db, "dep-1");
    expect(fetched).toBeTruthy();
    expect(fetched!.workerName).toBe("helm");
  });

  it("setPaused flips the flag and writes to push_log", async () => {
    const { db, log } = fakeDb();
    await insertDeployment(db, sampleInsert());
    await setPaused(db, "dep-1", true);
    expect(log[log.length - 1].kind).toBe("paused");
    await setPaused(db, "dep-1", false);
    expect(log[log.length - 1].kind).toBe("resumed");
  });

  it("listActiveDeployments skips paused rows", async () => {
    const { db } = fakeDb();
    await insertDeployment(db, sampleInsert("a"));
    await insertDeployment(db, sampleInsert("b"));
    await setPaused(db, "a", true);
    const active = await listActiveDeployments(db);
    expect(active.map((r) => r.id)).toEqual(["b"]);
  });

  it("issue + resolve manage token; expired and revoked tokens reject", async () => {
    const { db, manageTokens } = fakeDb();
    await insertDeployment(db, sampleInsert());
    const token = await issueManageToken(db, "dep-1");
    expect(token.length).toBe(43);
    const fresh = await resolveManageToken(db, token);
    expect(fresh).not.toBeNull();
    expect(fresh!.deploymentId).toBe("dep-1");
    // Expire it manually.
    manageTokens[0].expires_at = "2000-01-01T00:00:00Z";
    expect(await resolveManageToken(db, token)).toBeNull();
    // Revoke a fresh one.
    manageTokens[0].expires_at = "2099-01-01T00:00:00Z";
    await revokeManageToken(db, token);
    expect(await resolveManageToken(db, token)).toBeNull();
  });

  it("rotateToken updates ciphertext + IV + clears last_push_error", async () => {
    const { db, deployments, log } = fakeDb();
    await insertDeployment(db, sampleInsert());
    deployments[0].last_push_error = "stale token";
    await rotateToken(db, "dep-1", "new-cipher", "new-iv");
    expect(deployments[0].encrypted_token_b64).toBe("new-cipher");
    expect(deployments[0].encryption_iv_b64).toBe("new-iv");
    expect(deployments[0].last_push_error).toBeNull();
    expect(log[log.length - 1].kind).toBe("token-rotated");
  });

  it("recordPushSuccess + recordPushFailure write the right columns", async () => {
    const { db, deployments, log } = fakeDb();
    await insertDeployment(db, sampleInsert());
    await recordPushSuccess(db, "dep-1", "abc1234");
    expect(deployments[0].build_sha).toBe("abc1234");
    expect(deployments[0].last_pushed_at).not.toBeNull();
    expect(log.find((e) => e.kind === "push-success")).toBeTruthy();

    await recordPushFailure(db, "dep-1", "abc1234", "rate limited");
    expect(deployments[0].last_push_error).toMatch(/rate limited/);
    expect(log.find((e) => e.kind === "push-failure")).toBeTruthy();
  });

  it("appendPushLog + listPushLog round-trip", async () => {
    const { db } = fakeDb();
    await insertDeployment(db, sampleInsert());
    await appendPushLog(db, "dep-1", "deploy-created", null, null);
    await appendPushLog(db, "dep-1", "push-success", "sha1", null);
    const entries = await listPushLog(db, "dep-1");
    expect(entries.length).toBe(2);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("deploy-created");
    expect(kinds).toContain("push-success");
    const success = entries.find((e) => e.kind === "push-success");
    expect(success?.buildSha).toBe("sha1");
  });
});
