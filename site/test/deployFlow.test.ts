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
import { composeWranglerToml, renderFinalCommands, resolveModelPreset, runDeploy, verifyAndListAccounts } from "../src/cloud/deployFlow";

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

  it("returns userEmail when /user is reachable (token has User Details:Read)", async () => {
    // The deploy form uses this email to pre-fill the Owner-Email input
    // so the user can hit Deploy without retyping what CF already knows.
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok-1", status: "active" }),
      [`${CF}/user`]: () => ok({ id: "u-1", email: "tom@example.com" }),
      [`${CF}/accounts`]: () => ok([{ id: "acc-1", name: "Tom" }])
    });
    const r = await verifyAndListAccounts("token", { fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.userEmail).toBe("tom@example.com");
  });

  it("succeeds without userEmail when /user is not reachable (token missing the scope)", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok-1", status: "active" }),
      [`${CF}/user`]: () => err(9109, "Insufficient permissions"),
      [`${CF}/accounts`]: () => ok([{ id: "acc-1", name: "Tom" }])
    });
    const r = await verifyAndListAccounts("token", { fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.userEmail).toBeUndefined();
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

  it("AI Gateway create fails (auth error) → warning step, deploy continues", async () => {
    // Token missing "AI Gateway:Edit" — the most common reason a freshly
    // created v0.12 token doesn't get a gateway. The deploy should keep
    // going (chat just won't work zero-key).
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/workers/subdomain`]: () => ok({ subdomain: "acct" }),
      [`${CF}/accounts/acc-1/ai-gateway/gateways`]: () => err(10000, "Authentication error")
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false,
        secrets: {}
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    const aiStep = r.steps.find((s) => s.kind === "create-ai-gateway");
    expect(aiStep?.ok).toBe(true);
    expect(aiStep?.warning).toBeTruthy();
    expect(aiStep?.summary).toMatch(/AI Gateway skipped/i);
    expect(aiStep?.warning).toMatch(/AI Gateway:Edit/);
  });

  it("AI Gateway create succeeds → step kind is create-ai-gateway with reused flag false on first run", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/workers/subdomain`]: () => ok({ subdomain: "acct" }),
      [`${CF}/accounts/acc-1/ai-gateway/gateways`]: () => ok({ id: "helm" })
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false,
        secrets: {}
      },
      { fetchImpl: f }
    );
    const aiStep = r.steps.find((s) => s.kind === "create-ai-gateway");
    expect(aiStep?.ok).toBe(true);
    expect(aiStep?.warning).toBeUndefined();
    expect(aiStep?.summary).toMatch(/AI Gateway: helm/);
    expect((aiStep?.data as { reused?: boolean })?.reused).toBe(false);
  });

  it("R2 bucket auto-provisions + lands as a [[r2_buckets]] WORKSPACE block in wrangler.toml", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/workers/subdomain`]: () => ok({ subdomain: "acct" }),
      [`${CF}/accounts/acc-1/r2/buckets`]: () => ok({ name: "helm-workspace" })
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false,
        secrets: {}
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    expect(r.wranglerToml).toMatch(/\[\[r2_buckets\]\]/);
    expect(r.wranglerToml).toMatch(/binding = "WORKSPACE"/);
    expect(r.wranglerToml).toMatch(/bucket_name = "helm-workspace"/);
  });

  it("R2 bucket auth error → warning step, deploy continues without WORKSPACE binding", async () => {
    const f = routedFetch({
      [`${CF}/user/tokens/verify`]: () => ok({ id: "tok", status: "active" }),
      [`${CF}/accounts/acc-1/workers/subdomain`]: () => ok({ subdomain: "acct" }),
      [`${CF}/accounts/acc-1/r2/buckets`]: () => err(10000, "Authentication error")
    });
    const r = await runDeploy(
      {
        token: "t",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false,
        secrets: {}
      },
      { fetchImpl: f }
    );
    expect(r.ok).toBe(true);
    // The warning lands as a set-secret-kind step (R2 doesn't have its
    // own kind yet — it shares the catch-all infra-provision channel).
    const r2Step = r.steps.find((s) => /R2 bucket skipped/i.test(s.summary));
    expect(r2Step?.ok).toBe(true);
    expect(r2Step?.warning).toMatch(/Workers R2 Storage:Edit/);
    // wrangler.toml does NOT include the WORKSPACE block when R2 was skipped.
    expect(r.wranglerToml).not.toMatch(/binding = "WORKSPACE"/);
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
    // Non-fatal: ok=true (deploy continues) but `warning` is set so the
    // UI renders ⚠ instead of ✗. Summary mentions "team name" so the
    // user sees what specifically is wrong; warning copy points them at
    // the dash → Zero Trust → Settings fix.
    expect(accessStep?.ok).toBe(true);
    expect(accessStep?.warning).toBeTruthy();
    expect(accessStep?.summary).toMatch(/team name|Access skipped/i);
    expect(accessStep?.warning).toMatch(/Zero Trust/);
    expect(r.wranglerToml).not.toMatch(/CF_ACCESS_TEAM_DOMAIN/);
  });
});

describe("resolveModelPreset", () => {
  it("kimi-k2.6 default → Workers AI gateway when no key + AI Gateway provisioned", () => {
    const r = resolveModelPreset({
      preset: "kimi-k2.6",
      hasOpenRouter: false,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(r.warning).toBeUndefined();
  });

  it("kimi-k2.6 with OpenRouter → routes through OR for lower latency", () => {
    const r = resolveModelPreset({
      preset: "kimi-k2.6",
      hasOpenRouter: true,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("moonshotai/kimi-k2.6");
  });

  it("gpt-5.5 with OpenRouter → openai/gpt-5.5", () => {
    const r = resolveModelPreset({
      preset: "gpt-5.5",
      hasOpenRouter: true,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("openai/gpt-5.5");
    expect(r.warning).toBeUndefined();
  });

  it("gpt-5.5 without OpenRouter → falls back to Kimi + warns", () => {
    const r = resolveModelPreset({
      preset: "gpt-5.5",
      hasOpenRouter: false,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(r.warning).toMatch(/GPT-5\.5 needs an OpenRouter API key/);
  });

  it("opus-4.7 with Anthropic key → direct (preferred over OR)", () => {
    const r = resolveModelPreset({
      preset: "opus-4.7",
      hasOpenRouter: true, // OR also pasted, but Anthropic wins
      hasAnthropic: true,
      hasAiGateway: false
    });
    expect(r.modelId).toBe("claude-opus-4-7");
  });

  it("opus-4.7 with only OpenRouter → routes through OR", () => {
    const r = resolveModelPreset({
      preset: "opus-4.7",
      hasOpenRouter: true,
      hasAnthropic: false,
      hasAiGateway: false
    });
    expect(r.modelId).toBe("anthropic/claude-opus-4-7");
  });

  it("opus-4.7 with neither key → falls back + warns", () => {
    const r = resolveModelPreset({
      preset: "opus-4.7",
      hasOpenRouter: false,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(r.warning).toMatch(/Anthropic or OpenRouter/);
  });

  it("sonnet-4.6 with Anthropic key → claude-sonnet-4-6", () => {
    const r = resolveModelPreset({
      preset: "sonnet-4.6",
      hasOpenRouter: false,
      hasAnthropic: true,
      hasAiGateway: false
    });
    expect(r.modelId).toBe("claude-sonnet-4-6");
  });

  it("custom preset uses customModelId verbatim", () => {
    const r = resolveModelPreset({
      preset: "custom",
      customModelId: "openrouter/x-ai/grok-4",
      hasOpenRouter: true,
      hasAnthropic: false,
      hasAiGateway: false
    });
    expect(r.modelId).toBe("openrouter/x-ai/grok-4");
  });

  it("custom preset without an id falls back + warns", () => {
    const r = resolveModelPreset({
      preset: "custom",
      hasOpenRouter: false,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(r.warning).toMatch(/no id provided/);
  });

  it("undefined preset honors legacy openRouterDefaultModel when an OR key is present", () => {
    const r = resolveModelPreset({
      legacyOpenRouterModel: "openrouter/anthropic/claude-haiku-4-5",
      hasOpenRouter: true,
      hasAnthropic: false,
      hasAiGateway: true
    });
    expect(r.modelId).toBe("openrouter/anthropic/claude-haiku-4-5");
  });

  it("no preset, no AI Gateway → bare workers-ai model id (last-resort)", () => {
    const r = resolveModelPreset({
      hasOpenRouter: false,
      hasAnthropic: false,
      hasAiGateway: false
    });
    expect(r.modelId).toBe("@cf/moonshotai/kimi-k2.6");
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
    // mcp-client to self-administer (run cf-* skills,
    // helm-setup-deploy, drift sync) right out of the gate.
    // (helm-artifacts is intentionally absent until the published
    // manifest bundle catches up to v0.11 — see the comment in
    // deployFlow.ts ENABLED_PLUGINS for context.)
    expect(t).toMatch(/ENABLED_PLUGINS = ".*cloudflare-admin/);
    expect(t).toMatch(/ENABLED_PLUGINS = ".*helm-setup/);
    expect(t).toMatch(/ENABLED_PLUGINS = ".*mcp-client/);
    // ALLOWED_HOSTS must be non-empty or the runtime errors
    // E_INTERNAL "ALLOWED_HOSTS must include at least one host"
    // on every request.
    expect(t).toMatch(/ALLOWED_HOSTS = "api\.cloudflare\.com,/);
    // Default chat model: Kimi K2.6 via Workers AI (zero-key); when an
    // OpenRouter key is present, runDeploy upgrades this to the OR
    // routing path before calling composeWranglerToml.
    expect(t).toMatch(/MODEL_DEFAULT = "@cf\/moonshotai\/kimi-k2\.6"/);
  });

  it("emits the Sandbox DO binding + [[containers]] block + v4 migration", () => {
    // Customers running `wrangler deploy` from this snippet need the
    // Sandbox DO + container image registered for /shell/ws and helm-exec
    // to work. The v4 migration is what registers the Sandbox + CliAuthDO
    // sqlite classes; without it CF rejects the deploy.
    const t = composeWranglerToml({
      workerName: "helm",
      accountId: "acc-1",
      d1: null,
      access: null
    });
    // Sandbox DO binding
    expect(t).toMatch(/\[\[durable_objects\.bindings\]\][\s\S]*?name = "Sandbox"[\s\S]*?class_name = "Sandbox"/);
    // CliAuthDO binding
    expect(t).toMatch(/name = "CLI_AUTH"[\s\S]*?class_name = "CliAuthDO"/);
    // Container image — public CF-hosted base
    expect(t).toMatch(/\[\[containers\]\]/);
    expect(t).toMatch(/image = "docker\.io\/cloudflare\/sandbox:0\.10\.0"/);
    expect(t).toMatch(/class_name = "Sandbox"/);
    // Migration ladder ends at v4 with the sqlite classes
    expect(t).toMatch(/tag = "v4"[\s\S]*?new_sqlite_classes = \["Sandbox", "CliAuthDO"\]/);
  });

  it("honors openRouterDefaultModel override (e.g. pinning kimi)", () => {
    const t = composeWranglerToml({
      workerName: "helm",
      accountId: "acc-1",
      d1: null,
      access: null,
      openRouterDefaultModel: "openrouter/moonshotai/kimi-k2.6"
    });
    expect(t).toMatch(/MODEL_DEFAULT = "openrouter\/moonshotai\/kimi-k2\.6"/);
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

  it("auto-generates HELM_INTERNAL_TOKEN + sets shell env vars (HELM_WORKER_HOST, R2_BUCKET) on direct-deploy", async () => {
    const seenSecrets: Record<string, string> = {};
    let capturedMetadata: Record<string, unknown> | null = null;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === "https://manifest.test/m.json") return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      if (url === "https://manifest.test/helm.mjs") return new Response(SAMPLE_BUNDLE_BYTES, { status: 200 });
      if (url.endsWith("/user/tokens/verify")) return ok({ id: "tok", status: "active" });
      if (/\/workers\/subdomain$/.test(url)) return ok({ subdomain: "acct" });
      if (/\/r2\/buckets$/.test(url) && init?.method === "POST") return ok({ name: "helm-workspace" });
      if (/\/ai-gateway\/gateways$/.test(url) && init?.method === "POST") return ok({ id: "helm" });
      const scriptMatch = url.match(/\/workers\/scripts\/([^/]+)$/);
      if (scriptMatch && init?.method === "PUT") {
        const form = init.body as FormData;
        const meta = form?.get?.("metadata") as Blob | null;
        if (meta) capturedMetadata = JSON.parse(await meta.text());
        return ok({ id: scriptMatch[1] });
      }
      if (url.endsWith("/secrets") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { name: string; text: string };
        seenSecrets[body.name] = body.text;
        return ok({ name: body.name, type: "secret_text" });
      }
      return new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: "no route" }] }), { status: 404 });
    }) as unknown as typeof fetch;

    const r = await runDeploy(
      {
        token: "tok",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false,
        secrets: {}
      },
      { fetchImpl: f, directDeploy: { manifestUrl: "https://manifest.test/m.json" } }
    );
    expect(r.ok).toBe(true);
    expect(r.directDeployed).toBe(true);
    // HELM_INTERNAL_TOKEN was generated + set as a secret (32-byte hex = 64 chars).
    expect(seenSecrets.HELM_INTERNAL_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    // Shell-related plain_text vars landed in the upload's bindings.
    expect(capturedMetadata).not.toBeNull();
    const bindings = (capturedMetadata as { bindings: Array<{ name: string; type: string; text?: string }> }).bindings;
    const host = bindings.find((b) => b.name === "HELM_WORKER_HOST");
    expect(host?.type).toBe("plain_text");
    expect(host?.text).toBe("helm.acct.workers.dev");
    const bucket = bindings.find((b) => b.name === "R2_BUCKET");
    expect(bucket?.text).toBe("helm-workspace");
    const accountIdVar = bindings.find((b) => b.name === "CLOUDFLARE_ACCOUNT_ID" && b.type === "plain_text");
    expect(accountIdVar?.text).toBe("acc-1");
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

  it("migration tag precondition → retries with old_tag dropped/set, deploy succeeds", async () => {
    // Real-world scenario: re-deploying an existing Worker that's
    // already at migration tag v1. CF rejects the first PUT with
    // "Actor migration tag precondition failed, got tag '' when
    // expected tag is 'v1'" because our metadata sends new_tag without
    // old_tag. The retry path parses the expected tag and drops the
    // migrations field (since current === new_tag → no diff).
    let putCount = 0;
    const seenMetadata: Array<Record<string, unknown>> = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === "https://manifest.test/m.json") return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
      if (url === "https://manifest.test/helm.mjs") return new Response(SAMPLE_BUNDLE_BYTES, { status: 200 });
      if (url.endsWith("/user/tokens/verify")) return ok({ id: "tok", status: "active" });
      if (/\/workers\/subdomain$/.test(url)) return ok({ subdomain: "acct" });
      const scriptMatch = url.match(/\/workers\/scripts\/([^/]+)$/);
      if (scriptMatch && init?.method === "PUT") {
        putCount += 1;
        const form = init.body as FormData;
        const meta = form?.get?.("metadata") as Blob | null;
        if (meta) seenMetadata.push(JSON.parse(await meta.text()));
        if (putCount === 1) {
          return new Response(
            JSON.stringify({
              success: false,
              errors: [{ code: 10079, message: "Actor migration tag precondition failed, got tag '' when expected tag is 'v1'." }]
            }),
            { status: 400 }
          );
        }
        return ok({ id: scriptMatch[1] });
      }
      if (url.endsWith("/secrets") && init?.method === "PUT") return ok({ name: "x", type: "secret_text" });
      return new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: "no route" }] }), { status: 404 });
    }) as unknown as typeof fetch;

    const r = await runDeploy(
      {
        token: "tok",
        accountId: "acc-1",
        workerName: "helm",
        enableD1: false,
        enableAccess: false,
        secrets: {}
      },
      { fetchImpl: f, directDeploy: { manifestUrl: "https://manifest.test/m.json" } }
    );
    expect(r.ok).toBe(true);
    expect(r.directDeployed).toBe(true);
    expect(putCount).toBe(2); // first failed, second succeeded
    // First request had migrations.new_tag = v1 (no old_tag)
    expect((seenMetadata[0].migrations as { new_tag?: string }).new_tag).toBe("v1");
    // Retry dropped migrations entirely (current tag === new_tag)
    expect(seenMetadata[1].migrations).toBeUndefined();
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
