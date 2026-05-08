/**
 * Chat sessions + projects index.
 *
 * The runtime stores each chat session's *messages* in an AgentSessionDO
 * keyed by session id. This file provides the **index** that lives in
 * D1 — what sessions exist, who owns them, what title they have, what
 * project they belong to. The DO is the source of truth for transcript
 * content; D1 is the source of truth for session metadata + ordering.
 *
 * Why D1 and not a singleton DO:
 *   - Cheap recency queries (`ORDER BY last_message_at DESC`)
 *   - Easy project joins
 *   - SQL filtering for archive/active
 *   - One round-trip per page load instead of N reads from a singleton
 *
 * Per-user isolation: every row carries `user_email` and every query
 * filters on it. The runtime is single-tenant today, but threading the
 * email through means we don't have to refactor when multi-user lands.
 *
 * Schema is created lazily via `ensureSchema()`; callers don't need to
 * run a migration step.
 */

export interface ChatSession {
  id: string;
  userEmail: string;
  title: string | null;
  projectId: string | null;
  createdAt: number;
  lastMessageAt: number;
  archivedAt: number | null;
  messageCount: number;
}

export interface ChatProject {
  id: string;
  userEmail: string;
  name: string;
  createdAt: number;
  archivedAt: number | null;
  /** Computed at list time; not stored. */
  sessionCount?: number;
}

export interface SessionListItem extends ChatSession {
  projectName: string | null;
}

export class ChatSessionStore {
  private schemaReady = false;

  constructor(private readonly db: D1Database) {}

  /**
   * Idempotently create both tables + indexes. Runs once per Worker
   * isolate (the schemaReady flag is per-instance, so a fresh isolate
   * will re-run; CREATE IF NOT EXISTS makes that cheap).
   */
  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS chat_projects (
          id TEXT PRIMARY KEY,
          user_email TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          archived_at INTEGER
        )`
      )
      .run();
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY,
          user_email TEXT NOT NULL,
          title TEXT,
          project_id TEXT,
          created_at INTEGER NOT NULL,
          last_message_at INTEGER NOT NULL,
          archived_at INTEGER,
          message_count INTEGER NOT NULL DEFAULT 0
        )`
      )
      .run();
    // Index for the most common query: list user's active sessions in
    // recency order. archived_at IS NULL clause uses this.
    await this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_recent
          ON chat_sessions(user_email, archived_at, last_message_at DESC)`
      )
      .run();
    // Index for project-scoped lists.
    await this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_chat_sessions_project
          ON chat_sessions(project_id, last_message_at DESC)`
      )
      .run();
    await this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_chat_projects_user
          ON chat_projects(user_email, archived_at)`
      )
      .run();
    this.schemaReady = true;
  }

  // ─── Sessions ──────────────────────────────────────────────────────

  async createSession(input: {
    id: string;
    userEmail: string;
    projectId?: string | null;
    title?: string | null;
  }): Promise<ChatSession> {
    await this.ensureSchema();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO chat_sessions
          (id, user_email, title, project_id, created_at, last_message_at, archived_at, message_count)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`
      )
      .bind(input.id, input.userEmail, input.title ?? null, input.projectId ?? null, now, now)
      .run();
    return {
      id: input.id,
      userEmail: input.userEmail,
      title: input.title ?? null,
      projectId: input.projectId ?? null,
      createdAt: now,
      lastMessageAt: now,
      archivedAt: null,
      messageCount: 0
    };
  }

  /**
   * Idempotent upsert — used when a chat starts streaming via WebSocket
   * before any explicit "create session" call. If the row already
   * exists, only `last_message_at` advances.
   */
  async ensureSession(input: {
    id: string;
    userEmail: string;
  }): Promise<ChatSession> {
    await this.ensureSchema();
    const existing = await this.getSession(input.id, input.userEmail);
    if (existing) return existing;
    return this.createSession(input);
  }

  async getSession(id: string, userEmail: string): Promise<ChatSession | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(
        `SELECT id, user_email, title, project_id, created_at, last_message_at, archived_at, message_count
         FROM chat_sessions
         WHERE id = ? AND user_email = ?`
      )
      .bind(id, userEmail)
      .first<{
        id: string;
        user_email: string;
        title: string | null;
        project_id: string | null;
        created_at: number;
        last_message_at: number;
        archived_at: number | null;
        message_count: number;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      userEmail: row.user_email,
      title: row.title,
      projectId: row.project_id,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
      archivedAt: row.archived_at,
      messageCount: row.message_count
    };
  }

  /**
   * List the user's sessions ordered by most-recent-message-first.
   * Joins chat_projects so the UI can group sessions under their
   * project header in a single round-trip.
   *
   * `includeArchived` defaults false — archived sessions hide from the
   * left rail unless explicitly requested.
   */
  async listSessions(
    userEmail: string,
    options: { includeArchived?: boolean; limit?: number } = {}
  ): Promise<SessionListItem[]> {
    await this.ensureSchema();
    const limit = Math.min(Math.max(1, options.limit ?? 200), 500);
    const archivedClause = options.includeArchived ? "" : "AND s.archived_at IS NULL";
    const rows = await this.db
      .prepare(
        `SELECT s.id, s.user_email, s.title, s.project_id, s.created_at,
                s.last_message_at, s.archived_at, s.message_count,
                p.name AS project_name
         FROM chat_sessions s
         LEFT JOIN chat_projects p ON p.id = s.project_id
         WHERE s.user_email = ? ${archivedClause}
         ORDER BY s.last_message_at DESC
         LIMIT ?`
      )
      .bind(userEmail, limit)
      .all<{
        id: string;
        user_email: string;
        title: string | null;
        project_id: string | null;
        created_at: number;
        last_message_at: number;
        archived_at: number | null;
        message_count: number;
        project_name: string | null;
      }>();
    return (rows.results ?? []).map((r) => ({
      id: r.id,
      userEmail: r.user_email,
      title: r.title,
      projectId: r.project_id,
      createdAt: r.created_at,
      lastMessageAt: r.last_message_at,
      archivedAt: r.archived_at,
      messageCount: r.message_count,
      projectName: r.project_name
    }));
  }

  /**
   * Update mutable fields. Only the supplied fields change; pass `null`
   * to clear a value (e.g. `projectId: null` removes a session from
   * its project). Returns the updated row, or null if not found.
   */
  async updateSession(
    id: string,
    userEmail: string,
    patch: {
      title?: string | null;
      projectId?: string | null;
      archived?: boolean;
    }
  ): Promise<ChatSession | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      binds.push(patch.title);
    }
    if (patch.projectId !== undefined) {
      sets.push("project_id = ?");
      binds.push(patch.projectId);
    }
    if (patch.archived !== undefined) {
      sets.push("archived_at = ?");
      binds.push(patch.archived ? Date.now() : null);
    }
    if (sets.length === 0) return this.getSession(id, userEmail);
    binds.push(id, userEmail);
    await this.db
      .prepare(`UPDATE chat_sessions SET ${sets.join(", ")} WHERE id = ? AND user_email = ?`)
      .bind(...binds)
      .run();
    return this.getSession(id, userEmail);
  }

  /**
   * Touch `last_message_at` and increment `message_count`. Called every
   * time a new message lands so the recency ordering stays accurate.
   * Cheap — single UPDATE, no read.
   */
  async touchSession(id: string, userEmail: string): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `UPDATE chat_sessions
         SET last_message_at = ?, message_count = message_count + 1
         WHERE id = ? AND user_email = ?`
      )
      .bind(Date.now(), id, userEmail)
      .run();
  }

  /**
   * Hard delete — removes the row from D1 entirely. The AgentSessionDO
   * messages aren't touched (caller can decide whether to also wipe
   * the DO's storage).
   */
  async deleteSession(id: string, userEmail: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.db
      .prepare(`DELETE FROM chat_sessions WHERE id = ? AND user_email = ?`)
      .bind(id, userEmail)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  // ─── Projects ──────────────────────────────────────────────────────

  async createProject(input: {
    id: string;
    userEmail: string;
    name: string;
  }): Promise<ChatProject> {
    await this.ensureSchema();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO chat_projects (id, user_email, name, created_at, archived_at)
         VALUES (?, ?, ?, ?, NULL)`
      )
      .bind(input.id, input.userEmail, input.name, now)
      .run();
    return {
      id: input.id,
      userEmail: input.userEmail,
      name: input.name,
      createdAt: now,
      archivedAt: null,
      sessionCount: 0
    };
  }

  async getProject(id: string, userEmail: string): Promise<ChatProject | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(
        `SELECT id, user_email, name, created_at, archived_at
         FROM chat_projects
         WHERE id = ? AND user_email = ?`
      )
      .bind(id, userEmail)
      .first<{
        id: string;
        user_email: string;
        name: string;
        created_at: number;
        archived_at: number | null;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      userEmail: row.user_email,
      name: row.name,
      createdAt: row.created_at,
      archivedAt: row.archived_at
    };
  }

  /**
   * List the user's projects with a session count per project. The
   * left rail uses this to render collapsible project headers with a
   * "(N)" badge.
   */
  async listProjects(
    userEmail: string,
    options: { includeArchived?: boolean } = {}
  ): Promise<ChatProject[]> {
    await this.ensureSchema();
    const archivedClause = options.includeArchived ? "" : "AND p.archived_at IS NULL";
    const rows = await this.db
      .prepare(
        `SELECT p.id, p.user_email, p.name, p.created_at, p.archived_at,
                (SELECT COUNT(*) FROM chat_sessions s
                  WHERE s.project_id = p.id AND s.archived_at IS NULL) AS session_count
         FROM chat_projects p
         WHERE p.user_email = ? ${archivedClause}
         ORDER BY p.created_at DESC`
      )
      .bind(userEmail)
      .all<{
        id: string;
        user_email: string;
        name: string;
        created_at: number;
        archived_at: number | null;
        session_count: number;
      }>();
    return (rows.results ?? []).map((r) => ({
      id: r.id,
      userEmail: r.user_email,
      name: r.name,
      createdAt: r.created_at,
      archivedAt: r.archived_at,
      sessionCount: r.session_count
    }));
  }

  async updateProject(
    id: string,
    userEmail: string,
    patch: { name?: string; archived?: boolean }
  ): Promise<ChatProject | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      binds.push(patch.name);
    }
    if (patch.archived !== undefined) {
      sets.push("archived_at = ?");
      binds.push(patch.archived ? Date.now() : null);
    }
    if (sets.length === 0) return this.getProject(id, userEmail);
    binds.push(id, userEmail);
    await this.db
      .prepare(`UPDATE chat_projects SET ${sets.join(", ")} WHERE id = ? AND user_email = ?`)
      .bind(...binds)
      .run();
    return this.getProject(id, userEmail);
  }

  /**
   * Hard delete a project. Sessions assigned to it have their
   * project_id reset to NULL (move to "Untagged" rather than being
   * orphaned). Done in a single transaction-equivalent batch so the
   * UI can't observe a half-deleted state.
   */
  async deleteProject(id: string, userEmail: string): Promise<boolean> {
    await this.ensureSchema();
    const batch = await this.db.batch([
      this.db
        .prepare(`UPDATE chat_sessions SET project_id = NULL WHERE project_id = ? AND user_email = ?`)
        .bind(id, userEmail),
      this.db
        .prepare(`DELETE FROM chat_projects WHERE id = ? AND user_email = ?`)
        .bind(id, userEmail)
    ]);
    return (batch[1]?.meta.changes ?? 0) > 0;
  }
}

/**
 * Generate a stable, URL-safe session/project id. 16 random bytes →
 * 22 chars of base64url. Plenty of entropy, fits in a hash fragment
 * without being unwieldy.
 */
export function newId(prefix: "s" | "p" = "s"): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url without padding.
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${prefix}_${b64}`;
}
