/**
 * Miniflare smoke tests for the codex-bridge-worker.
 *
 * These run inside vitest-pool-workers (Cloudflare's first-party Workers test
 * runner), so Durable Objects, bindings, and `fetch()` to the Worker entrypoint
 * all work the same way they would in production. No network calls to ChatGPT —
 * we stub upstream fetches via `fetchMock`.
 *
 * Coverage:
 *   1. /healthz with no tokens configured
 *   2. /healthz never leaks tokenPreview, even when tokens ARE present
 *   3. /auth/rotate happy path writes to the DO and /auth/status reflects it
 *   4. /auth/rotate rejects requests without a bearer token
 *   5. /rpc returns a structured error on upstream 401 (re-run codex login path)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";

const BEARER = "test-bridge-token-please-rotate";

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${BEARER}`
    }
  };
}

describe("codex-bridge-worker", () => {
  beforeEach(() => {
    // @ts-expect-error vitest-pool-workers injects env into `env` for mutation
    env.BRIDGE_TOKEN = BEARER;
    // @ts-expect-error allow wiping
    env.CODEX_ACCESS_TOKEN = undefined;
    // @ts-expect-error allow wiping
    env.CODEX_ID_TOKEN = undefined;
  });

  it("GET /healthz returns ok=true without tokens", async () => {
    const req = new Request("https://bridge.test/healthz");
    const ctx = createExecutionContext();
    const resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);
    // Must not include tokenPreview on the public endpoint
    expect(body).not.toHaveProperty("tokenPreview");
    expect(body).not.toHaveProperty("rotatedAt");
  });

  it("GET /healthz never leaks tokenPreview even when configured", async () => {
    // @ts-expect-error test setup
    env.CODEX_ACCESS_TOKEN = "sk-example-50-char-access-token-that-should-be-masked";
    const req = new Request("https://bridge.test/healthz");
    const ctx = createExecutionContext();
    const resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body).not.toHaveProperty("tokenPreview");
    expect(body).not.toHaveProperty("rotatedAt");
  });

  it("POST /auth/rotate without bearer → 401", async () => {
    const req = new Request("https://bridge.test/auth/rotate", {
      method: "POST",
      body: JSON.stringify({ accessToken: "new-token" })
    });
    const ctx = createExecutionContext();
    const resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(401);
  });

  it("POST /auth/rotate with bearer writes DO, /auth/status reflects it", async () => {
    const rotate = new Request(
      "https://bridge.test/auth/rotate",
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: "new-access-token-50-chars-long-for-realistic-shape",
          idToken: "new-id-token",
          note: "from test"
        })
      })
    );
    const ctx1 = createExecutionContext();
    const rotateResp = await worker.fetch(rotate, env, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(rotateResp.status).toBe(200);
    const rotateBody = (await rotateResp.json()) as { ok: boolean; rotatedAt?: string };
    expect(rotateBody.ok).toBe(true);
    expect(rotateBody.rotatedAt).toBeTruthy();

    const status = new Request("https://bridge.test/auth/status", authed());
    const ctx2 = createExecutionContext();
    const statusResp = await worker.fetch(status, env, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(statusResp.status).toBe(200);
    const statusBody = (await statusResp.json()) as Record<string, unknown>;
    expect(statusBody.configured).toBe(true);
    expect(statusBody.source).toBe("durable-object");
    // /auth/status is bearer-gated, so a preview is OK here
    expect(typeof statusBody.tokenPreview).toBe("string");
  });

  it("POST /rpc forwards a structured error on upstream 401", async () => {
    // @ts-expect-error test setup
    env.CODEX_ACCESS_TOKEN = "stale-access-token";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      }) as unknown as Response
    );

    const req = new Request(
      "https://bridge.test/rpc",
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "codex/responses",
          params: { model: "gpt-5", messages: [] }
        })
      })
    );
    const ctx = createExecutionContext();
    const resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(resp.status).toBe(401);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("rotate");

    fetchSpy.mockRestore();
  });

  it("POST /rpc rejects unknown methods", async () => {
    // @ts-expect-error test setup
    env.CODEX_ACCESS_TOKEN = "a-valid-token";
    const req = new Request(
      "https://bridge.test/rpc",
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "codex/unknown", params: {} })
      })
    );
    const ctx = createExecutionContext();
    const resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unknown method");
  });
});
