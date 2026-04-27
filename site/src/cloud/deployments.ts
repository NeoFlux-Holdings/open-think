/**
 * Cloud-deployment repository — every read/write of `cloud_deployments`,
 * `cloud_manage_tokens`, and `cloud_push_log` lives here.
 *
 * No business logic in this file; just D1 calls + small mappers. The cron
 * pusher and the manage-page route handlers are the only callers.
 */

import { generateManageToken } from "./crypto";

export interface CloudDeploymentRow {
  id: string;
  customerId: string;
  accountId: string;
  workerName: string;
  encryptedTokenB64: string;
  encryptionIvB64: string;
  workerUrl: string | null;
  buildSha: string | null;
  paused: number; // 0 | 1
  createdAt: string;
  lastPushedAt: string | null;
  lastPushError: string | null;
}

export interface CloudManageTokenRow {
  token: string;
  deploymentId: string;
  createdAt: string;
  expiresAt: string;
  revoked: number;
}

export type PushLogKind =
  | "push-success"
  | "push-failure"
  | "paused"
  | "resumed"
  | "token-rotated"
  | "deploy-created";

/* ---------------- create / read ---------------- */

export async function insertDeployment(
  db: D1Database,
  input: Omit<CloudDeploymentRow, "createdAt" | "paused" | "lastPushedAt" | "lastPushError" | "buildSha"> & {
    buildSha?: string | null;
  }
): Promise<CloudDeploymentRow> {
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO cloud_deployments (
        id, customer_id, account_id, worker_name,
        encrypted_token_b64, encryption_iv_b64,
        worker_url, build_sha, paused,
        created_at, last_pushed_at, last_push_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)`
    )
    .bind(
      input.id,
      input.customerId,
      input.accountId,
      input.workerName,
      input.encryptedTokenB64,
      input.encryptionIvB64,
      input.workerUrl,
      input.buildSha ?? null,
      createdAt
    )
    .run();
  return {
    id: input.id,
    customerId: input.customerId,
    accountId: input.accountId,
    workerName: input.workerName,
    encryptedTokenB64: input.encryptedTokenB64,
    encryptionIvB64: input.encryptionIvB64,
    workerUrl: input.workerUrl,
    buildSha: input.buildSha ?? null,
    paused: 0,
    createdAt,
    lastPushedAt: null,
    lastPushError: null
  };
}

export async function getDeployment(
  db: D1Database,
  id: string
): Promise<CloudDeploymentRow | null> {
  const r = await db
    .prepare(
      `SELECT id, customer_id as customerId, account_id as accountId,
              worker_name as workerName, encrypted_token_b64 as encryptedTokenB64,
              encryption_iv_b64 as encryptionIvB64, worker_url as workerUrl,
              build_sha as buildSha, paused,
              created_at as createdAt, last_pushed_at as lastPushedAt,
              last_push_error as lastPushError
         FROM cloud_deployments WHERE id = ?`
    )
    .bind(id)
    .first<CloudDeploymentRow>();
  return r ?? null;
}

export async function listActiveDeployments(
  db: D1Database
): Promise<CloudDeploymentRow[]> {
  const r = await db
    .prepare(
      `SELECT id, customer_id as customerId, account_id as accountId,
              worker_name as workerName, encrypted_token_b64 as encryptedTokenB64,
              encryption_iv_b64 as encryptionIvB64, worker_url as workerUrl,
              build_sha as buildSha, paused,
              created_at as createdAt, last_pushed_at as lastPushedAt,
              last_push_error as lastPushError
         FROM cloud_deployments
        WHERE paused = 0
        ORDER BY last_pushed_at NULLS FIRST, created_at ASC`
    )
    .all<CloudDeploymentRow>();
  return r.results ?? [];
}

export async function listDeploymentsForCustomer(
  db: D1Database,
  customerId: string
): Promise<CloudDeploymentRow[]> {
  const r = await db
    .prepare(
      `SELECT id, customer_id as customerId, account_id as accountId,
              worker_name as workerName, encrypted_token_b64 as encryptedTokenB64,
              encryption_iv_b64 as encryptionIvB64, worker_url as workerUrl,
              build_sha as buildSha, paused,
              created_at as createdAt, last_pushed_at as lastPushedAt,
              last_push_error as lastPushError
         FROM cloud_deployments
        WHERE customer_id = ?
        ORDER BY created_at DESC`
    )
    .bind(customerId)
    .all<CloudDeploymentRow>();
  return r.results ?? [];
}

/* ---------------- update ---------------- */

export async function setPaused(
  db: D1Database,
  id: string,
  paused: boolean
): Promise<void> {
  await db
    .prepare(`UPDATE cloud_deployments SET paused = ? WHERE id = ?`)
    .bind(paused ? 1 : 0, id)
    .run();
  await appendPushLog(db, id, paused ? "paused" : "resumed", null, null);
}

export async function recordPushSuccess(
  db: D1Database,
  id: string,
  buildSha: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE cloud_deployments
          SET last_pushed_at = ?, build_sha = ?, last_push_error = NULL
        WHERE id = ?`
    )
    .bind(new Date().toISOString(), buildSha, id)
    .run();
  await appendPushLog(db, id, "push-success", buildSha, null);
}

export async function recordPushFailure(
  db: D1Database,
  id: string,
  buildSha: string,
  error: string
): Promise<void> {
  await db
    .prepare(`UPDATE cloud_deployments SET last_push_error = ? WHERE id = ?`)
    .bind(error.slice(0, 500), id)
    .run();
  await appendPushLog(db, id, "push-failure", buildSha, error.slice(0, 500));
}

export async function rotateToken(
  db: D1Database,
  id: string,
  encryptedTokenB64: string,
  encryptionIvB64: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE cloud_deployments
          SET encrypted_token_b64 = ?, encryption_iv_b64 = ?, last_push_error = NULL
        WHERE id = ?`
    )
    .bind(encryptedTokenB64, encryptionIvB64, id)
    .run();
  await appendPushLog(db, id, "token-rotated", null, null);
}

/* ---------------- manage tokens ---------------- */

export async function issueManageToken(
  db: D1Database,
  deploymentId: string,
  ttlDays = 30
): Promise<string> {
  const token = generateManageToken();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86400_000);
  await db
    .prepare(
      `INSERT INTO cloud_manage_tokens (token, deployment_id, created_at, expires_at, revoked)
       VALUES (?, ?, ?, ?, 0)`
    )
    .bind(token, deploymentId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

export async function resolveManageToken(
  db: D1Database,
  token: string
): Promise<CloudManageTokenRow | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT token, deployment_id as deploymentId,
              created_at as createdAt, expires_at as expiresAt, revoked
         FROM cloud_manage_tokens WHERE token = ?`
    )
    .bind(token)
    .first<CloudManageTokenRow>();
  if (!row) return null;
  if (row.revoked) return null;
  if (Date.parse(row.expiresAt) < Date.now()) return null;
  return row;
}

export async function revokeManageToken(db: D1Database, token: string): Promise<void> {
  await db.prepare(`UPDATE cloud_manage_tokens SET revoked = 1 WHERE token = ?`).bind(token).run();
}

/* ---------------- audit log ---------------- */

export async function appendPushLog(
  db: D1Database,
  deploymentId: string,
  kind: PushLogKind,
  buildSha: string | null,
  detail: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cloud_push_log (deployment_id, kind, build_sha, detail) VALUES (?, ?, ?, ?)`
    )
    .bind(deploymentId, kind, buildSha, detail)
    .run();
}

export interface PushLogEntry {
  id: number;
  ts: string;
  kind: PushLogKind;
  buildSha: string | null;
  detail: string | null;
}

export async function listPushLog(
  db: D1Database,
  deploymentId: string,
  limit = 50
): Promise<PushLogEntry[]> {
  const r = await db
    .prepare(
      `SELECT id, ts, kind, build_sha as buildSha, detail
         FROM cloud_push_log WHERE deployment_id = ?
        ORDER BY ts DESC LIMIT ?`
    )
    .bind(deploymentId, limit)
    .all<PushLogEntry>();
  return r.results ?? [];
}
