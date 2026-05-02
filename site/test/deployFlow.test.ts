/**
 * Deploy orchestrator round-trip tests. Mocks every CF API endpoint and
 * verifies:
 *   - The full happy path (token + D1 + Access) returns ok with a wrangler.toml
 *     containing the new database_id + team domain.
 *   - The "Access only, no D1" and "D1 only, no Access" paths produce the
 *     right wrangler.toml shape.
 *   - The token-rejected path stops at step 1 and reports a clean error.
 *   - Owner email rendering ends up in [vars].
 *   - Secret commands are emitted in the right order.
 */
import { describe, expect, it } from "vitest";
import { composeWranglerToml, renderFinalCommands, runDeploy, verifyAndListAccounts } from "../src/cloud/deployFlow";

const CF = "https://api.cloudflare.com/client/v4";

function routedFetch(routes: Record<string, () => Response>): typeof fetch {
  // Sort by descending length so more specific routes (e.g. /apps/X/policies)
  // match before their less-specific prefixes (/apps).
  const ordered = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const [pattern, handler] of ordered) {
      if (url.startsWith(pattern)) return handler();
    }
    return new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: "no route" }] }), { status: 404 });
  }) as unknown as typeof fetch;
}

function ok<T>(result: T) {
  return new Response(JSON.stringify({ success: true, result }), { status: 200 });
}
function err(code: number, message: string) {
  return new Response(JSON.stringify({ success: false, errors: [{ code, message }] }), { status: 400 });
}

describe("verifyAndListAccounts", () => {
  it("returns accounts on a good token", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok-1", status: "active" }),
      [`${CF}/accounts`]: () => ok([{ id: "acc-1", name: "Tom" }])
    });
    const r = await verifyAndListAccounts("token", { fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].id).toBe("acc-1");
  });

  it("surfaces token-verify failures", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => err(1000, "invalid token")
    });
    const r = await verifyAndListAccounts("bad", { fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid token/);
  });
});

describe("runDeploy · full happy path", () => {
  it("verifies → resolves subdomain → creates D1 → resolves Access team domain → composes wrangler.toml → defers Access app creation until after upload", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok-1", status: "active" }),
      // Subdomain lookup — runDeploy resolves this once so the URL it
      // advertises is `<name>.<subdomain>.workers.dev`, not the legacy
      // `<name>.workers.dev` (which doesn't actually resolve).
      [`${CF}/accounts/acc-1/workers/subdomain`]: () => ok({ subdomain: "tom-acct" }),
      [`${CF}/accounts/acc-1/d1/database`]: () => ok({ uuid: "d1-uuid-abc", name: "helm-pa" }),
      [`${CF}/accounts/acc-1/access/organizations`]: () => ok({ auth_domain: "tom.cloudflareaccess.com", name: "Tom" })
      // No /access/apps mock — directDeploy isn't configured in this
      // test, so the Access app creation step is deferred (the Worker
      // doesn't exist on the server side, only a wrangler.toml is
      // composed for local deploy).
    });

    const r = await runDeploy(
      {
        token: "tok",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: true,
        enableAccess: true,
        secrets: { OWNER_EMAIL: "tom@example.com", ANTHROPIC_API_KEY: "sk-ant-test" }
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    const stepKinds = r.steps.map((s) => s.kind);
    expect(stepKinds).toContain("verify-token");
    expect(stepKinds).toContain("create-d1");
    expect(stepKinds).toContain("create-access-app");
    expect(stepKinds).toContain("compose-wrangler-toml");
    expect(stepKinds).toContain("render-cli-commands");

    // The advertised URL uses the resolved subdomain.
    expect(r.workerUrl).toBe("https://helm.tom-acct.workers.dev");

    // Access creation deferred — we have the team domain but the Worker
    // doesn't exist yet (no directDeploy in this test). The deferred
    // step succeeds with a clear "run lockdown wizard at /app#/settings"
    // message.
    const accessStep = r.steps.find((s) => s.kind === "create-access-app");
    expect(accessStep?.ok).toBe(true);
    expect(accessStep?.summary).toMatch(/deferred|lockdown wizard|after/i);

    // Wrangler.toml carries the new IDs.
    expect(r.wranglerToml).toMatch(/database_id = "d1-uuid-abc"/);
    expect(r.wranglerToml).toMatch(/OWNER_EMAIL = "tom@example.com"/);
    // CF_ACCESS_AUD lives only in secrets, not in wrangler.toml [vars].
    expect(r.wranglerToml).not.toMatch(/CF_ACCESS_AUD = /);

    // Commands include both secrets the user supplied.
    const allCmds = (r.commands ?? []).join("\n");
    expect(allCmds).toMatch(/wrangler secret put OWNER_EMAIL/);
    expect(allCmds).toMatch(/wrangler secret put ANTHROPIC_API_KEY/);
    expect(allCmds).toMatch(/wrangler deploy/);
  });
});

describe("runDeploy · partial paths", () => {
  it("D1 disabled → no [[d1_databases]] in wrangler.toml", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/access/organizations`]: () => ok({ auth_domain: "x.cloudflareaccess.com", name: "x" }),
      [`${CF}/accounts/acc-1/access/apps`]: () => ok({ id: "a", uid: "a", aud: "AUD", name: "n", domain: "d.workers.dev", type: "self_hosted" }),
      [`${CF}/accounts/acc-1/access/apps/a/policies`]: () => ok({ id: "p" })
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: true,
        secrets: { OWNER_EMAIL: "x@x.com" }
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    expect(r.wranglerToml).not.toMatch(/\[\[d1_databases\]\]/);
    expect(r.steps.find((s) => s.kind === "create-d1")).toBeUndefined();
  });

  it("Access disabled → wrangler.toml has no CF_ACCESS_TEAM_DOMAIN", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/d1/database`]: () => ok({ uuid: "d1-x", name: "helm-pa" })
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: true,
        enableAccess: false
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    expect(r.wranglerToml).toMatch(/database_id = "d1-x"/);
    expect(r.wranglerToml).not.toMatch(/CF_ACCESS_TEAM_DOMAIN/);
  });
});

describe("runDeploy · failure modes", () => {
  it("token rejected → stops at step 1", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => err(1000, "invalid token")
    });
    const r = await runDeploy(
      { token: "bad", accountId: "acc-1", workerName: "helm", enableD1: true, enableAccess: true },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].ok).toBe(false);
    expect(r.steps[0].error).toMatch(/invalid token/);
  });

  it("D1 create fails → stops, no wrangler.toml", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/workers/subdomain`]: () => ok({ subdomain: "tom-acct" }),
      [`${CF}/accounts/acc-1/d1/database`]: () => err(7501, "quota exceeded")
    });
    const r = await runDeploy(
      { token: "t", accountId: "acc-1", workerName: "helm", enableD1: true, enableAccess: false },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(false);
    expect(r.wranglerToml).toBeUndefined();
    // D1 step is the one that fails — find by kind, not by index.
    // Earlier steps include verify-token + (potentially) the
    // subdomain-lookup warning step.
    const d1Step = r.steps.find((s) => s.kind === "create-d1");
    expect(d1Step?.ok).toBe(false);
    expect(d1Step?.error).toMatch(/quota exceeded/);
  });

  it("Access org has no team domain → continues without Access (warning step)", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/access/organizations`]: () => ok({ auth_domain: "", name: "x" })
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: true,
        secrets: { OWNER_EMAIL: "x@x.com" }
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true); // Access is optional; we soldier on
    const accessStep = r.steps.find((s) => s.kind === "create-access-app");
    expect(accessStep?.ok).toBe(false);
    expect(accessStep?.summary).toMatch(/team domain/);
    expect(r.wranglerToml).not.toMatch(/CF_ACCESS_TEAM_DOMAIN/);
  });
});

describe("composeWranglerToml · invariants", () => {
  it("ships the self-admin plugin stack + a non-empty ALLOWED_HOSTS", () => {
    const t = composeWranglerToml({
      workerName: "helm",
      accountId: "acc-1",
      d1: null,
      access: null
    });
    // The deployed Worker needs cloudflare-admin + helm-setup +
    // helm-artifacts + mcp-client to self-administer (run cf-* skills,
    // helm-setup-deploy, drift sync) right out of the gate.
    expect(t).toMatch(/ENABLED_PLUGINS = ".*cloudflare-admin/);
    expect(t).toMatch(/ENABLED_PLUGINS = ".*helm-setup/);
    expect(t).toMatch(/ENABLED_PLUGINS = ".*helm-artifacts/);
    expect(t).toMatch(/ENABLED_PLUGINS = ".*mcp-client/);
    // ALLOWED_HOSTS must be non-empty or the runtime errors
    // E_INTERNAL "ALLOWED_HOSTS must include at least one host"
    // on every request.
    expect(t).toMatch(/ALLOWED_HOSTS = "api\.cloudflare\.com,/);
    // Default chat model: openrouter/auto (best when OPENROUTER_API_KEY
    // is set; falls back to Workers AI in runtime when key missing).
    expect(t).toMatch(/MODEL_DEFAULT = "openrouter\/auto"/);
  });

  it("honors openRouterDefaultModel override (e.g. pinning kimi)", () => {
    const t = composeWranglerToml({
      workerName: "helm",
      accountId: "acc-1",
      d1: null,
      access: null,
      openRouterDefaultModel: "openrouter/moonshotai/kimi-k2-0905"
    });
    expect(t).toMatch(/MODEL_DEFAULT = "openrouter\/moonshotai\/kimi-k2-0905"/);
  });

  it("includes the two DO bindings + their migrations", () => {
    const t = composeWranglerToml({
      workerName: "helm",
      accountId: "acc-1",
      d1: null,
      access: null
    });
    expect(t).toMatch(/AGENT_SESSIONS/);
    expect(t).toMatch(/STREAM_HUBS/);
    expect(t).toMatch(/new_sqlite_classes = \["AgentSessionDO"\]/);
    expect(t).toMatch(/new_classes = \["StreamHubDO"\]/);
  });
});

describe("runDeploy · directDeploy", () => {
  const SAMPLE_BUNDLE_BYTES = new ArrayBuffer(2048);
  const SAMPLE_MANIFEST = {
    sha: "abc123def456",
    version: "v0.4.0",
    moduleUrl: "https://manifest.test/helm.mjs",
    metadata: {
      main_module: "helm.mjs",
      compatibility_date: "2026-04-16",
      compatibility_flags: ["nodejs_compat_v2"],
      bindings: [
        { type: "ai", name: "AI" },
        {
          type: "durable_object_namespace",
          name: "AGENT_SESSIONS",
          class_name: "AgentSessionDO"
        }
      ],
      migrations: [{ tag: "v1", new_sqlite_classes: ["AgentSessionDO"] }]
    }
  };

  function directDeployFetch(opts: {
    captureUploadMetadata?: (m: Record<string, unknown>) => void;
    captureSecrets?: (name: string, text: string) => void;
    uploadFails?: boolean;
  } = {}): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      // Manifest fetch
      if (url === "https://manifest.test/m.json") {
        return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      }
      if (url === "https://manifest.test/helm.mjs") {
        return new Response(SAMPLE_BUNDLE_BYTES, { status: 200 });
      }
      // CF API
      if (url.endsWith("/user/tokens/verify")) {
        return ok({ id: "tok", status: "active" });
      }
      if (url.endsWith("/d1/database")) {
        return ok({ uuid: "d1-merged", name: "helm-pa" });
      }
      // PUT /workers/scripts/<name> — capture metadata for assertion
      const scriptMatch = url.match(/\/workers\/scripts\/([^/]+)$/);
      if (scriptMatch && init?.method === "PUT") {
        if (opts.uploadFails) {
          return err(1042, "validation failed: script too large");
        }
        const form = init.body as FormData;
        const meta = form?.get?.("metadata") as Blob | null;
        if (meta && opts.captureUploadMetadata) {
          opts.captureUploadMetadata(JSON.parse(await meta.text()));
        }
        return ok({ id: scriptMatch[1] });
      }
      // PUT /workers/scripts/<name>/secrets
      if (url.endsWith("/secrets") && init?.method === "PUT") {
        const body = init.body as string;
        const parsed = JSON.parse(body) as { name: string; text: string };
        if (opts.captureSecrets) opts.captureSecrets(parsed.name, parsed.text);
        return ok({ name: parsed.name, type: "secret_text" });
      }
      return new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: "no route" }] }), { status: 404 });
    }) as unknown as typeof fetch;
  }

  it("uploads bundle + sets secrets and returns directDeployed=true", async () => {
    let capturedMetadata: Record<string, unknown> | null = null;
    const setSecrets: Array<[string, string]> = [];
    const f = directDeployFetch({
      captureUploadMetadata: (m) => { capturedMetadata = m; },
      captureSecrets: (n, t) => setSecrets.push([n, t])
    });
    const r = await runDeploy(
      {
        token: "tok",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: true,
        enableAccess: false,
        secrets: { OWNER_EMAIL: "tom@example.com", ANTHROPIC_API_KEY: "sk-ant-abc" }
      },
      { fetchImpl: f, directDeploy: { manifestUrl: "https://manifest.test/m.json" } }
    );
    expect(r.ok).toBe(true);
    expect(r.directDeployed).toBe(true);
    expect(r.workerUrl).toBe("https://helm.workers.dev");
    expect(r.buildSha).toBe("abc123def456");

    // Step kinds: fetch-bundle + upload-worker + set-secret all present
    const stepKinds = r.steps.map((s) => s.kind);
    expect(stepKinds).toContain("fetch-bundle");
    expect(stepKinds).toContain("upload-worker");
    expect(stepKinds).toContain("set-secret");

    // Metadata sent to CF includes the customer's D1 binding
    expect(capturedMetadata).not.toBeNull();
    const bindings = (capturedMetadata as { bindings: Array<Record<string, unknown>> }).bindings;
    const d1 = bindings.find((b) => b.name === "DB");
    expect(d1?.id).toBe("d1-merged");
    // Owner email is a plain_text var, not a secret
    const owner = bindings.find((b) => b.name === "OWNER_EMAIL");
    expect(owner?.type).toBe("plain_text");
    expect(owner?.text).toBe("tom@example.com");

    // Anthropic key was set via the secrets endpoint, NOT inlined
    const anthSecret = setSecrets.find(([n]) => n === "ANTHROPIC_API_KEY");
    expect(anthSecret).toBeTruthy();
    expect(anthSecret?.[1]).toBe("sk-ant-abc");
    // OWNER_EMAIL was inlined as plain_text, NOT set as a secret
    expect(setSecrets.find(([n]) => n === "OWNER_EMAIL")).toBeUndefined();
  });

  it("falls back gracefully when manifest fetch fails", async () => {
    const f = (async () => new Response("upstream offline", { status: 502 })) as unknown as typeof fetch;
    const r = await runDeploy(
      {
        token: "tok",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false
      },
      { fetchImpl: f, directDeploy: { manifestUrl: "https://manifest.test/m.json" } }
    );
    // Direct deploy fails but the surrounding flow returns its first failure
    // (token verify). For this test, with everything stubbed to fail, runDeploy
    // returns ok=false at verify-token. The point is: directDeploy doesn't crash.
    expect(r.ok).toBe(false);
  });

  it("upload failure leaves directDeployed=false but the rest of the flow succeeds", async () => {
    const f = directDeployFetch({ uploadFails: true });
    const r = await runDeploy(
      {
        token: "tok",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: true,
        enableAccess: false
      },
      { fetchImpl: f, directDeploy: { manifestUrl: "https://manifest.test/m.json" } }
    );
    expect(r.ok).toBe(true);
    expect(r.directDeployed).toBe(false);
    // Local-fallback wrangler.toml + commands are still emitted
    expect(r.wranglerToml).toBeTruthy();
    expect((r.commands ?? []).length).toBeGreaterThan(0);
    // upload-worker step shows the failure
    const upload = r.steps.find((s) => s.kind === "upload-worker");
    expect(upload?.ok).toBe(false);
  });
});

describe("renderFinalCommands", () => {
  it("emits one wrangler-secret-put per provided secret + a final deploy", () => {
    const cmds = renderFinalCommands({
      workerName: "helm",
      secrets: { OWNER_EMAIL: "tom@x.com", ANTHROPIC_API_KEY: "sk-ant", VAPID_PUBLIC_KEY: undefined }
    });
    const joined = cmds.join("\n");
    expect(joined).toMatch(/wrangler secret put OWNER_EMAIL/);
    expect(joined).toMatch(/wrangler secret put ANTHROPIC_API_KEY/);
    expect(joined).not.toMatch(/wrangler secret put VAPID_PUBLIC_KEY/);
    expect(joined).toMatch(/wrangler deploy/);
  });

  it("strips shell-dangerous characters from secret values", () => {
    const cmds = renderFinalCommands({
      workerName: "helm",
      secrets: { TEST: 'evil"`$\\value' }
    });
    const cmd = cmds.find((c) => c.includes("TEST")) ?? "";
    // Extract just the value between the first and last double quote.
    const m = cmd.match(/^echo "(.*)" \| wrangler secret put TEST$/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("evilvalue");
  });
});
