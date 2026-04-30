import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  parseActionBlocks,
  stripActionBlocks,
  extractAssistantText,
  buildAnthropicTools,
  buildOpenAITools,
  normalizeMode
} from "../src/conductor";
import type { SkillDefinition } from "../src/core/skills";

const skills: SkillDefinition[] = [
  {
    id: "admin-introspect",
    name: "Admin Introspect",
    description: "snapshot",
    pluginId: "admin",
    action: "introspect",
    tags: ["admin"],
    inputSchema: { type: "object", additionalProperties: false }
  },
  {
    id: "mcp-call-tool",
    name: "MCP Call Tool",
    description: "call an MCP tool",
    pluginId: "mcp-client",
    action: "call-tool",
    tags: ["mcp"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"]
    }
  }
];

describe("buildSystemPrompt", () => {
  it("lists the skill catalog and flags dangerous", () => {
    const prompt = buildSystemPrompt(skills, "auto");
    expect(prompt).toContain("admin-introspect");
    expect(prompt).toContain("mcp-call-tool [dangerous]");
    expect(prompt).toContain("AUTO");
  });

  it("switches preamble per mode", () => {
    expect(buildSystemPrompt(skills, "propose")).toContain("PROPOSE");
    expect(buildSystemPrompt(skills, "selective")).toContain("SELECTIVE");
    expect(buildSystemPrompt(skills, "auto")).toContain("AUTO");
  });

  it("notes when no skills are enabled", () => {
    expect(buildSystemPrompt([], "auto")).toContain("No skills are currently enabled");
  });
});

describe("parseActionBlocks", () => {
  it("parses multiple fenced action blocks", () => {
    const md = [
      "Here is a plan:",
      "```open-think-action",
      '{"skill": "admin-introspect", "input": {}}',
      "```",
      "And then:",
      "```open-think-action",
      '{"skill": "admin-health-check", "input": {"deep": true}}',
      "```"
    ].join("\n");
    expect(parseActionBlocks(md)).toEqual([
      { skill: "admin-introspect", input: {} },
      { skill: "admin-health-check", input: { deep: true } }
    ]);
  });

  it("ignores malformed blocks", () => {
    const md = "```open-think-action\nnot json\n```";
    expect(parseActionBlocks(md)).toEqual([]);
  });
});

describe("stripActionBlocks", () => {
  it("removes action fences", () => {
    const md = "Hello.\n```open-think-action\n{}\n```\nWorld.";
    expect(stripActionBlocks(md)).toBe("Hello.\n\nWorld.");
  });
});

describe("extractAssistantText", () => {
  it("unwraps workers-ai response shape", () => {
    expect(extractAssistantText("workers-ai", { response: "hi" })).toBe("hi");
  });

  it("unwraps anthropic content blocks", () => {
    expect(
      extractAssistantText("anthropic", {
        content: [
          { type: "text", text: "part a " },
          { type: "tool_use", id: "t1", name: "x", input: {} },
          { type: "text", text: "part b" }
        ]
      })
    ).toBe("part a part b");
  });

  it("unwraps openai-compatible choices", () => {
    expect(
      extractAssistantText("openai-compatible", {
        response: { choices: [{ message: { content: "hello" } }] }
      })
    ).toBe("hello");
  });
});

describe("buildAnthropicTools", () => {
  it("maps skill id to tool name and uses input schema", () => {
    const tools = buildAnthropicTools(skills);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      name: "admin-introspect",
      description: "snapshot",
      input_schema: { type: "object", additionalProperties: false }
    });
    expect(tools[1].name).toBe("mcp-call-tool");
    expect(tools[1].input_schema).toMatchObject({ required: ["name"] });
  });

  it("falls back to permissive schema when none declared", () => {
    const tool = buildAnthropicTools([{ ...skills[0], inputSchema: undefined }])[0];
    expect(tool.input_schema).toEqual({ type: "object", additionalProperties: true });
  });
});

describe("buildOpenAITools", () => {
  it("wraps each skill as a function tool", () => {
    const tools = buildOpenAITools(skills);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      type: "function",
      function: { name: "admin-introspect", description: "snapshot" }
    });
    expect(tools[0].function.parameters).toMatchObject({ type: "object" });
  });
});

describe("normalizeMode", () => {
  it("plan/propose collapse to plan", () => {
    expect(normalizeMode("plan")).toBe("plan");
    expect(normalizeMode("propose")).toBe("plan");
  });
  it("execute/selective/auto/undefined collapse to execute", () => {
    expect(normalizeMode("execute")).toBe("execute");
    expect(normalizeMode("selective")).toBe("execute");
    expect(normalizeMode("auto")).toBe("execute");
    expect(normalizeMode(undefined)).toBe("execute");
    expect(normalizeMode(null)).toBe("execute");
    expect(normalizeMode("garbage")).toBe("execute");
  });
});
