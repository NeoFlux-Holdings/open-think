/**
 * Memory plugin — backed by Cloudflare Agent Memory.
 *
 * Cloudflare Agent Memory (blog.cloudflare.com/introducing-agent-memory/) is a
 * managed service that extracts structured memories from conversations and
 * serves them back on demand. The Worker talks to it through an `env.MEMORY`
 * binding; each "profile" is an isolated memory store (one per project / one
 * per user).
 *
 * Binding (wrangler.toml):
 *   [[ai]] is unrelated; add:
 *   [[memory]]
 *     binding = "MEMORY"
 *   # or via the dashboard once the service is GA.
 *
 * API shape (from the beta announcement):
 *   env.MEMORY.getProfile(name)
 *     .remember({ content, sessionId })    → store a single memory
 *     .recall(query)                       → { results: { result: "..." } }
 *     .ingest(messages, { sessionId })     → extract memories from a turn
 *     .list() / .forget()                  → admin operations
 *
 * Until Agent Memory hits GA, this plugin falls back to a **D1-backed local
 * store** using the same shape. Flip the binding on and memories seamlessly
 * migrate to managed storage.
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";

/* ------------ External (managed) binding shape ------------ */

interface AgentMemoryProfile {
  remember(entry: { content: string; sessionId?: string; metadata?: unknown }): Promise<unknown>;
  recall(query: string): Promise<{ results?: { result?: string }; result?: string }>;
  ingest(messages: unknown[], options?: { sessionId?: string }): Promise<unknown>;
  list?(): Promise<{ items: Array<{ content: string; sessionId?: string; createdAt?: string }> }>;
  forget?(query?: string): Promise<unknown>;
}

interface AgentMemoryBinding {
  getProfile(name: string): Promise<AgentMemoryProfile> | AgentMemoryProfile;
}

/* ------------ Local D1 fallback (used until Agent Memory is wired) ------------ */

interface LocalFact {
  id: string;
  profile: string;
  sessionId: string | null;
  content: string;
  metadata: string | null;
  createdAt: string;
}

class LocalD1Memory {
  constructor(private readonly db: D1Database) {}

  async ensureTable(): Promise<void> {
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS agent_memory (
          id TEXT PRIMARY KEY,
          profile TEXT NOT NULL,
          session_id TEXT,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      )
      .run();
    await this.db
      .prepare(
        `CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(content, profile, content=agent_memory, content_rowid=rowid)`
      )
      .run()
      .catch(() => {
        // FTS is optional — best-effort substring search works without it.
      });
  }

  async save(
    profile: string,
    content: string,
    sessionId: string | null,
    metadata: unknown
  ): Promise<LocalFact> {
    await this.ensureTable();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const metaJson = metadata == null ? null : JSON.stringify(metadata);
    await this.db
      .prepare(
        `INSERT INTO agent_memory (id, profile, session_id, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, profile, sessionId, content, metaJson, createdAt)
      .run();
    return { id, profile, sessionId, content, metadata: metaJson, createdAt };
  }

  async recall(profile: string, query: string, limit = 5): Promise<LocalFact[]> {
    await this.ensureTable();
    const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const rs = await this.db
      .prepare(
        `SELECT id, profile, session_id as sessionId, content, metadata, created_at as createdAt
           FROM agent_memory
          WHERE profile = ? AND content LIKE ? ESCAPE '\\'
          ORDER BY created_at DESC
          LIMIT ?`
      )
      .bind(profile, like, limit)
      .all<LocalFact>();
    return rs.results ?? [];
  }

  async list(profile: string, limit = 50): Promise<LocalFact[]> {
    await this.ensureTable();
    const rs = await this.db
      .prepare(
        `SELECT id, profile, session_id as sessionId, content, metadata, created_at as createdAt
           FROM agent_memory
          WHERE profile = ?
          ORDER BY created_at DESC
          LIMIT ?`
      )
      .bind(profile, limit)
      .all<LocalFact>();
    return rs.results ?? [];
  }

  async forget(profile: string, id?: string): Promise<number> {
    await this.ensureTable();
    if (id) {
      const rs = await this.db
        .prepare(`DELETE FROM agent_memory WHERE profile = ? AND id = ?`)
        .bind(profile, id)
        .run();
      return rs.meta.changes ?? 0;
    }
    const rs = await this.db
      .prepare(`DELETE FROM agent_memory WHERE profile = ?`)
      .bind(profile)
      .run();
    return rs.meta.changes ?? 0;
  }
}

/* ------------ Plugin ------------ */

export class MemoryPlugin implements AgentPlugin {
  readonly id = "memory";
  readonly version = "0.1.0";
  readonly description = "Long-term memory for the agent — Cloudflare Agent Memory when bound, D1 fallback otherwise";
  readonly capabilities = ["tools", "admin"] as const;

  private env?: Env;
  private defaultProfile = "default";

  async initialize(context: PluginContext): Promise<void> {
    this.env = context.env;
    this.defaultProfile = context.env.AGENT_NAME?.toLowerCase().replace(/\s+/g, "-") ?? "default";
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.env) return { ok: false, error: "Plugin not initialized" };

    const inObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const profile = typeof inObj.profile === "string" && inObj.profile.length > 0
      ? inObj.profile
      : this.defaultProfile;

    const managed = (this.env as Env & { MEMORY?: AgentMemoryBinding }).MEMORY;
    const d1 = this.env.DB;

    if (!managed && !d1) {
      return {
        ok: false,
        error: "No memory backend available — bind either [[memory]] (preferred) or a D1 [[d1_databases]] named DB."
      };
    }

    switch (action) {
      case "memory-save": {
        const content = String(inObj.content ?? "");
        const sessionId = inObj.sessionId ? String(inObj.sessionId) : null;
        if (!content) return { ok: false, error: "input.content required" };
        if (managed) {
          const p = await managed.getProfile(profile);
          await p.remember({
            content,
            sessionId: sessionId ?? undefined,
            metadata: inObj.metadata
          });
          return { ok: true, data: { backend: "agent-memory", profile, saved: content.slice(0, 80) } };
        }
        const local = new LocalD1Memory(d1!);
        const fact = await local.save(profile, content, sessionId, inObj.metadata);
        return { ok: true, data: { backend: "d1", fact } };
      }

      case "memory-recall": {
        const query = String(inObj.query ?? "");
        if (!query) return { ok: false, error: "input.query required" };
        const limit = typeof inObj.limit === "number" ? Math.min(inObj.limit, 20) : 5;
        if (managed) {
          const p = await managed.getProfile(profile);
          const r = await p.recall(query);
          const synthesized = r?.results?.result ?? r?.result ?? "";
          return { ok: true, data: { backend: "agent-memory", profile, synthesized, raw: r } };
        }
        const local = new LocalD1Memory(d1!);
        const rows = await local.recall(profile, query, limit);
        return {
          ok: true,
          data: {
            backend: "d1",
            profile,
            query,
            count: rows.length,
            items: rows
          }
        };
      }

      case "memory-list": {
        const limit = typeof inObj.limit === "number" ? Math.min(inObj.limit, 200) : 50;
        if (managed) {
          const p = await managed.getProfile(profile);
          if (typeof p.list !== "function") {
            return { ok: false, error: "managed backend doesn't expose list() — use memory-recall with a broad query" };
          }
          const r = await p.list();
          return { ok: true, data: { backend: "agent-memory", profile, items: r.items ?? [] } };
        }
        const local = new LocalD1Memory(d1!);
        const rows = await local.list(profile, limit);
        return { ok: true, data: { backend: "d1", profile, count: rows.length, items: rows } };
      }

      case "memory-ingest": {
        // Compact a conversation window into durable memories.
        const messages = Array.isArray(inObj.messages) ? inObj.messages : [];
        const sessionId = inObj.sessionId ? String(inObj.sessionId) : undefined;
        if (messages.length === 0) return { ok: false, error: "input.messages array required" };
        if (managed) {
          const p = await managed.getProfile(profile);
          const r = await p.ingest(messages, { sessionId });
          return { ok: true, data: { backend: "agent-memory", profile, ingested: messages.length, raw: r } };
        }
        // D1 fallback: store the raw concatenated text as a single fact.
        const content = messages
          .map((m) => {
            if (m && typeof m === "object") {
              const mm = m as Record<string, unknown>;
              return `${String(mm.role ?? "user")}: ${String(mm.content ?? "")}`;
            }
            return String(m);
          })
          .join("\n");
        const local = new LocalD1Memory(d1!);
        const fact = await local.save(profile, content, sessionId ?? null, { ingested: messages.length });
        return { ok: true, data: { backend: "d1", profile, fact } };
      }

      case "memory-forget": {
        const id = inObj.id ? String(inObj.id) : undefined;
        if (managed) {
          const p = await managed.getProfile(profile);
          if (typeof p.forget !== "function") {
            return { ok: false, error: "managed backend doesn't expose forget()" };
          }
          const r = await p.forget(id);
          return { ok: true, data: { backend: "agent-memory", profile, raw: r } };
        }
        const local = new LocalD1Memory(d1!);
        const changes = await local.forget(profile, id);
        return { ok: true, data: { backend: "d1", profile, forgotten: changes } };
      }

      default:
        return { ok: false, error: `Unknown memory action: ${action}` };
    }
  }
}
