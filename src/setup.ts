import type { AgentRuntime } from "./core/runtime";
import type { SkillManager } from "./core/skills";
import type { Env } from "./types";
import { AppError } from "./core/errors";

/**
 * Setup aggregator — drives the Settings tab.
 *
 *   - `collectStatus()` — single-roundtrip diagnostic of every configured capability.
 *   - `generateSnippet()` — emits a wrangler.toml delta + .dev.vars block for a target setup.
 *   - `guidedStart()` — creates a setup session primed with context + goal so Helm
 *     can walk the user through provisioning via the Cloudflare MCP.
 */

export interface CapabilityCheck {
  id: string;
  label: string;
  group: "provider" | "tooling" | "runtime" | "infrastructure";
  enabled: boolean;
  configured: boolean;
  required: string[];
  missing: string[];
  hint: string;
  docs?: string;
}

export interface SetupStatus {
  enabledPlugins: string[];
  capabilities: CapabilityCheck[];
  readinessScore: number;
  recommended: string[];
  mcpBridge: {
    configured: boolean;
    url?: string;
    provider?: string;
  };
}

function hasEnvFlag(env: Env, ...names: Array<keyof Env>): boolean {
  return names.every((n) => Boolean(env[n]));
}

function hasAnyFlag(env: Env, ...names: Array<keyof Env>): boolean {
  return names.some((n) => Boolean(env[n]));
}

export function collectStatus(env: Env, runtime: AgentRuntime): SetupStatus {
  const enabled = new Set(runtime.listPlugins().map((p) => p.id));
  const checks: CapabilityCheck[] = [
    {
      id: "cf-ai-gateway",
      label: "Cloudflare AI Gateway (23+ providers)",
      group: "provider",
      enabled: enabled.has("cf-ai-gateway"),
      configured: hasEnvFlag(env, "AI_GATEWAY_ID"),
      required: ["AI_GATEWAY_ID"],
      missing: hasEnvFlag(env, "AI_GATEWAY_ID") ? [] : ["AI_GATEWAY_ID"],
      hint: "Create a gateway at dash → AI → AI Gateway, then wrangler secret put AI_GATEWAY_ID.",
      docs: "docs/PROVIDERS.md#1--cloudflare-ai-gateway-recommended-default"
    },
    {
      id: "workers-ai",
      label: "Workers AI (direct)",
      group: "provider",
      enabled: enabled.has("workers-ai"),
      configured: Boolean(env.AI),
      required: ["env.AI binding"],
      missing: env.AI ? [] : ["[ai] binding = \"AI\" in wrangler.toml"],
      hint: "Free tier included. Add `[ai] binding = \"AI\"` to wrangler.toml.",
      docs: "docs/PROVIDERS.md#2--workers-ai-direct"
    },
    {
      id: "anthropic",
      label: "Anthropic (direct)",
      group: "provider",
      enabled: enabled.has("anthropic"),
      configured: Boolean(env.ANTHROPIC_API_KEY),
      required: ["ANTHROPIC_API_KEY"],
      missing: env.ANTHROPIC_API_KEY ? [] : ["ANTHROPIC_API_KEY"],
      hint: "wrangler secret put ANTHROPIC_API_KEY; add api.anthropic.com to ALLOWED_HOSTS.",
      docs: "docs/PROVIDERS.md#3--anthropic-direct"
    },
    {
      id: "openai-compatible",
      label: "OpenAI-compatible (direct)",
      group: "provider",
      enabled: enabled.has("openai-compatible"),
      configured: Boolean(env.OPENAI_COMPATIBLE_URL),
      required: ["OPENAI_COMPATIBLE_URL"],
      missing: env.OPENAI_COMPATIBLE_URL ? [] : ["OPENAI_COMPATIBLE_URL"],
      hint: "Set base URL (Groq, Together, Ollama, etc.) and add its host to ALLOWED_HOSTS.",
      docs: "docs/PROVIDERS.md#4--openai-compatible-direct"
    },
    {
      id: "codex",
      label: "OpenAI Codex",
      group: "provider",
      enabled: enabled.has("codex"),
      configured: hasAnyFlag(env, "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_APP_SERVER_URL"),
      required: ["one of OPENAI_API_KEY / CODEX_ACCESS_TOKEN / CODEX_APP_SERVER_URL"],
      missing: hasAnyFlag(env, "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_APP_SERVER_URL")
        ? []
        : ["OPENAI_API_KEY or CODEX_ACCESS_TOKEN or CODEX_APP_SERVER_URL"],
      hint: "For ChatGPT subscription, deploy companion/codex-bridge/ and set CODEX_APP_SERVER_URL.",
      docs: "docs/CODEX_APPSERVER.md"
    },
    {
      id: "mcp-client",
      label: "MCP client (incl. Cloudflare MCP)",
      group: "tooling",
      enabled: enabled.has("mcp-client"),
      configured: Boolean(env.MCP_DEFAULT_URL),
      required: ["MCP_DEFAULT_URL"],
      missing: env.MCP_DEFAULT_URL ? [] : ["MCP_DEFAULT_URL"],
      hint: "Point at https://mcp.cloudflare.com/mcp to unlock account operations.",
      docs: "docs/HELM.md#pairing-with-cloudflare-mcp"
    },
    {
      id: "browser",
      label: "Browser Rendering (tier-3)",
      group: "tooling",
      enabled: enabled.has("browser"),
      configured: Boolean(env.BROWSER),
      required: ["env.BROWSER binding"],
      missing: env.BROWSER ? [] : ["[browser] binding in wrangler.toml"],
      hint: "Uncomment the [browser] binding block in wrangler.toml and redeploy.",
      docs: "docs/CAPABILITIES.md"
    },
    {
      id: "sandbox",
      label: "Cloudflare Sandbox (tier-4)",
      group: "tooling",
      enabled: enabled.has("sandbox"),
      configured: Boolean(env.SANDBOX),
      required: ["SANDBOX service binding"],
      missing: env.SANDBOX ? [] : ["SANDBOX service binding"],
      hint: "Bind a companion Sandbox Worker via [[services]] in wrangler.toml.",
      docs: "docs/CAPABILITIES.md"
    },
    {
      id: "agent-sessions",
      label: "Durable session storage",
      group: "runtime",
      enabled: true,
      configured: Boolean(env.AGENT_SESSIONS),
      required: ["AGENT_SESSIONS DO binding"],
      missing: env.AGENT_SESSIONS ? [] : ["AGENT_SESSIONS Durable Object binding"],
      hint: "Auto-provisioned on deploy — present by default in the shipped wrangler.toml.",
      docs: "docs/THINK_ALIGNMENT.md"
    },
    {
      id: "stream-hubs",
      label: "Streaming hub DO (multi-subscriber turns)",
      group: "runtime",
      enabled: true,
      configured: Boolean(env.STREAM_HUBS),
      required: ["STREAM_HUBS DO binding"],
      missing: env.STREAM_HUBS ? [] : ["STREAM_HUBS Durable Object binding"],
      hint: "Added in Phase 15 — apply migration v2 (`new_classes = [\"StreamHubDO\"]`).",
      docs: "docs/HELM.md#streaming-sse-over-a-codex-app-server-websocket"
    },
    /* ---------------- PA stack capability checks ---------------- */
    {
      id: "auth",
      label: "Cloudflare Access (auth gate)",
      group: "infrastructure",
      enabled: true,
      configured:
        Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) || env.DEV_AUTH_BYPASS === "1",
      required: ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD"],
      missing: (() => {
        if (env.DEV_AUTH_BYPASS === "1") return [];
        const m: string[] = [];
        if (!env.CF_ACCESS_TEAM_DOMAIN) m.push("CF_ACCESS_TEAM_DOMAIN");
        if (!env.CF_ACCESS_AUD) m.push("CF_ACCESS_AUD");
        return m;
      })(),
      hint:
        "Create a Self-hosted Access app at dash → Zero Trust → Access → Applications. Copy the Team domain + AUD tag. Free for ≤50 users.",
      docs: "docs/PA_STACK.md#one-time-setup"
    },
    {
      id: "d1",
      label: "D1 database (PA tables: memory, inbox, schedule, notifications, cost)",
      group: "infrastructure",
      enabled: true,
      configured: Boolean(env.DB),
      required: ["DB D1 binding"],
      missing: env.DB ? [] : ["DB D1 binding (run `wrangler d1 create`)"],
      hint: "npx wrangler d1 create tom-tom-pa, paste the database_id into wrangler.toml [[d1_databases]].",
      docs: "docs/PA_STACK.md#one-time-setup"
    },
    {
      id: "memory",
      label: "Agent Memory (managed beta + D1 fallback)",
      group: "tooling",
      enabled: enabled.has("memory"),
      configured: Boolean((env as Env & { MEMORY?: unknown }).MEMORY) || Boolean(env.DB),
      required: ["[[memory]] binding (preferred) OR DB binding (fallback)"],
      missing: (env as Env & { MEMORY?: unknown }).MEMORY || env.DB
        ? []
        : ["MEMORY binding or DB binding"],
      hint:
        "Cloudflare Agent Memory is in private beta — add the [[memory]] binding when your account has access. Until then, the D1 fallback runs automatically.",
      docs: "docs/PA_STACK.md"
    },
    {
      id: "email-send",
      label: "Email — outbound (Email Workers send_email binding)",
      group: "tooling",
      enabled: enabled.has("email"),
      configured: Boolean(env.SEB) && Boolean(env.OWNER_EMAIL || env.AGENT_OWNER_EMAIL),
      required: ["SEB send_email binding", "OWNER_EMAIL"],
      missing: (() => {
        const m: string[] = [];
        if (!env.SEB) m.push("[[send_email]] binding name=\"SEB\"");
        if (!env.OWNER_EMAIL && !env.AGENT_OWNER_EMAIL) m.push("OWNER_EMAIL");
        return m;
      })(),
      hint:
        "Enable Email Routing on your domain, verify a destination, add [[send_email]] in wrangler.toml. Set OWNER_EMAIL + FROM_EMAIL.",
      docs: "docs/PA_STACK.md"
    },
    {
      id: "email-inbound",
      label: "Email — inbound (Email Routing → email() handler)",
      group: "tooling",
      enabled: true,
      configured: Boolean(env.DB),
      required: ["dashboard: Email Routing → catch-all → this Worker"],
      missing: env.DB ? [] : ["wire Email Routing in dashboard (no env required)"],
      hint:
        "dash → Email → Email Routing → enable → add a verified destination → catch-all → Send to Worker → pick this Worker.",
      docs: "docs/PA_STACK.md"
    },
    {
      id: "notifier-webpush",
      label: "Notifier — Web Push (VAPID)",
      group: "tooling",
      enabled: enabled.has("notifier"),
      configured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) &&
        Boolean(env.VAPID_SUBJECT || env.OWNER_EMAIL || env.AGENT_OWNER_EMAIL),
      required: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
      missing: (() => {
        const m: string[] = [];
        if (!env.VAPID_PUBLIC_KEY) m.push("VAPID_PUBLIC_KEY");
        if (!env.VAPID_PRIVATE_KEY) m.push("VAPID_PRIVATE_KEY");
        if (!env.VAPID_SUBJECT && !env.OWNER_EMAIL && !env.AGENT_OWNER_EMAIL)
          m.push("VAPID_SUBJECT (or OWNER_EMAIL)");
        return m;
      })(),
      hint:
        "Run `npm run vapid:generate`, then `wrangler secret put VAPID_PUBLIC_KEY` / VAPID_PRIVATE_KEY / VAPID_SUBJECT.",
      docs: "docs/PA_STACK.md#web-push-vapid"
    },
    {
      id: "scheduler",
      label: "Scheduler (Workers Cron Triggers)",
      group: "infrastructure",
      enabled: true,
      configured: Boolean(env.DB),
      required: ["DB binding for pa_workflows table", "[triggers] crons in wrangler.toml"],
      missing: env.DB ? [] : ["DB binding"],
      hint:
        "Cron triggers in wrangler.toml fire scheduled() — wire each cron to a workflow row via POST /scheduler/workflows.",
      docs: "docs/PA_STACK.md#schedule-the-morning-briefing"
    },
    {
      id: "workflow-briefing",
      label: "Morning briefing (Cloudflare Workflows)",
      group: "infrastructure",
      enabled: true,
      configured: Boolean((env as Env & { BRIEFING_WORKFLOW?: unknown }).BRIEFING_WORKFLOW),
      required: ["BRIEFING_WORKFLOW binding"],
      missing: (env as Env & { BRIEFING_WORKFLOW?: unknown }).BRIEFING_WORKFLOW
        ? []
        : ["[[workflows]] binding for MorningBriefingWorkflow"],
      hint:
        "Add [[workflows]] name=\"morning-briefing\" binding=\"BRIEFING_WORKFLOW\" class_name=\"MorningBriefingWorkflow\" to wrangler.toml.",
      docs: "docs/PA_STACK.md"
    },
    {
      id: "cost-tracking",
      label: "Cost tracking (AI Gateway analytics → D1)",
      group: "infrastructure",
      enabled: true,
      configured:
        Boolean(env.DB) &&
        Boolean(env.CLOUDFLARE_ACCOUNT_ID) &&
        Boolean(env.AI_GATEWAY_ID) &&
        Boolean(env.CLOUDFLARE_API_TOKEN),
      required: ["DB", "CLOUDFLARE_ACCOUNT_ID", "AI_GATEWAY_ID", "CLOUDFLARE_API_TOKEN"],
      missing: (() => {
        const m: string[] = [];
        if (!env.DB) m.push("DB binding");
        if (!env.CLOUDFLARE_ACCOUNT_ID) m.push("CLOUDFLARE_ACCOUNT_ID");
        if (!env.AI_GATEWAY_ID) m.push("AI_GATEWAY_ID");
        if (!env.CLOUDFLARE_API_TOKEN) m.push("CLOUDFLARE_API_TOKEN");
        return m;
      })(),
      hint:
        "Daily cron pulls yesterday's gateway logs into the cost_daily table. Set DAILY_SPEND_CAP_USD to enforce a hard cap.",
      docs: "docs/PA_STACK.md"
    }
  ];

  const readinessScore = Math.round(
    (checks.filter((c) => c.configured).length / checks.length) * 100
  );

  const recommended: string[] = [];
  if (!enabled.has("cf-ai-gateway") || !hasEnvFlag(env, "AI_GATEWAY_ID")) {
    recommended.push("Enable cf-ai-gateway — unlocks many providers with one plugin");
  }
  if (!enabled.has("mcp-client") || !env.MCP_DEFAULT_URL) {
    recommended.push("Wire mcp-client to the Cloudflare MCP for chat-driven account operations");
  }
  if (enabled.has("codex") && !env.CODEX_APP_SERVER_URL) {
    recommended.push("Deploy companion/codex-bridge-worker/ to use a ChatGPT subscription end-to-end on Cloudflare");
  }
  // PA-stack recommendations
  if (env.DEV_AUTH_BYPASS !== "1" && (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD)) {
    recommended.push("Set up Cloudflare Access — without it your /app + /conductor/* are wide open");
  }
  if (!env.DB) {
    recommended.push("Run `wrangler d1 create tom-tom-pa` and add the binding — the PA stack lives in D1");
  }
  if (enabled.has("notifier") && !env.VAPID_PUBLIC_KEY) {
    recommended.push("`npm run vapid:generate` then `wrangler secret put VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` for Web Push");
  }
  if (enabled.has("email") && !env.SEB) {
    recommended.push("Add [[send_email]] binding to wrangler.toml + verify a destination in Email Routing");
  }
  if (!(env as Env & { BRIEFING_WORKFLOW?: unknown }).BRIEFING_WORKFLOW) {
    recommended.push("Add [[workflows]] binding for MorningBriefingWorkflow to enable the morning briefing");
  }

  const mcpBridge = {
    configured: Boolean(env.MCP_DEFAULT_URL),
    url: env.MCP_DEFAULT_URL,
    provider: env.MCP_DEFAULT_URL?.includes("mcp.cloudflare.com") ? "cloudflare" : "custom"
  };

  return {
    enabledPlugins: Array.from(enabled),
    capabilities: checks,
    readinessScore,
    recommended,
    mcpBridge
  };
}

export interface SnippetInput {
  enablePlugins?: string[];
  allowHosts?: string[];
}

export interface SnippetOutput {
  wrangler: string;
  devVars: string;
  notes: string[];
}

export function generateSnippet(env: Env, input: SnippetInput = {}): SnippetOutput {
  const enable = new Set(input.enablePlugins ?? []);
  const hosts = new Set<string>(input.allowHosts ?? []);
  const envLines: string[] = [];
  const notes: string[] = [];

  if (enable.has("cf-ai-gateway")) {
    hosts.add("gateway.ai.cloudflare.com");
    envLines.push("# Cloudflare AI Gateway — 23+ providers with BYOK");
    envLines.push("# AI_GATEWAY_ID=<your-gateway-id>");
    envLines.push("# CLOUDFLARE_ACCOUNT_ID=<your-account-id>");
    envLines.push("# CF_AI_GATEWAY_DEFAULT_MODEL=anthropic/claude-haiku-4-5");
  }
  if (enable.has("anthropic")) {
    hosts.add("api.anthropic.com");
    envLines.push("# Anthropic direct");
    envLines.push("# ANTHROPIC_API_KEY=sk-ant-...");
  }
  if (enable.has("openai-compatible")) {
    envLines.push("# OpenAI-compatible endpoint");
    envLines.push("# OPENAI_COMPATIBLE_URL=https://api.groq.com/openai/v1");
    envLines.push("# OPENAI_COMPATIBLE_KEY=...");
    notes.push("Add your OpenAI-compatible hostname to ALLOWED_HOSTS");
  }
  if (enable.has("codex")) {
    envLines.push("# Codex via ChatGPT subscription (recommended)");
    envLines.push("# CODEX_APP_SERVER_URL=wss://<your-bridge>");
    envLines.push("# CODEX_APP_SERVER_TOKEN=<bridge-bearer>");
    notes.push("Deploy companion/codex-bridge/ to host the Codex app-server");
  }
  if (enable.has("mcp-client")) {
    hosts.add("mcp.cloudflare.com");
    envLines.push("# MCP client (point at Cloudflare MCP for account ops)");
    envLines.push("# MCP_DEFAULT_URL=https://mcp.cloudflare.com/mcp");
    envLines.push("# MCP_BEARER_TOKEN=<your-cf-token>");
  }
  if (enable.has("browser")) {
    notes.push("Uncomment [browser] binding = \"BROWSER\" in wrangler.toml");
  }
  if (enable.has("sandbox")) {
    notes.push("Bind a SANDBOX service in wrangler.toml (companion Sandbox Worker)");
  }
  if (enable.has("artifacts")) {
    notes.push("Enable Cloudflare Artifacts binding when generally available");
  }
  /* ---------------- PA stack ---------------- */
  if (enable.has("memory")) {
    envLines.push("# Agent Memory (private beta) — falls back to D1 until [[memory]] is bound");
    notes.push("Add [[d1_databases]] binding=\"DB\" to wrangler.toml for the D1 fallback memory store");
  }
  if (enable.has("email")) {
    envLines.push("# Email Workers — set after enabling Email Routing on your domain");
    envLines.push("# OWNER_EMAIL=you@example.com");
    envLines.push("# FROM_EMAIL=helm@your-domain");
    notes.push("Add [[send_email]] name=\"SEB\" to wrangler.toml; verify destination in Email Routing");
  }
  if (enable.has("notifier")) {
    envLines.push("# Web Push (VAPID) — generate with `npm run vapid:generate`");
    envLines.push("# VAPID_PUBLIC_KEY=<base64url 65 bytes>");
    envLines.push("# VAPID_PRIVATE_KEY=<base64url 32 bytes>");
    envLines.push("# VAPID_SUBJECT=mailto:you@example.com");
  }
  if (enable.has("calendar")) {
    envLines.push("# Calendar via MCP — point at any calendar MCP server you trust");
    envLines.push("# CALENDAR_MCP_URL=https://your-cal-mcp.example.com");
    notes.push("Calendar requires a separate MCP server (no native CF calendar product yet)");
  }

  // Build ENABLED_PLUGINS line
  const enabledLine = Array.from(enable).join(",");
  const allowedHostsLine = Array.from(hosts).join(",");

  const existingEnabled = env.ENABLED_PLUGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const mergedEnabled = Array.from(new Set([...existingEnabled, ...enable]));
  const existingHosts = env.ALLOWED_HOSTS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const mergedHosts = Array.from(new Set([...existingHosts, ...hosts]));

  const wrangler = `# Append/update the [vars] block in wrangler.toml:

[vars]
ENABLED_PLUGINS = "${mergedEnabled.join(",")}"
ALLOWED_HOSTS = "${mergedHosts.join(",")}"
`;

  const devVars =
    envLines.length === 0
      ? "# no new env vars needed for the selected set\n"
      : `# Append to .dev.vars / \`wrangler secret put <NAME>\` for each:\n\n${envLines.join("\n")}\n\n# Also add to your list:\nENABLED_PLUGINS=${enabledLine}\nALLOWED_HOSTS=${allowedHostsLine}\n`;

  return { wrangler, devVars, notes };
}

export interface GuidedStartInput {
  goal?: string;
  provider?: string;
  bringCloudflareMcp?: boolean;
}

export interface GuidedStartOutput {
  sessionName: string;
  goal: string;
  recommendedMode: "propose" | "selective";
  primer: string;
}

export async function guidedStart(
  env: Env,
  runtime: AgentRuntime,
  skills: SkillManager,
  body: GuidedStartInput
): Promise<GuidedStartOutput> {
  if (!env.AGENT_SESSIONS) {
    throw new AppError("E_DO_BINDING_MISSING", "AGENT_SESSIONS binding required", 500);
  }
  const sessionName = `setup:${crypto.randomUUID()}`;
  const goal = body.goal?.trim() || "walk me through the recommended minimal setup";
  const status = collectStatus(env, runtime);

  const mcpGuidance = status.mcpBridge.configured
    ? `The user has the Cloudflare MCP configured (URL: ${status.mcpBridge.url}). Prefer skill \`mcp-call-tool\` with provider tools (kv_namespace_create, ai_gateway_create, accounts_list, etc.) to provision infrastructure directly. Each invocation will surface as an approve-to-run exhibit.`
    : `The user does NOT yet have the Cloudflare MCP configured. Walk them through enabling the \`mcp-client\` plugin with MCP_DEFAULT_URL=https://mcp.cloudflare.com/mcp first — it unlocks chat-driven account operations.`;

  const availableSkills = skills
    .listSkills()
    .map((s) => `- ${s.id}${s.dangerous ? " [dangerous]" : ""}: ${s.description}`)
    .join("\n");

  const agentName = env.AGENT_NAME ?? "the agent";
  const agentOwner = env.AGENT_OWNER ? `${env.AGENT_OWNER}'s ` : "";
  const personalContext = env.PERSONAL_CONTEXT
    ? `\n\nPersonal context about ${agentOwner || "the user"}:\n${env.PERSONAL_CONTEXT}\n`
    : "";

  const primer = `SETUP WIZARD CONTEXT — this session exists to help ${agentOwner}configure ${agentName}.

User goal: ${goal}

Current runtime readiness: ${status.readinessScore}%.
Enabled plugins: ${status.enabledPlugins.join(", ") || "(none)"}.

Capability status:
${status.capabilities
  .map((c) => `- ${c.label} — ${c.enabled ? "enabled" : "disabled"}, ${c.configured ? "configured" : "MISSING: " + c.missing.join("; ")}`)
  .join("\n")}

Recommended next actions:
${status.recommended.length > 0 ? status.recommended.map((r) => "- " + r).join("\n") : "- (runtime looks ready — ask the user what they want to build next)"}

${mcpGuidance}${personalContext}

Available skills you may propose:
${availableSkills}

Guidance:
- Be concrete. Propose at most 2 next steps per turn.
- When infrastructure changes are needed, use \`admin-env-template\` or \`setup-snippet\` to show the user exactly what to add.
- Mark destructive actions with \`[dangerous]\` and wait for user approval.
`;

  const doId = env.AGENT_SESSIONS.idFromName(sessionName);
  const stub = env.AGENT_SESSIONS.get(doId);
  await stub.fetch(
    new Request("https://do/init", {
      method: "POST",
      body: JSON.stringify({ title: `Setup wizard — ${goal.slice(0, 60)}` })
    })
  );
  await stub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      body: JSON.stringify({ role: "system", content: primer })
    })
  );

  return {
    sessionName,
    goal,
    recommendedMode: status.mcpBridge.configured ? "selective" : "propose",
    primer
  };
}
