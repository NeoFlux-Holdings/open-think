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
import {
  deleteWorkerSecret,
  getSecretSlot,
  KNOWN_SECRETS,
  listSecretStatus,
  putWorkerSecret
} from "./setup-secrets";
import { isPublicRoute, requireAuth, type AuthContext } from "./auth";
import { welcomeHtml } from "./welcome";
import type { Env, InvokeRequest } from "./types";

export { AgentSessionDO } from "./durable/agentSession";
export { StreamHubDO } from "./durable/streamHub";
export { ChatSessionDO } from "./durable/chatSession";
export { ShellContainerDO } from "./durable/shellContainer";
export { ShellRegistryDO } from "./durable/shellRegistry";
export { CliAuthDO } from "./durable/cliAuth";
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
    const explicit = decodeURIComponent(fromPath || url.searchParams.get("session") || "");
    // No explicit session → derive from authenticated email so each user
    // gets their own isolated container. We keep the prefix "u-" so it's
    // visually distinguishable from operator-named sessions and we hash
    // rather than embed the raw email (case-folding + DO-name-safety).
    let sessionName = explicit;
    if (!sessionName) {
      const email = (auth?.email ?? "anon").toLowerCase();
      // FNV-1a 32-bit — small, deterministic, no crypto cost. Collision
      // risk is fine here because the auth gate already isolates users.
      let h = 0x811c9dc5;
      for (let i = 0; i < email.length; i++) {
        h ^= email.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      sessionName = `u-${h.toString(16).padStart(8, "0")}`;
    }
    const id = env.SHELL_CONTAINER.idFromName(sessionName);
    const stub = env.SHELL_CONTAINER.get(id);
    // Best-effort: register this session in the registry so the
    // Sessions panel can list it. Don't await failure; the shell
    // upgrade is the user-facing path and registry hiccups shouldn't
    // block it.
    if (env.SHELL_REGISTRY) {
      const registry = env.SHELL_REGISTRY.get(env.SHELL_REGISTRY.idFromName("global"));
      registry
        .fetch(
          new Request("https://reg/touch", {
            method: "POST",
            body: JSON.stringify({
              session: sessionName,
              email: auth?.email ?? "anon",
              delta: 1
            })
          })
        )
        .catch(() => {});
    }
    // Container DO's fetch hands the request straight to the container's
    // HTTP server (port 7681). The bridge accepts ANY path on upgrade.
    const forward = new Request(
      `https://shell-do/ws?session=${encodeURIComponent(sessionName)}`,
      request
    );
    return stub.fetch(forward);
  }

  // POST /shell/exec — one-shot bash command runner inside a per-user
  // shell container. Same auth gate as the rest of /shell — the
  // internal bearer or a CF Access JWT.
  //
  // Body: { cmd, cwd?, timeoutMs?, stdin?, session? }
  // Returns: { ok, stdout, stderr, code, signal, durationMs, truncated, timedOut }
  //
  // The agent's helm-exec skill is the primary caller — lets the
  // conductor run `git clone`, `sed`, `wrangler deploy`, etc. without
  // a persistent terminal. Output is capped at 256 KB so a runaway
  // process doesn't dump megabytes of logs into the agent's context.
  if (request.method === "POST" && url.pathname === "/shell/exec") {
    if (!env.SHELL_CONTAINER) {
      return json({ ok: false, error: "SHELL_CONTAINER binding missing" }, 503, requestId);
    }
    const body = (await request.json().catch(() => ({}))) as {
      cmd?: string;
      cwd?: string;
      timeoutMs?: number;
      stdin?: string;
      session?: string;
    };
    if (!body.cmd) {
      return json({ ok: false, error: "body.cmd required" }, 400, requestId);
    }
    const explicit = body.session?.trim() ?? "";
    let sessionName = explicit;
    if (!sessionName) {
      const email = (auth?.email ?? "anon").toLowerCase();
      let h = 0x811c9dc5;
      for (let i = 0; i < email.length; i++) {
        h ^= email.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      sessionName = `u-${h.toString(16).padStart(8, "0")}`;
    }
    const id = env.SHELL_CONTAINER.idFromName(sessionName);
    const stub = env.SHELL_CONTAINER.get(id);
    // Forward to the bridge's /exec endpoint inside the container.
    const forward = new Request("https://shell-do/exec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cmd: body.cmd,
        cwd: body.cwd,
        timeoutMs: body.timeoutMs,
        stdin: body.stdin
      })
    });
    const r = await stub.fetch(forward);
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // GET /shell/list — return the registry's view of active/recent
  // sessions for the authenticated user. Operators can pass `?all=1`
  // to see everyone's sessions (gated by the same auth — anyone with
  // /app access can see; tighten with CF_ACCESS_ALLOWED_EMAILS).
  if (request.method === "GET" && url.pathname === "/shell/list") {
    if (!env.SHELL_REGISTRY) {
      return json(
        { ok: true, data: { sessions: [], note: "SHELL_REGISTRY binding missing" } },
        200,
        requestId
      );
    }
    const registry = env.SHELL_REGISTRY.get(env.SHELL_REGISTRY.idFromName("global"));
    const showAll = url.searchParams.get("all") === "1";
    const filter = showAll ? "" : `?email=${encodeURIComponent((auth?.email ?? "").toLowerCase())}`;
    const r = await registry.fetch(new Request(`https://reg/list${filter}`));
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // POST /shell/forget — drop a session from the registry. Doesn't
  // touch the underlying container DO (which sleeps on its own); just
  // removes it from the user-visible list.
  if (request.method === "POST" && url.pathname === "/shell/forget") {
    if (!env.SHELL_REGISTRY) {
      return json({ ok: false, error: "registry not bound" }, 503, requestId);
    }
    const body = (await request.json().catch(() => ({}))) as { session?: string };
    const registry = env.SHELL_REGISTRY.get(env.SHELL_REGISTRY.idFromName("global"));
    const r = await registry.fetch(
      new Request("https://reg/forget", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );
    return new Response(r.body, { status: r.status, headers: r.headers });
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
          // form fill required. Accept either AGENT_OWNER_EMAIL or
          // OWNER_EMAIL (the cloud deploy form sets both as plain-text vars
          // so either may be present at runtime).
          prefilledOwnerEmail: env.AGENT_OWNER_EMAIL ?? env.OWNER_EMAIL ?? null,
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

  // /persist/* — Worker-proxied R2 access for the Helm Shell container.
  // Auth gated like the rest of the app (CF Access JWT for browsers, the
  // internal bearer for the in-container `helm-save`/`helm-load` scripts
  // that don't carry a JWT). Routes through env.WORKSPACE so the
  // container never sees R2 credentials — eliminates two manual secret-puts
  // (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) for the common case.
  //
  //   GET    /persist/<key>     → object body (404 if missing)
  //   PUT    /persist/<key>     → store request body, returns {etag,size}
  //   DELETE /persist/<key>     → drop object
  //   GET    /persist/?prefix=  → list keys (max 1000)
  if (url.pathname === "/persist" || url.pathname.startsWith("/persist/")) {
    if (!env.WORKSPACE) {
      return json(
        {
          ok: false,
          error:
            "WORKSPACE R2 binding missing. Run /setup/auto to create the bucket, then add to wrangler.toml:\n  [[r2_buckets]]\n  binding = \"WORKSPACE\"\n  bucket_name = \"<your-bucket>\"",
          code: "E_WORKSPACE_BINDING_MISSING"
        },
        503,
        requestId
      );
    }
    const rawKey = url.pathname === "/persist" ? "" : url.pathname.slice("/persist/".length);
    const key = decodeURIComponent(rawKey).replace(/^\/+/, "");

    // List
    if (!key && request.method === "GET") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const list = await env.WORKSPACE.list({ prefix, limit: 1000 });
      return json(
        {
          ok: true,
          data: {
            keys: list.objects.map((o) => ({
              key: o.key,
              size: o.size,
              uploaded: o.uploaded.toISOString(),
              etag: o.etag
            })),
            truncated: list.truncated
          }
        },
        200,
        requestId
      );
    }

    if (!key) {
      return json({ ok: false, error: "key required" }, 400, requestId);
    }
    if (key.length > 1024) {
      return json({ ok: false, error: "key too long (max 1024 bytes)" }, 400, requestId);
    }

    if (request.method === "GET") {
      const obj = await env.WORKSPACE.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      // Stream the body straight back to caller. CF auto-handles ranges.
      return new Response(obj.body, { status: 200, headers });
    }

    if (request.method === "PUT") {
      const obj = await env.WORKSPACE.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get("content-type") ?? "application/octet-stream"
        }
      });
      return json(
        { ok: true, data: { key, size: obj.size, etag: obj.httpEtag } },
        200,
        requestId
      );
    }

    if (request.method === "DELETE") {
      await env.WORKSPACE.delete(key);
      return json({ ok: true, data: { deleted: key } }, 200, requestId);
    }

    return new Response("method not allowed", { status: 405 });
  }

  // /assets/xterm/* — Worker-proxied + edge-cached xterm.js bundle.
  // Browsers load these directly from the SPA; we never re-fetch from
  // jsdelivr after the first request to a colo. Public route (no
  // user data; the assets ARE the static distro of @xterm/xterm).
  if (request.method === "GET" && url.pathname.startsWith("/assets/xterm/")) {
    const file = url.pathname.slice("/assets/xterm/".length);
    // Pinned versions. Bump in src/app.ts at the same time.
    const XTERM_VER = "5.5.0";
    const FIT_VER = "0.10.0";
    type Source = { url: string; type: string };
    const SOURCES: Record<string, Source> = {
      "xterm.js": {
        url: `https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VER}/lib/xterm.js`,
        type: "application/javascript; charset=utf-8"
      },
      "xterm.css": {
        url: `https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VER}/css/xterm.css`,
        type: "text/css; charset=utf-8"
      },
      "addon-fit.js": {
        url: `https://cdn.jsdelivr.net/npm/@xterm/addon-fit@${FIT_VER}/lib/addon-fit.js`,
        type: "application/javascript; charset=utf-8"
      }
    };
    const source = SOURCES[file];
    if (!source) {
      return new Response("not found", { status: 404 });
    }
    // CF Cache API. The `default` cache isn't on the standard CacheStorage
    // type; cast to the CF-specific shape.
    const cache = (caches as unknown as { default: Cache }).default;
    // Cache key is namespaced so we don't collide with anything else.
    const cacheKey = new Request(`https://open-think-asset-cache.local/${file}?v=${XTERM_VER}-${FIT_VER}`);
    let cached = await cache.match(cacheKey);
    if (!cached) {
      const upstream = await fetch(source.url);
      if (!upstream.ok) {
        return new Response(`upstream fetch failed (${upstream.status})`, { status: 502 });
      }
      const body = await upstream.arrayBuffer();
      cached = new Response(body, {
        headers: {
          "content-type": source.type,
          // 1y immutable — version is in the upstream URL, so any bump
          // is a different file and the cache is rebuilt naturally.
          "cache-control": "public, max-age=31536000, immutable",
          "x-asset-source": source.url
        }
      });
      // Fire-and-forget the cache write. The first request pays the
      // cold-start cost; every subsequent request hits cache. Awaiting
      // would add ~1ms but keeps the code ctx-free.
      await cache.put(cacheKey, cached.clone());
    }
    return cached;
  }

  // GET /me — return the authenticated identity. Used by the Files
  // tab to derive the per-user prefix without re-implementing the
  // hash on the client. Cheap, no side effects.
  if (request.method === "GET" && url.pathname === "/me") {
    return json(
      {
        ok: true,
        data: {
          email: auth?.email ?? "anon",
          subject: auth?.subject ?? "",
          dev: auth?.dev ?? false,
          firstRun: auth?.firstRun ?? false
        }
      },
      200,
      requestId
    );
  }

  // ---------------- CLI device-code auth ----------------
  // POST /cli-auth/start — CLI begins the flow. Mints (deviceCode, userCode);
  // returns userCode + verifyUrl + poll interval. NO auth required (the
  // user has to approve in a browser, which is auth-gated).
  if (request.method === "POST" && url.pathname === "/cli-auth/start") {
    if (!env.CLI_AUTH) {
      return json({ ok: false, error: "CLI_AUTH binding not configured" }, 503, requestId);
    }
    const body = (await request.json().catch(() => ({}))) as {
      cliInfo?: string;
      appName?: string;
    };
    const stub = env.CLI_AUTH.get(env.CLI_AUTH.idFromName("global"));
    const r = await stub.fetch(
      new Request("https://cli/start", {
        method: "POST",
        body: JSON.stringify({
          cliInfo: body.cliInfo,
          appName: body.appName ?? env.AGENT_NAME ?? "open-think"
        })
      })
    );
    const data = (await r.json()) as { ok?: boolean; data?: { userCode: string } };
    const host = request.headers.get("host") ?? url.host;
    const verifyUrl = `https://${host}/app#/cli-auth?code=${encodeURIComponent(data.data?.userCode ?? "")}`;
    return json({ ...data, data: { ...(data.data ?? {}), verifyUrl } }, r.status, requestId);
  }

  // POST /cli-auth/poll — CLI checks if approved. NO auth required (it's
  // bound by deviceCode, which the CLI just got from /cli-auth/start).
  if (request.method === "POST" && url.pathname === "/cli-auth/poll") {
    if (!env.CLI_AUTH) {
      return json({ ok: false, error: "CLI_AUTH binding not configured" }, 503, requestId);
    }
    const body = await request.text();
    const stub = env.CLI_AUTH.get(env.CLI_AUTH.idFromName("global"));
    const r = await stub.fetch(
      new Request("https://cli/poll", { method: "POST", body })
    );
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // GET /cli-auth/lookup?code=<USER-CODE> — browser-side: resolve a user
  // code (typed in by the user) to the device record so we can show
  // metadata before approval. AUTH-GATED (browser-only path).
  if (request.method === "GET" && url.pathname === "/cli-auth/lookup") {
    if (!env.CLI_AUTH) {
      return json({ ok: false, error: "CLI_AUTH binding not configured" }, 503, requestId);
    }
    const code = url.searchParams.get("code") ?? "";
    const stub = env.CLI_AUTH.get(env.CLI_AUTH.idFromName("global"));
    const r = await stub.fetch(
      new Request(`https://cli/lookup?code=${encodeURIComponent(code)}`)
    );
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // POST /cli-auth/approve — browser-side: user clicked "Approve". The
  // auth.email comes from the CF Access JWT (we use the gate's auth ctx).
  // AUTH-GATED.
  if (request.method === "POST" && url.pathname === "/cli-auth/approve") {
    if (!env.CLI_AUTH) {
      return json({ ok: false, error: "CLI_AUTH binding not configured" }, 503, requestId);
    }
    const body = (await request.json().catch(() => ({}))) as { userCode?: string; deny?: boolean };
    const stub = env.CLI_AUTH.get(env.CLI_AUTH.idFromName("global"));
    const r = await stub.fetch(
      new Request("https://cli/approve", {
        method: "POST",
        body: JSON.stringify({
          userCode: body.userCode,
          deny: body.deny,
          email: auth?.email ?? "anon"
        })
      })
    );
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // POST /cli-auth/revoke — drop a stored CLI bearer. Body { token }.
  if (request.method === "POST" && url.pathname === "/cli-auth/revoke") {
    if (!env.CLI_AUTH) {
      return json({ ok: false, error: "CLI_AUTH binding not configured" }, 503, requestId);
    }
    const body = await request.text();
    const stub = env.CLI_AUTH.get(env.CLI_AUTH.idFromName("global"));
    const r = await stub.fetch(new Request("https://cli/revoke", { method: "POST", body }));
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // POST /setup/r2/bind — add an R2 binding to the live Worker without
  // touching wrangler.toml. CF API supports updating per-script settings
  // via PATCH; we fetch existing bindings, merge the new one, PATCH back.
  //
  // Trade-off (the user is told upfront): the local wrangler.toml will
  // STILL not have this binding, so the next `wrangler deploy` from
  // your machine will REMOVE it. We surface this clearly in the UI.
  //
  // The button at /app#/settings only appears after /setup/auto has
  // already created the bucket. Body { bucketName, bindingName? }.
  if (request.method === "POST" && url.pathname === "/setup/r2/bind") {
    const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
    if (!token) {
      return json({ ok: false, error: "CLOUDFLARE_API_TOKEN missing", code: "E_TOKEN_MISSING" }, 400, requestId);
    }
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      return json({ ok: false, error: "CLOUDFLARE_ACCOUNT_ID missing", code: "E_ACCOUNT_ID_MISSING" }, 400, requestId);
    }
    const body = (await request.json().catch(() => ({}))) as {
      bucketName?: string;
      bindingName?: string;
    };
    const bucketName = body.bucketName || env.R2_BUCKET || "";
    const bindingName = body.bindingName || "WORKSPACE";
    if (!bucketName) {
      return json({ ok: false, error: "bucketName required (or set R2_BUCKET)" }, 400, requestId);
    }
    const host = request.headers.get("host") ?? url.host;
    const scriptName = deriveScriptName(host) || "helm";
    // 1. Fetch current settings (to merge bindings).
    const get = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const getJson = (await get.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { bindings?: Array<Record<string, unknown>> };
      errors?: Array<{ message: string }>;
    };
    if (!get.ok || !getJson.success) {
      return json(
        { ok: false, error: getJson.errors?.[0]?.message ?? `fetch settings ${get.status}` },
        400,
        requestId
      );
    }
    const bindings = getJson.result?.bindings ?? [];
    // Replace any existing R2 binding with the same name; otherwise append.
    const filtered = bindings.filter(
      (b) => !(b.type === "r2_bucket" && b.name === bindingName)
    );
    filtered.push({ type: "r2_bucket", name: bindingName, bucket_name: bucketName });
    // 2. PATCH settings with the merged bindings array.
    const patch = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "multipart/form-data; boundary=BOUNDARY"
        },
        // PATCH on workers/scripts/settings expects a multipart body
        // with a `settings` JSON part. Build it inline.
        body: [
          "--BOUNDARY",
          'Content-Disposition: form-data; name="settings"',
          "Content-Type: application/json",
          "",
          JSON.stringify({ bindings: filtered }),
          "--BOUNDARY--",
          ""
        ].join("\r\n")
      }
    );
    const patchText = await patch.text();
    if (!patch.ok) {
      return json(
        {
          ok: false,
          error: `patch settings ${patch.status}: ${patchText.slice(0, 300)}`,
          hint:
            "If this fails, fall back to adding the [[r2_buckets]] block to wrangler.toml manually + redeploying."
        },
        400,
        requestId
      );
    }
    return json(
      {
        ok: true,
        data: {
          bindingName,
          bucketName,
          scriptName,
          warning:
            "The live Worker now has this binding, but your local wrangler.toml does NOT. The next `wrangler deploy` from your machine will REMOVE this binding unless you also paste it into wrangler.toml. Snippet:\n\n[[r2_buckets]]\nbinding = \"" +
            bindingName + "\"\nbucket_name = \"" + bucketName + "\""
        }
      },
      200,
      requestId
    );
  }

  // GET /setup/secrets — list every known secret slot + whether it's
  // currently configured. Values themselves are NEVER returned (env
  // already redacts them; we just check truthiness).
  if (request.method === "GET" && url.pathname === "/setup/secrets") {
    return json(
      { ok: true, data: { slots: listSecretStatus(env) } },
      200,
      requestId
    );
  }

  // PUT /setup/secrets/<NAME> — body { value: string }. Writes the
  // secret to the live Worker via the CF API. Name MUST be in our
  // allowlist (KNOWN_SECRETS) or we 400 — protects against an
  // /app session being used to set arbitrary env vars.
  if (request.method === "PUT" && url.pathname.startsWith("/setup/secrets/")) {
    const name = decodeURIComponent(url.pathname.slice("/setup/secrets/".length));
    if (!getSecretSlot(name)) {
      return json(
        {
          ok: false,
          error: `Unknown secret "${name}". Known: ${KNOWN_SECRETS.map((s) => String(s.name)).join(", ")}`,
          code: "E_UNKNOWN_SECRET"
        },
        400,
        requestId
      );
    }
    const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
    if (!token) {
      return json(
        { ok: false, error: "CLOUDFLARE_API_TOKEN not set on this Worker", code: "E_TOKEN_MISSING" },
        400,
        requestId
      );
    }
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      return json(
        {
          ok: false,
          error:
            "CLOUDFLARE_ACCOUNT_ID not set. Run /setup/auto or set it via this same endpoint first.",
          code: "E_ACCOUNT_ID_MISSING"
        },
        400,
        requestId
      );
    }
    const body = (await request.json().catch(() => ({}))) as { value?: unknown };
    if (typeof body.value !== "string" || body.value.length === 0) {
      return json({ ok: false, error: "body.value (non-empty string) required" }, 400, requestId);
    }
    const host = request.headers.get("host") ?? url.host;
    const scriptName = deriveScriptName(host) || "helm";
    const result = await putWorkerSecret({
      apiToken: token,
      accountId,
      scriptName,
      name,
      value: body.value
    });
    return json(
      {
        ok: result.ok,
        ...(result.ok
          ? { data: { name, scriptName, hint: "Worker auto-redeploys in ~15s; refresh after." } }
          : { error: result.error })
      },
      result.ok ? 200 : 400,
      requestId
    );
  }

  // DELETE /setup/secrets/<NAME>
  if (request.method === "DELETE" && url.pathname.startsWith("/setup/secrets/")) {
    const name = decodeURIComponent(url.pathname.slice("/setup/secrets/".length));
    const slot = getSecretSlot(name);
    if (!slot) {
      return json({ ok: false, error: `unknown secret "${name}"` }, 400, requestId);
    }
    const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
    if (!token) return json({ ok: false, error: "CLOUDFLARE_API_TOKEN missing" }, 400, requestId);
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) return json({ ok: false, error: "CLOUDFLARE_ACCOUNT_ID missing" }, 400, requestId);
    const host = request.headers.get("host") ?? url.host;
    const scriptName = deriveScriptName(host) || "helm";
    const result = await deleteWorkerSecret({
      apiToken: token,
      accountId,
      scriptName,
      name
    });
    return json(
      {
        ok: result.ok,
        ...(result.ok
          ? { data: { name, deleted: true } }
          : { error: result.error })
      },
      result.ok ? 200 : 400,
      requestId
    );
  }

  // POST /setup/auto — one-click full setup. Picks the account
  // automatically (env override → only-account → first-account), reads
  // owner email from env, runs lockdown end-to-end. Body is optional
  // and only needed for overrides:
  //   { accountId?, allowedEmails?, scriptName?, appName? }
  // Returns: { ok, picked: {accountId,name}, lockdown: LockdownResult,
  //           recommended: { ... } }
  if (request.method === "POST" && url.pathname === "/setup/auto") {
    const body = (await request.json().catch(() => ({}))) as {
      accountId?: string;
      allowedEmails?: string[];
      scriptName?: string;
      appName?: string;
      sessionDuration?: string;
    };
    const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
    if (!token) {
      return json(
        {
          ok: false,
          error: "CLOUDFLARE_API_TOKEN secret not set. Paste it in /app#/settings or run `wrangler secret put CLOUDFLARE_API_TOKEN`.",
          code: "E_TOKEN_MISSING"
        },
        400,
        requestId
      );
    }
    // 1. Pick account.
    const accountIdOverride = body.accountId || env.CLOUDFLARE_ACCOUNT_ID;
    let pickedAccount: { id: string; name: string } | null = null;
    if (accountIdOverride) {
      pickedAccount = { id: accountIdOverride, name: "(from env)" };
    } else {
      const list = await fetch(
        "https://api.cloudflare.com/client/v4/accounts?per_page=10",
        { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
      );
      const listJson = (await list.json().catch(() => ({}))) as {
        success?: boolean;
        result?: Array<{ id: string; name: string }>;
        errors?: Array<{ message: string }>;
      };
      if (!list.ok || !listJson.success) {
        return json(
          {
            ok: false,
            error: listJson.errors?.[0]?.message ?? "list-accounts failed",
            code: "E_LIST_ACCOUNTS_FAILED",
            hint:
              "Most likely the token is missing the 'Account Settings:Read' scope or is restricted to a different account."
          },
          400,
          requestId
        );
      }
      const accounts = listJson.result ?? [];
      if (accounts.length === 0) {
        return json({ ok: false, error: "no accounts visible to this token" }, 400, requestId);
      }
      pickedAccount = accounts[0];
    }
    // 2. Email allowlist — env owner first, body override second.
    const allowedEmails =
      body.allowedEmails && body.allowedEmails.length > 0
        ? body.allowedEmails
        : env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL
        ? [(env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL) as string]
        : [];
    if (allowedEmails.length === 0) {
      return json(
        {
          ok: false,
          error:
            "No owner email available. Set AGENT_OWNER_EMAIL (or OWNER_EMAIL) as a Worker var, or pass {allowedEmails:[...]} in the body.",
          code: "E_EMAIL_MISSING"
        },
        400,
        requestId
      );
    }
    // 3. Run lockdown.
    const host = request.headers.get("host") ?? url.host;
    const scriptName = body.scriptName || deriveScriptName(host) || "helm";
    const lockdown = await runLockdown({
      token,
      accountId: pickedAccount.id,
      scriptName,
      appName: body.appName || `Helm — ${scriptName}`,
      workerHost: host,
      allowedEmails,
      sessionDuration: body.sessionDuration
    });

    // 4. Auto-mint a HELM_INTERNAL_TOKEN if the Worker doesn't have one
    //    yet. This is the bearer the in-shell `helm` REPL uses, so without
    //    it the container's `helm` command is a dead button. We generate
    //    32 random bytes (256 bits) of entropy and persist as a secret.
    const extras: Array<{ kind: string; ok: boolean; detail?: string }> = [];
    if (!env.HELM_INTERNAL_TOKEN) {
      const buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      const internalToken = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${pickedAccount.id}/workers/scripts/${encodeURIComponent(
          scriptName
        )}/secrets`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            name: "HELM_INTERNAL_TOKEN",
            text: internalToken,
            type: "secret_text"
          })
        }
      );
      extras.push({
        kind: "set-helm-internal-token",
        ok: r.ok,
        detail: r.ok
          ? "auto-generated 32-byte secret; the in-shell `helm` REPL works after CF redeploys (~15s)"
          : `cf-put-secret HELM_INTERNAL_TOKEN failed (${r.status})`
      });
    } else {
      extras.push({
        kind: "set-helm-internal-token",
        ok: true,
        detail: "already set, leaving as-is"
      });
    }

    // 5. Auto-create R2 bucket for /persist if env doesn't have one.
    //    Default name = "${scriptName}-persist". Creating a bucket is
    //    cheap and reversible; we don't gate behind explicit opt-in.
    const r2BucketName = env.R2_BUCKET || `${scriptName}-persist`;
    if (!env.R2_BUCKET) {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${pickedAccount.id}/r2/buckets`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ name: r2BucketName })
        }
      );
      const bodyText = await r.text();
      const alreadyExists = !r.ok && bodyText.toLowerCase().includes("already exists");
      extras.push({
        kind: "create-r2-bucket",
        ok: r.ok || alreadyExists,
        detail: r.ok
          ? `bucket "${r2BucketName}" created`
          : alreadyExists
          ? `bucket "${r2BucketName}" already exists — reusing`
          : `failed (${r.status}): ${bodyText.slice(0, 200)}`
      });
      if (r.ok || alreadyExists) {
        // Persist the bucket name as a Worker secret so future requests
        // know which bucket to proxy /persist/* against.
        const setR = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${pickedAccount.id}/workers/scripts/${encodeURIComponent(
            scriptName
          )}/secrets`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              name: "R2_BUCKET",
              text: r2BucketName,
              type: "secret_text"
            })
          }
        );
        extras.push({
          kind: "set-r2-bucket-secret",
          ok: setR.ok,
          detail: setR.ok ? "R2_BUCKET secret set" : `failed (${setR.status})`
        });
      }
    } else {
      extras.push({
        kind: "create-r2-bucket",
        ok: true,
        detail: `R2_BUCKET="${env.R2_BUCKET}" already configured, leaving as-is`
      });
    }

    // 6. Build the next-steps list. We prefer Worker-proxied R2 (no
    //    R2 access keys needed in the container) and only nudge the user
    //    toward FUSE creds if they explicitly want filesystem semantics.
    const nextSteps: Array<{ done: boolean; label: string; hint?: string }> = [
      {
        done: lockdown.ok,
        label: "Cloudflare Access locked down",
        hint: lockdown.ok ? undefined : lockdown.error
      },
      {
        done: extras[0]?.ok ?? false,
        label: "HELM_INTERNAL_TOKEN auto-generated",
        hint: extras[0]?.detail
      },
      {
        done: (extras[1]?.ok ?? false) && (extras[2]?.ok ?? true),
        label: `R2 bucket for /persist (${r2BucketName})`,
        hint: extras[2]?.detail ?? extras[1]?.detail
      },
      {
        done: !!env.WORKSPACE,
        label: "[[r2_buckets]] binding (env.WORKSPACE) wired in wrangler.toml",
        hint: env.WORKSPACE
          ? "binding present"
          : `Add to wrangler.toml + redeploy:\n  [[r2_buckets]]\n  binding = "WORKSPACE"\n  bucket_name = "${r2BucketName}"`
      },
      {
        done: !!env.OPENROUTER_API_KEY,
        label: "OPENROUTER_API_KEY (recommended for chat)",
        hint: env.OPENROUTER_API_KEY
          ? undefined
          : "Get one at https://openrouter.ai/settings/keys, paste in /app#/settings"
      }
    ];

    return json(
      {
        ok: lockdown.ok,
        data: {
          picked: pickedAccount,
          allowedEmails,
          scriptName,
          host,
          lockdown,
          extras,
          nextSteps,
          recommended: {
            wranglerVars: {
              CF_ACCESS_TEAM_DOMAIN: lockdown.teamDomain,
              CF_ACCESS_AUD: lockdown.aud,
              AGENT_OWNER_EMAIL: allowedEmails[0]
            }
          }
        }
      },
      lockdown.ok ? 200 : 400,
      requestId
    );
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
