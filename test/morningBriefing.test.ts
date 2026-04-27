/**
 * Morning briefing — prompt + extractor tests.
 *
 * The risk: Helm runs in propose mode, which permits `open-think-action`
 * fenced blocks. If the model emits ONLY action blocks the existing
 * stripActionBlocks code returns "(no prose reply; see proposed actions)" —
 * which would land in the email body. Bad UX, scary for the owner.
 *
 * These tests pin two contracts:
 *   1. The prompt (`buildBriefingPrompt`) carries the "prose only,
 *      no action blocks" instructions in three places — top, middle, end.
 *   2. The extractor (`extractBriefText`) replaces Helm's placeholder with
 *      a calm fallback so the email never reads like a debug dump.
 */
import { describe, expect, it } from "vitest";
import {
  buildBriefingPrompt,
  extractBriefText
} from "../src/workflows/morningBriefing";

describe("buildBriefingPrompt", () => {
  const empty = { ok: true, summary: "{}" };

  it("includes the prose-only constraint at least three times", () => {
    const prompt = buildBriefingPrompt({ inbox: empty, projects: empty });
    const matches = prompt.match(/prose only|action blocks|do not propose/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("forbids open-think-action blocks explicitly", () => {
    const prompt = buildBriefingPrompt({ inbox: empty, projects: empty });
    expect(prompt).toMatch(/`open-think-action`/);
  });

  it("forbids tool/skill calls", () => {
    const prompt = buildBriefingPrompt({ inbox: empty, projects: empty });
    expect(prompt).toMatch(/DO NOT call any skills, tools, or APIs/);
  });

  it("includes word-count + tone guidance", () => {
    const prompt = buildBriefingPrompt({ inbox: empty, projects: empty });
    expect(prompt).toMatch(/120.180 words/);
    expect(prompt).toMatch(/Second person/);
  });

  it("embeds the supplied data as JSON, truncated", () => {
    const prompt = buildBriefingPrompt({
      inbox: { ok: true, summary: "x".repeat(20) },
      projects: { ok: true, summary: "y".repeat(20) }
    });
    expect(prompt).toMatch(/"inbox"/);
    expect(prompt).toMatch(/"projects"/);
  });

  it("hard-caps the data section to keep the model in budget", () => {
    const huge = { ok: true, summary: "z".repeat(20000) };
    const prompt = buildBriefingPrompt({ inbox: huge, projects: huge });
    // 8000 cap on the JSON section + ~600 chars of instructions ≈ <10000 total.
    expect(prompt.length).toBeLessThan(10_000);
  });
});

describe("extractBriefText", () => {
  it("returns the prose unchanged when Helm replied with prose", () => {
    expect(extractBriefText("Good morning, Tom — your build shipped.")).toBe(
      "Good morning, Tom — your build shipped."
    );
  });

  it("trims surrounding whitespace", () => {
    expect(extractBriefText("\n\n  Hi.  \n")).toBe("Hi.");
  });

  it("falls back when Helm emitted only action blocks", () => {
    expect(extractBriefText("(no prose reply; see proposed actions)")).toBe(
      "Morning brief unavailable — check inbox manually."
    );
  });

  it("falls back on null / undefined / empty", () => {
    const fb = "Morning brief unavailable — check inbox manually.";
    expect(extractBriefText(undefined)).toBe(fb);
    expect(extractBriefText(null)).toBe(fb);
    expect(extractBriefText("")).toBe(fb);
    expect(extractBriefText("   \n  ")).toBe(fb);
  });
});
