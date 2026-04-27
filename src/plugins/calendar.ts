/**
 * Calendar plugin — thin wrapper around an MCP calendar server.
 *
 * There is no native Cloudflare calendar product. Rather than reinvent iCal /
 * CalDAV / Google OAuth inside a Worker, we delegate to whichever calendar
 * MCP server the user points at via `CALENDAR_MCP_URL`. Examples that work
 * out of the box:
 *   - https://github.com/block/google-calendar-mcp-server (Google)
 *   - any CalDAV MCP server the user deploys
 *
 * Under the hood this plugin just forwards to the `mcp-client` plugin with a
 * pre-set URL, so the auth story, transport, and tool discovery are all the
 * same as any other MCP server the user connects to.
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";

export class CalendarPlugin implements AgentPlugin {
  readonly id = "calendar";
  readonly version = "0.1.0";
  readonly description = "Calendar via an MCP server (point CALENDAR_MCP_URL at Google/CalDAV/etc.)";
  readonly capabilities = ["connectors", "tools"] as const;

  private env?: Env;

  async initialize(context: PluginContext): Promise<void> {
    this.env = context.env;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    const env = this.env;
    if (!env) return { ok: false, error: "Plugin not initialized" };
    const url = (env as Env & { CALENDAR_MCP_URL?: string }).CALENDAR_MCP_URL;
    if (!url) {
      return {
        ok: false,
        error:
          "Set CALENDAR_MCP_URL to a calendar MCP server (e.g. google-calendar-mcp) and enable the mcp-client plugin."
      };
    }

    const inObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

    // We can't reach into the mcp-client plugin directly from here without a
    // runtime handle, so the skills we register below all route through
    // `mcp-call-tool` with `serverUrl` pre-set. Calling the plugin through
    // the runtime preserves the same tool-approval / rollback flow.
    switch (action) {
      case "calendar-today":
        return {
          ok: true,
          data: {
            forward: {
              plugin: "mcp-client",
              action: "mcp-call-tool",
              input: {
                serverUrl: url,
                name: "list_events",
                arguments: {
                  timeMin: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
                  timeMax: new Date(new Date().setHours(23, 59, 59, 999)).toISOString()
                }
              }
            },
            note: "Helm: invoke the returned forward call via mcp-client."
          }
        };

      case "calendar-upcoming": {
        const days = typeof inObj.days === "number" ? Math.min(inObj.days, 30) : 7;
        return {
          ok: true,
          data: {
            forward: {
              plugin: "mcp-client",
              action: "mcp-call-tool",
              input: {
                serverUrl: url,
                name: "list_events",
                arguments: {
                  timeMin: new Date().toISOString(),
                  timeMax: new Date(Date.now() + days * 86400_000).toISOString()
                }
              }
            }
          }
        };
      }

      default:
        return { ok: false, error: `Unknown calendar action: ${action}` };
    }
  }
}
