/**
 * Workers AI native streaming + tool-use loop.
 *
 * For `@cf/...` model ids (e.g. `@cf/moonshotai/kimi-k2.6`) we want to
 * call `env.AI.run(model, body, { stream: true })` directly instead of
 * routing through the cf-ai-gateway `/compat/chat/completions` HTTP
 * endpoint. The compat path is the source of `code:2019 "Chat completion
 * bad format"` errors — it expects `provider/model` model ids and
 * doesn't reliably handle the `@cf/...` namespace prefix.
 *
 * Implementation: wrap `runOpenAICompatibleToolStream` with a custom
 * invoker that calls `env.AI.run` and returns the resulting
 * ReadableStream. The Workers AI binding emits OpenAI-compatible SSE
 * directly (per `@cloudflare/workers-types` ≥ 2026-04), so the same
 * tool-use loop + parser works without modification.
 *
 * Optional `gateway` option still pipes through AI Gateway for
 * observability/caching/rate-limits when AI_GATEWAY_ID is set, but the
 * binding handles the routing so we never see a `/compat` URL.
 */

import { runOpenAICompatibleToolStream, type OpenAIStreamConfig } from "./openai-stream";
import type { LoopEvent, ToolLoopConfig } from "./tool-stream-types";

interface WorkersAiBinding {
  run(
    model: string,
    input: unknown,
    options?: { stream?: boolean; gateway?: { id: string }; [k: string]: unknown }
  ): Promise<unknown>;
}

const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.6";

export async function* runWorkersAiToolStream(
  config: ToolLoopConfig
): AsyncGenerator<LoopEvent, void, unknown> {
  const ai = config.env.AI as unknown as WorkersAiBinding | undefined;
  if (!ai) {
    yield {
      kind: "error",
      message:
        "env.AI binding missing — Workers AI streaming requires the [ai] binding in wrangler.toml",
      code: "E_WORKERS_AI_BINDING"
    };
    return;
  }

  const model = config.model ?? DEFAULT_MODEL;

  // Optional AI Gateway routing for observability. Doesn't change the
  // URL we hit (binding handles that); just adds gateway-side logging.
  const gatewayId = config.env.AI_GATEWAY_ID;

  const oaConfig: OpenAIStreamConfig = {
    ...config,
    model,
    providerLabel: "workers-ai",
    customInvoke: async (body) => {
      try {
        // env.AI.run with stream:true returns a ReadableStream<Uint8Array>
        // formatted as OpenAI-compatible SSE. We pipe straight into the
        // tool-loop's parser; no body transformation needed.
        const aiOptions: Record<string, unknown> = { stream: true };
        if (gatewayId) aiOptions.gateway = { id: gatewayId };

        const result = await ai.run(model, body, aiOptions);
        if (!result || typeof (result as ReadableStream).getReader !== "function") {
          return {
            ok: false,
            error: `env.AI.run returned non-stream result for ${model} (got ${typeof result}). The model may not support streaming.`
          };
        }
        return { ok: true, stream: result as ReadableStream<Uint8Array> };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    }
  };

  yield* runOpenAICompatibleToolStream(oaConfig);
}
