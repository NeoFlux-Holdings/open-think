/**
 * Auto-title generation for chat sessions.
 *
 * After the first user→assistant turn completes, the /touch endpoint
 * calls this to ask a small Workers AI model for a 4-6 word title
 * summarizing what the conversation is about. The result lands in
 * `chat_sessions.title` so the left rail renders something more
 * descriptive than the truncated first message.
 *
 * Why a small Workers AI model (not the chat model):
 *   - Title gen runs after every first-turn — frequent. Smaller =
 *     cheaper + lower-latency.
 *   - The chat model might be Anthropic / OpenRouter / etc. via a
 *     paid key; using env.AI directly with a Workers AI model keeps
 *     this on the free zero-key path so customers without provider
 *     keys still get nice titles.
 *
 * Failure mode: returns null. The caller falls back to a first-
 * message slice (autoTitleFromMessage in chatSessionsApi.ts).
 */

import type { Env } from "./types";

interface WorkersAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

const DEFAULT_TITLE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const SYSTEM_PROMPT =
  "You generate concise 4-6 word titles for chat conversations. " +
  "Reply with ONLY the title. No quotes, no period at the end, no " +
  "preamble like 'Title:' or 'Sure, here's a title'.";

/**
 * Generate a chat session title from the first user message + the
 * first assistant response. Returns null when env.AI isn't bound or
 * the model errors — caller is responsible for falling back to a
 * naive slice.
 *
 * Truncates inputs aggressively (user → 500c, assistant → 800c) so we
 * don't blow the model's context budget for what's a single short
 * generation.
 */
export async function generateChatTitle(
  env: Env,
  userMessage: string,
  assistantText: string
): Promise<string | null> {
  const ai = env.AI as unknown as WorkersAiBinding | undefined;
  if (!ai) return null;
  if (!userMessage || userMessage.trim().length === 0) return null;

  const model = env.HELM_AUTOTITLE_MODEL?.trim() || DEFAULT_TITLE_MODEL;
  const userTrimmed = userMessage.replace(/\s+/g, " ").trim().slice(0, 500);
  const assistantTrimmed = (assistantText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
  const userTurnPrompt =
    `Generate a 4-6 word title for this conversation. ` +
    `Focus on what the user wants to do, not pleasantries.\n\n` +
    `User: ${userTrimmed}\n\n` +
    (assistantTrimmed ? `Assistant: ${assistantTrimmed}\n\n` : "") +
    `Title:`;

  try {
    const result = await ai.run(
      model,
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userTurnPrompt }
        ],
        max_tokens: 30,
        temperature: 0.3,
        stream: false
      },
      // Optional gateway routing for observability — same pattern as
      // workers-ai-stream.ts. Doesn't change the model choice.
      env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined
    );
    return cleanTitle(extractTitleText(result));
  } catch {
    return null;
  }
}

/**
 * Workers AI's response shape varies by model. Most chat models
 * return `{ response: "..." }`; some return the full OpenAI-style
 * `{ choices: [{ message: { content: "..." } }] }`. Probe both.
 */
function extractTitleText(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.response === "string") return r.response;
  const choices = r.choices as Array<{ message?: { content?: string } }> | undefined;
  if (Array.isArray(choices) && choices[0]?.message?.content) {
    return choices[0].message.content;
  }
  // Some models return `{output_text: "..."}` or `{result: "..."}`.
  if (typeof r.output_text === "string") return r.output_text as string;
  if (typeof r.result === "string") return r.result as string;
  return null;
}

/**
 * Strip the model's typical decorations: surrounding quotes, "Title:"
 * preambles, trailing punctuation. Cap at 80 chars so a hallucinated
 * essay doesn't blow up the rail layout. Reject obviously bad outputs
 * (empty, single character, model echoing the prompt).
 */
function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip a leading "Title:" / "Title -" / similar preamble.
  s = s.replace(/^(title|conversation title|chat title)\s*[:\-–—]\s*/i, "");
  // Strip wrapping quotes (single, double, smart).
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  // Strip trailing period (model often adds one despite the prompt).
  s = s.replace(/[.。]$/, "");
  // First newline only — model sometimes adds explanation after.
  s = s.split(/\r?\n/)[0].trim();
  // Length guards.
  if (s.length < 3) return null;
  if (s.length > 80) s = s.slice(0, 80).trimEnd();
  // Reject prompt-echo cases (e.g. "Generate a 4-6 word title").
  if (/^generate\s+a\s+\d/i.test(s)) return null;
  return s;
}
