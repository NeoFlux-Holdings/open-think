import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";
import {
  enforceSpendingCap,
  getCostRange,
  getDailyCost,
  rollupAiGatewayCosts
} from "../costTracking";

const CATALOG: Array<{
  intent: string;
  suggest: string[];
  needs: string[];
  notes: string;
}> = [
  {
    intent: "chat with a model",
    suggest: ["workers-ai"],
    needs: ["env.AI binding"],
    notes: "Free tier available; add AI_GATEWAY_ID to enable caching + analytics."
  },
  {
    intent: "chat with Claude directly",
    suggest: ["anthropic"],
    needs: ["ANTHROPIC_API_KEY"],
    notes: "Also add api.anthropic.com to ALLOWED_HOSTS."
  },
  {
    intent: "chat with Groq / Together / Ollama / any OpenAI-compatible endpoint",
    suggest: ["openai-compatible"],
    needs: ["OPENAI_COMPATIBLE_URL", "OPENAI_COMPATIBLE_KEY (usually)"],
    notes: "Add the endpoint hostname to ALLOWED_HOSTS."
  },
  {
    intent: "call external MCP tool servers",
    suggest: ["mcp-client"],
    needs: ["MCP_DEFAULT_URL or per-call serverUrl"],
    notes: "For Cloudflare MCP use https://mcp.cloudflare.com/mcp and add it to ALLOWED_HOSTS."
  },
  {
    intent: "operate the user's Cloudflare account",
    suggest: ["cloudflare-api-mcp", "mcp-client"],
    needs: ["CLOUDFLARE_API_TOKEN scoped to the least privilege needed"],
    notes: "Pair with MCP_DEFAULT_URL=https://mcp.cloudflare.com/mcp for full Helm-style control."
  },
  {
    intent: "fetch web pages / screenshot / scrape",
    suggest: ["browser"],
    needs: ["env.BROWSER binding via `[browser]` in wrangler.toml"],
    notes: "Counts as tier-3 execution in the Project Think ladder."
  },
  {
    intent: "run arbitrary shell / compile code",
    suggest: ["sandbox"],
    needs: ["SANDBOX service binding to a companion Sandbox Worker"],
    notes: "Tier-4 execution; review capability scoping before enabling in production."
  },
  {
    intent: "store artifacts (git-for-agents)",
    suggest: ["artifacts"],
    needs: ["env.ARTIFACTS binding"],
    notes: "Use when the agent needs durable git-like repo state."
  }
];

function matchIntent(goal: string) {
  const normalized = goal.toLowerCase();
  return CATALOG.filter((entry) =>
    entry.intent
      .toLowerCase()
      .split(/[\s,/]+/)
      .some((word) => word.length > 3 && normalized.includes(word))
  );
}

export class AdminPlugin implements AgentPlugin {
  readonly id = "admin";
  readonly version = "0.1.0";
  readonly description = "Runtime introspection and setup guidance for Helm (the meta-agent)";
  readonly capabilities = ["admin", "tools"] as const;

  private ctx?: PluginContext;
  private env?: Env;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.runtime) {
      throw new Error("admin plugin requires runtime introspection handle");
    }
    this.ctx = context;
    this.env = context.env;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx?.runtime) {
      return { ok: false, error: "Plugin not initialized" };
    }

    if (action === "introspect") {
      return {
        ok: true,
        data: {
          plugins: this.ctx.runtime.listPlugins(),
          config: this.ctx.runtime.getConfigSnapshot()
        }
      };
    }

    if (action === "suggest-plugins") {
      const goal =
        input && typeof input === "object"
          ? String((input as Record<string, unknown>).goal ?? "")
          : "";
      if (!goal) {
        return { ok: false, error: "input.goal (string) is required" };
      }
      const matches = matchIntent(goal);
      return {
        ok: true,
        data: {
          goal,
          suggestions: matches.length > 0 ? matches : CATALOG
        }
      };
    }

    if (action === "env-template") {
      const plugins = this.ctx.runtime.listPlugins().map((p) => p.id);
      const snapshot = this.ctx.runtime.getConfigSnapshot();
      const template: string[] = [
        `# Generated ${new Date().toISOString()}`,
        `ENABLED_PLUGINS=${snapshot.enabledPlugins.join(",")}`,
        `ALLOWED_HOSTS=${snapshot.allowedHosts.join(",")}`,
        `MODEL_DEFAULT=${snapshot.modelDefault}`
      ];
      if (plugins.includes("workers-ai") && !snapshot.hasAiGateway) {
        template.push("# AI_GATEWAY_ID=your-gateway-id");
      }
      if (plugins.includes("anthropic") && !snapshot.hasAnthropicKey) {
        template.push("# ANTHROPIC_API_KEY=sk-ant-...");
      }
      if (plugins.includes("openai-compatible") && !snapshot.hasOpenAICompatible) {
        template.push("# OPENAI_COMPATIBLE_URL=https://api.groq.com/openai/v1");
        template.push("# OPENAI_COMPATIBLE_KEY=...");
      }
      if (plugins.includes("mcp-client") && !snapshot.hasMcpDefault) {
        template.push("# MCP_DEFAULT_URL=https://mcp.cloudflare.com/mcp");
      }
      if (plugins.includes("cloudflare-api-mcp") && !snapshot.hasCloudflareToken) {
        template.push("# CLOUDFLARE_API_TOKEN=...");
      }
      return { ok: true, data: { dotenv: template.join("\n") } };
    }

    if (action === "health-check") {
      const plugins = this.ctx.runtime.listPlugins();
      const snapshot = this.ctx.runtime.getConfigSnapshot();
      const issues: string[] = [];
      if (plugins.some((p) => p.id === "cloudflare-api-mcp") && !snapshot.hasCloudflareToken) {
        issues.push("cloudflare-api-mcp enabled but no CLOUDFLARE_API_TOKEN/AGENT_TOKEN present");
      }
      if (plugins.some((p) => p.id === "anthropic") && !snapshot.hasAnthropicKey) {
        issues.push("anthropic enabled but ANTHROPIC_API_KEY missing");
      }
      if (plugins.some((p) => p.id === "openai-compatible") && !snapshot.hasOpenAICompatible) {
        issues.push("openai-compatible enabled but OPENAI_COMPATIBLE_URL missing");
      }
      return {
        ok: true,
        data: {
          plugins: plugins.length,
          enabled: snapshot.enabledPlugins,
          issues,
          healthy: issues.length === 0
        }
      };
    }

    if (action === "cost-today") {
      if (!this.env) return { ok: false, error: "env unavailable" };
      const rows = await getDailyCost(this.env);
      const totalUsd = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const totalTokens = rows.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
      return { ok: true, data: { day: rows[0]?.day ?? new Date().toISOString().slice(0, 10), totalUsd, totalTokens, byProvider: rows } };
    }

    if (action === "cost-range") {
      if (!this.env) return { ok: false, error: "env unavailable" };
      const inObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const start = typeof inObj.start === "string" ? inObj.start : "";
      const end = typeof inObj.end === "string" ? inObj.end : "";
      if (!start || !end) return { ok: false, error: "start and end (YYYY-MM-DD) required" };
      const rows = await getCostRange(this.env, start, end);
      const totalUsd = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      return { ok: true, data: { start, end, totalUsd, rowCount: rows.length, rows } };
    }

    if (action === "cost-cap") {
      if (!this.env) return { ok: false, error: "env unavailable" };
      const r = await enforceSpendingCap(this.env);
      return { ok: true, data: r };
    }

    if (action === "cost-rollup") {
      if (!this.env) return { ok: false, error: "env unavailable" };
      const r = await rollupAiGatewayCosts(this.env);
      return { ok: r.ok, data: r };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
