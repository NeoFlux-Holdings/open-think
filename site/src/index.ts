import { renderLanding } from "./pages/landing";
import { renderPricing } from "./pages/pricing";
import { renderConcierge } from "./pages/concierge";
import { renderChangelog } from "./pages/changelog";
import { renderDocs } from "./pages/docs";
import { renderDocPage } from "./pages/doc";
import { renderDemo } from "./pages/demo";
import { renderMarketplace } from "./pages/marketplace";
import { renderMarketplaceItem } from "./pages/marketplace-item";
import type { EntryType } from "./marketplace/types";
import { renderSuccess } from "./pages/success";
import { renderCloudAgent } from "./pages/cloudAgent";
import { renderCloudDeploy } from "./pages/cloudDeploy";
import { renderCloudGuided } from "./pages/cloudGuided";
import { renderCloudManage, renderManageNotFound } from "./pages/cloudManage";
import { renderCloudRecover } from "./pages/cloudRecover";
import { runDeploy, verifyAndListAccounts, type SubscriptionPersistInput } from "./cloud/deployFlow";
import type { DeployRequest } from "./cloud/types";
import {
  encryptCfToken
} from "./cloud/crypto";
import {
  getDeployment,
  listPushLog,
  resolveManageToken,
  rotateToken,
  setPaused
} from "./cloud/deployments";
import { isDeploymentSelfManaged, listStuckDeployments, runUpdatePush } from "./cloud/pushUpdates";
import {
  bindClaimToDeployment,
  claimSession,
  clearIntentCookieHeader,
  issueIntentCookie,
  readVerifiedIntent
} from "./cloud/sessions";
import { html, json, setAnalyticsToken } from "./layout";
import {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  lookupCheckoutSession,
  lookupCustomerSubscription,
  type StripeEnv
} from "./payments/stripe";

export interface Env extends StripeEnv {
  SITE_URL?: string;
  SUPPORT_EMAIL?: string;
  CF_ANALYTICS_TOKEN?: string;
  /** Master AES key for encrypting CF API tokens at rest. Required for Helm Cloud. */
  CLOUD_MASTER_KEY?: string;
  /** URL serving the Helm bundle manifest JSON. The cron pushes whatever it points at. */
  HELM_BUNDLE_MANIFEST_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    setAnalyticsToken(env.CF_ANALYTICS_TOKEN);

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // --- Pages ---
    if (method === "GET" && (path === "/" || path === "")) {
      return html(renderLanding());
    }
    if (method === "GET" && path === "/pricing") {
      return html(
        renderPricing({
          cancelled: url.searchParams.get("status") === "cancelled",
          config: {
            hasPro: Boolean(env.STRIPE_PRICE_PRO_MONTHLY),
            hasConcierge: Boolean(env.STRIPE_PRICE_CONCIERGE_ONESHOT),
            hasHelmCloud: Boolean(env.STRIPE_PRICE_HELM_CLOUD)
          }
        })
      );
    }
    if (method === "GET" && path === "/concierge") {
      return html(renderConcierge());
    }
    if (method === "GET" && path === "/changelog") {
      return html(renderChangelog());
    }
    if (method === "GET" && path === "/demo") {
      return html(renderDemo());
    }
    if (method === "GET" && (path === "/marketplace" || path === "/marketplace/")) {
      const rawType = url.searchParams.get("type");
      const allowed: EntryType[] = [
        "plugin",
        "mcp-server",
        "skill-pack",
        "agent-template",
        "companion"
      ];
      const filter = allowed.find((t) => t === rawType);
      return html(renderMarketplace(filter));
    }
    if (method === "GET" && path.startsWith("/marketplace/")) {
      const slug = decodeURIComponent(path.slice("/marketplace/".length).replace(/\/$/, ""));
      if (!slug) return html(renderMarketplace());
      const { body, status } = renderMarketplaceItem(slug);
      return html(body, status);
    }
    if (method === "GET" && (path === "/docs" || path === "/docs/")) {
      return html(renderDocs());
    }
    if (method === "GET" && path === "/docs/conductor") {
      // Legacy slug redirect (doc renamed Conductor → Helm in 2026-04).
      return Response.redirect(new URL("/docs/helm", url.origin).toString(), 301);
    }
    if (method === "GET" && path.startsWith("/docs/")) {
      const slug = decodeURIComponent(path.slice("/docs/".length).replace(/\/$/, ""));
      if (!slug) return html(renderDocs());
      const { body, status } = renderDocPage(slug);
      return html(body, status);
    }
    if (method === "GET" && path === "/success") {
      return html(renderSuccess(url.searchParams.get("session_id") ?? undefined));
    }
    if (method === "GET" && path === "/deploy/cloud") {
      return html(renderCloudDeploy());
    }
    if (method === "GET" && path === "/deploy/guided") {
      return html(renderCloudGuided());
    }
    if (method === "GET" && path === "/deploy/agent") {
      return html(renderCloudAgent());
    }
    if (method === "GET" && path === "/cloud/manage") {
      return await handleManagePage(env, url);
    }
    if (method === "GET" && path === "/cloud/recover") {
      return html(
        renderCloudRecover({
          submitted: url.searchParams.get("submitted") === "1",
          supportEmail: env.SUPPORT_EMAIL
        })
      );
    }
    if (method === "POST" && path === "/api/cloud/recover") {
      return await handleRecoverRequest(request, env, url);
    }

    // --- Cloud deploy API ---
    // The user's CF token rides only this request and never lives at rest.
    // We don't log it; we don't proxy it to anywhere except api.cloudflare.com.
    if (method === "POST" && path === "/api/cloud/verify-token") {
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      if (typeof body.token !== "string" || body.token.length === 0) {
        return json({ ok: false, error: "token required" }, 400);
      }
      const r = await verifyAndListAccounts(body.token);
      return json(r, r.ok ? 200 : 400);
    }
    if (method === "POST" && path === "/api/cloud/exchange-session") {
      return await handleExchangeSession(request, env);
    }
    if (method === "GET" && path === "/api/cloud/current-intent") {
      return await handleCurrentIntent(request, env);
    }
    if (method === "POST" && path === "/api/cloud/forget-intent") {
      // One-shot logout — clears the intent cookie. Idempotent, no side
      // effects on the claim ledger (the session_id stays claimed; you
      // can't un-mark a Stripe session).
      const isHttps = url.protocol === "https:";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": clearIntentCookieHeader(isHttps)
        }
      });
    }
    if (method === "POST" && path === "/api/cloud/deploy") {
      return await handleCloudDeploy(request, env, url);
    }
    if (method === "POST" && path.startsWith("/api/cloud/manage/")) {
      const action = path.slice("/api/cloud/manage/".length);
      return await handleManageAction(env, url, action, request);
    }

    // --- Payments ---
    if (method === "POST" && path === "/api/stripe/checkout") {
      return await handleCheckout(request, env);
    }
    if (method === "POST" && path === "/api/stripe/webhook") {
      return await handleWebhook(env, request);
    }
    if (method === "POST" && path === "/api/stripe/portal") {
      return await handlePortal(request, env);
    }

    // --- Utility ---
    if (method === "GET" && path === "/health") {
      return json({
        ok: true,
        service: "open-think-site",
        hasStripe: Boolean(env.STRIPE_SECRET_KEY),
        hasDb: Boolean(env.DB),
        hasCloudMasterKey: Boolean(env.CLOUD_MASTER_KEY),
        hasManifestUrl: Boolean(env.HELM_BUNDLE_MANIFEST_URL),
        now: new Date().toISOString()
      });
    }
    if (method === "GET" && path === "/api/cloud/health") {
      return await handleCloudHealth(env);
    }
    if (method === "GET" && path === "/robots.txt") {
      return new Response(
        `User-agent: *\nAllow: /\nSitemap: ${env.SITE_URL ?? "https://open-think.app"}/sitemap.xml\n`,
        { headers: { "content-type": "text/plain" } }
      );
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },

  /**
   * Cron entrypoint — runs the Helm Cloud update push for every active
   * deployment whose `build_sha` is older than the manifest's. Configured
   * via [triggers] crons in wrangler.toml; unbound deployments (no
   * CLOUD_MASTER_KEY) skip cleanly.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runUpdatePush(env)
        .then((summary) => {
          console.log("[cloud-cron]", JSON.stringify(summary));
        })
        .catch((err) => {
          console.error("[cloud-cron] runUpdatePush failed:", (err as Error).message);
        })
    );
  }
};

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  let body: { plan?: string; email?: string };
  if (contentType.includes("application/json")) {
    body = (await request.json()) as { plan?: string; email?: string };
  } else {
    const form = await request.formData();
    body = {
      plan: String(form.get("plan") ?? ""),
      email: String(form.get("email") ?? "")
    };
  }
  const plan = body.plan as
    | "pro-monthly"
    | "pro-annual"
    | "concierge"
    | "helm-cloud"
    | undefined;
  if (
    plan !== "pro-monthly" &&
    plan !== "pro-annual" &&
    plan !== "concierge" &&
    plan !== "helm-cloud"
  ) {
    return json({ ok: false, error: "invalid plan" }, 400);
  }
  const result = await createCheckoutSession(env, {
    plan,
    email: body.email && body.email.length > 0 ? body.email : undefined
  });
  if (!result.ok) {
    return json({ ok: false, error: result.error }, 400);
  }
  const redirectUrl = result.session?.url;
  if (!redirectUrl) {
    return json({ ok: false, error: "Stripe did not return a URL" }, 500);
  }
  if (contentType.includes("application/json")) {
    return json({ ok: true, url: redirectUrl });
  }
  return Response.redirect(redirectUrl, 303);
}

async function handlePortal(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { customerId?: string };
  if (!body.customerId) return json({ ok: false, error: "customerId required" }, 400);
  const result = await createPortalSession(env, body.customerId);
  if (!result.ok || !result.portal?.url) {
    return json({ ok: false, error: "portal failed" }, 500);
  }
  const sub = await lookupCustomerSubscription(env, body.customerId);
  return json({ ok: true, url: result.portal.url, subscription: sub });
}

/* ---------------- Helm Cloud recovery ---------------- */

/**
 * POST /api/cloud/recover — record a manage-link recovery request from a
 * subscriber who lost their manage URL. We don't trust the email match to
 * leak data; we just log a structured WARN line for support to action via
 * Workers Tail / Logpush.
 *
 * Behaves the same whether or not the email belongs to a real customer —
 * avoids a customer-enumeration oracle.
 */
async function handleRecoverRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  let email = "";
  let note = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { email?: string; note?: string };
    email = String(body.email ?? "").trim();
    note = String(body.note ?? "").trim();
  } else {
    const form = await request.formData();
    email = String(form.get("email") ?? "").trim();
    note = String(form.get("note") ?? "").trim();
  }
  if (!email || !email.includes("@") || email.length > 200) {
    return json({ ok: false, error: "valid email required" }, 400);
  }
  // Basic note sanitization — avoid letting a 5MB string into our logs.
  if (note.length > 500) note = note.slice(0, 500);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
  console.warn(
    `[cloud-recovery] email=${JSON.stringify(email)} ip=${ip} note=${JSON.stringify(note)}`
  );
  // Always redirect to the same page with ?submitted=1, regardless of
  // whether the email matched a customer.
  return Response.redirect(new URL("/cloud/recover?submitted=1", url.origin).toString(), 303);
}

/* ---------------- Helm Cloud health endpoint ---------------- */

/**
 * GET /api/cloud/health — operational view of Helm Cloud.
 *
 * Returns a snapshot of:
 *   - Configuration presence (DB, master key, manifest URL, Stripe price)
 *   - Deployment counts (active, paused, errored)
 *   - Last cron push run (timestamp, count pushed/skipped/failed)
 *   - Last 5 push events across all deployments (kind + sha + ts only)
 *
 * NEVER returns customer-identifying fields, encrypted tokens, or push
 * detail — this is safe to leave open. Useful for status pages and ops
 * dashboards without paging anyone.
 */
async function handleCloudHealth(env: Env): Promise<Response> {
  const config = {
    hasDb: Boolean(env.DB),
    hasCloudMasterKey: Boolean(env.CLOUD_MASTER_KEY),
    hasManifestUrl: Boolean(env.HELM_BUNDLE_MANIFEST_URL),
    hasStripePrice: Boolean(env.STRIPE_PRICE_HELM_CLOUD)
  };
  const ready = config.hasDb && config.hasCloudMasterKey && config.hasManifestUrl && config.hasStripePrice;

  if (!env.DB) {
    return json({
      ok: false,
      ready: false,
      config,
      error: "DB binding required for cloud health"
    });
  }

  // Counts. We tolerate missing tables (table doesn't exist on old envs).
  let active = 0;
  let paused = 0;
  let errored = 0;
  let total = 0;
  try {
    const r = await env.DB
      .prepare(
        `SELECT
           SUM(CASE WHEN paused = 0 THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN paused = 1 THEN 1 ELSE 0 END) AS paused,
           SUM(CASE WHEN last_push_error IS NOT NULL THEN 1 ELSE 0 END) AS errored,
           COUNT(*) AS total
         FROM cloud_deployments`
      )
      .first<{ active: number; paused: number; errored: number; total: number }>();
    if (r) {
      active = Number(r.active ?? 0);
      paused = Number(r.paused ?? 0);
      errored = Number(r.errored ?? 0);
      total = Number(r.total ?? 0);
    }
  } catch {
    /* migration 0002 hasn't run; treat as zero deployments */
  }

  // Most recent push events (across all deployments).
  let recent: Array<{ ts: string; kind: string; sha: string | null }> = [];
  try {
    const r = await env.DB
      .prepare(
        `SELECT ts, kind, build_sha as sha
           FROM cloud_push_log
          ORDER BY ts DESC LIMIT 5`
      )
      .all<{ ts: string; kind: string; sha: string | null }>();
    recent = r.results ?? [];
  } catch {
    /* same — fine */
  }

  // Last cron run summary, derived from the most recent push-success/failure.
  let lastCronAt: string | null = null;
  let lastCronStatus: "ok" | "errors" | "idle" = "idle";
  try {
    const r = await env.DB
      .prepare(
        `SELECT ts, kind FROM cloud_push_log
          WHERE kind IN ('push-success','push-failure')
          ORDER BY ts DESC LIMIT 1`
      )
      .first<{ ts: string; kind: string }>();
    if (r) {
      lastCronAt = r.ts;
      lastCronStatus = r.kind === "push-success" ? "ok" : "errors";
    }
  } catch {
    /* fine */
  }

  // Stuck deployments — failing 3+ in a row, the ones an operator should look at.
  const stuck = await listStuckDeployments(env.DB).catch(() => []);

  return json({
    ok: true,
    ready,
    config,
    deployments: { total, active, paused, errored, stuck: stuck.length },
    cron: { lastRunAt: lastCronAt, lastRunStatus: lastCronStatus, recent },
    alerts: stuck.length > 0
      ? stuck.map((s) => ({
          deploymentId: s.deploymentId,
          consecutiveFailures: s.consecutiveFailures
        }))
      : []
  });
}

/* ---------------- Helm Cloud session exchange + deploy ---------------- */

/**
 * POST /api/cloud/exchange-session — converts a Stripe Checkout session_id
 * (from the redirect URL after pay) into a server-issued signed cookie that
 * the deploy endpoint trusts. Replays are rejected via the cloud_session_claims
 * D1 ledger; the cookie itself binds the deploy to this exact browser.
 *
 * Body: `{ "sessionId": "cs_..." }`
 *
 * On success: sets `oth_cloud_intent` cookie, returns `{ok, customerId, email}`
 * for the UI banner. The customerId in the response body is informational —
 * the deploy endpoint reads the cookie, not the body.
 */
async function handleExchangeSession(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return json({ ok: false, error: "sessionId required" }, 400);
  }
  if (!env.DB) {
    return json({ ok: false, error: "DB binding required for replay-safe exchange" }, 503);
  }
  if (!env.CLOUD_MASTER_KEY) {
    return json({ ok: false, error: "CLOUD_MASTER_KEY required for cookie signing" }, 503);
  }

  // Step 1 — verify with Stripe that the session is real, complete, and paid.
  const stripeLookup = await lookupCheckoutSession(env, body.sessionId);
  if (!stripeLookup.ok) {
    return json({ ok: false, error: stripeLookup.error }, 400);
  }

  // Step 2 — issue the cookie (we need its expiry for the claim row).
  const isHttps = new URL(request.url).protocol === "https:";
  const cookie = await issueIntentCookie(
    stripeLookup.customerId,
    body.sessionId,
    env.CLOUD_MASTER_KEY,
    {
      email: stripeLookup.email,
      secure: isHttps
    }
  );

  // Step 3 — claim the session in D1. If a different browser already
  // claimed it, refuse and don't ship a new cookie.
  const claim = await claimSession(env.DB, {
    sessionId: body.sessionId,
    customerId: stripeLookup.customerId,
    email: stripeLookup.email,
    cookieExpiresAt: cookie.expiresAtIso
  });
  if (!claim.ok) {
    if (claim.reason === "already-claimed") {
      return json(
        {
          ok: false,
          error:
            "This checkout session was already claimed by another browser. " +
            "If this is unexpected, contact support — we'll reissue a manage link."
        },
        409
      );
    }
    return json({ ok: false, error: `claim failed: ${claim.error}` }, 500);
  }

  // Step 4 — return + set cookie.
  return new Response(
    JSON.stringify({
      ok: true,
      customerId: stripeLookup.customerId,
      email: stripeLookup.email
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": cookie.setCookieHeader
      }
    }
  );
}

/**
 * GET /api/cloud/current-intent — lets the deploy page reconstruct the
 * "you're subscribed" banner after a refresh that strips the session_id
 * from the URL. Returns whatever the verified cookie carries; doesn't
 * mutate state.
 */
async function handleCurrentIntent(request: Request, env: Env): Promise<Response> {
  if (!env.CLOUD_MASTER_KEY) return json({ ok: false }, 200);
  const intent = await readVerifiedIntent(request, env.CLOUD_MASTER_KEY);
  if (!intent) return json({ ok: false }, 200);
  return json({
    ok: true,
    customerId: intent.sub,
    email: intent.email ?? null,
    sessionId: intent.sid
  });
}

/**
 * POST /api/cloud/deploy — runs the deploy orchestrator. The persist path
 * (Helm Cloud subscriber) requires a valid intent cookie; we read customerId
 * from the cookie, NOT from the request body. A request that asks to persist
 * but has no valid cookie falls through to a free-tier deploy with a clear
 * "subscription persistence skipped" step.
 */
async function handleCloudDeploy(request: Request, env: Env, url: URL): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | (DeployRequest & { persist?: boolean | { customerId?: string; customerEmail?: string } })
    | null;
  if (!body || typeof body.token !== "string" || !body.accountId || !body.workerName) {
    return json({ ok: false, error: "token, accountId, workerName required" }, 400);
  }

  // Decide whether to persist. We persist iff:
  //   1. The client explicitly opted in via `persist: true` (or the legacy object form)
  //   2. We have DB + CLOUD_MASTER_KEY in env
  //   3. The intent cookie is present and verified
  const wantsPersist = Boolean(body.persist);
  let persistInput: SubscriptionPersistInput | undefined;
  let persistSkipReason: string | undefined;

  if (wantsPersist && env.DB && env.CLOUD_MASTER_KEY) {
    const intent = await readVerifiedIntent(request, env.CLOUD_MASTER_KEY);
    if (intent) {
      persistInput = {
        db: env.DB,
        masterKey: env.CLOUD_MASTER_KEY,
        customerId: intent.sub,
        customerEmail: intent.email
      };
    } else {
      persistSkipReason = "intent cookie missing or expired — refresh /deploy/cloud and retry within 30 minutes of paying";
    }
  } else if (wantsPersist) {
    persistSkipReason = "Helm Cloud server-side requirements not met (DB / CLOUD_MASTER_KEY)";
  }

  // Direct-deploy: when HELM_BUNDLE_MANIFEST_URL is set, the deploy flow
  // pulls the bundle and uploads it via the CF API right here — no
  // `wrangler deploy` step required from the user. If unset, the deploy
  // still produces wrangler.toml + commands as a fallback.
  const directDeploy = env.HELM_BUNDLE_MANIFEST_URL
    ? { manifestUrl: env.HELM_BUNDLE_MANIFEST_URL }
    : undefined;

  // Streaming path: when the client sets `Accept: application/x-ndjson`,
  // we flush each step + every "running…" hint as it lands instead of
  // holding the whole result for 60-120s. The client renders these as
  // they arrive so the user sees real progress instead of a frozen UI.
  const wantsStream = (request.headers.get("accept") ?? "").includes("application/x-ndjson");
  if (wantsStream) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const writeLine = async (obj: unknown): Promise<void> => {
      try {
        await writer.write(encoder.encode(JSON.stringify(obj) + "\n"));
      } catch {
        /* writer closed (client navigated away) — let runDeploy finish anyway */
      }
    };
    // Run deploy in the background; flush events as they arrive. We
    // can't `ctx.waitUntil` here without the route having access to
    // ExecutionContext, so we use Promise chaining and rely on the
    // Workers runtime keeping the request alive while the stream is open.
    (async () => {
      try {
        const result = await runDeploy(body, {
          persist: persistInput,
          directDeploy,
          onProgress: writeLine
        });
        if (result.ok && result.deploymentId && env.DB && env.CLOUD_MASTER_KEY) {
          const intent = await readVerifiedIntent(request, env.CLOUD_MASTER_KEY);
          if (intent) {
            try {
              await bindClaimToDeployment(env.DB, intent.sid, result.deploymentId);
            } catch {
              /* non-fatal */
            }
          }
        }
        if (persistSkipReason) {
          result.steps = [
            ...result.steps,
            {
              kind: "render-cli-commands",
              ok: false,
              summary: "subscription persistence skipped",
              error: persistSkipReason
            }
          ];
        }
        await writeLine({ phase: "final", result });
      } catch (err) {
        await writeLine({
          phase: "final",
          result: {
            ok: false,
            workerName: body.workerName,
            accountId: body.accountId,
            steps: [],
            error: (err as Error).message ?? "deploy threw"
          }
        });
      } finally {
        try {
          await writer.close();
        } catch {
          /* already closed */
        }
      }
    })();
    const headers: Record<string, string> = {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache, no-transform",
      // CF buffering hint: streams to the client as bytes arrive instead
      // of coalescing them.
      "x-accel-buffering": "no"
    };
    return new Response(readable, { status: 200, headers });
  }

  // Legacy non-streaming path — single JSON response after the entire
  // deploy completes. Kept for backwards compat with any clients that
  // don't send Accept: application/x-ndjson.
  const result = await runDeploy(body, { persist: persistInput, directDeploy });

  // Bind the claim row to the deployment so re-exchange of the same
  // session_id can never produce a second deployment.
  if (result.ok && result.deploymentId && env.DB && env.CLOUD_MASTER_KEY) {
    const intent = await readVerifiedIntent(request, env.CLOUD_MASTER_KEY);
    if (intent) {
      try {
        await bindClaimToDeployment(env.DB, intent.sid, result.deploymentId);
      } catch {
        // Non-fatal — claim row still exists, just unlinked.
      }
    }
  }

  // If the user wanted persist and we skipped, surface the reason as an
  // extra step so the UI can show it.
  if (persistSkipReason) {
    result.steps = [
      ...result.steps,
      {
        kind: "render-cli-commands",
        ok: false,
        summary: "subscription persistence skipped",
        error: persistSkipReason
      }
    ];
  }

  // Clear the intent cookie after a successful persisted deploy — its job
  // is done and reusing it would be a footgun.
  const responseInit: ResponseInit = {
    status: result.ok ? 200 : 400,
    headers: { "content-type": "application/json; charset=utf-8" }
  };
  if (result.ok && result.deploymentId) {
    const isHttps = url.protocol === "https:";
    (responseInit.headers as Record<string, string>)["set-cookie"] =
      clearIntentCookieHeader(isHttps);
  }
  return new Response(JSON.stringify(result), responseInit);
}

/* ---------------- Helm Cloud manage page + actions ---------------- */

async function handleManagePage(env: Env, url: URL): Promise<Response> {
  if (!env.DB) {
    return manageHtml(renderManageNotFound("Manage is unavailable: Helm Cloud not configured."), 503);
  }
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return manageHtml(renderManageNotFound("Missing ?token= in the URL. Use the link we showed you after deploy."), 400);
  }
  const tokenRow = await resolveManageToken(env.DB, token);
  if (!tokenRow) {
    return manageHtml(renderManageNotFound("This manage link is invalid, expired, or revoked."), 404);
  }
  const deployment = await getDeployment(env.DB, tokenRow.deploymentId);
  if (!deployment) {
    return manageHtml(renderManageNotFound("The underlying deployment record is gone."), 404);
  }
  const log = await listPushLog(env.DB, deployment.id, 20);

  // Fetch the customer's email for display (best-effort).
  let email: string | undefined;
  try {
    const row = await env.DB
      .prepare("SELECT email FROM customers WHERE id = ?")
      .bind(deployment.customerId)
      .first<{ email: string }>();
    email = row?.email;
  } catch {
    /* customers table may not exist in dev */
  }
  return manageHtml(renderCloudManage({ deployment, manageToken: token, log, email }));
}

/**
 * Manage-page response wrapper — like html() but with a tight Referrer
 * Policy + Cache-Control: no-store. The page URL contains the manage
 * token, so:
 *   - `Referrer-Policy: no-referrer` keeps it out of every outbound
 *     request the user triggers from this page (links to Stripe portal,
 *     external help docs, etc.). Without this, anyone the user clicks
 *     through to sees the full URL in the Referer header.
 *   - `Cache-Control: no-store` keeps it out of CDN + browser caches
 *     (a valid manage token sitting in a CDN node would be a footgun).
 */
function manageHtml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

async function handleManageAction(
  env: Env,
  url: URL,
  action: string,
  request: Request
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "DB binding required" }, 503);

  // Read the manage token from the POST body (preferred), with a fallback
  // to the URL ?token= for back-compat. New clients should always use the
  // body — URL placement leaks via Referer headers despite the page-level
  // referrer policy (e.g. if a CDN logs the URL in access logs).
  const rawBody = await request.text();
  let parsedBody: { manageToken?: string; cfToken?: string } = {};
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody) as typeof parsedBody;
    } catch {
      /* fall through — body wasn't JSON */
    }
  }
  const manageToken = parsedBody.manageToken ?? url.searchParams.get("token") ?? "";
  const tokenRow = await resolveManageToken(env.DB, manageToken);
  if (!tokenRow) return json({ ok: false, error: "invalid or expired token" }, 401);
  const deployment = await getDeployment(env.DB, tokenRow.deploymentId);
  if (!deployment) return json({ ok: false, error: "deployment not found" }, 404);

  switch (action) {
    case "pause":
      await setPaused(env.DB, deployment.id, true);
      return json({ ok: true, paused: true });
    case "resume":
      await setPaused(env.DB, deployment.id, false);
      return json({ ok: true, paused: false });
    case "rotate-token": {
      if (!env.CLOUD_MASTER_KEY) {
        return json({ ok: false, error: "CLOUD_MASTER_KEY not configured" }, 500);
      }
      const fresh = parsedBody.cfToken?.trim() ?? "";
      if (!fresh) return json({ ok: false, error: "cfToken required" }, 400);
      try {
        const enc = await encryptCfToken(fresh, env.CLOUD_MASTER_KEY);
        await rotateToken(env.DB, deployment.id, enc.ciphertextB64, enc.ivB64);
        return json({ ok: true });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 500);
      }
    }
    case "billing-portal": {
      const portal = await createPortalSession(env, deployment.customerId);
      if (!portal.ok || !portal.portal?.url) {
        return json({ ok: false, error: "Stripe portal unavailable" }, 502);
      }
      return json({ ok: true, url: portal.portal.url });
    }
    case "push-now": {
      // Customer-initiated "push the latest bundle to my Worker now" —
      // closes the gap between "we shipped a bug fix" and "your hourly
      // cron picks it up". Runs the same code path as the cron, just
      // filtered to this one deployment (so a paused deployment is also
      // pushable on demand — pause is for stopping the cron, not for
      // gating manual pushes).
      //
      // Self-managed gate: when the live Worker has HELM_CUSTOM_DEPLOY,
      // pushing upstream would clobber the customer's custom code. We
      // refuse with 409 + selfManaged:true unless the request body has
      // confirm:true, so the client can show "are you sure?" before
      // calling again with the override.
      try {
        const force = parsedBody && (parsedBody as { confirm?: boolean }).confirm === true;
        if (!force) {
          const flagged = await isDeploymentSelfManaged(env, deployment);
          if (flagged.ok && flagged.selfManaged) {
            return json(
              {
                ok: false,
                selfManaged: true,
                error:
                  "This deployment is self-managed (HELM_CUSTOM_DEPLOY=1). Pushing upstream will overwrite your custom code. Re-call with { confirm: true } to proceed."
              },
              409
            );
          }
        }
        const summary = await runUpdatePush(env, { deploymentId: deployment.id });
        if (summary.skippedUpToDate === 1 && summary.pushed === 0) {
          return json({
            ok: true,
            alreadyUpToDate: true,
            manifestSha: summary.manifestSha,
            message: "Already on the latest bundle — nothing to push."
          });
        }
        if (!summary.ok) {
          return json(
            {
              ok: false,
              error: summary.error ?? summary.failures[0]?.error ?? "push failed",
              manifestSha: summary.manifestSha
            },
            502
          );
        }
        return json({
          ok: true,
          pushed: summary.pushed,
          manifestSha: summary.manifestSha,
          message: "Pushed. The Worker should pick it up within ~15 seconds."
        });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 500);
      }
    }
    case "forget": {
      // Tier 2 b — "Forget my deployment". Customer-initiated GDPR-style
      // deletion. Removes the deployment row + revokes every manage token
      // for it. The customer's Worker keeps running (their account, their
      // bindings); we just stop pushing.
      try {
        await env.DB
          .prepare(`UPDATE cloud_manage_tokens SET revoked = 1 WHERE deployment_id = ?`)
          .bind(deployment.id)
          .run();
        await env.DB
          .prepare(`DELETE FROM cloud_deployments WHERE id = ?`)
          .bind(deployment.id)
          .run();
        // We intentionally keep cloud_push_log rows for audit; they have no
        // PII beyond a deployment id.
        return json({ ok: true, forgotten: true });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 500);
      }
    }
    default:
      return json({ ok: false, error: `unknown action '${action}'` }, 400);
  }
}
