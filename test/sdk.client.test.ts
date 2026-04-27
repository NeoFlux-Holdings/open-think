import { describe, expect, it, vi } from "vitest";
import { OpenThinkClient } from "../src/sdk/client";

function buildFetch(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const { pathname } = new URL(url);
    const handler = routes[pathname];
    if (!handler) {
      return new Response(JSON.stringify({ ok: false, error: "Not found", code: "E_NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    const req = new Request(url, init);
    return handler(req);
  });
}

describe("OpenThinkClient", () => {
  it("lists plugins via /plugins", async () => {
    const fetchFn = buildFetch({
      "/plugins": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { plugins: [{ id: "workers-ai", version: "0.1.0", description: "", capabilities: [] }] }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });
    const client = new OpenThinkClient("https://worker.example", { fetch: fetchFn as typeof globalThis.fetch });
    const result = await client.plugins();
    expect(result.ok).toBe(true);
    expect(result.data?.plugins?.[0]?.id).toBe("workers-ai");
  });

  it("invokes skill with bearer token header", async () => {
    const fetchFn = buildFetch({
      "/skills/invoke/ai-status": async (req) => {
        expect(req.headers.get("Authorization")).toBe("Bearer demo");
        return new Response(JSON.stringify({ ok: true, data: { provider: "workers-ai" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const client = new OpenThinkClient("https://worker.example/", {
      fetch: fetchFn as typeof globalThis.fetch,
      bearerToken: "demo"
    });
    const result = await client.invokeSkill("ai-status");
    expect(result.ok).toBe(true);
  });

  it("appends a session message via the session handle", async () => {
    const fetchFn = buildFetch({
      "/sessions/my-session/messages": async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { message: { id: "m-1", parentId: null, role: "user", content: "hi", createdAt: "now" }, rootId: "m-1" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });
    const client = new OpenThinkClient("https://worker.example", { fetch: fetchFn as typeof globalThis.fetch });
    const result = await client.session("my-session").append({ role: "user", content: "hi" });
    expect(result.ok).toBe(true);
    expect(result.data?.message.id).toBe("m-1");
  });
});
