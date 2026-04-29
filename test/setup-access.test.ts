/**
 * Lock-it-down wizard — orchestrator + helper tests.
 *
 * The wizard chains 6 CF API calls (org → app → policy → 3× secrets) so the
 * tests focus on:
 *   - happy-path: every call succeeds, all 6 step records returned ok
 *   - per-call failure: each step fails cleanly, prior progress preserved,
 *     recovery copy makes sense
 *   - input validation: bad email, bad token shape
 *   - host parsing: workers.dev derivation, custom-domain returns null
 */

import { describe, expect, it } from "vitest";
import {
  preflightToken,
  runLockdown,
  deriveScriptName,
  ACCESS_WIZARD_TOKEN_URL,
  ACCESS_WIZARD_SCOPES
} from "../src/setup-access";

const CF = "https://api.cloudflare.com/client/v4";

/* ---------------- routedFetch helper ---------------- */
function routedFetch(routes: Record<string, () => Response>): typeof fetch {
  // Sort by descending length so /access/apps/{id}/policies matches before
  // /access/apps. Each handler resolves to a Response.
  const ordered = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const [pattern, handler] of ordered) {
      if (url.startsWith(pattern)) return handler();
    }
    return new Response(
      JSON.stringify({ success: false, errors: [{ code: 404, message: "no route: " + url }] }),
      { status: 404 }
    );
  }) as unknown as typeof fetch;
}

const ok = <T>(result: T) =>
  new Response(JSON.stringify({ success: true, result }), { status: 200 });

const err = (code: number, message: string) =>
  new Response(JSON.stringify({ success: false, errors: [{ code, message }] }), {
    status: 400
  });

/* ---------------- preflightToken ---------------- */

describe("preflightToken", () => {
  it("rejects malformed tokens upfront", async () => {
    const r = await preflightToken("short");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("shape");
  });

  it("returns accounts when the token verifies", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok-1", status: "active" }),
      [`${CF}/accounts`]: () => ok([{ id: "acc-a", name: "Tom" }, { id: "acc-b", name: "Other" }])
    });
    const r = await preflightToken("a-real-looking-token-1234567890", { fetchImpl: f });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokenId).toBe("tok-1");
      expect(r.accounts.length).toBe(2);
    }
  });

  it("surfaces a verify failure as 'verify-failed'", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => err(1000, "invalid token")
    });
    const r = await preflightToken("a-real-looking-token-1234567890", { fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("verify-failed");
      expect(r.error).toMatch(/invalid token/);
    }
  });

  it("returns 'no-accounts' when the token has zero accounts", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok-1", status: "active" }),
      [`${CF}/accounts`]: () => ok([])
    });
    const r = await preflightToken("a-real-looking-token-1234567890", { fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no-accounts");
  });
});

/* ---------------- runLockdown · happy path ---------------- */

describe("runLockdown · full happy path", () => {
  it("creates app + policy + 3 secrets and returns aud + teamDomain", async () => {
    const secretCalls: Array<{ name: string; text: string }> = [];
    const f = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "tom.cloudflareaccess.com", name: "Tom" }),
      [`${CF}/accounts/acc-1/access/apps/app-1/policies`]: () => ok({ id: "pol-1" }),
      [`${CF}/accounts/acc-1/access/apps`]: () =>
        ok({
          id: "app-1",
          uid: "app-1",
          aud: "AUD123abcdef0123456789",
          name: "Helm — tomtom-agent",
          domain: "tomtom-agent.acct.workers.dev",
          type: "self_hosted"
        }),
      [`${CF}/accounts/acc-1/workers/scripts/tomtom-agent/secrets`]: () =>
        ok({ name: "set", type: "secret_text" })
    });

    // Wrap fetch so we can capture the secret-PUT request bodies.
    const wrappedFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/secrets") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}"));
        secretCalls.push({ name: body.name, text: body.text });
      }
      return f(input as RequestInfo, init);
    }) as typeof fetch;

    const result = await runLockdown(
      {
        token: "valid-token-1234567890",
        accountId: "acc-1",
        scriptName: "tomtom-agent",
        appName: "Helm — tomtom-agent",
        workerHost: "tomtom-agent.acct.workers.dev",
        allowedEmails: ["tom@example.com"]
      },
      { fetchImpl: wrappedFetch }
    );

    expect(result.ok).toBe(true);
    expect(result.aud).toBe("AUD123abcdef0123456789");
    expect(result.appId).toBe("app-1");
    expect(result.teamDomain).toBe("https://tom.cloudflareaccess.com");

    // All 6 expected step kinds present + ok.
    const kinds = result.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      "team-domain",
      "create-app",
      "create-policy",
      "set-secret-team-domain",
      "set-secret-aud",
      "set-secret-allowed-emails"
    ]);
    expect(result.steps.every((s) => s.ok)).toBe(true);

    // The 3 secret PUTs carried the right values.
    expect(secretCalls.find((s) => s.name === "CF_ACCESS_TEAM_DOMAIN")?.text).toBe(
      "https://tom.cloudflareaccess.com"
    );
    expect(secretCalls.find((s) => s.name === "CF_ACCESS_AUD")?.text).toBe("AUD123abcdef0123456789");
    expect(secretCalls.find((s) => s.name === "CF_ACCESS_ALLOWED_EMAILS")?.text).toBe("tom@example.com");
  });

  it("joins multiple emails into the allow-list secret", async () => {
    const secretCalls: Array<{ name: string; text: string }> = [];
    const baseFetch = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "x.cloudflareaccess.com", name: "x" }),
      [`${CF}/accounts/acc-1/access/apps/app-1/policies`]: () => ok({ id: "p" }),
      [`${CF}/accounts/acc-1/access/apps`]: () =>
        ok({ id: "app-1", uid: "app-1", aud: "AUD", name: "n", domain: "d", type: "self_hosted" }),
      [`${CF}/accounts/acc-1/workers/scripts/h/secrets`]: () => ok({ name: "x", type: "secret_text" })
    });
    const f: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : (input as Request).url;
      if (u.endsWith("/secrets") && init?.method === "PUT") {
        secretCalls.push(JSON.parse(String(init.body ?? "{}")));
      }
      return baseFetch(input as RequestInfo, init);
    }) as typeof fetch;
    const r = await runLockdown(
      {
        token: "tok",
        accountId: "acc-1",
        scriptName: "h",
        appName: "h",
        workerHost: "h.dev",
        allowedEmails: ["a@x.com", "b@x.com", "c@x.com"]
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    expect(secretCalls.find((s) => s.name === "CF_ACCESS_ALLOWED_EMAILS")?.text).toBe(
      "a@x.com,b@x.com,c@x.com"
    );
  });
});

/* ---------------- runLockdown · failure modes ---------------- */

describe("runLockdown · failure paths", () => {
  it("missing team domain → stops at step 1 with recovery copy", async () => {
    const f = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "", name: "x" })
    });
    const r = await runLockdown(
      {
        token: "tok",
        accountId: "acc-1",
        scriptName: "h",
        appName: "h",
        workerHost: "h.dev",
        allowedEmails: ["a@x.com"]
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].kind).toBe("team-domain");
    expect(r.steps[0].ok).toBe(false);
    expect(r.recovery).toMatch(/Zero Trust/);
  });

  it("Access app POST fails → returns recovery suggesting token scope", async () => {
    const f = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "x.cloudflareaccess.com", name: "x" }),
      [`${CF}/accounts/acc-1/access/apps`]: () => err(9109, "Insufficient permissions")
    });
    const r = await runLockdown(
      {
        token: "tok",
        accountId: "acc-1",
        scriptName: "h",
        appName: "h",
        workerHost: "h.dev",
        allowedEmails: ["a@x.com"]
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    expect(r.steps).toHaveLength(2); // team-domain ok + create-app fail
    expect(r.steps[1].kind).toBe("create-app");
    expect(r.recovery).toMatch(/Apps and Policies/);
  });

  it("policy creation fails → still returns aud + appId so user can clean up", async () => {
    const f = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "x.cloudflareaccess.com", name: "x" }),
      [`${CF}/accounts/acc-1/access/apps/app-1/policies`]: () =>
        err(9109, "policy permission missing"),
      [`${CF}/accounts/acc-1/access/apps`]: () =>
        ok({ id: "app-1", uid: "app-1", aud: "AUD-X", name: "n", domain: "d", type: "self_hosted" })
    });
    const r = await runLockdown(
      {
        token: "tok",
        accountId: "acc-1",
        scriptName: "h",
        appName: "h",
        workerHost: "h.dev",
        allowedEmails: ["a@x.com"]
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    expect(r.appId).toBe("app-1");
    expect(r.aud).toBe("AUD-X");
    expect(r.recovery).toMatch(/Delete the app/);
  });

  it("secret PUT fails after app+policy succeed → recovery names the missing secrets", async () => {
    const f = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "x.cloudflareaccess.com", name: "x" }),
      [`${CF}/accounts/acc-1/access/apps/app-1/policies`]: () => ok({ id: "p" }),
      [`${CF}/accounts/acc-1/access/apps`]: () =>
        ok({ id: "app-1", uid: "app-1", aud: "AUD-X", name: "n", domain: "d", type: "self_hosted" }),
      [`${CF}/accounts/acc-1/workers/scripts/h/secrets`]: () =>
        err(10007, "Workers Scripts:Edit missing")
    });
    const r = await runLockdown(
      {
        token: "tok",
        accountId: "acc-1",
        scriptName: "h",
        appName: "h",
        workerHost: "h.dev",
        allowedEmails: ["a@x.com"]
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    // 4 steps: team-domain ok, create-app ok, create-policy ok, set-secret-team-domain fail
    expect(r.steps.length).toBe(4);
    expect(r.steps[3].kind).toBe("set-secret-team-domain");
    expect(r.steps[3].ok).toBe(false);
    expect(r.recovery).toMatch(/CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD/);
    expect(r.appId).toBe("app-1"); // still surfaces the breadcrumb
  });

  it("empty allowedEmails list → fails create-policy step before calling CF", async () => {
    const f = routedFetch({
      [`${CF}/accounts/acc-1/access/organizations`]: () =>
        ok({ auth_domain: "x.cloudflareaccess.com", name: "x" }),
      [`${CF}/accounts/acc-1/access/apps`]: () =>
        ok({ id: "app-1", uid: "app-1", aud: "AUD", name: "n", domain: "d", type: "self_hosted" })
    });
    const r = await runLockdown(
      {
        token: "tok",
        accountId: "acc-1",
        scriptName: "h",
        appName: "h",
        workerHost: "h.dev",
        allowedEmails: ["", "  ", "not-an-email"]
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no valid emails/);
  });
});

/* ---------------- helpers ---------------- */

describe("deriveScriptName", () => {
  it("extracts the leading subdomain on workers.dev", () => {
    expect(deriveScriptName("tomtom-agent.thomas-zarebczan.workers.dev")).toBe("tomtom-agent");
    expect(deriveScriptName("helm.workers.dev")).toBe("helm");
  });
  it("returns null for custom domains (caller must specify)", () => {
    expect(deriveScriptName("agent.example.com")).toBe(null);
    expect(deriveScriptName("")).toBe(null);
  });
});

describe("ACCESS_WIZARD_TOKEN_URL + scopes", () => {
  it("includes the four required permission groups", () => {
    expect(ACCESS_WIZARD_TOKEN_URL).toMatch(/workers\.scripts:edit/);
    expect(ACCESS_WIZARD_TOKEN_URL).toMatch(/zerotrust\.access:edit/);
    expect(ACCESS_WIZARD_TOKEN_URL).toMatch(/settings:read/);
    expect(ACCESS_WIZARD_TOKEN_URL).toMatch(/user\.details:read/);
  });
  it("scope list mirrors the URL", () => {
    expect(ACCESS_WIZARD_SCOPES.length).toBe(4);
    expect(ACCESS_WIZARD_SCOPES.some((s) => s.permission.includes("Workers Scripts"))).toBe(true);
  });
});
