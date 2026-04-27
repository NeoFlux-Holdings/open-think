/**
 * Morning briefing — the killer PA flow.
 *
 * Fired by a Workers Cron Trigger (e.g. `55 12 * * *` = 07:55 ET = 12:55 UTC).
 * Pulls:
 *   1. Inbox: unread email since yesterday 18:00 local (via `email-inbox`)
 *   2. Memory: "ongoing projects" facts (via `memory-recall`)
 *   3. Cloudflare MCP: any queued infra tasks flagged "today" (if wired)
 * Composes a 120–180 word brief via Helm in propose-mode-free prose, then
 * `notify-user` via email.
 *
 * Registered with the scheduler as handler id `morning-briefing`.
 *
 * This is implemented as a **Cloudflare Workflow** so the individual steps
 * (fetch inbox, synthesize, send) are each durable + retried independently
 * on transient failures. If the LLM call flakes, only that step retries —
 * we don't duplicate the email send.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../types";
import { AgentRuntime } from "../core/runtime";
import { SkillManager } from "../core/skills";
import { getPlugins } from "../plugins/registry";
import { handleConductorMessage } from "../conductor";
import { registerWorkflow } from "../scheduler";

export interface MorningBriefingParams {
  timezone?: string;
  since?: string; // ISO timestamp; default: yesterday 18:00
  channel?: "email" | "web-push" | "log";
}

/**
 * The prompt sent to Helm in propose mode. Exported so tests can assert it
 * carries the prose-only constraint (otherwise the model can emit
 * `open-think-action` blocks and the email body becomes the fallback string).
 *
 * The constraints are deliberately repeated — propose mode ALLOWS action
 * blocks by default; a single instruction at the top is easy for a model to
 * miss when the data section is long. We say it three times.
 */
export function buildBriefingPrompt(input: {
  inbox: { ok: boolean; summary: string };
  projects: { ok: boolean; summary: string };
}): string {
  return [
    "You are writing the body of a morning email to the owner.",
    "",
    "STRICT OUTPUT CONSTRAINTS (the email body is the literal text you write):",
    "- Plain prose only. No markdown headings, no bullet lists, no JSON.",
    "- DO NOT emit any `open-think-action` fenced blocks. Do not propose actions.",
    "- DO NOT call any skills, tools, or APIs. This is a pure-text reply.",
    "- 120–180 words. Second person. Practical, calm tone.",
    "",
    "Cover (in order, in flowing prose):",
    "  (a) the top 1–2 emails worth acting on today, if any;",
    "  (b) today's priorities recalled from memory;",
    "  (c) one concrete next step to begin the day.",
    "",
    "If a data field is empty, say so plainly and move on — never invent items.",
    "",
    "Data (JSON, do not echo back):",
    JSON.stringify({ inbox: input.inbox, projects: input.projects }, null, 2).slice(0, 8000),
    "",
    "Reminder: prose only. Do not emit fenced action blocks."
  ].join("\n");
}

/**
 * Extract the brief text from Helm's reply. Falls back to a short, honest
 * sentence rather than the propose-mode placeholder Helm uses when its only
 * output was action blocks (which the prompt forbids but a model might still
 * try). We never want the email body to read "(no prose reply; see proposed
 * actions)".
 */
export function extractBriefText(content: string | undefined | null): string {
  const fallback = "Morning brief unavailable — check inbox manually.";
  if (typeof content !== "string") return fallback;
  const trimmed = content.trim();
  if (!trimmed) return fallback;
  // Helm's propose-mode placeholder when the model only emitted action blocks
  // and stripActionBlocks left nothing behind.
  if (trimmed.startsWith("(no prose reply")) return fallback;
  return trimmed;
}

export class MorningBriefingWorkflow extends WorkflowEntrypoint<Env, MorningBriefingParams> {
  async run(event: WorkflowEvent<MorningBriefingParams>, step: WorkflowStep): Promise<unknown> {
    const env = this.env;
    const params = event.payload ?? {};

    // --- Step 1: fetch recent email (retried independently) ---
    // Each step returns a JSON-safe shape so Workflows can persist + replay.
    const inbox = await step.do(
      "fetch-inbox",
      { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
      async (): Promise<{ ok: boolean; summary: string }> => {
        const runtime = await AgentRuntime.bootstrap(env, getPlugins());
        const skills = new SkillManager(runtime);
        const since = params.since ?? new Date(Date.now() - 14 * 3600 * 1000).toISOString();
        const r = await skills.invoke("email-inbox", { input: { since, limit: 25 } });
        return { ok: Boolean(r.ok), summary: JSON.stringify(r).slice(0, 4000) };
      }
    );

    // --- Step 2: recall ongoing projects from memory ---
    const projects = await step.do(
      "recall-projects",
      { retries: { limit: 2, delay: "5 seconds" } },
      async (): Promise<{ ok: boolean; summary: string }> => {
        const runtime = await AgentRuntime.bootstrap(env, getPlugins());
        const skills = new SkillManager(runtime);
        const r = await skills.invoke("memory-recall", {
          input: { query: "ongoing projects and priorities" }
        });
        return { ok: Boolean(r.ok), summary: JSON.stringify(r).slice(0, 4000) };
      }
    );

    // --- Step 3: synthesize via Helm ---
    const brief = await step.do(
      "synthesize",
      { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } },
      async (): Promise<{ text: string }> => {
        const runtime = await AgentRuntime.bootstrap(env, getPlugins());
        const skills = new SkillManager(runtime);
        const content = buildBriefingPrompt({ inbox, projects });
        const reply = await handleConductorMessage(env, runtime, skills, {
          sessionName: `briefing:${new Date().toISOString().slice(0, 10)}`,
          content,
          mode: "propose"
        });
        const text = extractBriefText(reply.assistantMessage?.content);
        return { text };
      }
    );

    // --- Step 4: send via notifier ---
    await step.do(
      "send",
      { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } },
      async (): Promise<{ ok: boolean; channel: string }> => {
        const runtime = await AgentRuntime.bootstrap(env, getPlugins());
        const skills = new SkillManager(runtime);
        const r = await skills.invoke("notify-user", {
          input: {
            title: "Morning brief",
            body: brief.text,
            channel: params.channel ?? "email",
            url: "https://beta.open-think.app/app#/briefing"
          }
        });
        return { ok: Boolean(r.ok), channel: params.channel ?? "email" };
      }
    );

    return { ok: true, sentAt: new Date().toISOString() };
  }
}

/* ---------------- Scheduler adapter ---------------- */

/**
 * When the scheduler fires the `morning-briefing` handler, it triggers the
 * Workflow instance rather than running inline — this gives us durable
 * retries for each step.
 */
registerWorkflow("morning-briefing", async (env, _runtime, skills, params, firing) => {
  const workflowBinding = (env as Env & { BRIEFING_WORKFLOW?: { create: (input: { id: string; params: unknown }) => Promise<unknown> } })
    .BRIEFING_WORKFLOW;
  if (workflowBinding) {
    const id = `briefing-${new Date().toISOString().slice(0, 10)}-${firing.scheduledTime}`;
    await workflowBinding.create({ id, params });
    return { ok: true, workflowInstanceId: id };
  }
  // Fallback: run inline via the skill chain if Workflows aren't bound yet.
  void skills;
  return { ok: false, error: "BRIEFING_WORKFLOW binding not configured; add [[workflows]] in wrangler.toml." };
});
