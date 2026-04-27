/**
 * CF API client tests. Every method is exercised against a mocked fetch:
 * we assert the URL, method, headers, body shape, and the parsed result.
 *
 * No real CF API calls — we never want a test run to surprise-bill someone.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createAccessApp,
  createAccessPolicy,
  createD1Database,
  getAccessOrganization,
  listAccounts,
  listZones,
  putWorkerSecret,
  verifyToken
} from "../src/cloud/cfApi";

function fakeFetch(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return (async (url: RequestInfo, init: RequestInit = {}) => {
    return responder(typeof url === "string" ? url : (url as Request).url, init);
  }) as typeof fetch;
}

describe("cfApi.verifyToken", () => {
  it("hits /user/tokens/verify with Authorization: Bearer", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const f = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedAuth = (init.headers as Record<string, string>).authorization ?? "";
      return new Response(
        JSON.stringify({ success: true, result: { id: "tok-1", status: "active" } }),
        { status: 200 }
      );
    });
    const r = await verifyToken("test-token", { fetchImpl: f });
    expect(capturedUrl).toBe("https://api.cloudflare.com/client/v4/user/tokens/verify");
    expect(capturedAuth).toBe("Bearer test-token");
    expect(r.success).toBe(true);
    expect(r.result?.id).toBe("tok-1");
  });

  it("surfaces 4xx errors as success: false", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 1000, message: "invalid token" }] }),
        { status: 400 }
      )
    );
    const r = await verifyToken("bad", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].message).toBe("invalid token");
  });

  it("handles non-JSON error responses gracefully", async () => {
    const f = fakeFetch(() => new Response("Bad gateway", { status: 502 }));
    const r = await verifyToken("x", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].code).toBe(502);
    expect(r.errors?.[0].message).toMatch(/Bad gateway/);
  });
});

describe("cfApi.listAccounts", () => {
  it("returns the accounts array", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: true,
          result: [{ id: "acc-1", name: "Tom" }, { id: "acc-2", name: "Side" }]
        }),
        { status: 200 }
      )
    );
    const r = await listAccounts("t", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result).toHaveLength(2);
    expect(r.result?.[0].id).toBe("acc-1");
  });
});

describe("cfApi.listZones", () => {
  it("filters by account.id", async () => {
    let capturedUrl = "";
    const f = fakeFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    });
    await listZones("t", "acc-1", { fetchImpl: f });
    expect(capturedUrl).toContain("/zones?account.id=acc-1");
  });
});

describe("cfApi.createD1Database", () => {
  it("POSTs the database name and returns the uuid", async () => {
    let capturedBody = "";
    const f = fakeFetch((url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({
          success: true,
          result: { uuid: "d1-abc", name: "tom-pa" }
        }),
        { status: 200 }
      );
    });
    const r = await createD1Database("t", "acc-1", "tom-pa", { fetchImpl: f });
    expect(JSON.parse(capturedBody)).toEqual({ name: "tom-pa" });
    expect(r.result?.uuid).toBe("d1-abc");
  });
});

describe("cfApi.createAccessApp + createAccessPolicy", () => {
  it("creates a self-hosted Access app with auto_redirect off", async () => {
    let capturedBody = "";
    const f = fakeFetch((url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({
          success: true,
          result: { id: "app-1", uid: "app-1", aud: "AUDXYZ", name: "Helm", domain: "helm.workers.dev", type: "self_hosted" }
        }),
        { status: 200 }
      );
    });
    const r = await createAccessApp(
      "t",
      "acc-1",
      { name: "Helm", domain: "helm.workers.dev" },
      { fetchImpl: f }
    );
    const body = JSON.parse(capturedBody);
    expect(body.type).toBe("self_hosted");
    expect(body.auto_redirect_to_identity).toBe(false);
    expect(body.session_duration).toBe("24h");
    expect(r.result?.aud).toBe("AUDXYZ");
  });

  it("createAccessPolicy includes the owner email", async () => {
    let capturedBody = "";
    const f = fakeFetch((url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({ success: true, result: { id: "policy-1" } }),
        { status: 200 }
      );
    });
    const r = await createAccessPolicy("t", "acc-1", "app-1", "you@x.com", { fetchImpl: f });
    const body = JSON.parse(capturedBody);
    expect(body.decision).toBe("allow");
    expect(body.include[0].email.email).toBe("you@x.com");
    expect(r.result?.id).toBe("policy-1");
  });
});

describe("cfApi.getAccessOrganization", () => {
  it("returns the team's auth_domain", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: true,
          result: { auth_domain: "tom.cloudflareaccess.com", name: "Tom" }
        }),
        { status: 200 }
      )
    );
    const r = await getAccessOrganization("t", "acc-1", { fetchImpl: f });
    expect(r.result?.auth_domain).toBe("tom.cloudflareaccess.com");
  });
});

describe("cfApi.putWorkerSecret", () => {
  it("posts secret_text type", async () => {
    let capturedBody = "";
    const f = fakeFetch((url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({
          success: true,
          result: { name: "ANTHROPIC_API_KEY", type: "secret_text" }
        }),
        { status: 200 }
      );
    });
    const r = await putWorkerSecret(
      "t",
      "acc-1",
      "helm",
      "ANTHROPIC_API_KEY",
      "sk-ant-test",
      { fetchImpl: f }
    );
    const body = JSON.parse(capturedBody);
    expect(body).toEqual({ name: "ANTHROPIC_API_KEY", text: "sk-ant-test", type: "secret_text" });
    expect(r.success).toBe(true);
  });
});
