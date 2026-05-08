import { describe, expect, it, beforeEach } from "vitest";
import { ChatSessionStore, newId } from "../src/chatSessions";

/**
 * In-memory D1 fake. Implements the subset of the D1Database surface
 * that ChatSessionStore actually uses: prepare → bind → first/all/run,
 * plus batch(). Mirrors the existing fakeDb shape from pushUpdates
 * tests but with full schema-aware row tracking.
 */
function fakeD1(): D1Database {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    chat_projects: [],
    chat_sessions: []
  };

  function exec(sql: string, params: unknown[]): { rows: Array<Record<string, unknown>>; changes: number } {
    const collapsed = sql.replace(/\s+/g, " ").trim();

    // CREATE TABLE / CREATE INDEX → no-op (assume schema exists)
    if (/^CREATE\s+(TABLE|INDEX|VIRTUAL\s+TABLE)/i.test(collapsed)) {
      return { rows: [], changes: 0 };
    }

    // INSERT
    let m = /^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(collapsed);
    if (m) {
      const [, table, colsRaw] = m;
      const cols = colsRaw.split(",").map((s) => s.trim());
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        row[c] = params[i] === undefined ? null : params[i];
      });
      tables[table].push(row);
      return { rows: [row], changes: 1 };
    }

    // SELECT … FROM chat_sessions s LEFT JOIN chat_projects p
    if (/SELECT.*FROM\s+chat_sessions\s+s\s+LEFT\s+JOIN\s+chat_projects\s+p/i.test(collapsed)) {
      const userEmail = params[0] as string;
      const limit = params[params.length - 1] as number;
      const archivedOnly = !/archived_at IS NULL/.test(collapsed);
      let rows = tables.chat_sessions
        .filter((r) => r.user_email === userEmail)
        .filter((r) => archivedOnly || r.archived_at === null);
      rows.sort((a, b) => Number(b.last_message_at) - Number(a.last_message_at));
      rows = rows.slice(0, limit);
      const enriched = rows.map((r) => {
        const proj = tables.chat_projects.find((p) => p.id === r.project_id);
        return { ...r, project_name: proj?.name ?? null };
      });
      return { rows: enriched, changes: 0 };
    }

    // SELECT … FROM chat_projects p with subquery for session_count
    if (/SELECT.*FROM\s+chat_projects\s+p\s+WHERE\s+p\.user_email/i.test(collapsed)) {
      const userEmail = params[0] as string;
      const archivedOnly = !/archived_at IS NULL/.test(collapsed);
      const rows = tables.chat_projects
        .filter((r) => r.user_email === userEmail)
        .filter((r) => archivedOnly || r.archived_at === null)
        .map((r) => ({
          ...r,
          session_count: tables.chat_sessions.filter(
            (s) => s.project_id === r.id && s.archived_at === null
          ).length
        }));
      (rows as Array<Record<string, unknown>>).sort(
        (a, b) => Number(b.created_at) - Number(a.created_at)
      );
      return { rows, changes: 0 };
    }

    // SELECT * FROM chat_sessions WHERE id = ? AND user_email = ?
    m = /^SELECT[\s\S]+FROM\s+chat_sessions\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const [id, email] = params as [string, string];
      const row = tables.chat_sessions.find((r) => r.id === id && r.user_email === email);
      return { rows: row ? [row] : [], changes: 0 };
    }

    // SELECT * FROM chat_projects WHERE id = ? AND user_email = ?
    m = /^SELECT[\s\S]+FROM\s+chat_projects\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const [id, email] = params as [string, string];
      const row = tables.chat_projects.find((r) => r.id === id && r.user_email === email);
      return { rows: row ? [row] : [], changes: 0 };
    }

    // UPDATE chat_sessions SET ... WHERE id = ? AND user_email = ?
    m = /^UPDATE\s+chat_sessions\s+SET\s+(.+?)\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const setExpr = m[1];
      const fields = setExpr.split(",").map((s) => s.trim().split("=")[0].trim());
      const id = params[params.length - 2] as string;
      const email = params[params.length - 1] as string;
      const row = tables.chat_sessions.find((r) => r.id === id && r.user_email === email);
      if (!row) return { rows: [], changes: 0 };
      // touchSession's UPDATE has `last_message_at = ?, message_count = message_count + 1`.
      // The "message_count + 1" branch isn't a regular bind; handle inline.
      if (/message_count\s*=\s*message_count\s*\+\s*1/.test(setExpr)) {
        row.last_message_at = params[0];
        row.message_count = Number(row.message_count) + 1;
      } else {
        fields.forEach((f, i) => {
          row[f] = params[i] === undefined ? null : params[i];
        });
      }
      return { rows: [row], changes: 1 };
    }

    m = /^UPDATE\s+chat_projects\s+SET\s+(.+?)\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const setExpr = m[1];
      const fields = setExpr.split(",").map((s) => s.trim().split("=")[0].trim());
      const id = params[params.length - 2] as string;
      const email = params[params.length - 1] as string;
      const row = tables.chat_projects.find((r) => r.id === id && r.user_email === email);
      if (!row) return { rows: [], changes: 0 };
      fields.forEach((f, i) => {
        row[f] = params[i] === undefined ? null : params[i];
      });
      return { rows: [row], changes: 1 };
    }

    // UPDATE chat_sessions SET project_id = NULL WHERE project_id = ? AND user_email = ?
    m = /^UPDATE\s+chat_sessions\s+SET\s+project_id\s*=\s*NULL\s+WHERE\s+project_id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const [pid, email] = params as [string, string];
      let changes = 0;
      for (const r of tables.chat_sessions) {
        if (r.project_id === pid && r.user_email === email) {
          r.project_id = null;
          changes += 1;
        }
      }
      return { rows: [], changes };
    }

    // DELETE FROM chat_sessions WHERE id = ? AND user_email = ?
    m = /^DELETE\s+FROM\s+chat_sessions\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const [id, email] = params as [string, string];
      const before = tables.chat_sessions.length;
      tables.chat_sessions = tables.chat_sessions.filter((r) => !(r.id === id && r.user_email === email));
      return { rows: [], changes: before - tables.chat_sessions.length };
    }

    m = /^DELETE\s+FROM\s+chat_projects\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_email\s*=\s*\?/i.exec(collapsed);
    if (m) {
      const [id, email] = params as [string, string];
      const before = tables.chat_projects.length;
      tables.chat_projects = tables.chat_projects.filter((r) => !(r.id === id && r.user_email === email));
      return { rows: [], changes: before - tables.chat_projects.length };
    }

    throw new Error(`fakeD1 unhandled SQL: ${collapsed}`);
  }

  function makeStmt(sql: string) {
    let binds: unknown[] = [];
    return {
      bind(...args: unknown[]) {
        binds = args;
        return this;
      },
      async first<T = unknown>(): Promise<T | null> {
        const r = exec(sql, binds);
        return (r.rows[0] as T) ?? null;
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        const r = exec(sql, binds);
        return { results: r.rows as T[] };
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const r = exec(sql, binds);
        return { meta: { changes: r.changes } };
      }
    };
  }

  return {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async batch(stmts: Array<ReturnType<typeof makeStmt>>) {
      const results: Array<{ meta: { changes: number } }> = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    }
  } as unknown as D1Database;
}

describe("ChatSessionStore", () => {
  let store: ChatSessionStore;
  beforeEach(() => {
    store = new ChatSessionStore(fakeD1());
  });

  it("createSession + getSession round-trips with the right defaults", async () => {
    const created = await store.createSession({ id: "s_a", userEmail: "alice@example.com" });
    expect(created.title).toBeNull();
    expect(created.projectId).toBeNull();
    expect(created.archivedAt).toBeNull();
    expect(created.messageCount).toBe(0);

    const fetched = await store.getSession("s_a", "alice@example.com");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe("s_a");
  });

  it("getSession returns null for cross-user lookups (per-user isolation)", async () => {
    await store.createSession({ id: "s_a", userEmail: "alice@example.com" });
    const peek = await store.getSession("s_a", "mallory@example.com");
    expect(peek).toBeNull();
  });

  it("listSessions returns most-recent-first and filters by user", async () => {
    const now = Date.now();
    await store.createSession({ id: "s_a", userEmail: "alice@example.com", title: "older alice" });
    await new Promise((r) => setTimeout(r, 5));
    await store.createSession({ id: "s_b", userEmail: "bob@example.com", title: "bob's chat" });
    await new Promise((r) => setTimeout(r, 5));
    await store.createSession({ id: "s_c", userEmail: "alice@example.com", title: "newer alice" });

    const aliceList = await store.listSessions("alice@example.com");
    expect(aliceList.map((s) => s.id)).toEqual(["s_c", "s_a"]); // newer first
    expect(aliceList.every((s) => s.userEmail === "alice@example.com")).toBe(true);
    void now;
  });

  it("touchSession bumps recency + increments message count", async () => {
    await store.createSession({ id: "s_a", userEmail: "alice@example.com" });
    const before = await store.getSession("s_a", "alice@example.com");
    await new Promise((r) => setTimeout(r, 5));
    await store.touchSession("s_a", "alice@example.com");
    const after = await store.getSession("s_a", "alice@example.com");
    expect(after!.lastMessageAt).toBeGreaterThan(before!.lastMessageAt);
    expect(after!.messageCount).toBe(1);
  });

  it("updateSession patches title without touching projectId or archived", async () => {
    await store.createSession({ id: "s_a", userEmail: "alice@example.com", projectId: null });
    await store.updateSession("s_a", "alice@example.com", { title: "renamed" });
    const after = await store.getSession("s_a", "alice@example.com");
    expect(after!.title).toBe("renamed");
    expect(after!.projectId).toBeNull();
    expect(after!.archivedAt).toBeNull();
  });

  it("archive sets archived_at + filters from default listSessions", async () => {
    await store.createSession({ id: "s_a", userEmail: "alice@example.com", title: "active" });
    await store.createSession({ id: "s_b", userEmail: "alice@example.com", title: "to-archive" });
    await store.updateSession("s_b", "alice@example.com", { archived: true });

    const visible = await store.listSessions("alice@example.com");
    expect(visible.map((s) => s.id)).toEqual(["s_a"]);

    const all = await store.listSessions("alice@example.com", { includeArchived: true });
    expect(all.map((s) => s.id).sort()).toEqual(["s_a", "s_b"]);
  });

  it("createProject + listProjects returns the user's projects with sessionCount", async () => {
    await store.createProject({ id: "p_a", userEmail: "alice@example.com", name: "tomtom-claude" });
    await store.createProject({ id: "p_b", userEmail: "alice@example.com", name: "deploy form" });
    await store.createSession({ id: "s_a", userEmail: "alice@example.com", projectId: "p_a" });
    await store.createSession({ id: "s_b", userEmail: "alice@example.com", projectId: "p_a" });
    await store.createSession({ id: "s_c", userEmail: "alice@example.com", projectId: null });

    const projects = await store.listProjects("alice@example.com");
    const tomtom = projects.find((p) => p.id === "p_a")!;
    const deploy = projects.find((p) => p.id === "p_b")!;
    expect(tomtom.sessionCount).toBe(2);
    expect(deploy.sessionCount).toBe(0);
  });

  it("deleteProject moves its sessions to NULL project_id (untagged) without deleting them", async () => {
    await store.createProject({ id: "p_x", userEmail: "alice@example.com", name: "doomed" });
    await store.createSession({ id: "s_a", userEmail: "alice@example.com", projectId: "p_x", title: "kept" });

    const ok = await store.deleteProject("p_x", "alice@example.com");
    expect(ok).toBe(true);
    expect(await store.getProject("p_x", "alice@example.com")).toBeNull();
    const session = await store.getSession("s_a", "alice@example.com");
    expect(session).not.toBeNull();
    expect(session!.projectId).toBeNull();
  });

  it("deleteSession removes the row but leaves the project intact", async () => {
    await store.createProject({ id: "p_a", userEmail: "alice@example.com", name: "keep" });
    await store.createSession({ id: "s_a", userEmail: "alice@example.com", projectId: "p_a" });
    const ok = await store.deleteSession("s_a", "alice@example.com");
    expect(ok).toBe(true);
    expect(await store.getSession("s_a", "alice@example.com")).toBeNull();
    expect(await store.getProject("p_a", "alice@example.com")).not.toBeNull();
  });

  it("ensureSession is idempotent — second call returns the existing row", async () => {
    const first = await store.ensureSession({ id: "s_a", userEmail: "alice@example.com" });
    const second = await store.ensureSession({ id: "s_a", userEmail: "alice@example.com" });
    expect(second.createdAt).toBe(first.createdAt);
  });
});

describe("newId", () => {
  it("returns prefixed base64url with no padding", () => {
    const id = newId("s");
    expect(id).toMatch(/^s_[A-Za-z0-9_-]+$/);
    expect(id).not.toMatch(/=/);
    expect(id).not.toMatch(/[+/]/);
  });

  it("collisions are negligible", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newId("p"));
    expect(seen.size).toBe(1000);
  });
});
