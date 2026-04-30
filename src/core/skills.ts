import type { AgentRuntime } from "./runtime";

export interface JsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  pluginId: string;
  action: string;
  tags: string[];
  inputSchema?: JsonSchema;
  /** If true, skill is skipped by selective-mode auto execution and surfaced as a proposal. */
  dangerous?: boolean;
}

export interface SkillInvocationRequest {
  input?: unknown;
}

const EMPTY_SCHEMA: JsonSchema = { type: "object", additionalProperties: false };

const CHAT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    model: { type: "string" },
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant", "tool"] },
          content: { type: "string" }
        },
        required: ["role", "content"]
      }
    },
    maxTokens: { type: "number" },
    temperature: { type: "number" }
  },
  required: ["messages"]
};

const SKILL_CATALOG: SkillDefinition[] = [
  {
    id: "admin-introspect",
    name: "Admin Introspect",
    description: "Snapshot of enabled plugins + redacted config",
    pluginId: "admin",
    action: "introspect",
    tags: ["admin", "health"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "admin-health-check",
    name: "Admin Health Check",
    description: "Deep check of enabled plugins for missing secrets/bindings",
    pluginId: "admin",
    action: "health-check",
    tags: ["admin", "health"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "admin-suggest-plugins",
    name: "Admin Suggest Plugins",
    description: "Given a goal, propose which plugins + env vars to enable",
    pluginId: "admin",
    action: "suggest-plugins",
    tags: ["admin", "setup"],
    inputSchema: {
      type: "object",
      properties: { goal: { type: "string", description: "Plain-English description of what the user wants to do" } },
      required: ["goal"]
    }
  },
  {
    id: "admin-env-template",
    name: "Admin Env Template",
    description: "Emit a .dev.vars template based on currently enabled plugins",
    pluginId: "admin",
    action: "env-template",
    tags: ["admin", "setup"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-introspect",
    name: "Cloudflare Introspect",
    description: "Check Cloudflare MCP plugin readiness and runtime metadata",
    pluginId: "cloudflare-api-mcp",
    action: "introspect",
    tags: ["cloudflare", "health", "mcp"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-list-zones",
    name: "Cloudflare List Zones",
    description: "List Cloudflare zones (requires API/Agent token)",
    pluginId: "cloudflare-api-mcp",
    action: "list-zones",
    tags: ["cloudflare", "dns", "ops"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-list-dns-records",
    name: "Cloudflare List DNS Records",
    description: "List DNS records for a zone (input.zoneId required)",
    pluginId: "cloudflare-api-mcp",
    action: "list-dns-records",
    tags: ["cloudflare", "dns", "records"],
    inputSchema: {
      type: "object",
      properties: { zoneId: { type: "string", description: "Cloudflare zone id" } },
      required: ["zoneId"]
    }
  },
  /* ---- cloudflare-admin: agent provisions its own infrastructure ---- */
  {
    id: "cf-verify",
    name: "CF Token Verify",
    description:
      "Verify CLOUDFLARE_API_TOKEN works (calls /user/tokens/verify). Returns token id, status, expiry.",
    pluginId: "cloudflare-admin",
    action: "verify",
    tags: ["cloudflare", "admin", "health"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-list-accounts",
    name: "CF List Accounts",
    description: "List Cloudflare accounts visible to the configured token.",
    pluginId: "cloudflare-admin",
    action: "list-accounts",
    tags: ["cloudflare", "admin"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-list-workers",
    name: "CF List Workers",
    description:
      "List Workers scripts in an account. accountId optional — defaults to env.CLOUDFLARE_ACCOUNT_ID.",
    pluginId: "cloudflare-admin",
    action: "list-workers",
    tags: ["cloudflare", "admin", "workers"],
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } }
    }
  },
  {
    id: "cf-list-d1",
    name: "CF List D1 Databases",
    description: "List D1 SQLite databases.",
    pluginId: "cloudflare-admin",
    action: "list-d1",
    tags: ["cloudflare", "admin", "d1"],
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } }
    }
  },
  {
    id: "cf-create-d1",
    name: "CF Create D1 Database",
    description: "Create a new D1 database. DANGEROUS — creates real infrastructure.",
    pluginId: "cloudflare-admin",
    action: "create-d1",
    tags: ["cloudflare", "admin", "d1", "create"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        name: { type: "string", description: "D1 database name (lowercase, dashes ok)" }
      },
      required: ["name"]
    }
  },
  {
    id: "cf-query-d1",
    name: "CF Query D1",
    description:
      "Run a SQL query against a D1 database. Pass {databaseId, sql, params}. DANGEROUS for non-SELECT statements.",
    pluginId: "cloudflare-admin",
    action: "query-d1",
    tags: ["cloudflare", "admin", "d1", "sql"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        databaseId: { type: "string" },
        sql: { type: "string" },
        params: { type: "array", items: {} }
      },
      required: ["databaseId", "sql"]
    }
  },
  {
    id: "cf-list-kv",
    name: "CF List KV Namespaces",
    description: "List Workers KV namespaces.",
    pluginId: "cloudflare-admin",
    action: "list-kv",
    tags: ["cloudflare", "admin", "kv"],
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } }
    }
  },
  {
    id: "cf-create-kv",
    name: "CF Create KV Namespace",
    description: "Create a new KV namespace. DANGEROUS — creates real infrastructure.",
    pluginId: "cloudflare-admin",
    action: "create-kv",
    tags: ["cloudflare", "admin", "kv", "create"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        title: { type: "string" }
      },
      required: ["title"]
    }
  },
  {
    id: "cf-kv-put",
    name: "CF KV Put",
    description: "Write a value to KV. value is stored as text (or JSON.stringified object).",
    pluginId: "cloudflare-admin",
    action: "kv-put",
    tags: ["cloudflare", "admin", "kv", "write"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        namespaceId: { type: "string" },
        key: { type: "string" },
        value: {}
      },
      required: ["namespaceId", "key", "value"]
    }
  },
  {
    id: "cf-kv-get",
    name: "CF KV Get",
    description: "Read a key from KV. Returns the raw text value.",
    pluginId: "cloudflare-admin",
    action: "kv-get",
    tags: ["cloudflare", "admin", "kv", "read"],
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        namespaceId: { type: "string" },
        key: { type: "string" }
      },
      required: ["namespaceId", "key"]
    }
  },
  {
    id: "cf-kv-delete",
    name: "CF KV Delete",
    description: "Delete a key from KV. DANGEROUS.",
    pluginId: "cloudflare-admin",
    action: "kv-delete",
    tags: ["cloudflare", "admin", "kv", "delete"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        namespaceId: { type: "string" },
        key: { type: "string" }
      },
      required: ["namespaceId", "key"]
    }
  },
  {
    id: "cf-list-r2",
    name: "CF List R2 Buckets",
    description: "List R2 buckets.",
    pluginId: "cloudflare-admin",
    action: "list-r2",
    tags: ["cloudflare", "admin", "r2"],
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } }
    }
  },
  {
    id: "cf-create-r2",
    name: "CF Create R2 Bucket",
    description: "Create an R2 bucket. DANGEROUS — creates real infrastructure.",
    pluginId: "cloudflare-admin",
    action: "create-r2",
    tags: ["cloudflare", "admin", "r2", "create"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        name: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    id: "cf-put-secret",
    name: "CF Put Worker Secret",
    description:
      "Set a secret on a Worker script. {scriptName, name, text}. DANGEROUS — handles secret material.",
    pluginId: "cloudflare-admin",
    action: "put-secret",
    tags: ["cloudflare", "admin", "secret", "worker"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        scriptName: { type: "string" },
        name: { type: "string" },
        text: { type: "string" }
      },
      required: ["scriptName", "name", "text"]
    }
  },
  {
    id: "cf-list-bindings",
    name: "CF List Worker Bindings",
    description:
      "List the live Worker's bindings (R2, D1, KV, AI, DOs, secrets, etc.). USE THIS BEFORE proposing cf-patch-binding so you don't duplicate work — the binding may already be there.",
    pluginId: "cloudflare-admin",
    action: "list-bindings",
    tags: ["cloudflare", "admin", "introspect"],
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        scriptName: { type: "string", description: "Worker script name (default: \"helm\")" }
      },
      required: ["scriptName"]
    }
  },
  {
    id: "cf-list-secrets",
    name: "CF List Worker Secrets",
    description:
      "List the live Worker's secret NAMES (values are write-only by design, never returned). USE THIS to see what's already configured before proposing cf-put-secret.",
    pluginId: "cloudflare-admin",
    action: "list-secrets",
    tags: ["cloudflare", "admin", "introspect"],
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        scriptName: { type: "string" }
      },
      required: ["scriptName"]
    }
  },
  {
    id: "cf-patch-binding",
    name: "CF Patch Worker Binding",
    description:
      "Add or replace a binding on the LIVE Worker via CF API (no wrangler.toml edit needed). type ∈ {r2_bucket, d1, kv_namespace, ai, queue, hyperdrive}. ALSO returns the matching wrangler.toml snippet — surface it to the user verbatim, because the binding will be removed by their next `wrangler deploy` unless they commit the snippet too. DANGEROUS.",
    pluginId: "cloudflare-admin",
    action: "patch-binding",
    tags: ["cloudflare", "admin", "binding", "create"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        scriptName: { type: "string" },
        type: { type: "string", enum: ["r2_bucket", "d1", "kv_namespace", "ai", "queue", "hyperdrive", "plain_text"] },
        name: { type: "string", description: "Binding name (e.g. WORKSPACE, DB, AI)" },
        config: {
          type: "object",
          description: "type-specific config: r2_bucket { bucket_name }; d1 { database_name, database_id }; kv_namespace { namespace_id }; ai {}; queue { queue_name }; hyperdrive { id }; plain_text { text }"
        }
      },
      required: ["scriptName", "type", "name"]
    }
  },
  {
    id: "cf-list-access-apps",
    name: "CF List Access Apps",
    description: "List Cloudflare Access applications.",
    pluginId: "cloudflare-admin",
    action: "list-access-apps",
    tags: ["cloudflare", "admin", "access"],
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string" } }
    }
  },
  {
    id: "cf-create-access-app",
    name: "CF Create Access App",
    description:
      "Create a self-hosted Access application. {name, domain, sessionDuration?}. DANGEROUS.",
    pluginId: "cloudflare-admin",
    action: "create-access-app",
    tags: ["cloudflare", "admin", "access", "create"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        name: { type: "string" },
        domain: { type: "string", description: "FQDN to gate (e.g. helm.example.workers.dev)" },
        sessionDuration: { type: "string", description: "e.g. 24h" }
      },
      required: ["name", "domain"]
    }
  },
  /* ---- helm-setup: high-level setup wrappers ---- */
  {
    id: "helm-setup-status",
    name: "Helm Setup Status",
    description:
      "Live capability matrix — for each runtime feature returns {enabled, configured, required, missing, hint, docs}. USE THIS as the FIRST step of any \"set me up\" turn so you propose the smallest set of changes.",
    pluginId: "helm-setup",
    action: "status",
    tags: ["setup", "introspect"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "helm-setup-secrets-status",
    name: "Helm Setup Secrets Status",
    description:
      "Secret-slot inventory: the canonical list of secrets the runtime knows about + whether each is currently set. Same data as /app#/settings → Manage secrets.",
    pluginId: "helm-setup",
    action: "secrets-status",
    tags: ["setup", "introspect", "secrets"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "helm-setup-auto",
    name: "Helm Setup Auto",
    description:
      "ONE-CALL full setup. Verifies CLOUDFLARE_API_TOKEN, picks an account, runs Cloudflare Access lockdown, mints HELM_INTERNAL_TOKEN, creates R2 bucket. Returns nextSteps[] showing what's done vs what's still manual (just the [[r2_buckets]] TOML edit). PREFER THIS over chaining individual cf-* skills when the user says \"set me up\". DANGEROUS.",
    pluginId: "helm-setup",
    action: "auto",
    tags: ["setup", "auto", "create"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        scriptName: { type: "string", description: "Worker name (default: env.AGENT_NAME or \"helm\")" },
        appName: { type: "string", description: "Access app display name" },
        allowedEmails: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    id: "helm-docs",
    name: "Helm Self-Docs",
    description:
      "Read curated documentation about Helm's own architecture. Topics: setup, topology, bindings, secrets, shell, skills, manual-steps. Pass {topic:\"<name>\"} to read one; pass {} to list topics. USE THIS when the user asks something where you'd otherwise say \"I don't know my own setup\" — you do, just call this.",
    pluginId: "helm-setup",
    action: "docs",
    tags: ["setup", "docs", "self"],
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic name. Empty input lists available topics." }
      }
    }
  },
  {
    id: "cf-api",
    name: "CF API (escape hatch)",
    description:
      "Generic Cloudflare API call. {method, path, body?}. Use ONLY when no specific cf-* skill fits. Path must start with '/'. DANGEROUS.",
    pluginId: "cloudflare-admin",
    action: "cf-api",
    tags: ["cloudflare", "admin", "raw"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", description: "API path starting with '/' (e.g. '/accounts/{id}/...')" },
        body: {}
      },
      required: ["method", "path"]
    }
  },
  {
    id: "ai-chat",
    name: "Workers AI Chat",
    description: "Chat with Workers AI models (input.messages array required)",
    pluginId: "workers-ai",
    action: "chat",
    tags: ["ai", "chat", "workers-ai"],
    inputSchema: CHAT_SCHEMA
  },
  {
    id: "ai-status",
    name: "Workers AI Status",
    description: "Confirm Workers AI binding and effective default model",
    pluginId: "workers-ai",
    action: "status",
    tags: ["ai", "health"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-gateway-chat",
    name: "CF AI Gateway Chat",
    description:
      "Universal chat via Cloudflare AI Gateway — model must be 'provider/model-name' (e.g. 'anthropic/claude-opus-4-6'). BYOK via Secrets Store.",
    pluginId: "cf-ai-gateway",
    action: "chat",
    tags: ["ai", "cf-ai-gateway", "byok"],
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "provider/model-name" },
        messages: CHAT_SCHEMA.properties!.messages,
        maxTokens: { type: "number" },
        temperature: { type: "number" },
        providerKeyRef: { type: "string", description: "Secrets Store key reference" },
        forceCompat: { type: "boolean" }
      },
      required: ["messages"]
    }
  },
  {
    id: "cf-gateway-list-providers",
    name: "CF AI Gateway List Providers",
    description: "List the 23+ providers supported by Cloudflare AI Gateway",
    pluginId: "cf-ai-gateway",
    action: "list-providers",
    tags: ["cf-ai-gateway", "catalog"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cf-gateway-chat-fallbacks",
    name: "CF AI Gateway Chat (with fallbacks)",
    description:
      "Call a list of models in priority order; return the first success. Each entry must be 'provider/model-name'.",
    pluginId: "cf-ai-gateway",
    action: "chat-with-fallbacks",
    tags: ["ai", "cf-ai-gateway", "fallback"],
    inputSchema: {
      type: "object",
      properties: {
        models: {
          type: "array",
          items: { type: "string", description: "provider/model-name" }
        },
        messages: CHAT_SCHEMA.properties!.messages,
        maxTokens: { type: "number" },
        temperature: { type: "number" },
        perModelTimeoutMs: { type: "number" }
      },
      required: ["models", "messages"]
    }
  },
  {
    id: "cf-gateway-status",
    name: "CF AI Gateway Status",
    description: "Check gateway id, binding presence, and default model",
    pluginId: "cf-ai-gateway",
    action: "status",
    tags: ["cf-ai-gateway", "health"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "codex-chat",
    name: "Codex Chat",
    description:
      "Chat with OpenAI Codex. Uses OPENAI_API_KEY (classic) or CODEX_ACCESS_TOKEN (ChatGPT subscription).",
    pluginId: "codex",
    action: "chat",
    tags: ["ai", "codex", "openai"],
    inputSchema: CHAT_SCHEMA
  },
  {
    id: "codex-status",
    name: "Codex Status",
    description: "Report which Codex auth mode is active",
    pluginId: "codex",
    action: "status",
    tags: ["codex", "health"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "codex-setup-instructions",
    name: "Codex Setup Instructions",
    description: "Describe how to connect Codex via api-key, ChatGPT tokens, app-server, or OAuth",
    pluginId: "codex",
    action: "setup-instructions",
    tags: ["codex", "setup"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "codex-thread-start",
    name: "Codex Thread Start",
    description: "Start a new thread via the app-server (requires CODEX_APP_SERVER_URL)",
    pluginId: "codex",
    action: "thread-start",
    tags: ["codex", "app-server", "thread"],
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } }
    }
  },
  {
    id: "codex-thread-list",
    name: "Codex Thread List",
    description: "List threads via the app-server",
    pluginId: "codex",
    action: "thread-list",
    tags: ["codex", "app-server", "thread"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "codex-models",
    name: "Codex Models",
    description: "List models advertised by the app-server",
    pluginId: "codex",
    action: "models",
    tags: ["codex", "app-server", "models"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "codex-rpc",
    name: "Codex RPC",
    description: "Low-level passthrough to any app-server JSON-RPC method (input.method required). Dangerous.",
    pluginId: "codex",
    action: "rpc",
    tags: ["codex", "app-server", "rpc"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "JSON-RPC method, e.g. turn/start" },
        params: { type: "object", additionalProperties: true }
      },
      required: ["method"]
    }
  },
  {
    id: "anthropic-chat",
    name: "Anthropic Chat (direct)",
    description: "Call Anthropic Messages API directly (bypasses CF AI Gateway). Requires ANTHROPIC_API_KEY.",
    pluginId: "anthropic",
    action: "chat",
    tags: ["ai", "anthropic", "claude"],
    inputSchema: CHAT_SCHEMA
  },
  {
    id: "openai-compat-chat",
    name: "OpenAI-compatible Chat",
    description: "Call any OpenAI-compatible /chat/completions endpoint (Groq, Together, Ollama…)",
    pluginId: "openai-compatible",
    action: "chat",
    tags: ["ai", "openai-compatible"],
    inputSchema: CHAT_SCHEMA
  },
  {
    id: "openai-compat-list-models",
    name: "OpenAI-compatible List Models",
    description: "GET /v1/models against the configured OpenAI-compatible endpoint",
    pluginId: "openai-compatible",
    action: "list-models",
    tags: ["ai", "openai-compatible"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "mcp-list-tools",
    name: "MCP List Tools",
    description: "List tools from a configured MCP server (input.serverUrl optional)",
    pluginId: "mcp-client",
    action: "list-tools",
    tags: ["mcp", "tools"],
    inputSchema: {
      type: "object",
      properties: { serverUrl: { type: "string" } }
    }
  },
  {
    id: "mcp-call-tool",
    name: "MCP Call Tool",
    description: "Call a named MCP tool (input.name + input.arguments required). Dangerous — MCP tools may mutate external state.",
    pluginId: "mcp-client",
    action: "call-tool",
    tags: ["mcp", "tools"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
        serverUrl: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    id: "browser-fetch",
    name: "Browser Fetch",
    description: "Fetch a URL via Cloudflare Browser Rendering (input.url required)",
    pluginId: "browser",
    action: "fetch",
    tags: ["browser", "tier-3"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string" }
      },
      required: ["url"]
    }
  },
  {
    id: "sandbox-exec",
    name: "Sandbox Exec",
    description: "Run a shell command in the Cloudflare Sandbox. Dangerous — tier-4 execution.",
    pluginId: "sandbox",
    action: "exec",
    tags: ["sandbox", "tier-4"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        stdin: { type: "string" },
        timeoutMs: { type: "number" }
      },
      required: ["command"]
    }
  },
  {
    id: "artifacts-create-repo",
    name: "Artifacts Create Repo",
    description: "Create a Cloudflare Artifacts repository. Dangerous — mutates account state.",
    pluginId: "artifacts",
    action: "create-repo",
    tags: ["artifacts", "git", "storage"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"]
    }
  },
  {
    id: "artifacts-import-repo",
    name: "Artifacts Import Repo",
    description: "Import an existing repo into Artifacts. Dangerous — mutates account state.",
    pluginId: "artifacts",
    action: "import-repo",
    tags: ["artifacts", "git", "import"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        sourceUrl: { type: "string" },
        targetName: { type: "string" },
        branch: { type: "string" }
      },
      required: ["sourceUrl", "targetName"]
    }
  },
  {
    id: "artifacts-fork-repo",
    name: "Artifacts Fork Repo",
    description: "Fork an Artifacts repo. Dangerous — mutates account state.",
    pluginId: "artifacts",
    action: "fork-repo",
    tags: ["artifacts", "git", "fork"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        forkName: { type: "string" },
        readOnly: { type: "boolean" }
      },
      required: ["name", "forkName"]
    }
  },
  {
    id: "mpp-status",
    name: "MPP Status",
    description: "Check mpp provider connectivity and effective default model",
    pluginId: "mpp",
    action: "status",
    tags: ["mpp", "model", "provider"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "mpp-list-models",
    name: "MPP List Models",
    description: "List available models from mpp.dev",
    pluginId: "mpp",
    action: "list-models",
    tags: ["mpp", "models", "catalog"],
    inputSchema: EMPTY_SCHEMA
  },
  /* ---------------- Memory (Cloudflare Agent Memory / D1 fallback) ---------------- */
  {
    id: "memory-save",
    name: "Memory — save a fact",
    description: "Persist a fact to long-term memory. Use for preferences, project facts, names, decisions.",
    pluginId: "memory",
    action: "memory-save",
    tags: ["memory", "write"],
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Free-text fact to remember" },
        sessionId: { type: "string", description: "Optional session to associate" },
        profile: { type: "string", description: "Memory profile (default: agent name)" },
        metadata: { type: "object", additionalProperties: true }
      },
      required: ["content"]
    }
  },
  {
    id: "memory-recall",
    name: "Memory — recall by query",
    description: "Retrieve matching memories (synthesized answer via managed backend, substring search via D1)",
    pluginId: "memory",
    action: "memory-recall",
    tags: ["memory", "read"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        profile: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    id: "memory-list",
    name: "Memory — list",
    description: "List recent memories for a profile (for UI + admin)",
    pluginId: "memory",
    action: "memory-list",
    tags: ["memory", "read", "admin"],
    inputSchema: {
      type: "object",
      properties: { profile: { type: "string" }, limit: { type: "number" } }
    }
  },
  {
    id: "memory-ingest",
    name: "Memory — ingest a conversation",
    description: "Extract memories from a series of messages (uses Agent Memory LLM extraction when bound)",
    pluginId: "memory",
    action: "memory-ingest",
    tags: ["memory", "write", "compact"],
    inputSchema: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object", additionalProperties: true } },
        sessionId: { type: "string" },
        profile: { type: "string" }
      },
      required: ["messages"]
    }
  },
  {
    id: "memory-forget",
    name: "Memory — forget",
    description: "Delete a memory (by id) or an entire profile",
    pluginId: "memory",
    action: "memory-forget",
    tags: ["memory", "write", "destructive"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, profile: { type: "string" } }
    }
  },
  /* ---------------- Email ---------------- */
  {
    id: "email-draft",
    name: "Email — draft (dry run)",
    description: "Build a MIME envelope without sending. Returns the preview for approval before send.",
    pluginId: "email",
    action: "email-draft",
    tags: ["email", "read"],
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        text: { type: "string" },
        html: { type: "string" },
        from: { type: "string" },
        replyTo: { type: "string" }
      },
      required: ["to", "subject"]
    }
  },
  {
    id: "email-send",
    name: "Email — send",
    description: "Actually send the email via Cloudflare Email Workers. DANGEROUS: outbound, user must approve.",
    pluginId: "email",
    action: "email-send",
    tags: ["email", "write", "outbound"],
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        text: { type: "string" },
        html: { type: "string" },
        from: { type: "string" },
        replyTo: { type: "string" }
      },
      required: ["to", "subject"]
    }
  },
  {
    id: "email-inbox",
    name: "Email — list inbox",
    description: "List recent inbound emails received via Email Routing (persisted in D1).",
    pluginId: "email",
    action: "email-inbox",
    tags: ["email", "read"],
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO timestamp lower bound" },
        limit: { type: "number" }
      }
    }
  },
  {
    id: "email-thread",
    name: "Email — read one message",
    description: "Fetch a single inbound message by id",
    pluginId: "email",
    action: "email-thread",
    tags: ["email", "read"],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    }
  },
  /* ---------------- Notifier ---------------- */
  {
    id: "notify-user",
    name: "Notify — reach the owner",
    description: "Send a notification (email or Web Push) to the PA's owner",
    pluginId: "notifier",
    action: "notify-user",
    tags: ["notifier", "write"],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        url: { type: "string" },
        channel: { type: "string", enum: ["email", "web-push", "log"] }
      },
      required: ["body"]
    }
  },
  {
    id: "notifier-list",
    name: "Notifier — list sent",
    description: "List notifications the PA has sent (audit log)",
    pluginId: "notifier",
    action: "notifier-list",
    tags: ["notifier", "read", "admin"],
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } }
    }
  },
  /* ---------------- Calendar (MCP-delegated) ---------------- */
  {
    id: "calendar-today",
    name: "Calendar — today",
    description: "Get today's calendar via the configured CALENDAR_MCP_URL",
    pluginId: "calendar",
    action: "calendar-today",
    tags: ["calendar", "read"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "calendar-upcoming",
    name: "Calendar — upcoming",
    description: "Get upcoming events in the next N days (default 7)",
    pluginId: "calendar",
    action: "calendar-upcoming",
    tags: ["calendar", "read"],
    inputSchema: {
      type: "object",
      properties: { days: { type: "number" } }
    }
  },
  /* ---------------- Cost tracking (admin plugin) ---------------- */
  {
    id: "cost-today",
    name: "Cost — today",
    description: "Per-provider token + USD spend for today (UTC)",
    pluginId: "admin",
    action: "cost-today",
    tags: ["cost", "read", "admin"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cost-range",
    name: "Cost — range",
    description: "Per-day per-provider spend for an inclusive UTC date range",
    pluginId: "admin",
    action: "cost-range",
    tags: ["cost", "read", "admin"],
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", description: "YYYY-MM-DD (UTC)" },
        end: { type: "string", description: "YYYY-MM-DD (UTC)" }
      },
      required: ["start", "end"]
    }
  },
  {
    id: "cost-cap",
    name: "Cost — check spending cap",
    description: "Returns whether today's spend has hit DAILY_SPEND_CAP_USD",
    pluginId: "admin",
    action: "cost-cap",
    tags: ["cost", "read", "admin"],
    inputSchema: EMPTY_SCHEMA
  },
  {
    id: "cost-rollup-now",
    name: "Cost — roll up yesterday",
    description: "Immediately fetch + aggregate yesterday's AI Gateway logs (normally runs on cron)",
    pluginId: "admin",
    action: "cost-rollup",
    tags: ["cost", "write", "admin"],
    inputSchema: EMPTY_SCHEMA
  }
];

export class SkillManager {
  constructor(private readonly runtime: AgentRuntime) {}

  listSkills(): SkillDefinition[] {
    const enabledPluginIds = new Set(this.runtime.listPlugins().map((plugin) => plugin.id));
    return SKILL_CATALOG.filter((skill) => enabledPluginIds.has(skill.pluginId));
  }

  getSkill(skillId: string): SkillDefinition | undefined {
    return this.listSkills().find((skill) => skill.id === skillId);
  }

  async invoke(skillId: string, request: SkillInvocationRequest) {
    const skill = this.getSkill(skillId);

    if (!skill) {
      return {
        ok: false,
        error: `Skill '${skillId}' is not available`,
        availableSkills: this.listSkills().map((s) => s.id)
      };
    }

    return this.runtime.invoke(skill.pluginId, {
      action: skill.action,
      input: request.input
    });
  }
}
