import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import { AppError } from "../core/errors";
import { planMcpRollback, getUpdateCaptureStrategy } from "../rollback";

interface McpCallInput {
  serverUrl?: string;
  method: string;
  params?: unknown;
  id?: string | number;
  headers?: Record<string, string>;
}

interface ToolCallInput {
  serverUrl?: string;
  name: string;
  arguments?: unknown;
}

function pickString(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseCall(input: unknown): McpCallInput {
  const method = pickString(input, "method");
  if (!method) {
    throw new AppError("E_BAD_REQUEST", "method is required", 400);
  }
  const serverUrl = pickString(input, "serverUrl");
  const params = (input as Record<string, unknown>)?.params;
  const id = (input as Record<string, unknown>)?.id as string | number | undefined;
  const headers = (input as Record<string, unknown>)?.headers as Record<string, string> | undefined;
  return { serverUrl, method, params, id, headers };
}

function parseToolCall(input: unknown): ToolCallInput {
  const name = pickString(input, "name");
  if (!name) {
    throw new AppError("E_BAD_REQUEST", "name is required", 400);
  }
  return {
    name,
    serverUrl: pickString(input, "serverUrl"),
    arguments: (input as Record<string, unknown>)?.arguments
  };
}

export class McpClientPlugin implements AgentPlugin {
  readonly id = "mcp-client";
  readonly version = "0.1.0";
  readonly description = "Outbound MCP (streamable-HTTP) client for tool proxying";
  readonly capabilities = ["mcp", "tools", "connectors"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  private resolveServerUrl(provided?: string): string {
    const url = provided ?? this.ctx?.env.MCP_DEFAULT_URL;
    if (!url) {
      throw new AppError(
        "E_MCP_URL_MISSING",
        "serverUrl not provided and MCP_DEFAULT_URL env var is not set",
        400
      );
    }
    return url;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    const token = this.ctx?.env.MCP_BEARER_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return { ...headers, ...(extra ?? {}) };
  }

  private async jsonRpc(
    url: string,
    method: string,
    params?: unknown,
    id?: string | number,
    headers?: Record<string, string>
  ) {
    if (!this.ctx) {
      throw new AppError("E_PLUGIN_NOT_INITIALIZED", "Plugin not initialized", 500);
    }
    const body = {
      jsonrpc: "2.0" as const,
      id: id ?? crypto.randomUUID(),
      method,
      params
    };

    const response = await this.ctx.fetch(url, {
      method: "POST",
      headers: this.buildHeaders(headers),
      body: JSON.stringify(body)
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
    }

    if (contentType.includes("text/event-stream")) {
      const match = text.match(/data:\s*(\{.*\})/);
      if (!match) {
        return { ok: false, error: "Empty MCP SSE response" };
      }
      return { ok: true, status: response.status, data: JSON.parse(match[1]) };
    }

    try {
      return { ok: true, status: response.status, data: text ? JSON.parse(text) : null };
    } catch {
      return { ok: false, error: "MCP response was not valid JSON", raw: text };
    }
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) {
      return { ok: false, error: "Plugin not initialized" };
    }

    try {
      if (action === "status") {
        return {
          ok: true,
          data: {
            provider: "mcp-client",
            defaultServerUrl: this.ctx.env.MCP_DEFAULT_URL ?? null,
            hasBearer: Boolean(this.ctx.env.MCP_BEARER_TOKEN)
          }
        };
      }

      if (action === "list-tools") {
        const url = this.resolveServerUrl(pickString(input, "serverUrl"));
        const result = await this.jsonRpc(url, "tools/list");
        return result.ok
          ? { ok: true, data: result.data }
          : { ok: false, error: result.error ?? "list-tools failed" };
      }

      if (action === "call-tool") {
        const parsed = parseToolCall(input);
        const url = this.resolveServerUrl(parsed.serverUrl);
        const args = (parsed.arguments as Record<string, unknown>) ?? {};

        // For update-style mutations, capture the pre-update state first so we
        // can build a rollback hint that restores it later. Non-fatal on failure:
        // the mutation still runs, we just skip the rollback hint.
        const updateStrategy = getUpdateCaptureStrategy(parsed.name, args);
        let captureResponse: unknown = null;
        let captureFailed = false;
        if (updateStrategy) {
          const capture = await this.jsonRpc(url, "tools/call", updateStrategy.captureCall);
          if (capture.ok) {
            captureResponse = capture.data;
          } else {
            captureFailed = true;
          }
        }

        const result = await this.jsonRpc(url, "tools/call", {
          name: parsed.name,
          arguments: args
        });
        if (!result.ok) {
          return { ok: false, error: result.error ?? "call-tool failed" };
        }

        let rollback: ReturnType<typeof planMcpRollback> | null = null;
        if (updateStrategy && !captureFailed) {
          rollback = updateStrategy.buildHint(captureResponse);
        }
        if (!rollback) {
          rollback = planMcpRollback(parsed.name, args, result.data);
        }

        return {
          ok: true,
          data: rollback
            ? { ...(result.data as object | null ?? {}), _rollback: rollback }
            : result.data
        };
      }

      if (action === "raw") {
        const parsed = parseCall(input);
        const url = this.resolveServerUrl(parsed.serverUrl);
        const result = await this.jsonRpc(url, parsed.method, parsed.params, parsed.id, parsed.headers);
        return result.ok
          ? { ok: true, data: result.data }
          : { ok: false, error: result.error ?? "raw call failed" };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
