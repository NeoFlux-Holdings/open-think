import { AppError, toAppError } from "./core/errors";
import { AgentRuntime } from "./core/runtime";
import { SkillManager } from "./core/skills";
import { emitAuditEvent } from "./core/telemetry";
import { metricsStore } from "./core/metrics";
import { evaluateErrorRateAlert, sendAlertWebhook } from "./core/alerts";
import { getPlugins } from "./plugins/registry";
import type { Env, InvokeRequest } from "./types";

function json(data: unknown, status = 200, requestId?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8"
  };

  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  return new Response(JSON.stringify(data, null, 2), { status, headers });
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

async function handler(request: Request, env: Env, requestId: string, startedAt: number): Promise<Response> {
  const url = new URL(request.url);
  const runtime = await AgentRuntime.bootstrap(env, getPlugins());
  const skills = new SkillManager(runtime);

  if (request.method === "GET" && url.pathname === "/") {
    return json({
      ok: true,
      service: "open-think",
      docs: {
        health: "GET /health",
        plugins: "GET /plugins",
        invokePlugin: "POST /invoke/{pluginId}",
        skills: "GET /skills",
        invokeSkill: "POST /skills/invoke/{skillId}",
        metrics: "GET /metrics",
        alertsCheck: "POST /alerts/check"
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, plugins: runtime.listPlugins().length, skills: skills.listSkills().length });
  }

  if (request.method === "GET" && url.pathname === "/plugins") {
    return json({ ok: true, plugins: runtime.listPlugins() });
  }

  if (request.method === "GET" && url.pathname === "/metrics") {
    return json({ ok: true, metrics: metricsStore.snapshot() }, 200, requestId);
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
    return json({ ok: true, skills: skills.listSkills() });
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
  }
};
