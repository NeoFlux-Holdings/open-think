import type { MessageRole, SessionMessage, SessionMeta } from "../types";

export interface OpenThinkClientOptions {
  fetch?: typeof globalThis.fetch;
  bearerToken?: string;
  headers?: Record<string, string>;
}

export interface AppendMessageArgs {
  role: MessageRole;
  content: string;
  parentId?: string | null;
  name?: string;
  toolCallId?: string;
}

export interface ForkArgs {
  fromMessageId: string;
  targetSessionId?: string;
}

export interface FiberArgs {
  idempotencyKey: string;
  input?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "completed" | "failed";
  error?: string;
}

export interface PluginSummary {
  id: string;
  version: string;
  description: string;
  capabilities: string[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  pluginId: string;
  action: string;
  tags: string[];
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

async function parseResponse<T>(response: Response): Promise<ApiResult<T>> {
  const text = await response.text();
  if (!text) {
    return { ok: response.ok, data: undefined };
  }
  try {
    return JSON.parse(text) as ApiResult<T>;
  } catch {
    return { ok: response.ok, data: text as unknown as T };
  }
}

export class OpenThinkClient {
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(
    private readonly baseUrl: string,
    private readonly options: OpenThinkClientOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private url(path: string): string {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl.slice(0, -1) : this.baseUrl;
    return `${base}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      ...(this.options.headers ?? {})
    };
    if (this.options.bearerToken) {
      headers.Authorization = `Bearer ${this.options.bearerToken}`;
    }
    return { ...headers, ...(extra ?? {}) };
  }

  private async req<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    const response = await this.fetchImpl(this.url(path), {
      ...init,
      headers: this.headers(init?.headers as Record<string, string> | undefined)
    });
    return parseResponse<T>(response);
  }

  health(): Promise<ApiResult> {
    return this.req("/health");
  }

  plugins(): Promise<ApiResult<{ plugins: PluginSummary[] }>> {
    return this.req("/plugins");
  }

  skills(): Promise<ApiResult<{ skills: SkillSummary[] }>> {
    return this.req("/skills");
  }

  invokePlugin<T = unknown>(pluginId: string, action: string, input?: unknown): Promise<ApiResult<T>> {
    return this.req(`/invoke/${encodeURIComponent(pluginId)}`, {
      method: "POST",
      body: JSON.stringify({ action, input })
    });
  }

  invokeSkill<T = unknown>(skillId: string, input?: unknown): Promise<ApiResult<T>> {
    return this.req(`/skills/invoke/${encodeURIComponent(skillId)}`, {
      method: "POST",
      body: JSON.stringify({ input })
    });
  }

  session(name: string): SessionHandle {
    return new SessionHandle(this, name);
  }

  async rawSession<T>(name: string, subpath: string, init?: RequestInit): Promise<ApiResult<T>> {
    return this.req(`/sessions/${encodeURIComponent(name)}${subpath}`, init);
  }
}

export class SessionHandle {
  constructor(
    private readonly client: OpenThinkClient,
    private readonly name: string
  ) {}

  init(title?: string): Promise<ApiResult<SessionMeta>> {
    return this.client.rawSession<SessionMeta>(this.name, "/init", {
      method: "POST",
      body: JSON.stringify({ title })
    });
  }

  describe(): Promise<ApiResult<{ exists: boolean; meta?: SessionMeta; messageCount?: number }>> {
    return this.client.rawSession(this.name, "");
  }

  append(args: AppendMessageArgs): Promise<ApiResult<{ message: SessionMessage; rootId: string }>> {
    return this.client.rawSession(this.name, "/messages", {
      method: "POST",
      body: JSON.stringify(args)
    });
  }

  messages(): Promise<ApiResult<SessionMessage[]>> {
    return this.client.rawSession<SessionMessage[]>(this.name, "/messages");
  }

  tree(): Promise<ApiResult<unknown>> {
    return this.client.rawSession(this.name, "/tree");
  }

  fork(args: ForkArgs): Promise<ApiResult<{ sessionName: string; copiedMessageCount: number }>> {
    return this.client.rawSession(this.name, "/fork", {
      method: "POST",
      body: JSON.stringify(args)
    });
  }

  compact(upToMessageId: string, summary: string): Promise<ApiResult<unknown>> {
    return this.client.rawSession(this.name, "/compact", {
      method: "POST",
      body: JSON.stringify({ upToMessageId, summary })
    });
  }

  search(query: string, limit?: number): Promise<ApiResult<SessionMessage[]>> {
    return this.client.rawSession<SessionMessage[]>(this.name, "/search", {
      method: "POST",
      body: JSON.stringify({ query, limit })
    });
  }

  fiber(args: FiberArgs): Promise<ApiResult<{ fiber: unknown; reused: boolean }>> {
    return this.client.rawSession(this.name, "/fibers", {
      method: "POST",
      body: JSON.stringify(args)
    });
  }

  getFiber(id: string): Promise<ApiResult<unknown>> {
    return this.client.rawSession(this.name, `/fibers/${encodeURIComponent(id)}`);
  }
}
