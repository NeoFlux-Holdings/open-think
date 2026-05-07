import { describe, expect, it, vi } from "vitest";
import { runWorkersAiToolStream } from "../src/workers-ai-stream";
import type { LoopEvent } from "../src/tool-stream-types";
import type { SkillDefinition } from "../src/core/skills";

/**
 * Stream a list of SSE chunks as a ReadableStream<Uint8Array>. The
 * Workers AI binding's `stream:true` mode returns this same shape, so
 * the same fixture works for both adapters.
 */
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    }
  });
}

function chunk(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function fakeRuntime(handler: (pluginId: string, req: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>) {
  return {
    invoke: vi.fn(handler),
    listPlugins: () => [],
    config: {} as never
  } as never;
}

const healthSkill: SkillDefinition = {
  id: "admin-health-check",
  name: "Health",
  description: "Check health",
  pluginId: "admin",
  action: "health-check",
  tags: ["admin"]
};

describe("runWorkersAiToolStream", () => {
  it("yields text deltas and end-turn when the binding streams plain text", async () => {
    const aiRun = vi.fn(async () =>
      sseStream([
        chunk({ choices: [{ delta: { content: "Hi " } }] }),
        chunk({ choices: [{ delta: { content: "there" } }] }),
        chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n"
      ])
    );
    const events: LoopEvent[] = [];
    for await (const e of runWorkersAiToolStream({
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: "",
        // Cast through unknown — env.AI is typed as the real Cloudflare
        // AI binding, but the runtime only calls `.run(model, body, opts)`.
        AI: { run: aiRun } as unknown as Env["AI"]
      } as unknown as Env,
      runtime: fakeRuntime(async () => ({ ok: true })),
      skillList: [healthSkill],
      systemPrompt: "test",
      messages: [],
      userContent: "hi",
      model: "@cf/moonshotai/kimi-k2.6",
      mode: "auto"
    })) {
      events.push(e);
    }

    // env.AI.run was called once (single turn, no tool calls).
    expect(aiRun).toHaveBeenCalledOnce();
    const callArgs = aiRun.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>];
    const [model, body, options] = callArgs;
    expect(model).toBe("@cf/moonshotai/kimi-k2.6");
    expect(body.stream).toBe(true);
    expect(options.stream).toBe(true);

    const deltas = events.filter((e) => e.kind === "text-delta");
    expect(deltas.map((d) => (d as { text: string }).text)).toEqual(["Hi ", "there"]);
    const loopDone = events.find((e) => e.kind === "loop-done");
    expect((loopDone as { finalText: string }).finalText).toBe("Hi there");
  });

  it("includes the gateway:{id} option when AI_GATEWAY_ID is set", async () => {
    // Customers who DID provision an AI Gateway still get observability
    // (logs, caching) — we just route through the binding's gateway
    // option instead of the broken `/compat` URL.
    const aiRun = vi.fn(async () =>
      sseStream([
        chunk({ choices: [{ delta: { content: "ok" } }] }),
        chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n"
      ])
    );
    for await (const _ of runWorkersAiToolStream({
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: "",
        AI_GATEWAY_ID: "my-gateway",
        AI: { run: aiRun } as unknown as Env["AI"]
      } as unknown as Env,
      runtime: fakeRuntime(async () => ({ ok: true })),
      skillList: [],
      systemPrompt: "test",
      messages: [],
      userContent: "hi"
    })) {
      void _;
    }
    const callArgs = aiRun.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>];
    expect(callArgs[2]).toMatchObject({ stream: true, gateway: { id: "my-gateway" } });
  });

  it("yields a clean error event when env.AI binding is missing", async () => {
    const events: LoopEvent[] = [];
    for await (const e of runWorkersAiToolStream({
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: ""
        // No AI binding.
      } as unknown as Env,
      runtime: fakeRuntime(async () => ({ ok: true })),
      skillList: [],
      systemPrompt: "test",
      messages: [],
      userContent: "hi"
    })) {
      events.push(e);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error", code: "E_WORKERS_AI_BINDING" });
  });

  it("surfaces env.AI.run thrown errors as workers-ai error events", async () => {
    // Workers AI itself throws (network glitch, model unavailable). The
    // adapter must NOT crash the whole loop — yield an error event with
    // the workers-ai prefix so the conductor's catch path still works.
    const aiRun = vi.fn(async () => {
      throw new Error("model temporarily unavailable");
    });
    const events: LoopEvent[] = [];
    for await (const e of runWorkersAiToolStream({
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: "",
        AI: { run: aiRun } as unknown as Env["AI"]
      } as unknown as Env,
      runtime: fakeRuntime(async () => ({ ok: true })),
      skillList: [],
      systemPrompt: "test",
      messages: [],
      userContent: "hi"
    })) {
      events.push(e);
    }
    const err = events.find((e) => e.kind === "error");
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toMatch(/workers-ai.*temporarily unavailable/);
  });

  it("accumulates tool_call arguments across chunks and executes the tool", async () => {
    // Same shape as openai-stream's tool-use test — proves the
    // customInvoke path inherits the full tool loop.
    let call = 0;
    const aiRun = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return sseStream([
          chunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", type: "function", function: { name: "admin-health-check", arguments: "" } }
                  ]
                }
              }
            ]
          }),
          chunk({
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }
            ]
          }),
          chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
          "data: [DONE]\n\n"
        ]);
      }
      return sseStream([
        chunk({ choices: [{ delta: { content: "all healthy" } }] }),
        chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n"
      ]);
    });
    const runtimeInvoke = vi.fn(async () => ({ ok: true, data: { healthy: true } }));
    const events: LoopEvent[] = [];
    for await (const e of runWorkersAiToolStream({
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: "",
        AI: { run: aiRun } as unknown as Env["AI"]
      } as unknown as Env,
      runtime: fakeRuntime(runtimeInvoke),
      skillList: [healthSkill],
      systemPrompt: "test",
      messages: [],
      userContent: "how are we?",
      mode: "auto"
    })) {
      events.push(e);
    }
    expect(call).toBe(2);
    const start = events.find((e) => e.kind === "tool-use-start");
    expect((start as { name: string }).name).toBe("admin-health-check");
    const result = events.find((e) => e.kind === "tool-result");
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(runtimeInvoke).toHaveBeenCalledOnce();
  });
});

// Placeholder import to satisfy the `Env` type cast above. The real
// type comes from `../src/types`; we re-import here so vitest resolves it.
import type { Env } from "../src/types";
