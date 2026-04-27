import { describe, expect, it, vi } from "vitest";
import {
  runAnthropicToolStream,
  parseAnthropicSse,
  type LoopEvent
} from "../src/anthropic-stream";
import type { SkillDefinition } from "../src/core/skills";

function sseStream(frames: Array<{ event: string; data: Record<string, unknown> }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        const payload = `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }
      controller.close();
    }
  });
}

describe("parseAnthropicSse", () => {
  it("parses interleaved events", async () => {
    const body = sseStream([
      { event: "message_start", data: { type: "message_start" } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "message_stop", data: { type: "message_stop" } }
    ]);

    const collected = [];
    for await (const evt of parseAnthropicSse(body)) {
      collected.push((evt as { type: string }).type);
    }
    expect(collected).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_stop"
    ]);
  });
});

describe("runAnthropicToolStream", () => {
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

  const deleteSkill: SkillDefinition = {
    id: "artifacts-create-repo",
    name: "Create repo",
    description: "Create repo",
    pluginId: "artifacts",
    action: "create-repo",
    tags: ["artifacts"],
    dangerous: true
  };

  it("yields text deltas and end-turn when model replies with only text", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        sseStream([
          { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" } } },
          { event: "message_stop", data: { type: "message_stop" } }
        ])
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const events: LoopEvent[] = [];
      for await (const e of runAnthropicToolStream({
        env: { ANTHROPIC_API_KEY: "sk-test", ENABLED_PLUGINS: "anthropic", ALLOWED_HOSTS: "api.anthropic.com" },
        runtime: fakeRuntime(async () => ({ ok: true })),
        skillList: [healthSkill],
        systemPrompt: "test",
        messages: [],
        userContent: "hi",
        mode: "auto"
      })) {
        events.push(e);
      }

      const deltas = events.filter((e) => e.kind === "text-delta");
      expect(deltas).toHaveLength(2);
      const finalText = events.find((e) => e.kind === "loop-done");
      expect(finalText).toBeDefined();
      expect((finalText as { finalText: string }).finalText).toBe("Hello world");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("executes a safe tool, feeds the result back, and continues the loop", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          sseStream([
            { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "admin-health-check" } } },
            { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } } },
            { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
            { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" } } },
            { event: "message_stop", data: { type: "message_stop" } }
          ])
        );
      }
      return new Response(
        sseStream([
          { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "all healthy" } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" } } },
          { event: "message_stop", data: { type: "message_stop" } }
        ])
      );
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const events: LoopEvent[] = [];
      const runtimeInvoke = vi.fn(async () => ({ ok: true, data: { healthy: true } }));
      for await (const e of runAnthropicToolStream({
        env: { ANTHROPIC_API_KEY: "sk-test", ENABLED_PLUGINS: "anthropic,admin", ALLOWED_HOSTS: "api.anthropic.com" },
        runtime: fakeRuntime(runtimeInvoke),
        skillList: [healthSkill],
        systemPrompt: "test",
        messages: [],
        userContent: "how are we?",
        mode: "auto"
      })) {
        events.push(e);
      }

      const toolResults = events.filter((e) => e.kind === "tool-result");
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as { skill: string }).skill).toBe("admin-health-check");
      expect((toolResults[0] as { ok: boolean }).ok).toBe(true);
      expect(call).toBe(2); // two provider calls — one per turn
      const loopDone = events.find((e) => e.kind === "loop-done");
      expect((loopDone as { finalText: string }).finalText).toBe("all healthy");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("holds a dangerous skill in selective mode without invoking it", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        sseStream([
          { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "artifacts-create-repo" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"name\":\"x\"}" } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" } } },
          { event: "message_stop", data: { type: "message_stop" } }
        ])
      )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const events: LoopEvent[] = [];
      const runtimeInvoke = vi.fn(async () => ({ ok: true }));
      for await (const e of runAnthropicToolStream({
        env: { ANTHROPIC_API_KEY: "sk-test", ENABLED_PLUGINS: "anthropic,artifacts", ALLOWED_HOSTS: "api.anthropic.com" },
        runtime: fakeRuntime(runtimeInvoke),
        skillList: [deleteSkill],
        systemPrompt: "test",
        messages: [],
        userContent: "create",
        mode: "selective"
      })) {
        events.push(e);
      }

      const held = events.find((e) => e.kind === "tool-held");
      expect(held).toBeDefined();
      expect((held as { skill: string }).skill).toBe("artifacts-create-repo");
      expect(runtimeInvoke).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("errors cleanly when the API key is missing", async () => {
    const events: LoopEvent[] = [];
    for await (const e of runAnthropicToolStream({
      env: { ENABLED_PLUGINS: "anthropic", ALLOWED_HOSTS: "api.anthropic.com" },
      runtime: { invoke: vi.fn(), listPlugins: () => [], config: {} } as never,
      skillList: [],
      systemPrompt: "test",
      messages: [],
      userContent: "hi"
    })) {
      events.push(e);
    }
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("error");
  });
});
