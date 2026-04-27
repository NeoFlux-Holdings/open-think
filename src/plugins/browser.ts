import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";

interface FetchInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  screenshot?: boolean;
  bodyText?: string;
}

function parseFetch(input: unknown): FetchInput {
  if (!input || typeof input !== "object") {
    throw new Error("input must be an object with 'url'");
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.url !== "string" || candidate.url.length === 0) {
    throw new Error("'url' must be a non-empty string");
  }
  return {
    url: candidate.url,
    method: typeof candidate.method === "string" ? candidate.method : "GET",
    headers:
      candidate.headers && typeof candidate.headers === "object"
        ? (candidate.headers as Record<string, string>)
        : undefined,
    screenshot: Boolean(candidate.screenshot),
    bodyText: typeof candidate.bodyText === "string" ? candidate.bodyText : undefined
  };
}

export class BrowserPlugin implements AgentPlugin {
  readonly id = "browser";
  readonly version = "0.1.0";
  readonly description = "Cloudflare Browser Rendering (tier-3 execution)";
  readonly capabilities = ["tools", "connectors"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.env.BROWSER) {
      throw new Error("browser plugin requires BROWSER binding (enable `[browser]` in wrangler.toml)");
    }
    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx?.env.BROWSER) {
      return { ok: false, error: "Plugin not initialized" };
    }

    if (action === "status") {
      return {
        ok: true,
        data: { provider: "cloudflare-browser", bound: true }
      };
    }

    if (action === "fetch") {
      try {
        const parsed = parseFetch(input);
        const response = await this.ctx.env.BROWSER.fetch(parsed.url, {
          method: parsed.method,
          headers: parsed.headers,
          body: parsed.bodyText
        });
        const text = await response.text();
        return {
          ok: true,
          data: {
            status: response.status,
            contentType: response.headers.get("content-type"),
            bodyPreview: text.slice(0, 20_000)
          }
        };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
