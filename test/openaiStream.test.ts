import { describe, expect, it, vi } from "vitest";
import {
  runOpenAICompatibleToolStream,
  parseOpenAISse
} from "../src/openai-stream";
import type { LoopEvent } from "../src/tool-stream-types";
import type { SkillDefinition } from "../src/core/skills";

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

describe("parseOpenAISse", () => {
  it("parses multiple data frames and honors [DONE] sentinel", async () => {
    const body = sseStream([
      chunk({ choices: [{ delta: { content: "a" } }] }),
      chunk({ choices: [{ delta: { content: "b" } }] }),
      "data: [DONE]\n\n"
    ]);
    const frames: unknown[] = [];
    for await (const frame of parseOpenAISse(body)) frames.push(frame);
    expect(frames).toHaveLength(2);
  });
});

describe("runOpenAICompatibleToolStream", () => {
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

  const dangerousSkill: SkillDefinition = {
    id: "artifacts-create-repo",
    name: "Create repo",
    description: "Create repo",
    pluginId: "artifacts",
    action: "create-repo",
    tags: ["artifacts"],
    dangerous: true
  };

  it("yields text deltas and end-turn when the model replies with only text", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        sseStream([
          chunk({ choices: [{ delta: { content: "Hello " } }] }),
          chunk({ choices: [{ delta: { content: "world" } }] }),
          chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          "data: [DONE]\n\n"
        ])
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const events: LoopEvent[] = [];
      for await (const e of runOpenAICompatibleToolStream({
        env: { ENABLED_PLUGINS: "openai-compatible", ALLOWED_HOSTS: "api.groq.com" },
        runtime: fakeRuntime(async () => ({ ok: true })),
        skillList: [healthSkill],
        systemPrompt: "test",
        messages: [],
        userContent: "hi",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b",
        mode: "auto"
      })) {
        events.push(e);
      }

      const deltas = events.filter((e) => e.kind === "text-delta");
      expect(deltas.map((d) => (d as { text: string }).text)).toEqual(["Hello ", "world"]);
      const loopDone = events.find((e) => e.kind === "loop-done");
      expect((loopDone as { finalText: string }).finalText).toBe("Hello world");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accumulates tool_call arguments across chunks and executes the tool", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          sseStream([
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
                {
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: "{}" } }]
                  }
                }
              ]
            }),
            chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
            "data: [DONE]\n\n"
          ])
        );
      }
      return new Response(
        sseStream([
          chunk({ choices: [{ delta: { content: "all healthy" } }] }),
          chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          "data: [DONE]\n\n"
        ])
      );
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const runtimeInvoke = vi.fn(async () => ({ ok: true, data: { healthy: true } }));
      const events: LoopEvent[] = [];
      for await (const e of runOpenAICompatibleToolStream({
        env: { ENABLED_PLUGINS: "openai-compatible,admin", ALLOWED_HOSTS: "api.groq.com" },
        runtime: fakeRuntime(runtimeInvoke),
        skillList: [healthSkill],
        systemPrompt: "test",
        messages: [],
        userContent: "how are we?",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b",
        mode: "auto"
      })) {
        events.push(e);
      }

      expect(call).toBe(2);
      const start = events.find((e) => e.kind === "tool-use-start");
      expect((start as { name: string }).name).toBe("admin-health-check");
      const stop = events.find((e) => e.kind === "tool-use-stop");
      expect((stop as { input: unknown }).input).toEqual({});
      const result = events.find((e) => e.kind === "tool-result");
      expect((result as { ok: boolean }).ok).toBe(true);
      expect(runtimeInvoke).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("holds dangerous skills in selective mode without calling runtime.invoke", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        sseStream([
          chunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", type: "function", function: { name: "artifacts-create-repo", arguments: "{\"name\":\"x\"}" } }
                  ]
                }
              }
            ]
          }),
          chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
          "data: [DONE]\n\n"
        ])
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const runtimeInvoke = vi.fn(async () => ({ ok: true }));
      const events: LoopEvent[] = [];
      for await (const e of runOpenAICompatibleToolStream({
        env: { ENABLED_PLUGINS: "openai-compatible,artifacts", ALLOWED_HOSTS: "api.groq.com" },
        runtime: fakeRuntime(runtimeInvoke),
        skillList: [dangerousSkill],
        systemPrompt: "test",
        messages: [],
        userContent: "create",
        baseUrl: "https://api.groq.com/openai/v1",
        mode: "selective"
      })) {
        events.push(e);
      }

      const held = events.find((e) => e.kind === "tool-held");
      expect(held).toBeDefined();
      expect(runtimeInvoke).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends extra headers (e.g. cf-aig-authorization)", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["cf-aig-authorization"]).toBe("Bearer gw-token");
      return new Response(
        sseStream([
          chunk({ choices: [{ delta: { content: "ok" } }] }),
          chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          "data: [DONE]\n\n"
        ])
      );
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const events: LoopEvent[] = [];
      for await (const e of runOpenAICompatibleToolStream({
        env: { ENABLED_PLUGINS: "cf-ai-gateway", ALLOWED_HOSTS: "gateway.ai.cloudflare.com" },
        runtime: fakeRuntime(async () => ({ ok: true })),
        skillList: [],
        systemPrompt: "test",
        messages: [],
        userContent: "hi",
        baseUrl: "https://gateway.ai.cloudflare.com/v1/acct/gw/compat",
        extraHeaders: { "cf-aig-authorization": "Bearer gw-token" },
        model: "anthropic/claude-haiku-4-5"
      })) {
        events.push(e);
      }
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
