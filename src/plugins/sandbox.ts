import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";

interface ExecInput {
  command: string;
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
  workdir?: string;
}

function parseExec(input: unknown): ExecInput {
  if (!input || typeof input !== "object") {
    throw new Error("input must be an object with 'command'");
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.command !== "string" || candidate.command.length === 0) {
    throw new Error("'command' must be a non-empty string");
  }
  return {
    command: candidate.command,
    args: Array.isArray(candidate.args) ? (candidate.args as string[]) : undefined,
    stdin: typeof candidate.stdin === "string" ? candidate.stdin : undefined,
    timeoutMs:
      typeof candidate.timeoutMs === "number" && candidate.timeoutMs > 0
        ? candidate.timeoutMs
        : undefined,
    workdir: typeof candidate.workdir === "string" ? candidate.workdir : undefined
  };
}

export class SandboxPlugin implements AgentPlugin {
  readonly id = "sandbox";
  readonly version = "0.1.0";
  readonly description = "Cloudflare Sandbox code execution (tier-4)";
  readonly capabilities = ["tools", "connectors"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.env.SANDBOX) {
      throw new Error(
        "sandbox plugin requires SANDBOX service binding (see wrangler.toml example)"
      );
    }
    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx?.env.SANDBOX) {
      return { ok: false, error: "Plugin not initialized" };
    }

    if (action === "status") {
      return { ok: true, data: { provider: "cloudflare-sandbox", bound: true } };
    }

    if (action === "exec") {
      try {
        const parsed = parseExec(input);
        const response = await this.ctx.env.SANDBOX.fetch("https://sandbox/exec", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed)
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, error: `Sandbox error ${response.status}: ${text.slice(0, 500)}` };
        }
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch {
          return { ok: true, data: { raw: text } };
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
