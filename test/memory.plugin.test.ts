/**
 * MemoryPlugin tests.
 *
 * We cover:
 *   1. No backend → clean error (neither MEMORY nor DB bound)
 *   2. D1 fallback path: save → recall (substring) → list → forget
 *   3. Managed MEMORY path: remember → recall (synthesized result shape)
 *   4. Unknown action returns a descriptive error
 *
 * The tests use a tiny in-memory D1 stub (just enough to satisfy the
 * `D1Database` shape we exercise) and a hand-rolled MEMORY stub.
 */
import { describe, expect, it, vi } from "vitest";
import { MemoryPlugin } from "../src/plugins/memory";
import type { Env } from "../src/types";

/* ---------- Fakes ---------- */

interface FakeRow {
  id: string;
  profile: string;
  session_id: string | null;
  content: string;
  metadata: string | null;
  created_at: string;
}

function fakeD1(): { db: D1Database; rows: FakeRow[] } {
  const rows: FakeRow[] = [];
  const db = {
    prepare(sql: string) {
      return {
        _sql: sql,
        _binds: [] as unknown[],
        bind(...args: unknown[]) {
          this._binds = args;
          return this;
        },
        async run() {
          if (/INSERT INTO agent_memory/i.test(this._sql)) {
            const [id, profile, sessionId, content, metadata, createdAt] = this._binds as [
              string, string, string | null, string, string | null, string
            ];
            rows.push({ id, profile, session_id: sessionId, content, metadata, created_at: createdAt });
          }
          if (/DELETE FROM agent_memory/i.test(this._sql)) {
            const [profile, idArg] = this._binds as [string, string | undefined];
            const before = rows.length;
            const filtered = idArg
              ? rows.filter((r) => !(r.profile === profile && r.id === idArg))
              : rows.filter((r) => r.profile !== profile);
            rows.splice(0, rows.length, ...filtered);
            return { meta: { changes: before - rows.length } };
          }
          return { meta: { changes: 0 } };
        },
        async all<T = unknown>() {
          // SELECT ... WHERE profile = ? [AND content LIKE ?]
          if (/FROM agent_memory/i.test(this._sql)) {
            const [profile, q, limit] = this._binds as [string, string, number] | [string, number];
            const limitNum = typeof limit === "number" ? limit : (q as unknown as number);
            if (/LIKE/i.test(this._sql) && typeof q === "string") {
              const needle = q.replace(/%/g, "").replace(/\\/g, "");
              const filtered = rows
                .filter((r) => r.profile === profile && r.content.includes(needle))
                .slice(0, limitNum)
                .map((r) => ({
                  id: r.id,
                  profile: r.profile,
                  sessionId: r.session_id,
                  content: r.content,
                  metadata: r.metadata,
                  createdAt: r.created_at
                })) as unknown as T[];
              return { results: filtered };
            }
            const filtered = rows
              .filter((r) => r.profile === profile)
              .slice(0, typeof q === "number" ? q : limitNum)
              .map((r) => ({
                id: r.id,
                profile: r.profile,
                sessionId: r.session_id,
                content: r.content,
                metadata: r.metadata,
                createdAt: r.created_at
              })) as unknown as T[];
            return { results: filtered };
          }
          return { results: [] as T[] };
        }
      };
    }
  } as unknown as D1Database;
  return { db, rows };
}

function baseEnv(partial: Partial<Env> = {}): Env {
  return {
    ENABLED_PLUGINS: "memory",
    ALLOWED_HOSTS: "",
    ...partial
  } as Env;
}

async function init(env: Env): Promise<MemoryPlugin> {
  const plugin = new MemoryPlugin();
  await plugin.initialize({
    config: {
      enabledPlugins: new Set(["memory"]),
      allowedHosts: new Set(),
      modelDefault: "x",
      alertErrorRatePct: 5
    },
    fetch: globalThis.fetch,
    env
  });
  return plugin;
}

/* ---------- Tests ---------- */

describe("MemoryPlugin", () => {
  it("errors when neither MEMORY nor DB is bound", async () => {
    const plugin = await init(baseEnv());
    const r = await plugin.invoke("memory-save", { content: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No memory backend available/);
  });

  it("D1 fallback: save → recall → list → forget", async () => {
    const { db, rows } = fakeD1();
    const plugin = await init(baseEnv({ DB: db, AGENT_NAME: "Tom-Tom" }));

    const save = await plugin.invoke("memory-save", {
      content: "Tom prefers serverless",
      sessionId: "s-1",
      metadata: { tag: "preference" }
    });
    expect(save.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].profile).toBe("tom-tom");

    const recall = await plugin.invoke("memory-recall", { query: "serverless" });
    expect(recall.ok).toBe(true);
    const recallData = recall.data as { count: number; items: Array<{ content: string }> };
    expect(recallData.count).toBe(1);
    expect(recallData.items[0].content).toContain("serverless");

    const list = await plugin.invoke("memory-list", { limit: 10 });
    expect(list.ok).toBe(true);
    const listData = list.data as { count: number };
    expect(listData.count).toBe(1);

    const forgetAll = await plugin.invoke("memory-forget", {});
    expect(forgetAll.ok).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it("managed MEMORY path — remember + recall pass through to binding", async () => {
    const remember = vi.fn(async () => ({ id: "m-1" }));
    const recall = vi.fn(async () => ({ results: { result: "Tom likes serverless." } }));
    const MEMORY = {
      getProfile: async () => ({ remember, recall })
    };
    const plugin = await init(baseEnv({ MEMORY } as Partial<Env>));

    const save = await plugin.invoke("memory-save", { content: "Tom prefers serverless" });
    expect(save.ok).toBe(true);
    expect(remember).toHaveBeenCalledOnce();

    const r = await plugin.invoke("memory-recall", { query: "what does Tom prefer?" });
    expect(r.ok).toBe(true);
    const data = r.data as { synthesized: string; backend: string };
    expect(data.backend).toBe("agent-memory");
    expect(data.synthesized).toBe("Tom likes serverless.");
  });

  it("unknown action returns a clear error", async () => {
    const { db } = fakeD1();
    const plugin = await init(baseEnv({ DB: db }));
    const r = await plugin.invoke("memory-frobnicate", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown memory action/);
  });
});
