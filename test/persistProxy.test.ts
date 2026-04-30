/**
 * Tests for the Worker-proxied /persist/* endpoints. We don't boot
 * Cloudflare's Container DO here — the only thing we care about is the
 * HTTP contract: that GET/PUT/DELETE/list correctly route to the bound
 * R2 bucket, with HELM_INTERNAL_TOKEN auth gating non-browser callers.
 *
 * We exercise the routes via a fake R2 bucket implementation to avoid a
 * full miniflare runtime. This keeps the test fast and focused on the
 * route logic in src/index.ts.
 */
import { describe, expect, it } from "vitest";

// Tiny in-memory R2 bucket. Implements just the methods our /persist
// proxy uses: get, put, delete, list.
class FakeR2 {
  private store = new Map<string, { body: Uint8Array; contentType: string }>();

  async get(key: string) {
    const obj = this.store.get(key);
    if (!obj) return null;
    // Wrap the bytes in a fresh ArrayBuffer slice so the Response BodyInit
    // overload picks the buffer-source path on the strict TS types.
    return {
      body: new Response(obj.body.buffer.slice(obj.body.byteOffset, obj.body.byteOffset + obj.body.byteLength) as ArrayBuffer).body,
      size: obj.body.length,
      httpEtag: '"' + key + '"',
      writeHttpMetadata: (h: Headers) => {
        h.set("content-type", obj.contentType);
      }
    };
  }

  async put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string | null, options?: { httpMetadata?: { contentType?: string } }) {
    let bytes: Uint8Array;
    if (body instanceof Uint8Array) bytes = body;
    else if (typeof body === "string") bytes = new TextEncoder().encode(body);
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else if (body && typeof (body as ReadableStream).getReader === "function") {
      const chunks: Uint8Array[] = [];
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
    } else {
      bytes = new Uint8Array();
    }
    const ct = options?.httpMetadata?.contentType ?? "application/octet-stream";
    this.store.set(key, { body: bytes, contentType: ct });
    return {
      key,
      size: bytes.length,
      httpEtag: '"' + key + '"'
    };
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list({ prefix = "", limit = 1000 } = {}) {
    const objects = [];
    for (const [k, v] of this.store) {
      if (k.startsWith(prefix)) {
        objects.push({
          key: k,
          size: v.body.length,
          uploaded: new Date(0),
          etag: '"' + k + '"'
        });
        if (objects.length >= limit) break;
      }
    }
    return { objects, truncated: false };
  }
}

// Run a request through src/index.ts's default fetch handler.
async function runRoute(env: Record<string, unknown>, request: Request): Promise<Response> {
  const mod = await import("../src/index");
  const handler = (mod as { default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> } }).default;
  return handler.fetch(request, env, { waitUntil: () => undefined, passThroughOnException: () => undefined });
}

function envWithBucket(extras: Record<string, unknown> = {}) {
  return {
    ENABLED_PLUGINS: "admin",
    ALLOWED_HOSTS: "api.cloudflare.com",
    DEV_AUTH_BYPASS: "1",
    AGENT_OWNER_EMAIL: "test@local",
    WORKSPACE: new FakeR2(),
    ...extras
  };
}

describe("/persist proxy", () => {
  it("returns 503 with helpful error when WORKSPACE binding missing", async () => {
    const env = envWithBucket({ WORKSPACE: undefined });
    const r = await runRoute(env, new Request("https://helm.test/persist/some-key"));
    expect(r.status).toBe(503);
    const body = (await r.json()) as { ok: boolean; error: string; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("E_WORKSPACE_BINDING_MISSING");
  });

  it("PUT then GET round-trips bytes", async () => {
    const env = envWithBucket();
    const put = await runRoute(env, new Request("https://helm.test/persist/sessions/me/snap.bin", {
      method: "PUT",
      body: new Uint8Array([1, 2, 3, 4]),
      headers: { "content-type": "application/octet-stream" }
    }));
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { ok: boolean; data: { size: number } };
    expect(putBody.ok).toBe(true);
    expect(putBody.data.size).toBe(4);

    const get = await runRoute(env, new Request("https://helm.test/persist/sessions/me/snap.bin"));
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("GET returns 404 for missing keys", async () => {
    const env = envWithBucket();
    const r = await runRoute(env, new Request("https://helm.test/persist/missing-key"));
    expect(r.status).toBe(404);
  });

  it("LIST with prefix returns matching keys", async () => {
    const env = envWithBucket();
    await runRoute(env, new Request("https://helm.test/persist/sessions/a/x", { method: "PUT", body: "1" }));
    await runRoute(env, new Request("https://helm.test/persist/sessions/a/y", { method: "PUT", body: "22" }));
    await runRoute(env, new Request("https://helm.test/persist/sessions/b/z", { method: "PUT", body: "333" }));
    const list = await runRoute(env, new Request("https://helm.test/persist?prefix=sessions/a/"));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { ok: boolean; data: { keys: Array<{ key: string }> } };
    const keys = body.data.keys.map((k) => k.key).sort();
    expect(keys).toEqual(["sessions/a/x", "sessions/a/y"]);
  });

  it("DELETE drops the object", async () => {
    const env = envWithBucket();
    await runRoute(env, new Request("https://helm.test/persist/k", { method: "PUT", body: "x" }));
    const del = await runRoute(env, new Request("https://helm.test/persist/k", { method: "DELETE" }));
    expect(del.status).toBe(200);
    const get = await runRoute(env, new Request("https://helm.test/persist/k"));
    expect(get.status).toBe(404);
  });

  it("internal bearer auth path: matching HELM_INTERNAL_TOKEN authenticates", async () => {
    const env = envWithBucket({
      DEV_AUTH_BYPASS: undefined,
      CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-tag",
      HELM_INTERNAL_TOKEN: "secret-xyz"
    });
    // No CF Access JWT, just the internal bearer.
    const put = await runRoute(env, new Request("https://helm.test/persist/foo", {
      method: "PUT",
      body: "hello",
      headers: { authorization: "Bearer secret-xyz" }
    }));
    expect(put.status).toBe(200);
  });

  it("internal bearer auth path: wrong bearer is rejected (401)", async () => {
    const env = envWithBucket({
      DEV_AUTH_BYPASS: undefined,
      CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-tag",
      HELM_INTERNAL_TOKEN: "secret-xyz"
    });
    const put = await runRoute(env, new Request("https://helm.test/persist/foo", {
      method: "PUT",
      body: "hello",
      headers: { authorization: "Bearer wrong-token" }
    }));
    expect(put.status).toBe(401);
  });
});
