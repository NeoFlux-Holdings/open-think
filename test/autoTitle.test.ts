import { describe, expect, it, vi } from "vitest";
import { generateChatTitle } from "../src/autoTitle";
import type { Env } from "../src/types";

/** Build a minimal Env with `AI.run` overridden by the supplied stub. */
function envWithAi(run: (model: string, input: unknown, opts?: unknown) => Promise<unknown>): Env {
  return {
    AI: { run } as unknown as Env["AI"]
  } as unknown as Env;
}

describe("generateChatTitle", () => {
  it("returns null when env.AI binding is missing (zero-key fallback)", async () => {
    const r = await generateChatTitle({} as Env, "hello", "hi back");
    expect(r).toBeNull();
  });

  it("returns null when the user message is empty", async () => {
    const run = vi.fn();
    const r = await generateChatTitle(envWithAi(run), "   ", "ignored");
    expect(r).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("extracts and cleans a title from a typical Workers AI {response} envelope", async () => {
    const run = vi.fn(async () => ({ response: "Debug chat 2019 error" }));
    const r = await generateChatTitle(
      envWithAi(run),
      "still failing with code 2019",
      "let me check the gateway logs..."
    );
    expect(r).toBe("Debug chat 2019 error");
  });

  it("strips surrounding quotes the model often adds despite the prompt", async () => {
    const run = vi.fn(async () => ({ response: '"Plan deploy form rewrite"' }));
    const r = await generateChatTitle(envWithAi(run), "rewrite the deploy form", "ok");
    expect(r).toBe("Plan deploy form rewrite");
  });

  it("strips a 'Title:' preamble", async () => {
    const run = vi.fn(async () => ({ response: "Title: Sandbox migration plan" }));
    const r = await generateChatTitle(envWithAi(run), "let's migrate to sandbox", "ok");
    expect(r).toBe("Sandbox migration plan");
  });

  it("strips trailing period", async () => {
    const run = vi.fn(async () => ({ response: "Configure OpenRouter key." }));
    const r = await generateChatTitle(envWithAi(run), "set up openrouter", "ok");
    expect(r).toBe("Configure OpenRouter key");
  });

  it("trims to first newline (model sometimes adds explanation after)", async () => {
    const run = vi.fn(async () => ({
      response: "Fix shell websocket\n\nThis title summarizes the user's question about the shell."
    }));
    const r = await generateChatTitle(envWithAi(run), "shell ws is broken", "let me check");
    expect(r).toBe("Fix shell websocket");
  });

  it("supports the OpenAI-style choices[0].message.content envelope", async () => {
    const run = vi.fn(async () => ({
      choices: [{ message: { content: "Pull upstream latest" } }]
    }));
    const r = await generateChatTitle(envWithAi(run), "pull from upstream", "ok");
    expect(r).toBe("Pull upstream latest");
  });

  it("rejects too-short outputs (model echoed empty)", async () => {
    const run = vi.fn(async () => ({ response: "  ?" }));
    const r = await generateChatTitle(envWithAi(run), "hello", "hi");
    expect(r).toBeNull();
  });

  it("rejects prompt-echo outputs (model repeated the instruction)", async () => {
    const run = vi.fn(async () => ({
      response: "Generate a 4-6 word title for this conversation"
    }));
    const r = await generateChatTitle(envWithAi(run), "x", "y");
    expect(r).toBeNull();
  });

  it("caps overly-long titles at 80 chars", async () => {
    const longTitle = "This is an unreasonably long title that the model produced because it ignored the word-count limit completely and kept generating";
    const run = vi.fn(async () => ({ response: longTitle }));
    const r = await generateChatTitle(envWithAi(run), "x", "y");
    expect(r).not.toBeNull();
    expect(r!.length).toBeLessThanOrEqual(80);
  });

  it("returns null when env.AI.run throws (transient model error)", async () => {
    const run = vi.fn(async () => {
      throw new Error("model unavailable");
    });
    const r = await generateChatTitle(envWithAi(run), "x", "y");
    expect(r).toBeNull();
  });

  it("uses HELM_AUTOTITLE_MODEL override when set", async () => {
    const run = vi.fn(async () => ({ response: "OK" }));
    await generateChatTitle(
      {
        AI: { run } as unknown as Env["AI"],
        HELM_AUTOTITLE_MODEL: "@cf/some/other-model"
      } as unknown as Env,
      "hi",
      "yo"
    );
    expect(run).toHaveBeenCalledOnce();
    const callArgs = run.mock.calls[0] as unknown as [string, unknown, unknown];
    expect(callArgs[0]).toBe("@cf/some/other-model");
  });

  it("forwards AI_GATEWAY_ID via the binding's gateway option", async () => {
    const run = vi.fn(async () => ({ response: "Test gateway forwarding" }));
    await generateChatTitle(
      {
        AI: { run } as unknown as Env["AI"],
        AI_GATEWAY_ID: "my-gateway"
      } as unknown as Env,
      "hi",
      "yo"
    );
    const callArgs = run.mock.calls[0] as unknown as [string, unknown, { gateway?: { id: string } } | undefined];
    expect(callArgs[2]?.gateway?.id).toBe("my-gateway");
  });

  it("truncates very long inputs before calling the model", async () => {
    const huge = "x".repeat(5000);
    const run = vi.fn(async () => ({ response: "fine" }));
    await generateChatTitle(envWithAi(run), huge, huge);
    const callArgs = run.mock.calls[0] as unknown as [string, { messages: Array<{ content: string }> }, unknown];
    // System + user message; user message contains both trimmed inputs.
    const userContent = callArgs[1].messages[1].content;
    // 500 (user) + 800 (assistant) + scaffolding ≈ ~1400 max.
    expect(userContent.length).toBeLessThan(1700);
  });
});
