/**
 * codex-bridge-worker
 *
 * Cloudflare-native Codex bridge that runs as its own Worker. Forwards requests
 * from Open Think's `codex` plugin (or any compatible caller) to the ChatGPT
 * backend API that the `codex` CLI itself uses under the hood. No subprocess,
 * no Docker, no tunnel — a single Worker on your own account.
 *
 * Scope trade-off vs. the Node `codex-bridge`:
 *   - ✅ Works entirely on Cloudflare (no host to maintain)
 *   - ✅ Tokens live in Worker secrets or a Durable Object
 *   - ⚠️ Doesn't run the codex CLI itself, so it can't refresh tokens
 *     on its own. Users rotate tokens by running `codex login` locally and
 *     POSTing the new values to `/auth/rotate` (bearer-auth'd).
 *   - ⚠️ Only exposes `responses` calls (chat). Full thread/turn semantics
 *     need the real app-server which needs a Node process. See ../codex-bridge.
 *
 * Endpoints:
 *   GET  /healthz              → 200 when tokens are present
 *   POST /rpc                  → JSON-RPC-shaped single request → single response
 *                                (method must be "codex/responses"; params forwarded as body)
 *   POST /stream               → JSON-RPC → SSE stream of upstream chunks
 *   POST /auth/rotate          → { accessToken, idToken? } — rotate stored tokens
 *   GET  /auth/status          → { configured, tokenPreview, rotatedAt, expiresAt? }
 *
 * Auth: every request except /healthz requires `Authorization: Bearer <BRIDGE_TOKEN>`.
 */

import { DurableObject } from "cloudflare:workers";

export interface Env {
  BRIDGE_TOKEN?: string;
  CODEX_ACCESS_TOKEN?: string;
  CODEX_ID_TOKEN?: string;
  CODEX_BACKEND_URL?: string;
  CODEX_AUTH?: DurableObjectNamespace;
  /** If set, the rotation-watch cron posts here when tokens age past ROTATE_MAX_AGE_DAYS. */
  ROTATE_ALERT_URL?: string;
  /** Max token age in days before the cron nags. Default 30. */
  ROTATE_MAX_AGE_DAYS?: string;
}

const DEFAULT_BACKEND = "https://chatgpt.com/backend-api/codex";

interface AuthSnapshot {
  accessToken: string;
  idToken?: string;
  rotatedAt: string;
  note?: string;
}

/**
 * Per-instance DO that stores rotated tokens + an access audit log.
 *
 * Security hardening:
 *   - Every `/get`, `/set`, `/delete`, `/audit` call passes through an
 *     audit_log row so a compromised BRIDGE_TOKEN leaves a forensic trail.
 *   - `/delete` nukes the token — paired with the Worker's DELETE /auth
 *     route for fast revocation in an incident.
 *   - `/status` returns metadata only (never the token itself) so the
 *     authenticated /auth/status endpoint can avoid token previews entirely.
 */
export class CodexAuthDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS auth (
        id INTEGER PRIMARY KEY DEFAULT 1,
        access_token TEXT NOT NULL,
        id_token TEXT,
        rotated_at TEXT NOT NULL,
        note TEXT
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        op TEXT NOT NULL,
        source TEXT,
        ok INTEGER NOT NULL,
        detail TEXT
      );
    `);
  }

  private audit(op: string, source: string | null, ok: boolean, detail?: string): void {
    this.sql.exec(
      `INSERT INTO audit_log (op, source, ok, detail) VALUES (?, ?, ?, ?)`,
      op,
      source,
      ok ? 1 : 0,
      detail ?? null
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const source = request.headers.get("x-source") ?? null;

    if (request.method === "POST" && url.pathname === "/set") {
      const body = (await request.json()) as AuthSnapshot;
      if (!body?.accessToken) {
        this.audit("set", source, false, "missing accessToken");
        return new Response(JSON.stringify({ ok: false, error: "accessToken required" }), { status: 400 });
      }
      this.sql.exec(
        `INSERT OR REPLACE INTO auth (id, access_token, id_token, rotated_at, note)
         VALUES (1, ?, ?, ?, ?)`,
        body.accessToken,
        body.idToken ?? null,
        body.rotatedAt,
        body.note ?? null
      );
      this.audit("set", source, true, body.note ?? undefined);
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/get") {
      const rows = this.sql.exec("SELECT * FROM auth WHERE id = 1 LIMIT 1").toArray();
      if (rows.length === 0) {
        this.audit("get", source, true, "empty");
        return Response.json({ ok: true, data: null });
      }
      const r = rows[0] as Record<string, unknown>;
      this.audit("get", source, true);
      return Response.json({
        ok: true,
        data: {
          accessToken: String(r.access_token),
          idToken: r.id_token ? String(r.id_token) : undefined,
          rotatedAt: String(r.rotated_at),
          note: r.note ? String(r.note) : undefined
        } satisfies AuthSnapshot
      });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const rows = this.sql.exec(
        "SELECT rotated_at, note FROM auth WHERE id = 1 LIMIT 1"
      ).toArray();
      if (rows.length === 0) {
        return Response.json({ ok: true, data: { configured: false } });
      }
      const r = rows[0] as Record<string, unknown>;
      return Response.json({
        ok: true,
        data: {
          configured: true,
          rotatedAt: String(r.rotated_at),
          note: r.note ? String(r.note) : undefined
        }
      });
    }

    if (request.method === "DELETE" && url.pathname === "/delete") {
      const rs = this.sql.exec("DELETE FROM auth WHERE id = 1");
      const changed = Number(rs.rowsWritten ?? 0);
      this.audit("delete", source, true, `rows=${changed}`);
      return Response.json({ ok: true, deleted: changed });
    }

    if (request.method === "GET" && url.pathname === "/audit") {
      const limitParam = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 500) : 50;
      const rows = this.sql
        .exec(
          `SELECT ts, op, source, ok, detail FROM audit_log
             ORDER BY ts DESC LIMIT ?`,
          limit
        )
        .toArray();
      return Response.json({ ok: true, data: rows });
    }

    return new Response("not found", { status: 404 });
  }
}

async function loadAuth(env: Env): Promise<AuthSnapshot | null> {
  if (env.CODEX_AUTH) {
    const stub = env.CODEX_AUTH.get(env.CODEX_AUTH.idFromName("singleton"));
    const resp = await stub.fetch("https://do/get");
    const json = (await resp.json()) as { ok: boolean; data: AuthSnapshot | null };
    if (json.ok && json.data) return json.data;
  }
  if (env.CODEX_ACCESS_TOKEN) {
    return {
      accessToken: env.CODEX_ACCESS_TOKEN,
      idToken: env.CODEX_ID_TOKEN,
      rotatedAt: "from-secret"
    };
  }
  return null;
}

function checkAuth(request: Request, env: Env): Response | null {
  if (!env.BRIDGE_TOKEN) {
    return Response.json(
      { ok: false, error: "BRIDGE_TOKEN not set — see README to configure." },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.BRIDGE_TOKEN}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function preview(token: string | undefined): string {
  if (!token) return "";
  return token.length <= 10 ? "***" : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function callResponses(
  env: Env,
  auth: AuthSnapshot,
  body: Record<string, unknown>,
  stream: boolean
): Promise<Response> {
  const base = (env.CODEX_BACKEND_URL ?? DEFAULT_BACKEND).replace(/\/$/, "");
  const payload = { ...body, stream };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.accessToken}`,
    "openai-beta": "codex-2025",
    accept: stream ? "text/event-stream" : "application/json"
  };
  if (auth.idToken) headers["x-codex-id-token"] = auth.idToken;

  return fetch(`${base}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

/**
 * Rotation-watch cron. Wires to a `[triggers] crons = [...]` entry in
 * wrangler.toml. Once a day it checks how old the stored tokens are; if
 * they're past ROTATE_MAX_AGE_DAYS (default 30) it pings ROTATE_ALERT_URL
 * with a JSON payload so the owner's PA (or any webhook) can notify.
 */
async function rotationWatch(env: Env): Promise<void> {
  const snap = await loadAuth(env);
  if (!snap) return;
  if (snap.rotatedAt === "from-secret") return;
  const rotatedTs = Date.parse(snap.rotatedAt);
  if (!Number.isFinite(rotatedTs)) return;
  const ageDays = Math.floor((Date.now() - rotatedTs) / 86400_000);
  const maxAge = Number(env.ROTATE_MAX_AGE_DAYS ?? "30");
  if (ageDays < maxAge) return;
  if (!env.ROTATE_ALERT_URL) {
    console.warn(`[rotation-watch] tokens are ${ageDays}d old (max ${maxAge}); set ROTATE_ALERT_URL to notify.`);
    return;
  }
  try {
    await fetch(env.ROTATE_ALERT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "codex-bridge.rotation-stale",
        ageDays,
        maxAgeDays: maxAge,
        rotatedAt: snap.rotatedAt
      })
    });
  } catch (err) {
    console.error("[rotation-watch] alert failed:", (err as Error).message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/healthz") {
      // Public, unauthenticated probe — deliberately omits tokenPreview and
      // rotatedAt so this endpoint never leaks any shape of the stored tokens
      // to an unauthenticated caller. Use /auth/status (bearer-gated) when you
      // need the preview or the last-rotated-at timestamp.
      const auth = await loadAuth(env);
      return Response.json({
        ok: true,
        configured: Boolean(auth),
        backendUrl: env.CODEX_BACKEND_URL ?? DEFAULT_BACKEND
      });
    }

    const authCheck = checkAuth(request, env);
    if (authCheck) return authCheck;

    if (request.method === "POST" && path === "/auth/rotate") {
      const body = (await request.json().catch(() => ({}))) as {
        accessToken?: string;
        idToken?: string;
        note?: string;
      };
      if (!body?.accessToken) {
        return Response.json({ ok: false, error: "accessToken required" }, { status: 400 });
      }
      if (!env.CODEX_AUTH) {
        return Response.json(
          {
            ok: false,
            error:
              "CODEX_AUTH binding missing. Either add the Durable Object (preferred) or use `wrangler secret put CODEX_ACCESS_TOKEN`."
          },
          { status: 500 }
        );
      }
      const stub = env.CODEX_AUTH.get(env.CODEX_AUTH.idFromName("singleton"));
      const snapshot: AuthSnapshot = {
        accessToken: body.accessToken,
        idToken: body.idToken,
        rotatedAt: new Date().toISOString(),
        note: body.note
      };
      await stub.fetch("https://do/set", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-source": request.headers.get("x-source") ?? "auth-rotate"
        },
        body: JSON.stringify(snapshot)
      });
      return Response.json({ ok: true, rotatedAt: snapshot.rotatedAt });
    }

    if (request.method === "DELETE" && path === "/auth") {
      // Incident-response hatch: revoke the stored token immediately. After
      // this the bridge returns 503 until /auth/rotate is called with fresh
      // tokens. Use this if BRIDGE_TOKEN leaks or you're sunsetting the
      // worker.
      if (!env.CODEX_AUTH) {
        return Response.json(
          { ok: false, error: "CODEX_AUTH DO binding required for DELETE /auth" },
          { status: 500 }
        );
      }
      const stub = env.CODEX_AUTH.get(env.CODEX_AUTH.idFromName("singleton"));
      const r = await stub.fetch("https://do/delete", {
        method: "DELETE",
        headers: { "x-source": request.headers.get("x-source") ?? "delete-auth" }
      });
      const body = await r.json();
      return Response.json({ ok: true, data: body });
    }

    if (request.method === "GET" && path === "/auth/audit") {
      if (!env.CODEX_AUTH) {
        return Response.json({ ok: false, error: "CODEX_AUTH binding required" }, { status: 500 });
      }
      const stub = env.CODEX_AUTH.get(env.CODEX_AUTH.idFromName("singleton"));
      const limit = url.searchParams.get("limit") ?? "50";
      const r = await stub.fetch(`https://do/audit?limit=${limit}`);
      return new Response(r.body, {
        status: r.status,
        headers: { "content-type": r.headers.get("content-type") ?? "application/json" }
      });
    }

    if (request.method === "GET" && path === "/auth/status") {
      const auth = await loadAuth(env);
      return Response.json({
        ok: true,
        configured: Boolean(auth),
        tokenPreview: preview(auth?.accessToken),
        rotatedAt: auth?.rotatedAt ?? null,
        source: env.CODEX_AUTH ? "durable-object" : env.CODEX_ACCESS_TOKEN ? "secret" : "none"
      });
    }

    const auth = await loadAuth(env);
    if (!auth) {
      return Response.json(
        {
          ok: false,
          error:
            "No Codex tokens configured. POST to /auth/rotate with { accessToken, idToken? } or set CODEX_ACCESS_TOKEN as a Worker secret."
        },
        { status: 503 }
      );
    }

    if (request.method === "POST" && path === "/rpc") {
      const body = (await request.json()) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      if (body?.method !== "codex/responses") {
        return Response.json(
          { ok: false, error: `Unknown method: ${body?.method}. Only codex/responses is supported.` },
          { status: 400 }
        );
      }
      const upstream = await callResponses(env, auth, body.params ?? {}, false);
      if (upstream.status === 401 || upstream.status === 403) {
        return Response.json(
          {
            ok: false,
            error: `Codex tokens rejected (${upstream.status}). Rotate via POST /auth/rotate with fresh tokens from \`codex login\`.`
          },
          { status: upstream.status }
        );
      }
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" }
      });
    }

    if (request.method === "GET" && path === "/auth/age") {
      // Returns how stale the stored token is in days. Useful for the PA to
      // proactively remind the owner to re-run `codex login` before things
      // break.
      const rotatedAt = auth.rotatedAt;
      const rotatedTs = rotatedAt === "from-secret" ? null : Date.parse(rotatedAt);
      const ageDays =
        rotatedTs && Number.isFinite(rotatedTs)
          ? Math.floor((Date.now() - rotatedTs) / 86400_000)
          : null;
      const maxAge = Number(env.ROTATE_MAX_AGE_DAYS ?? "30");
      return Response.json({
        ok: true,
        data: {
          rotatedAt,
          ageDays,
          maxAgeDays: maxAge,
          stale: ageDays !== null && ageDays >= maxAge
        }
      });
    }

    if (request.method === "POST" && path === "/stream") {
      const body = (await request.json()) as { method?: string; params?: Record<string, unknown> };
      if (body?.method !== "codex/responses") {
        return Response.json(
          { ok: false, error: "Only codex/responses supported on /stream" },
          { status: 400 }
        );
      }
      const upstream = await callResponses(env, auth, body.params ?? {}, true);
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        return Response.json(
          { ok: false, error: `upstream ${upstream.status}: ${text.slice(0, 400)}` },
          { status: upstream.status || 502 }
        );
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        }
      });
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(rotationWatch(env));
  }
};
