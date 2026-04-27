import { DurableObject } from "cloudflare:workers";
import type { Env, SessionMessage, SessionMeta, MessageRole } from "../types";
import { AppError, toAppError } from "../core/errors";

interface TreeNode extends SessionMessage {
  children: TreeNode[];
}

interface AppendMessageInput {
  role: MessageRole;
  content: string;
  parentId?: string | null;
  name?: string;
  toolCallId?: string;
  rollback?: {
    skill: string;
    input: unknown;
    label: string;
    notes?: string;
    producedBy?: string;
  } | null;
}

interface ForkInput {
  fromMessageId: string;
  targetSessionId?: string;
}

interface FiberUpsertInput {
  idempotencyKey: string;
  input?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "completed" | "failed";
  error?: string;
}

interface FiberRow {
  id: string;
  idempotency_key: string;
  input_json: string | null;
  result_json: string | null;
  status: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

const ALLOWED_ROLES: ReadonlySet<MessageRole> = new Set<MessageRole>([
  "user",
  "assistant",
  "system",
  "tool"
]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError("E_BAD_REQUEST", "Request body must be valid JSON", 400);
  }
}

function rowToMessage(row: Record<string, unknown>): SessionMessage {
  let rollback: SessionMessage["rollback"] = undefined;
  if (typeof row.rollback_json === "string" && row.rollback_json.length > 0) {
    try {
      rollback = JSON.parse(row.rollback_json) as SessionMessage["rollback"];
    } catch {
      rollback = undefined;
    }
  }
  return {
    id: String(row.id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    role: String(row.role) as MessageRole,
    content: String(row.content),
    name: row.name === null || row.name === undefined ? undefined : String(row.name),
    toolCallId:
      row.tool_call_id === null || row.tool_call_id === undefined ? undefined : String(row.tool_call_id),
    createdAt: String(row.created_at),
    rollback,
    rollbackStatus:
      row.rollback_status === "available" || row.rollback_status === "applied" || row.rollback_status === "failed"
        ? row.rollback_status
        : undefined
  };
}

export class AgentSessionDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        title TEXT,
        root_id TEXT,
        compacted_parent_id TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        name TEXT,
        tool_call_id TEXT,
        created_at TEXT NOT NULL,
        rollback_json TEXT,
        rollback_status TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid'
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TABLE IF NOT EXISTS fibers (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE NOT NULL,
        input_json TEXT,
        result_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fibers_status ON fibers(status);
    `);

    // Best-effort migrations for rollback columns on existing databases.
    try {
      this.sql.exec("ALTER TABLE messages ADD COLUMN rollback_json TEXT");
    } catch {
      /* column already present */
    }
    try {
      this.sql.exec("ALTER TABLE messages ADD COLUMN rollback_status TEXT");
    } catch {
      /* column already present */
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const route = url.pathname;

      if (request.method === "GET" && (route === "/" || route === "")) {
        return json(this.describe());
      }

      if (request.method === "POST" && route === "/init") {
        const body = await readJson<{ title?: string }>(request);
        return json({ ok: true, data: this.initSession(body?.title) });
      }

      if (request.method === "POST" && route === "/messages") {
        const body = await readJson<AppendMessageInput>(request);
        return json(this.appendMessage(body));
      }

      if (request.method === "GET" && route === "/messages") {
        return json({ ok: true, data: this.listMessages() });
      }

      if (request.method === "GET" && route === "/tree") {
        return json({ ok: true, data: this.buildTree() });
      }

      if (request.method === "POST" && route === "/fork") {
        const body = await readJson<ForkInput>(request);
        return json(await this.forkSession(body));
      }

      if (request.method === "POST" && route === "/compact") {
        const body = await readJson<{ upToMessageId: string; summary: string }>(request);
        return json(this.compact(body));
      }

      if (request.method === "POST" && route === "/search") {
        const body = await readJson<{ query: string; limit?: number }>(request);
        return json({ ok: true, data: this.search(body?.query ?? "", body?.limit) });
      }

      if (request.method === "GET" && route === "/rollbacks") {
        return json({ ok: true, data: this.listPendingRollbacks() });
      }

      if (request.method === "POST" && route === "/rollback") {
        const body = await readJson<{ messageId?: string }>(request);
        return json(this.markRollbackApplied(body?.messageId));
      }

      if (request.method === "POST" && route === "/fibers") {
        const body = await readJson<FiberUpsertInput>(request);
        return json(this.upsertFiber(body));
      }

      if (request.method === "GET" && route.startsWith("/fibers/")) {
        const id = decodeURIComponent(route.replace("/fibers/", ""));
        return json(this.getFiber(id));
      }

      if (request.method === "GET" && route === "/fibers") {
        return json({ ok: true, data: this.listFibers() });
      }

      return json({ ok: false, error: "Not found", code: "E_NOT_FOUND" }, 404);
    } catch (error) {
      const err = toAppError(error);
      return json({ ok: false, error: err.message, code: err.code }, err.status);
    }
  }

  private loadMeta(): SessionMeta | undefined {
    const rows = this.sql
      .exec("SELECT id, created_at, title, root_id, compacted_parent_id FROM meta LIMIT 1")
      .toArray();
    if (rows.length === 0) {
      return undefined;
    }
    const row = rows[0];
    return {
      id: String(row.id),
      createdAt: String(row.created_at),
      title: row.title === null || row.title === undefined ? undefined : String(row.title),
      rootId: row.root_id === null || row.root_id === undefined ? null : String(row.root_id),
      compactedParentId:
        row.compacted_parent_id === null || row.compacted_parent_id === undefined
          ? null
          : String(row.compacted_parent_id)
    };
  }

  private ensureMeta(): SessionMeta {
    return this.loadMeta() ?? this.initSession();
  }

  private initSession(title?: string): SessionMeta {
    const existing = this.loadMeta();
    if (existing) {
      return existing;
    }

    const meta: SessionMeta = {
      id: this.ctx.id.toString(),
      createdAt: new Date().toISOString(),
      title,
      rootId: null,
      compactedParentId: null
    };
    this.sql.exec(
      "INSERT INTO meta (id, created_at, title, root_id, compacted_parent_id) VALUES (?, ?, ?, ?, ?)",
      meta.id,
      meta.createdAt,
      meta.title ?? null,
      meta.rootId,
      meta.compactedParentId ?? null
    );
    return meta;
  }

  private describe() {
    const meta = this.loadMeta();
    if (!meta) {
      return { ok: true, data: { exists: false } };
    }
    const count = Number(
      this.sql.exec("SELECT COUNT(*) as c FROM messages").toArray()[0].c
    );
    const fiberCount = Number(
      this.sql.exec("SELECT COUNT(*) as c FROM fibers").toArray()[0].c
    );
    return { ok: true, data: { exists: true, meta, messageCount: count, fiberCount } };
  }

  private appendMessage(input: AppendMessageInput) {
    if (!input || !ALLOWED_ROLES.has(input.role)) {
      throw new AppError("E_BAD_REQUEST", `Invalid role: ${input?.role}`, 400);
    }
    if (typeof input.content !== "string" || input.content.length === 0) {
      throw new AppError("E_BAD_REQUEST", "content must be a non-empty string", 400);
    }

    const meta = this.ensureMeta();
    const parentId = input.parentId ?? meta.rootId ?? null;

    if (parentId !== null) {
      const parent = this.sql
        .exec("SELECT id FROM messages WHERE id = ? LIMIT 1", parentId)
        .toArray();
      if (parent.length === 0) {
        throw new AppError("E_PARENT_NOT_FOUND", `Parent message '${parentId}' not found`, 404);
      }
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const rollbackJson = input.rollback ? JSON.stringify(input.rollback) : null;
    const rollbackStatus = input.rollback ? "available" : null;
    this.sql.exec(
      "INSERT INTO messages (id, parent_id, role, content, name, tool_call_id, created_at, rollback_json, rollback_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      parentId,
      input.role,
      input.content,
      input.name ?? null,
      input.toolCallId ?? null,
      createdAt,
      rollbackJson,
      rollbackStatus
    );

    let rootId = meta.rootId;
    if (!rootId) {
      rootId = id;
      this.sql.exec("UPDATE meta SET root_id = ? WHERE id = ?", rootId, meta.id);
    }

    return {
      ok: true,
      data: {
        message: {
          id,
          parentId,
          role: input.role,
          content: input.content,
          name: input.name,
          toolCallId: input.toolCallId,
          createdAt,
          rollback: input.rollback ?? undefined,
          rollbackStatus: input.rollback ? "available" : undefined
        },
        rootId
      }
    };
  }

  private listMessages(): SessionMessage[] {
    const rows = this.sql
      .exec(
        "SELECT id, parent_id, role, content, name, tool_call_id, created_at, rollback_json, rollback_status FROM messages ORDER BY created_at ASC"
      )
      .toArray();
    return rows.map(rowToMessage);
  }

  private buildTree(): TreeNode[] {
    const messages = this.listMessages();
    const byId = new Map<string, TreeNode>();
    for (const msg of messages) {
      byId.set(msg.id, { ...msg, children: [] });
    }
    const roots: TreeNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  private async forkSession(input: ForkInput) {
    if (!input?.fromMessageId) {
      throw new AppError("E_BAD_REQUEST", "fromMessageId is required", 400);
    }

    const path = this.pathToRoot(input.fromMessageId);
    if (path.length === 0) {
      throw new AppError("E_MESSAGE_NOT_FOUND", `Message '${input.fromMessageId}' not found`, 404);
    }

    if (!this.env.AGENT_SESSIONS) {
      throw new AppError(
        "E_DO_BINDING_MISSING",
        "AGENT_SESSIONS Durable Object binding is not configured",
        500
      );
    }

    const newSessionName = input.targetSessionId ?? `fork-${crypto.randomUUID()}`;
    const newId = this.env.AGENT_SESSIONS.idFromName(newSessionName);
    const newStub = this.env.AGENT_SESSIONS.get(newId);

    await newStub.fetch("https://do/init", {
      method: "POST",
      body: JSON.stringify({ title: `fork of ${this.ctx.id.toString()}` })
    });

    for (const msg of path) {
      await newStub.fetch("https://do/messages", {
        method: "POST",
        body: JSON.stringify({
          role: msg.role,
          content: msg.content,
          name: msg.name,
          toolCallId: msg.toolCallId
        })
      });
    }

    return {
      ok: true,
      data: {
        sessionName: newSessionName,
        forkedFromMessageId: input.fromMessageId,
        copiedMessageCount: path.length
      }
    };
  }

  private pathToRoot(leafId: string): SessionMessage[] {
    const chain: SessionMessage[] = [];
    let cursor: string | null = leafId;
    const guard = new Set<string>();

    while (cursor) {
      if (guard.has(cursor)) {
        break;
      }
      guard.add(cursor);
      const rows = this.sql
        .exec(
          "SELECT id, parent_id, role, content, name, tool_call_id, created_at, rollback_json, rollback_status FROM messages WHERE id = ? LIMIT 1",
          cursor
        )
        .toArray();
      if (rows.length === 0) {
        return [];
      }
      const msg = rowToMessage(rows[0]);
      chain.push(msg);
      cursor = msg.parentId;
    }

    return chain.reverse();
  }

  private compact(input: { upToMessageId: string; summary: string }) {
    if (!input?.upToMessageId || typeof input.summary !== "string" || input.summary.length === 0) {
      throw new AppError("E_BAD_REQUEST", "upToMessageId and summary are required", 400);
    }

    const target = this.sql
      .exec("SELECT id FROM messages WHERE id = ? LIMIT 1", input.upToMessageId)
      .toArray();
    if (target.length === 0) {
      throw new AppError("E_MESSAGE_NOT_FOUND", `Message '${input.upToMessageId}' not found`, 404);
    }

    const appended = this.appendMessage({
      role: "system",
      content: `[compaction] ${input.summary}`,
      parentId: input.upToMessageId
    });

    const meta = this.ensureMeta();
    this.sql.exec(
      "UPDATE meta SET compacted_parent_id = ? WHERE id = ?",
      appended.data.message.id,
      meta.id
    );
    return { ok: true, data: { summary: appended.data.message, meta: this.loadMeta() } };
  }

  private listPendingRollbacks(): SessionMessage[] {
    const rows = this.sql
      .exec(
        `SELECT id, parent_id, role, content, name, tool_call_id, created_at, rollback_json, rollback_status
         FROM messages
         WHERE rollback_json IS NOT NULL
           AND (rollback_status IS NULL OR rollback_status = 'available')
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .toArray();
    return rows.map(rowToMessage);
  }

  private markRollbackApplied(messageId?: string) {
    if (!messageId || typeof messageId !== "string") {
      throw new AppError("E_BAD_REQUEST", "messageId is required", 400);
    }
    const rows = this.sql
      .exec("SELECT * FROM messages WHERE id = ? LIMIT 1", messageId)
      .toArray();
    if (rows.length === 0) {
      throw new AppError("E_MESSAGE_NOT_FOUND", `Message '${messageId}' not found`, 404);
    }
    this.sql.exec("UPDATE messages SET rollback_status = 'applied' WHERE id = ?", messageId);
    return { ok: true, data: { messageId, status: "applied" } };
  }

  private search(query: string, limit?: number): SessionMessage[] {
    if (!query) {
      return [];
    }
    const max = typeof limit === "number" && limit > 0 ? Math.min(limit, 100) : 25;
    const ftsQuery = sanitizeFtsQuery(query);
    try {
      const rows = this.sql
        .exec(
          `SELECT m.id, m.parent_id, m.role, m.content, m.name, m.tool_call_id, m.created_at, m.rollback_json, m.rollback_status
           FROM messages m
           JOIN messages_fts f ON m.rowid = f.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
          ftsQuery,
          max
        )
        .toArray();
      return rows.map(rowToMessage);
    } catch {
      const rows = this.sql
        .exec(
          "SELECT id, parent_id, role, content, name, tool_call_id, created_at, rollback_json, rollback_status FROM messages WHERE instr(lower(content), lower(?)) > 0 ORDER BY created_at ASC LIMIT ?",
          query,
          max
        )
        .toArray();
      return rows.map(rowToMessage);
    }
  }

  private upsertFiber(input: FiberUpsertInput) {
    if (!input?.idempotencyKey || typeof input.idempotencyKey !== "string") {
      throw new AppError("E_BAD_REQUEST", "idempotencyKey is required", 400);
    }

    const existing = this.sql
      .exec("SELECT * FROM fibers WHERE idempotency_key = ? LIMIT 1", input.idempotencyKey)
      .toArray();
    if (existing.length > 0) {
      return {
        ok: true,
        data: { fiber: this.serializeFiber(existing[0] as unknown as FiberRow), reused: true }
      };
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const status = input.status ?? (input.result !== undefined ? "completed" : "pending");
    const completedAt = status === "completed" || status === "failed" ? createdAt : null;

    this.sql.exec(
      "INSERT INTO fibers (id, idempotency_key, input_json, result_json, status, error, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.idempotencyKey,
      input.input === undefined ? null : JSON.stringify(input.input),
      input.result === undefined ? null : JSON.stringify(input.result),
      status,
      input.error ?? null,
      createdAt,
      completedAt
    );

    const row = this.sql.exec("SELECT * FROM fibers WHERE id = ? LIMIT 1", id).toArray()[0];
    return {
      ok: true,
      data: { fiber: this.serializeFiber(row as unknown as FiberRow), reused: false }
    };
  }

  private getFiber(id: string) {
    const rows = this.sql.exec("SELECT * FROM fibers WHERE id = ? LIMIT 1", id).toArray();
    if (rows.length === 0) {
      return { ok: false, error: `Fiber '${id}' not found`, code: "E_FIBER_NOT_FOUND" };
    }
    return { ok: true, data: this.serializeFiber(rows[0] as unknown as FiberRow) };
  }

  private listFibers() {
    const rows = this.sql
      .exec("SELECT * FROM fibers ORDER BY created_at DESC LIMIT 100")
      .toArray();
    return rows.map((row) => this.serializeFiber(row as unknown as FiberRow));
  }

  private serializeFiber(row: FiberRow) {
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      input: row.input_json ? safeParse(row.input_json) : null,
      result: row.result_json ? safeParse(row.result_json) : null,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at
    };
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sanitizeFtsQuery(raw: string): string {
  const tokens = raw
    .replace(/["'()*]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`);
  return tokens.length === 0 ? '""' : tokens.join(" AND ");
}
