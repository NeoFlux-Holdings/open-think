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
  createAiGateway,
  createD1Database,
  createR2Bucket,
  ensureAccessApp,
  ensureAiGateway,
  ensureD1Database,
  ensureR2Bucket,
  ensureWorkerSecret,
  findAccessAppByDestination,
  findD1DatabaseByName,
  flattenMigrationsForCfApi,
  getAccessOrganization,
  getUserDetails,
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

describe("cfApi.getUserDetails", () => {
  it("returns the token owner's email from /user", async () => {
    const f = fakeFetch((url) => {
      expect(url).toBe("https://api.cloudflare.com/client/v4/user");
      return new Response(
        JSON.stringify({
          success: true,
          result: { id: "u-1", email: "you@example.com", first_name: "Tom", last_name: "Z" }
        }),
        { status: 200 }
      );
    });
    const r = await getUserDetails("t", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result?.email).toBe("you@example.com");
  });

  it("returns success: false when the token lacks User Details:Read", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 9109, message: "Insufficient permissions" }] }),
        { status: 403 }
      )
    );
    const r = await getUserDetails("t", { fetchImpl: f });
    expect(r.success).toBe(false);
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
    // Modern format: destinations array, NOT the legacy `domain` string
    // (which CF rejects on *.workers.dev with "domain does not belong to zone").
    expect(body.domain).toBeUndefined();
    expect(body.destinations).toEqual([
      { type: "public", uri: "https://helm.workers.dev" }
    ]);
    expect(r.result?.aud).toBe("AUDXYZ");
  });

  it("normalizes a bare host to a full https:// uri in the destination", async () => {
    let capturedBody = "";
    const f = fakeFetch((_url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({ success: true, result: { id: "a", uid: "a", aud: "X", name: "n", domain: "n", type: "self_hosted" } }),
        { status: 200 }
      );
    });
    await createAccessApp("t", "acc-1", { name: "n", domain: "x.example.com" }, { fetchImpl: f });
    expect(JSON.parse(capturedBody).destinations[0].uri).toBe("https://x.example.com");
  });

  it("preserves a destination uri that already has a scheme", async () => {
    let capturedBody = "";
    const f = fakeFetch((_url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({ success: true, result: { id: "a", uid: "a", aud: "X", name: "n", domain: "n", type: "self_hosted" } }),
        { status: 200 }
      );
    });
    await createAccessApp("t", "acc-1", { name: "n", domain: "https://x.example.com" }, { fetchImpl: f });
    expect(JSON.parse(capturedBody).destinations[0].uri).toBe("https://x.example.com");
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

  it("createAccessPolicy emits one include entry per email when given a list", async () => {
    let capturedBody = "";
    const f = fakeFetch((_url, init) => {
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ success: true, result: { id: "p-2" } }), { status: 200 });
    });
    await createAccessPolicy(
      "t", "acc-1", "app-1",
      ["you@x.com", "alice@x.com", "bob@x.com"],
      { fetchImpl: f }
    );
    const body = JSON.parse(capturedBody);
    expect(body.name).toMatch(/allowlist \(3\)/);
    expect(body.include).toHaveLength(3);
    expect(body.include.map((i: { email: { email: string } }) => i.email.email)).toEqual([
      "you@x.com", "alice@x.com", "bob@x.com"
    ]);
  });

  it("createAccessPolicy filters empty / non-email entries from a list", async () => {
    let capturedBody = "";
    const f = fakeFetch((_url, init) => {
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ success: true, result: { id: "p-3" } }), { status: 200 });
    });
    await createAccessPolicy(
      "t", "acc-1", "app-1",
      ["you@x.com", "  ", "not-an-email", "  alice@x.com  "],
      { fetchImpl: f }
    );
    const body = JSON.parse(capturedBody);
    expect(body.include).toHaveLength(2);
    expect(body.include[1].email.email).toBe("alice@x.com");
  });

  it("createAccessPolicy returns a 400-ish error when no valid emails remain", async () => {
    let calls = 0;
    const f = fakeFetch(() => {
      calls += 1;
      return new Response("should not be called", { status: 500 });
    });
    const r = await createAccessPolicy("t", "acc-1", "app-1", ["not-an-email", "  "], { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].code).toBe(400);
    expect(calls).toBe(0); // never even hit the API
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

describe("cfApi.findAccessAppByDestination", () => {
  it("returns the matching app when destinations[].uri matches", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              id: "app-other", uid: "app-other", aud: "AUD-O", name: "other", domain: "other", type: "self_hosted",
              destinations: [{ type: "public", uri: "https://other.workers.dev" }]
            },
            {
              id: "app-match", uid: "app-match", aud: "AUD-M", name: "Helm", domain: "match.example", type: "self_hosted",
              destinations: [{ type: "public", uri: "https://match.example/" }]
            }
          ]
        }),
        { status: 200 }
      )
    );
    const r = await findAccessAppByDestination("t", "acc-1", "https://match.example", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result?.id).toBe("app-match");
  });

  it("falls back to legacy `domain` field for old apps", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: true,
          result: [
            { id: "legacy", uid: "legacy", aud: "AUD-L", name: "Legacy", domain: "legacy.workers.dev", type: "self_hosted" }
          ]
        }),
        { status: 200 }
      )
    );
    const r = await findAccessAppByDestination("t", "acc-1", "https://legacy.workers.dev", { fetchImpl: f });
    expect(r.result?.id).toBe("legacy");
  });

  it("returns null result when nothing matches", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: true, result: [] }),
        { status: 200 }
      )
    );
    const r = await findAccessAppByDestination("t", "acc-1", "https://nothing.example", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result).toBeNull();
  });
});

describe("cfApi.ensureAccessApp", () => {
  it("create succeeds — passes result through with no `reused` flag", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: true,
          result: { id: "app-new", uid: "app-new", aud: "AUD-N", name: "Helm", domain: "new.example", type: "self_hosted" }
        }),
        { status: 200 }
      )
    );
    const r = await ensureAccessApp("t", "acc-1", { name: "Helm", domain: "new.example" }, { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result?.id).toBe("app-new");
    expect(r.reused).toBeUndefined();
  });

  it("on application_already_exists, falls back to find-by-destination and returns reused: true", async () => {
    let call = 0;
    const f = fakeFetch((_url, _init) => {
      call += 1;
      if (call === 1) {
        // POST /access/apps
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 12109, message: "access.api.error.application_already_exists" }]
          }),
          { status: 409 }
        );
      }
      // GET /access/apps?per_page=100
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              id: "app-existing", uid: "app-existing", aud: "AUD-E", name: "Helm — old", domain: "x.example", type: "self_hosted",
              destinations: [{ type: "public", uri: "https://x.example" }]
            }
          ]
        }),
        { status: 200 }
      );
    });
    const r = await ensureAccessApp("t", "acc-1", { name: "Helm", domain: "x.example" }, { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result?.id).toBe("app-existing");
    expect(r.result?.aud).toBe("AUD-E");
    expect(r.reused).toBe(true);
  });

  it("on a non-conflict error, surfaces the original failure", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: "Authentication error" }]
        }),
        { status: 403 }
      )
    );
    const r = await ensureAccessApp("t", "acc-1", { name: "Helm", domain: "y.example" }, { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].code).toBe(9109);
    expect(r.reused).toBeUndefined();
  });

  it("application_already_exists but list returns nothing → surfaces original error", async () => {
    let call = 0;
    const f = fakeFetch(() => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ success: false, errors: [{ code: 12109, message: "duplicate" }] }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    });
    const r = await ensureAccessApp("t", "acc-1", { name: "Helm", domain: "z.example" }, { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].message).toBe("duplicate");
  });
});

describe("cfApi.createR2Bucket / ensureR2Bucket", () => {
  it("createR2Bucket POSTs to /r2/buckets with normalized name", async () => {
    let capturedBody = "";
    const f = fakeFetch((url, init) => {
      capturedBody = String(init.body);
      expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc-1/r2/buckets");
      return new Response(
        JSON.stringify({ success: true, result: { name: "helm-workspace" } }),
        { status: 200 }
      );
    });
    // Pass uppercase + invalid chars — the helper should normalize.
    await createR2Bucket("t", "acc-1", "Helm_Workspace.X", { fetchImpl: f });
    expect(JSON.parse(capturedBody)).toEqual({ name: "helm-workspace-x" });
  });

  it("ensureR2Bucket recovers from already-exists by reusing the same name", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10004, message: "The bucket you tried to create already exists" }]
        }),
        { status: 409 }
      )
    );
    const r = await ensureR2Bucket("t", "acc-1", "helm-workspace", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.reused).toBe(true);
    expect(r.result?.name).toBe("helm-workspace");
  });

  it("ensureR2Bucket surfaces non-conflict errors directly", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 9109, message: "Authentication error" }] }),
        { status: 403 }
      )
    );
    const r = await ensureR2Bucket("t", "acc-1", "helm-workspace", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].code).toBe(9109);
    expect(r.reused).toBeUndefined();
  });
});

describe("cfApi.createAiGateway / ensureAiGateway", () => {
  it("createAiGateway POSTs to /ai-gateway/gateways with a normalized id", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const f = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({ success: true, result: { id: "open-think" } }),
        { status: 200 }
      );
    });
    // Pass a name with uppercase + underscores — the helper should
    // lowercase + hyphenate to match CF's id rules.
    await createAiGateway("t", "acc-1", "Open_Think", { fetchImpl: f });
    expect(capturedUrl).toBe("https://api.cloudflare.com/client/v4/accounts/acc-1/ai-gateway/gateways");
    const body = JSON.parse(capturedBody);
    expect(body.id).toBe("open-think");
    // CF's create-gateway endpoint requires all six fields; omitting
    // any number returns "Expected number, received nan" (code 7001).
    expect(body.cache_invalidate_on_update).toBe(true);
    expect(body.cache_ttl).toBe(0);
    expect(body.collect_logs).toBe(true);
    expect(body.rate_limiting_interval).toBe(0);
    expect(body.rate_limiting_limit).toBe(0);
  });

  it("ensureAiGateway returns success directly on a fresh create", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: true, result: { id: "helm" } }),
        { status: 200 }
      )
    );
    const r = await ensureAiGateway("t", "acc-1", "helm", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.reused).toBeUndefined();
    expect(r.result?.id).toBe("helm");
  });

  it("ensureAiGateway recovers from 409/already-exists by reusing the same id", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 5403, message: "AI gateway with that id already exists" }]
        }),
        { status: 409 }
      )
    );
    const r = await ensureAiGateway("t", "acc-1", "Helm", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.reused).toBe(true);
    // Normalized id is what we'd reference at the gateway URL — verify
    // the helper returns a usable value for downstream code.
    expect(r.result?.id).toBe("helm");
  });

  it("ensureAiGateway surfaces non-conflict errors directly", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 9109, message: "Authentication error" }] }),
        { status: 403 }
      )
    );
    const r = await ensureAiGateway("t", "acc-1", "helm", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].code).toBe(9109);
    expect(r.reused).toBeUndefined();
  });
});

describe("cfApi.ensureWorkerSecret", () => {
  it("PUT succeeds — no settings call needed", async () => {
    let calls = 0;
    const f = fakeFetch(() => {
      calls += 1;
      return new Response(
        JSON.stringify({ success: true, result: { name: "X", type: "secret_text" } }),
        { status: 200 }
      );
    });
    const r = await ensureWorkerSecret("t", "acc-1", "helm", "X", "v", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.reused).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("on 10053 with matching plain_text — succeeds with reused=value-match-plain-text", async () => {
    let call = 0;
    const f = fakeFetch(() => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10053, message: "Binding name 'CF_ACCESS_TEAM_DOMAIN' already in use." }]
          }),
          { status: 400 }
        );
      }
      // settings GET
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            bindings: [
              { name: "CF_ACCESS_TEAM_DOMAIN", type: "plain_text", text: "https://tom.cloudflareaccess.com" }
            ]
          }
        }),
        { status: 200 }
      );
    });
    const r = await ensureWorkerSecret("t", "acc-1", "helm", "CF_ACCESS_TEAM_DOMAIN", "https://tom.cloudflareaccess.com", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.reused).toBe("value-match-plain-text");
  });

  it("on 10053 with DIFFERENT plain_text value — fails with concrete recovery", async () => {
    let call = 0;
    const f = fakeFetch(() => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10053, message: "Binding name 'X' already in use." }]
          }),
          { status: 400 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: { bindings: [{ name: "X", type: "plain_text", text: "old-value" }] }
        }),
        { status: 200 }
      );
    });
    const r = await ensureWorkerSecret("t", "acc-1", "helm", "X", "new-value", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.recovery).toMatch(/different value/i);
    expect(r.recovery).toContain("dash");
  });

  it("on 10053 with secret_text — succeeds with reused=already-secret", async () => {
    let call = 0;
    const f = fakeFetch(() => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10053, message: "Binding name 'X' already in use." }]
          }),
          { status: 400 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: { bindings: [{ name: "X", type: "secret_text" }] }
        }),
        { status: 200 }
      );
    });
    const r = await ensureWorkerSecret("t", "acc-1", "helm", "X", "v", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.reused).toBe("already-secret");
  });

  it("on a non-binding-conflict error — surfaces the original error directly", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 9109, message: "Authentication error" }] }),
        { status: 403 }
      )
    );
    const r = await ensureWorkerSecret("t", "acc-1", "helm", "X", "v", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0].code).toBe(9109);
    expect(r.recovery).toBeUndefined();
  });
});

describe("cfApi.flattenMigrationsForCfApi", () => {
  it("flattens an array of historical migrations into one CF API object", () => {
    const out = flattenMigrationsForCfApi([
      { tag: "v1", new_sqlite_classes: ["AgentSessionDO"] },
      { tag: "v2", new_classes: ["StreamHubDO"] },
      { tag: "v3", new_classes: ["ChatSessionDO"] }
    ]);
    expect(out).toEqual({
      new_tag: "v3",
      new_classes: ["StreamHubDO", "ChatSessionDO"],
      new_sqlite_classes: ["AgentSessionDO"]
    });
  });

  it("returns undefined for empty / missing input", () => {
    expect(flattenMigrationsForCfApi(undefined)).toBeUndefined();
    expect(flattenMigrationsForCfApi([])).toBeUndefined();
  });

  it("passes through if already in object shape", () => {
    const obj = { new_tag: "v2", new_classes: ["X"] };
    expect(flattenMigrationsForCfApi(obj)).toEqual(obj);
  });

  it("ignores migrations with no class fields (just a tag)", () => {
    const out = flattenMigrationsForCfApi([
      { tag: "v1" },
      { tag: "v2", new_classes: ["X"] }
    ]);
    expect(out).toEqual({ new_tag: "v2", new_classes: ["X"] });
  });
});

describe("cfApi.findD1DatabaseByName", () => {
  it("hits the right URL with name query", async () => {
    let capturedUrl = "";
    const f = fakeFetch((url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          success: true,
          result: [{ uuid: "abc-123", name: "helm-pa" }]
        }),
        { status: 200 }
      );
    });
    const r = await findD1DatabaseByName("t", "acc-1", "helm-pa", { fetchImpl: f });
    expect(capturedUrl).toContain("/accounts/acc-1/d1/database");
    expect(capturedUrl).toContain("name=helm-pa");
    expect(r.success).toBe(true);
    expect(r.result?.[0]?.uuid).toBe("abc-123");
  });
});

describe("cfApi.ensureD1Database (idempotent create)", () => {
  it("returns the new uuid when create succeeds first try", async () => {
    let calls = 0;
    const f = fakeFetch(() => {
      calls++;
      return new Response(
        JSON.stringify({ success: true, result: { uuid: "new-uuid", name: "helm-pa" } }),
        { status: 200 }
      );
    });
    const r = await ensureD1Database("t", "acc-1", "helm-pa", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result?.uuid).toBe("new-uuid");
    expect(r.reused).toBeUndefined();
    expect(calls).toBe(1); // only the create call, no fallback list
  });

  it("falls back to list-by-name when create says 'already exists'", async () => {
    let calls = 0;
    const f = fakeFetch((url, init) => {
      calls++;
      if (init.method === "POST") {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 7501, message: "A database with that name already exists" }]
          }),
          { status: 400 }
        );
      }
      // GET fallback — return the existing database
      return new Response(
        JSON.stringify({
          success: true,
          result: [{ uuid: "existing-uuid", name: "helm-pa" }]
        }),
        { status: 200 }
      );
    });
    const r = await ensureD1Database("t", "acc-1", "helm-pa", { fetchImpl: f });
    expect(r.success).toBe(true);
    expect(r.result?.uuid).toBe("existing-uuid");
    expect(r.reused).toBe(true);
    expect(calls).toBe(2); // create + list
  });

  it("surfaces the original error when create fails for a non-name-collision reason", async () => {
    const f = fakeFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: "Authentication error" }]
        }),
        { status: 403 }
      )
    );
    const r = await ensureD1Database("t", "acc-1", "helm-pa", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0]?.message).toMatch(/Authentication error/);
  });

  it("returns original create error if list-by-name finds nothing", async () => {
    const f = fakeFetch((_url, init) => {
      if (init.method === "POST") {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 7501, message: "name already exists" }]
          }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    });
    const r = await ensureD1Database("t", "acc-1", "helm-pa", { fetchImpl: f });
    expect(r.success).toBe(false);
    expect(r.errors?.[0]?.message).toMatch(/already exists/);
  });
});
