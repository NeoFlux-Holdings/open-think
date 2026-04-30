/**
 * Auth tests — only the dev-bypass + config-missing paths run in unit tests.
 * The real JWT verification needs a JWKS endpoint; we trust jose's own tests
 * for that and verify integration at deploy time.
 */
import { describe, expect, it } from "vitest";
import { isPublicRoute, requireAuth, verifyAccessJwt } from "../src/auth";
import type { Env } from "../src/types";

function baseEnv(partial: Partial<Env> = {}): Env {
  return { ENABLED_PLUGINS: "", ALLOWED_HOSTS: "", ...partial } as Env;
}

describe("auth", () => {
  it("isPublicRoute exposes only the small public-by-design surface", () => {
    // Public reads
    expect(isPublicRoute("GET", "/")).toBe(true);
    expect(isPublicRoute("GET", "/welcome")).toBe(true);
    expect(isPublicRoute("GET", "/health")).toBe(true);
    expect(isPublicRoute("GET", "/openapi.json")).toBe(true);
    // Web Push needs the public key + service worker reachable pre-session
    expect(isPublicRoute("GET", "/webpush/public-key")).toBe(true);
    expect(isPublicRoute("GET", "/sw.js")).toBe(true);
    expect(isPublicRoute("GET", "/icon.svg")).toBe(true);
    // Everything else is gated
    expect(isPublicRoute("GET", "/app")).toBe(false);
    expect(isPublicRoute("GET", "/conductor/message")).toBe(false);
    expect(isPublicRoute("GET", "/setup/status")).toBe(false);
    // Non-GET methods always require auth even on public paths
    expect(isPublicRoute("POST", "/")).toBe(false);
    expect(isPublicRoute("POST", "/welcome")).toBe(false);
  });

  it("DEV_AUTH_BYPASS fakes a logged-in user", async () => {
    const env = baseEnv({ DEV_AUTH_BYPASS: "1", AGENT_OWNER_EMAIL: "dev@example.com" });
    const req = new Request("https://helm.test/app");
    const ctx = await verifyAccessJwt(req, env);
    expect(ctx).not.toBeNull();
    expect(ctx!.email).toBe("dev@example.com");
    expect(ctx!.dev).toBe(true);
  });

  it("missing token returns null (not a throw)", async () => {
    const env = baseEnv({
      CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-tag"
    });
    const req = new Request("https://helm.test/app");
    expect(await verifyAccessJwt(req, env)).toBeNull();
  });

  it("first-run permissive: no Access config, no JWT → returns guest with firstRun=true", async () => {
    const env = baseEnv();
    const req = new Request("https://helm.test/app");
    const ctx = await verifyAccessJwt(req, env);
    expect(ctx).not.toBeNull();
    expect(ctx!.firstRun).toBe(true);
    expect(ctx!.dev).toBe(false);
    expect(ctx!.email).toContain("first-run");
  });

  it("first-run permissive: ignores any JWT when Access is unconfigured", async () => {
    const env = baseEnv();
    const req = new Request("https://helm.test/app", {
      headers: { "cf-access-jwt-assertion": "bogus.jwt.value" }
    });
    const ctx = await verifyAccessJwt(req, env);
    // Should NOT throw, should NOT trust the bogus JWT — should return a
    // first-run guest. Strict mode flips on automatically once Access is set.
    expect(ctx).not.toBeNull();
    expect(ctx!.firstRun).toBe(true);
  });

  it("strict mode: with Access config + no JWT → null (handler-side requireAuth → 401)", async () => {
    const env = baseEnv({
      CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-tag"
    });
    const req = new Request("https://helm.test/app");
    expect(await verifyAccessJwt(req, env)).toBeNull();
  });

  it("requireAuth lets first-run guests through, blocks strict-mode anonymous", async () => {
    // First-run: should not throw.
    const firstRunEnv = baseEnv();
    const firstRunReq = new Request("https://helm.test/app");
    const ctx = await requireAuth(firstRunReq, firstRunEnv);
    expect(ctx.firstRun).toBe(true);

    // Strict-mode: should reject.
    const strictEnv = baseEnv({
      CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-tag"
    });
    const strictReq = new Request("https://helm.test/app");
    await expect(requireAuth(strictReq, strictEnv)).rejects.toMatchObject({
      code: "E_UNAUTHORIZED",
      status: 401
    });
  });

  describe("HELM_INTERNAL_TOKEN bearer path", () => {
    it("matching bearer authenticates as the agent (overrides Access)", async () => {
      const env = baseEnv({
        CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud-tag",
        HELM_INTERNAL_TOKEN: "secret-internal-xyz",
        AGENT_OWNER_EMAIL: "tom@example.com"
      });
      const req = new Request("https://helm.test/conductor/message", {
        headers: { authorization: "Bearer secret-internal-xyz" }
      });
      const ctx = await verifyAccessJwt(req, env);
      expect(ctx).not.toBeNull();
      expect(ctx!.subject).toBe("helm-internal");
      expect(ctx!.email).toBe("tom@example.com");
      expect(ctx!.firstRun).toBe(false);
      expect(ctx!.dev).toBe(false);
    });

    it("mismatched bearer falls through to JWT verification", async () => {
      const env = baseEnv({
        CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud-tag",
        HELM_INTERNAL_TOKEN: "secret-internal-xyz"
      });
      const req = new Request("https://helm.test/conductor/message", {
        headers: { authorization: "Bearer wrong-token" }
      });
      // Wrong bearer + no JWT → null (caller would 401).
      expect(await verifyAccessJwt(req, env)).toBeNull();
    });

    it("bearer is ignored when HELM_INTERNAL_TOKEN is unset", async () => {
      const env = baseEnv({
        CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud-tag"
      });
      const req = new Request("https://helm.test/conductor/message", {
        headers: { authorization: "Bearer anything" }
      });
      expect(await verifyAccessJwt(req, env)).toBeNull();
    });

    it("non-Bearer Authorization header is not interpreted as internal", async () => {
      const env = baseEnv({
        CF_ACCESS_TEAM_DOMAIN: "https://tom.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud-tag",
        HELM_INTERNAL_TOKEN: "secret-internal-xyz"
      });
      const req = new Request("https://helm.test/conductor/message", {
        headers: { authorization: "Basic c2VjcmV0LWludGVybmFsLXh5eg==" }
      });
      expect(await verifyAccessJwt(req, env)).toBeNull();
    });
  });
});
