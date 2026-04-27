import { htmlHead, htmlFoot } from "../layout";

export interface Entry {
  phase: string;
  date: string;
  title: string;
  bullets: string[];
}

// Hand-curated from docs/EXECUTION_PLAN.md — each deploy updates this list.
// Keep it short: readers skim; we link to the repo for deeper history.
export const ENTRIES: Entry[] = [
  {
    phase: "Phase 17",
    date: "2026-04-17",
    title: "Cross-provider streaming + update-style rollback",
    bullets: [
      "Shared LoopEvent union across Anthropic / OpenAI-compatible / CF AI Gateway",
      "OpenAI-compatible SSE adapter — unlocks Groq, Together, Ollama, self-hosted",
      "Update-style MCP rollback with pre-mutation state capture (DNS, KV, Hyperdrive)",
      "115 tests, all green"
    ]
  },
  {
    phase: "Phase 16",
    date: "2026-04-17",
    title: "Native tool-use streaming + MCP rollback",
    bullets: [
      "Anthropic Messages streaming with tool_use blocks, end-to-end SSE to browser",
      "Selective mode: dangerous tool calls halt mid-stream as exhibit cards",
      "MCP rollback registry with 8 create-delete inverses and generative rollback hints",
      "Session DO gained rollback columns with live migration"
    ]
  },
  {
    phase: "Phase 15",
    date: "2026-04-17",
    title: "Multi-subscriber streaming + Settings panel",
    bullets: [
      "StreamHubDO: one upstream WS, N SSE subscribers, 500-frame replay buffer",
      "Turn cancellation via turn/interrupt",
      "Settings tab with capability checklist + snippet generator",
      "Guided setup via Helm with MCP integration"
    ]
  },
  {
    phase: "Phase 14",
    date: "2026-04-17",
    title: "Streaming + companion codex-bridge",
    bullets: [
      "Durable Object-held WebSocket streaming for Codex app-server",
      "Companion Node server wraps codex stdio into HTTP + SSE",
      "Dockerfile + recipes for CF Containers, Fly, local tunnels"
    ]
  },
  {
    phase: "Phase 13",
    date: "2026-04-17",
    title: "Fallback chains + app-server bridge",
    bullets: [
      "chat-with-fallbacks: ordered model[] retries with per-model timeout + attempts ledger",
      "Codex plugin: app-server JSON-RPC bridge (HTTP or WS)",
      "5 new Codex skills including raw RPC passthrough"
    ]
  },
  {
    phase: "Phase 12",
    date: "2026-04-17",
    title: "Cloudflare AI Gateway + Codex subscription auth",
    bullets: [
      "cf-ai-gateway plugin: 23+ providers via BYOK Secrets Store",
      "Codex plugin with API key or pasted ChatGPT subscription tokens",
      "Binding path (env.AI.run) + compat REST path"
    ]
  },
  {
    phase: "Phase 11",
    date: "2026-04-17",
    title: "Native tool-use + three setup paths",
    bullets: [
      "Three Helm modes: propose, selective, auto",
      "SkillDefinition gained inputSchema + dangerous flags",
      "External agents can drive Helm as a planner"
    ]
  },
  {
    phase: "Phase 10",
    date: "2026-04-17",
    title: "Meta-agent + editorial UI",
    bullets: [
      "Admin plugin with runtime introspection",
      "Helm meta-agent at POST /conductor/message",
      "Editorial-broadsheet /app UI with 8 sections"
    ]
  }
];

export function renderChangelog(): string {
  return `${htmlHead({
    title: "Changelog",
    description: "Every phase of Open Think, shipped in public. Short, dated, and linked back to the repo."
  })}
<main>

<section class="hero" style="padding-top: 48px; grid-template-columns: 1fr; display: block;">
  <div class="reveal d1">
    <div class="edition mono">§05 · Changelog · shipped in public</div>
    <h1 class="serif" style="font-size: clamp(52px, 8vw, 104px); max-width: 18ch;">
      Every <em>phase</em>, dated.
    </h1>
    <p class="sub" style="max-width: 56ch;">
      We ship in narrow vertical slices and write every phase down before moving to the
      next. The repo's <span class="mono"><a href="https://github.com/NeoFlux-Holdings/open-think/blob/main/docs/EXECUTION_PLAN.md">docs/EXECUTION_PLAN.md</a></span> is the source of truth; this page is the
      reader's digest.
    </p>
  </div>
</section>

<section class="reveal d2">
  <div class="section-ref"><span>§05.1 · Phases</span><span class="rule"></span><span>Newest first</span></div>
  ${ENTRIES.map((e, i) => renderEntry(e, i)).join("")}
</section>

<section class="reveal">
  <p style="color: var(--muted); font-style: italic; font-family: 'Instrument Serif', serif; font-size: 22px; max-width: 42ch; margin-top: 16px;">
    Watching the repo is the fastest way to stay current.
    <a href="https://github.com/NeoFlux-Holdings/open-think" style="display: block; margin-top: 10px; font-size: 15px; font-style: normal; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.08em; text-transform: uppercase;">github.com/NeoFlux-Holdings/open-think →</a>
  </p>
</section>

</main>
${htmlFoot()}`;
}

function renderEntry(e: Entry, i: number): string {
  return `<div class="entry reveal" style="animation-delay: ${80 + i * 40}ms;">
  <div class="label">${e.phase} · ${e.date}</div>
  <h3 class="serif">${e.title}</h3>
  <ul>
    ${e.bullets.map((b) => `<li>${b}</li>`).join("")}
  </ul>
</div>`;
}

/** Compact card rendering for the landing-page preview. */
export function renderChangelogPreviewCard(e: Entry): string {
  return `<a href="/changelog" class="cl-preview-card">
    <div class="cl-preview-meta mono">${e.phase} · ${e.date}</div>
    <div class="cl-preview-title serif">${e.title}</div>
    <div class="cl-preview-bullet">${e.bullets[0] ?? ""}</div>
  </a>`;
}
