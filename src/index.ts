import { AppError, toAppError } from "./core/errors";
import type { AgentRuntime as _AgentRuntimeType } from "./core/runtime";
import { AgentRuntime } from "./core/runtime";
import { SkillManager } from "./core/skills";
import { emitAuditEvent } from "./core/telemetry";
import { metricsStore } from "./core/metrics";
import { evaluateErrorRateAlert, sendAlertWebhook } from "./core/alerts";
import { getPlugins } from "./plugins/registry";
import { playgroundHtml } from "./playground";
import { appHtml } from "./app";
import { openapiDocument } from "./openapi";
import { handleConductorMessage } from "./conductor";
import {
  handleConductorStreamStart,
  handleConductorStreamSubscribe,
  handleConductorStreamInterrupt,
  handleConductorStreamState
} from "./conductor-stream";
import { handleConductorToolStream } from "./conductor-tool-stream";
import { listMcpRollbackSupport } from "./rollback";
import type { ConductorInput } from "./conductor";
import { startDeviceCode, pollDeviceCode } from "./oauth/codexOauth";
import { collectStatus, generateSnippet, guidedStart } from "./setup";
import {
  ACCESS_WIZARD_SCOPES,
  ACCESS_WIZARD_TOKEN_URL,
  deriveScriptName,
  preflightToken,
  probeScopes,
  runLockdown
} from "./setup-access";
import { isPublicRoute, requireAuth, type AuthContext } from "./auth";
import { welcomeHtml } from "./welcome";
import type { Env, InvokeRequest } from "./types";

export { AgentSessionDO } from "./durable/agentSession";
export { StreamHubDO } from "./durable/streamHub";
export { ChatSessionDO } from "./durable/chatSession";
export { ShellContainerDO } from "./durable/shellContainer";
export { MorningBriefingWorkflow } from "./workflows/morningBriefing";

import {
  deleteWorkflow,
  listScheduledWorkflows,
  listWorkflowHandlers,
  runScheduledCron,
  upsertWorkflow
} from "./scheduler";
import {
  enforceSpendingCap,
  getCostRange,
  getDailyCost,
  rollupAiGatewayCosts
} from "./costTracking";
import { handleInboundEmail } from "./emailHandler";
// Ensure the morning-briefing handler registers itself on cold start.
import "./workflows/morningBriefing";

const runtimeCache = new WeakMap<Env, AgentRuntime>();

async function getRuntime(env: Env): Promise<AgentRuntime> {
  const cached = runtimeCache.get(env);
  if (cached) {
    return cached;
  }
  const fresh = await AgentRuntime.bootstrap(env, getPlugins());
  runtimeCache.set(env, fresh);
  return fresh;
}

function json(data: unknown, status = 200, requestId?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8"
  };

  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function parseInvokeRequest(payload: unknown): InvokeRequest {
  if (!payload || typeof payload !== "object") {
    throw new AppError("E_BAD_REQUEST", "Request body must be a JSON object", 400);
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.action !== "string" || candidate.action.trim() === "") {
    throw new AppError("E_BAD_REQUEST", "'action' must be a non-empty string", 400);
  }

  return {
    action: candidate.action,
    input: candidate.input
  };
}

function parseSkillInvokeRequest(payload: unknown): { input?: unknown } {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const candidate = payload as Record<string, unknown>;
  return { input: candidate.input };
}

async function proxyToSession(
  env: Env,
  sessionName: string,
  subpath: string,
  request: Request
): Promise<Response> {
  if (!env.AGENT_SESSIONS) {
    throw new AppError(
      "E_DO_BINDING_MISSING",
      "AGENT_SESSIONS Durable Object binding not configured in wrangler.toml",
      500
    );
  }
  const doId = env.AGENT_SESSIONS.idFromName(sessionName);
  const stub = env.AGENT_SESSIONS.get(doId);

  const rewritten = new Request(`https://do${subpath}`, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
  });
  return stub.fetch(rewritten);
}

async function handleApplyRollback(
  request: Request,
  env: Env,
  runtime: AgentRuntime,
  sessionName: string,
  requestId: string
): Promise<Response> {
  if (!env.AGENT_SESSIONS) {
    return json(
      { ok: false, error: "AGENT_SESSIONS binding required", code: "E_DO_BINDING_MISSING" },
      500,
      requestId
    );
  }

  const body = (await request.json().catch(() => ({}))) as { messageId?: string };
  const doId = env.AGENT_SESSIONS.idFromName(sessionName);
  const stub = env.AGENT_SESSIONS.get(doId);

  // Locate the target rollback entry
  const pendingResp = await stub.fetch(new Request("https://do/rollbacks"));
  const pendingJson = (await pendingResp.json()) as {
    ok: boolean;
    data?: Array<{ id: string; rollback?: { skill: string; input: unknown; label: string } | null; rollbackStatus?: string }>;
  };
  const list = pendingJson.data ?? [];
  const targetMessage = body.messageId
    ? list.find((m) => m.id === body.messageId)
    : list.find((m) => m.rollbackStatus !== "applied");

  if (!targetMessage || !targetMessage.rollback) {
    return json(
      { ok: false, error: "no rollback available for this session", code: "E_NO_ROLLBACK" },
      404,
      requestId
    );
  }

  // Execute the rollback via its declared skill
  const rollback = targetMessage.rollback;
  const plugin = runtime
    .listPlugins()
    .find(() => true); // runtime has no getPlugin — we use invoke below
  void plugin;
  // We always know rollbacks are skill-shaped; route through runtime.invoke-via-skill equivalent.
  const skillsResult = await (async () => {
    const skillMgr = new (await import("./core/skills")).SkillManager(runtime);
    return skillMgr.invoke(rollback.skill, { input: rollback.input });
  })();

  // Append the rollback result as a tool message; mark the original as applied.
  await stub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      body: JSON.stringify({
        role: "tool",
        name: `rollback:${rollback.skill}`,
        toolCallId: `rollback-${targetMessage.id}`,
        content: JSON.stringify({
          rollbackOf: targetMessage.id,
          label: rollback.label,
          result: skillsResult
        })
      })
    })
  );

  await stub.fetch(
    new Request("https://do/rollback", {
      method: "POST",
      body: JSON.stringify({ messageId: targetMessage.id })
    })
  );

  return json(
    {
      ok: true,
      data: {
        appliedMessageId: targetMessage.id,
        skill: rollback.skill,
        label: rollback.label,
        result: skillsResult
      }
    },
    200,
    requestId
  );
}

async function handler(request: Request, env: Env, requestId: string, startedAt: number): Promise<Response> {
  const url = new URL(request.url);

  // --- Auth gate (Cloudflare Access) ---
  // Public GETs (`/`, `/health`, `/openapi.json`) pass through. Everything else
  // — including the `/app` SPA shell, `/playground`, and every `/conductor/*`,
  // `/skills/*`, `/sessions/*`, `/invoke/*`, `/setup/*`, `/oauth/*`, and
  // `/rollback/*` endpoint — requires a valid Access JWT.
  let auth: AuthContext | null = null;
  if (!isPublicRoute(request.method, url.pathname)) {
    auth = await requireAuth(request, env);
  }
  void auth; // bound for future per-user scoping; runtime is single-tenant today

  if (request.method === "GET" && (url.pathname === "/app" || url.pathname === "/app/")) {
    return html(appHtml());
  }

  if (request.method === "GET" && url.pathname === "/playground") {
    return html(playgroundHtml());
  }

  if (request.method === "GET" && url.pathname === "/openapi.json") {
    return json(openapiDocument(), 200, requestId);
  }

  // First-run friendly: a browser hitting `/welcome` or `/` (with an
  // HTML-preferring Accept header) gets a real onboarding page instead of
  // a JSON route map.
  if (request.method === "GET" && url.pathname === "/welcome") {
    return html(welcomeHtml({ AGENT_NAME: env.AGENT_NAME, AGENT_OWNER: env.AGENT_OWNER }));
  }

  const runtime = await getRuntime(env);
  const skills = new SkillManager(runtime);

  if (request.method === "GET" && url.pathname === "/") {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html") && !accept.includes("application/json")) {
      return html(welcomeHtml({ AGENT_NAME: env.AGENT_NAME, AGENT_OWNER: env.AGENT_OWNER }));
    }
    return json({
      ok: true,
      service: "open-think",
      version: "0.3.0",
      docs: {
        welcome: "GET /welcome (HTML, also at GET / with Accept: text/html)",
        app: "GET /app",
        playground: "GET /playground",
        openapi: "GET /openapi.json",
        health: "GET /health",
        plugins: "GET /plugins",
        skills: "GET /skills",
        invokePlugin: "POST /invoke/{pluginId}",
        invokeSkill: "POST /skills/invoke/{skillId}",
        metrics: "GET /metrics",
        alertsCheck: "POST /alerts/check",
        conductor: "POST /conductor/message",
        sessionInit: "POST /sessions/{name}/init",
        sessionDescribe: "GET /sessions/{name}",
        sessionMessages: "GET|POST /sessions/{name}/messages",
        sessionTree: "GET /sessions/{name}/tree",
        sessionFork: "POST /sessions/{name}/fork",
        sessionCompact: "POST /sessions/{name}/compact",
        sessionSearch: "POST /sessions/{name}/search",
        sessionFibers: "GET|POST /sessions/{name}/fibers"
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      data: {
        plugins: runtime.listPlugins().length,
        skills: skills.listSkills().length,
        durableObjects: Boolean(env.AGENT_SESSIONS),
        workersAi: Boolean(env.AI)
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/plugins") {
    return json({ ok: true, data: { plugins: runtime.listPlugins() } });
  }

  if (request.method === "GET" && url.pathname === "/metrics") {
    return json({ ok: true, data: { metrics: metricsStore.snapshot() } }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/alerts/check") {
    const metrics = metricsStore.snapshot();
    const evaluation = evaluateErrorRateAlert(metrics, runtime.config.alertErrorRatePct);

    if (evaluation.triggered && runtime.config.alertWebhookUrl) {
      await sendAlertWebhook(fetch, runtime.config.alertWebhookUrl, {
        requestId,
        type: "error_rate_alert",
        evaluation,
        metrics
      });
    }

    return json({
      ok: true,
      evaluation,
      webhookSent: Boolean(evaluation.triggered && runtime.config.alertWebhookUrl),
      metrics
    }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/skills") {
    return json({ ok: true, data: { skills: skills.listSkills() } });
  }

  if (request.method === "POST" && url.pathname === "/conductor/stream") {
    return await handleConductorStreamStart(request, env, runtime, skills);
  }

  // WebSocket-based chat — modeled after the Cloudflare Workers WebSocket
  // example (https://developers.cloudflare.com/workers/examples/websockets/)
  // and Helm's existing conductor semantics. One DO per session name; the
  // DO holds all browser tabs watching that session and broadcasts events.
  if (url.pathname.startsWith("/chat/ws/")) {
    if (!env.CHAT_SESSIONS) {
      return json(
        { ok: false, error: "CHAT_SESSIONS DO binding required", code: "E_DO_BINDING_MISSING" },
        503,
        requestId
      );
    }
    const upgrade = request.headers.get("upgrade")?.toLowerCase() ?? "";
    if (upgrade !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const sessionName =
      decodeURIComponent(url.pathname.slice("/chat/ws/".length).replace(/\/$/, "")) ||
      "conductor:default";
    const id = env.CHAT_SESSIONS.idFromName(sessionName);
    const stub = env.CHAT_SESSIONS.get(id);
    // Forward to the DO with the session name as a query param so the DO's
    // fetch handler can read it without re-parsing the path.
    const forward = new Request(
      `https://chat-do/?session=${encodeURIComponent(sessionName)}`,
      request
    );
    return stub.fetch(forward);
  }

  // Helm Shell — Cloudflare Container hosting bash, fronted by a tiny
  // Node WebSocket↔PTY bridge (docker/shell/server.mjs). Browser uses
  // xterm.js at /app#/shell; CLI uses scripts/open-think-shell.mjs.
  // The container's `defaultPort` (7681) is fixed by the bridge and
  // proxied transparently — we just hand the upgrade to the SDK and
  // it routes WebSocket frames bidirectionally.
  if (url.pathname === "/shell/ws" || url.pathname.startsWith("/shell/ws/")) {
    if (!env.SHELL_CONTAINER) {
      return json(
        {
          ok: false,
          error:
            "SHELL_CONTAINER binding missing. Add the [[containers]] block + [[durable_objects.bindings]] for ShellContainerDO from wrangler.toml and redeploy.",
          code: "E_SHELL_CONTAINER_MISSING"
        },
        503,
        requestId
      );
    }
    const upgrade = request.headers.get("upgrade")?.toLowerCase() ?? "";
    if (upgrade !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const fromPath = url.pathname.slice("/shell/ws".length).replace(/^\//, "");
    const sessionName =
      decodeURIComponent(fromPath || url.searchParams.get("session") || "default") || "default";
    const id = env.SHELL_CONTAINER.idFromName(sessionName);
    const stub = env.SHELL_CONTAINER.get(id);
    // Container DO's fetch hands the request straight to the container's
    // HTTP server (port 7681). The bridge accepts ANY path on upgrade.
    const forward = new Request(
      `https://shell-do/ws?session=${encodeURIComponent(sessionName)}`,
      request
    );
    return stub.fetch(forward);
  }

  if (request.method === "POST" && url.pathname === "/conductor/stream-tools") {
    return await handleConductorToolStream(request, env, runtime, skills);
  }

  if (request.method === "GET" && url.pathname === "/rollback/support") {
    return json({ ok: true, data: { supported: listMcpRollbackSupport() } }, 200, requestId);
  }

  if (url.pathname.startsWith("/conductor/stream/")) {
    const rest = url.pathname.replace("/conductor/stream/", "");
    const parts = rest.split("/");
    const streamId = decodeURIComponent(parts[0] ?? "");
    const tail = parts.slice(1).join("/");
    if (request.method === "GET" && tail === "") {
      return await handleConductorStreamSubscribe(env, streamId);
    }
    if (request.method === "POST" && tail === "interrupt") {
      return await handleConductorStreamInterrupt(request, env, streamId);
    }
    if (request.method === "GET" && tail === "state") {
      return await handleConductorStreamState(env, streamId);
    }
    return json({ ok: false, error: "stream route not found", code: "E_NOT_FOUND" }, 404, requestId);
  }

  /* ---------------- Scheduler CRUD ---------------- */
  if (request.method === "GET" && url.pathname === "/scheduler/workflows") {
    const rows = await listScheduledWorkflows(env);
    return json(
      { ok: true, data: { handlers: listWorkflowHandlers(), workflows: rows } },
      200,
      requestId
    );
  }
  if (request.method === "POST" && url.pathname === "/scheduler/workflows") {
    const body = (await request.json()) as {
      name: string;
      cron: string;
      handler: string;
      paramsJson?: string;
      enabled?: number;
    };
    if (!body.name || !body.cron || !body.handler) {
      return json(
        { ok: false, error: "name, cron, handler required", code: "E_BAD_REQUEST" },
        400,
        requestId
      );
    }
    if (!listWorkflowHandlers().includes(body.handler)) {
      return json(
        {
          ok: false,
          error: `unknown handler '${body.handler}'. Registered: ${listWorkflowHandlers().join(", ")}`,
          code: "E_HANDLER_NOT_FOUND"
        },
        400,
        requestId
      );
    }
    const row = await upsertWorkflow(env, body);
    return json({ ok: true, data: row }, 200, requestId);
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/scheduler/workflows/")) {
    const id = decodeURIComponent(url.pathname.slice("/scheduler/workflows/".length));
    const ok = await deleteWorkflow(env, id);
    return json({ ok, data: { id } }, ok ? 200 : 404, requestId);
  }
  /* ---------------- Web Push ---------------- */
  if (request.method === "GET" && url.pathname === "/sw.js") {
    // Public — service workers must be served from the same origin without
    // credentials. Browsers refuse to register a SW that returns 401.
    const { SERVICE_WORKER_JS } = await import("./webpush/serviceWorker");
    return new Response(SERVICE_WORKER_JS, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        // Let the browser revalidate often — push behavior changes ship via SW updates.
        "cache-control": "no-cache",
        // Required header for service workers in the path that owns the SW.
        "service-worker-allowed": "/"
      }
    });
  }
  if (request.method === "GET" && url.pathname === "/icon.svg") {
    const { ICON_SVG } = await import("./webpush/serviceWorker");
    return new Response(ICON_SVG, {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400"
      }
    });
  }
  if (request.method === "GET" && url.pathname === "/webpush/public-key") {
    // Public: the service worker needs this to call PushManager.subscribe().
    if (!env.VAPID_PUBLIC_KEY) {
      return json(
        {
          ok: false,
          error:
            "VAPID_PUBLIC_KEY not configured. Run `npm run vapid:generate` then `wrangler secret put VAPID_PUBLIC_KEY`.",
          code: "E_VAPID_NOT_CONFIGURED"
        },
        503,
        requestId
      );
    }
    return json(
      { ok: true, data: { publicKey: env.VAPID_PUBLIC_KEY } },
      200,
      requestId
    );
  }
  if (request.method === "POST" && url.pathname === "/webpush/subscribe") {
    // Auth-gated. Accepts the shape returned by PushSubscription.toJSON().
    const sub = (await request.json().catch(() => ({}))) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return json(
        { ok: false, error: "endpoint + keys.p256dh + keys.auth required", code: "E_BAD_REQUEST" },
        400,
        requestId
      );
    }
    const r = await skills.invoke("notifier-subscribe-push", { input: sub });
    return json(
      r.ok
        ? { ok: true, data: (r as { data?: unknown }).data }
        : { ok: false, error: r.error },
      r.ok ? 200 : 500,
      requestId
    );
  }
  if (request.method === "POST" && url.pathname === "/webpush/test") {
    // Convenience: fire a test notification to every registered subscription.
    const r = await skills.invoke("notify-user", {
      input: {
        title: "Helm test",
        body: "If you can read this, Web Push is wired up.",
        channel: "web-push"
      }
    });
    return json(
      r.ok
        ? { ok: true, data: (r as { data?: unknown }).data }
        : { ok: false, error: r.error },
      r.ok ? 200 : 500,
      requestId
    );
  }

  /* ---------------- Cost tracking ---------------- */
  if (request.method === "GET" && url.pathname === "/cost/today") {
    const rows = await getDailyCost(env);
    const totalUsd = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const totalTokens = rows.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
    return json(
      { ok: true, data: { totalUsd, totalTokens, byProvider: rows } },
      200,
      requestId
    );
  }
  if (request.method === "GET" && url.pathname === "/cost/range") {
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    if (!start || !end) {
      return json(
        { ok: false, error: "?start=YYYY-MM-DD&end=YYYY-MM-DD required" },
        400,
        requestId
      );
    }
    const rows = await getCostRange(env, start, end);
    const totalUsd = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    return json({ ok: true, data: { start, end, totalUsd, rows } }, 200, requestId);
  }
  if (request.method === "GET" && url.pathname === "/cost/cap") {
    const r = await enforceSpendingCap(env);
    return json({ ok: true, data: r }, 200, requestId);
  }
  if (request.method === "POST" && url.pathname === "/cost/rollup") {
    const r = await rollupAiGatewayCosts(env);
    return json({ ok: r.ok, data: r }, r.ok ? 200 : 500, requestId);
  }

  if (request.method === "POST" && url.pathname === "/scheduler/fire") {
    // Manual-fire endpoint — useful for testing a workflow without waiting
    // for its cron expression. Accepts { cron } and fans out as if that
    // cron had fired.
    const body = (await request.json().catch(() => ({}))) as { cron?: string };
    if (!body.cron) {
      return json({ ok: false, error: "body.cron required", code: "E_BAD_REQUEST" }, 400, requestId);
    }
    const result = await runScheduledCron(env, { cron: body.cron, scheduledTime: Date.now() });
    return json({ ok: true, data: result }, 200, requestId);
  }

  if (request.method === "GET" && url.pathname === "/setup/status") {
    return json({ ok: true, data: collectStatus(env, runtime) }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/setup/snippet") {
    const body = (await request.json().catch(() => ({}))) as {
      enablePlugins?: string[];
      allowHosts?: string[];
    };
    return json({ ok: true, data: generateSnippet(env, body) }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/setup/guided-start") {
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      provider?: string;
      bringCloudflareMcp?: boolean;
    };
    const result = await guidedStart(env, runtime, skills, body);
    return json({ ok: true, data: result }, 200, requestId);
  }

  /* ---- Lock-it-down wizard for Cloudflare Access ---- */
  // GET /setup/access/discover — populates the wizard form on Settings tab.
  // Returns the worker's own host + best-guess script name + whether auth
  // is already configured + the pre-filled token-creation URL.
  if (request.method === "GET" && url.pathname === "/setup/access/discover") {
    const host = request.headers.get("host") ?? url.host;
    const status = collectStatus(env, runtime);
    const auth = status.capabilities.find((c) => c.id === "auth");
    return json(
      {
        ok: true,
        data: {
          authConfigured: Boolean(auth?.configured),
          workerHost: host,
          scriptName: deriveScriptName(host),
          // True iff the operator pasted CLOUDFLARE_API_TOKEN at deploy time
          // (or set it later via wrangler secret put). The wizard uses this
          // as a fallback so the user doesn't have to paste again.
          hasExistingToken: Boolean(env.CLOUDFLARE_API_TOKEN),
          // Pre-fill the email field. If both this AND hasExistingToken are
          // true, the wizard's "Lock it down" button is one click — no
          // form fill required.
          prefilledOwnerEmail: env.OWNER_EMAIL ?? null,
          tokenUrl: ACCESS_WIZARD_TOKEN_URL,
          scopes: ACCESS_WIZARD_SCOPES
        }
      },
      200,
      requestId
    );
  }

  // POST /setup/access/preflight — verify token + return account picker rows
  // + (when accountId is supplied) probe each required scope so the UI can
  // tell the user which permission is missing BEFORE they submit.
  // Token comes from the request body OR (if absent) from env.CLOUDFLARE_API_TOKEN.
  if (request.method === "POST" && url.pathname === "/setup/access/preflight") {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      accountId?: string;
    };
    const token = body.token || env.CLOUDFLARE_API_TOKEN || "";
    if (!token) {
      return json({ ok: false, error: "token required" }, 400, requestId);
    }
    const r = await preflightToken(token);
    if (!r.ok) {
      return json(r, 400, requestId);
    }
    // Pick the account to probe against — body.accountId if supplied,
    // else the first account (single-account case).
    const probeAccountId =
      body.accountId && r.accounts.find((a) => a.id === body.accountId)
        ? body.accountId
        : r.accounts[0]?.id;
    if (probeAccountId) {
      try {
        r.scopes = await probeScopes(token, probeAccountId);
      } catch {
        // Probes are best-effort; an exception here doesn't fail the
        // preflight. The user can still submit; runLockdown surfaces the
        // real error if a scope is actually missing.
        r.scopes = [];
      }
    }
    return json({ ok: true, data: r }, 200, requestId);
  }

  // POST /setup/access/run — orchestrate the lockdown.
  // Body: { token?, accountId, scriptName?, allowedEmails: [], appName? }
  // Token falls back to env.CLOUDFLARE_API_TOKEN when omitted/empty.
  // Returns: full LockdownResult with per-step progress.
  if (request.method === "POST" && url.pathname === "/setup/access/run") {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      accountId?: string;
      scriptName?: string;
      appName?: string;
      allowedEmails?: string[];
      sessionDuration?: string;
    };
    const token = body.token || env.CLOUDFLARE_API_TOKEN || "";
    if (!token || !body.accountId) {
      return json(
        { ok: false, error: "token and accountId required" },
        400,
        requestId
      );
    }
    const host = request.headers.get("host") ?? url.host;
    const scriptName = body.scriptName || deriveScriptName(host) || "helm";
    const result = await runLockdown({
      token,
      accountId: body.accountId,
      scriptName,
      appName: body.appName || `Helm — ${scriptName}`,
      workerHost: host,
      allowedEmails: body.allowedEmails ?? [],
      sessionDuration: body.sessionDuration
    });
    if (result.ok) {
      return json({ ok: true, data: result }, 200, requestId);
    }
    // result already has ok:false + error/recovery/steps; pass through.
    return json(result, 400, requestId);
  }

  if (request.method === "POST" && url.pathname === "/oauth/codex/device/start") {
    const data = await startDeviceCode(env);
    return json({ ok: true, data }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/oauth/codex/device/poll") {
    const body = (await request.json()) as { device_code?: string };
    const data = await pollDeviceCode(env, body?.device_code ?? "");
    return json({ ok: true, data }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname === "/conductor/message") {
    const payload = (await request.json()) as ConductorInput;
    const reply = await handleConductorMessage(env, runtime, skills, payload);

    metricsStore.recordRequest(Date.now() - startedAt);
    metricsStore.recordPluginInvoke();

    emitAuditEvent({
      type: "plugin.invoke",
      requestId,
      method: request.method,
      path: url.pathname,
      ok: true,
      durationMs: Date.now() - startedAt,
      action: `conductor:${reply.providerUsed}`
    });

    return json({ ok: true, data: reply }, 200, requestId);
  }

  if (request.method === "POST" && url.pathname.startsWith("/skills/invoke/")) {
    const skillId = url.pathname.replace("/skills/invoke/", "").trim();
    const payload = await request.json();
    const parsed = parseSkillInvokeRequest(payload);
    const result = await skills.invoke(skillId, parsed);

    metricsStore.recordRequest(Date.now() - startedAt);
    metricsStore.recordSkillInvoke();

    emitAuditEvent({
      type: "skill.invoke",
      requestId,
      method: request.method,
      path: url.pathname,
      ok: result.ok,
      durationMs: Date.now() - startedAt,
      skillId
    });

    return json(result, result.ok ? 200 : 400, requestId);
  }

  if (request.method === "POST" && url.pathname.startsWith("/invoke/")) {
    const pluginId = url.pathname.replace("/invoke/", "").trim();
    const payload = await request.json();
    const parsed = parseInvokeRequest(payload);
    const result = await runtime.invoke(pluginId, parsed);

    metricsStore.recordRequest(Date.now() - startedAt);
    metricsStore.recordPluginInvoke();

    emitAuditEvent({
      type: "plugin.invoke",
      requestId,
      method: request.method,
      path: url.pathname,
      ok: result.ok,
      durationMs: Date.now() - startedAt,
      pluginId,
      action: parsed.action
    });

    return json(result, result.ok ? 200 : 400, requestId);
  }

  if (url.pathname.startsWith("/sessions/")) {
    const rest = url.pathname.replace("/sessions/", "");
    const [rawName, ...segments] = rest.split("/");
    const sessionName = decodeURIComponent(rawName ?? "");
    if (!sessionName) {
      return json({ ok: false, error: "session name required", code: "E_BAD_REQUEST" }, 400, requestId);
    }
    const subpath = segments.length === 0 ? "/" : "/" + segments.join("/");

    // Intercept /sessions/{name}/apply-rollback — executes the pending rollback
    // via the skill plane, then records the applied state back to the session.
    if (request.method === "POST" && subpath === "/apply-rollback") {
      return await handleApplyRollback(request, env, runtime, sessionName, requestId);
    }

    const response = await proxyToSession(env, sessionName, subpath, request);
    metricsStore.recordRequest(Date.now() - startedAt);
    emitAuditEvent({
      type: "plugin.invoke",
      requestId,
      method: request.method,
      path: url.pathname,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      action: `session:${subpath}`
    });
    return response;
  }

  return json({ ok: false, error: "Not found", code: "E_NOT_FOUND" }, 404, requestId);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      return await handler(request, env, requestId, startedAt);
    } catch (error) {
      const err = toAppError(error);

      metricsStore.recordRequest(Date.now() - startedAt);
      metricsStore.recordError();

      emitAuditEvent({
        type: "request.error",
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        ok: false,
        durationMs: Date.now() - startedAt,
        code: err.code
      });

      return json(
        {
          ok: false,
          error: err.message,
          code: err.code,
          requestId
        },
        err.status,
        requestId
      );
    }
  },

  /**
   * Workers Cron Triggers entrypoint. Each cron expression in wrangler.toml's
   * [triggers] array fires this handler with `controller.cron` set to the
   * expression that fired. We dispatch to every workflow in `pa_workflows`
   * whose `cron` matches (see src/scheduler.ts).
   */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runScheduledCron(env, {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime
      }).catch((err) => console.error("[scheduled] runScheduledCron failed:", (err as Error).message))
    );
  },

  /**
   * Email Routing entrypoint. Every inbound message (catch-all or specific
   * address) lands here. We parse + persist + optionally forward.
   */
  async email(
    message: Parameters<typeof handleInboundEmail>[0],
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await handleInboundEmail(message, env, ctx);
  }
};
