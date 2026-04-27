import { htmlHead, htmlFoot, logoSvg } from "../layout";
import { ENTRIES, renderChangelogPreviewCard } from "./changelog";

export function renderLanding(): string {
  return `${htmlHead({
    title: "",
    description:
      "Open Think is an open-source agent runtime for Cloudflare. Plugins, connectors, and MCP on one bus. Free to run, pro when you need hands."
  })}
<main>

<section class="hero">
  <div class="reveal d1">
    <div class="edition mono">Vol. 1 · Issue 1 · 2026 · Research edition</div>
    <h1 class="serif">
      <span class="line">Agents</span>
      <span class="line">on <em>Cloudflare's</em></span>
      <span class="line">edge.</span>
    </h1>
    <p class="sub">
      An open-source agent runtime for Cloudflare. Plugins, connectors, and MCP
      on one bus — durable, streaming, built in public.
    </p>
    <div class="actions">
      <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think" class="btn primary">
        Deploy to Cloudflare <span class="arrow">→</span>
      </a>
      <a href="/docs" class="btn ghost">Read the docs</a>
    </div>
    <div class="stats">
      <div><b>23</b><span>providers via gateway</span></div>
      <div><b>17</b><span>plugins</span></div>
      <div><b>162</b><span>tests passing</span></div>
    </div>
  </div>

  <div class="node-graph reveal d2" aria-hidden="true">
    ${heroGraphSvg()}
  </div>
</section>

<section class="reveal d3">
  <div class="section-ref"><span>§01 · Primitives</span><span class="rule"></span><span>Built on what Cloudflare ships</span></div>
  <h2 class="headline serif">Four primitives.<br>One plugin bus.</h2>
  <p class="lede">
    The same Cloudflare stack that runs the biggest sites on the internet now runs
    agents. Open Think wires it together so you can ship one on a weekend.
  </p>

  <div class="grid-3" style="margin-top: 36px;">
    <div class="pillar">
      <span class="n mono">§01.1</span>
      <h3 class="serif">Durable by default</h3>
      <p>Every agent is a Durable Object with its own SQLite database. Sessions, fibers, and tool-call history survive restarts. Hibernate when idle, wake on the next turn.</p>
    </div>
    <div class="pillar">
      <span class="n mono">§01.2</span>
      <h3 class="serif">Any model, one bus</h3>
      <p>Workers AI, Anthropic, OpenAI, Groq, Google — and 19 more via the Cloudflare AI Gateway. Stream tool-use natively. Swap providers without touching agent code.</p>
    </div>
    <div class="pillar">
      <span class="n mono">§01.3</span>
      <h3 class="serif">MCP out of the box</h3>
      <p>Every agent is an MCP client the moment you deploy. Point it at Cloudflare's own MCP and you have a chat-first control plane for your whole account — with approve-to-run exhibits and rollback.</p>
    </div>
  </div>
</section>

<section class="reveal d4">
  <div class="section-ref"><span>§02 · Helm</span><span class="rule"></span><span>A meta-agent you talk to</span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif"><em>Helm</em> reads your runtime<br>and plans the next move.</h2>
    </div>
    <div>
      <p class="lede">
        Ask in plain English. Helm reads your plugin catalog, proposes skill
        invocations as approve-to-run exhibits, or — in <span class="mono">auto</span>
        mode — runs the whole plan end-to-end with native tool-use streaming.
      </p>
      <p style="color: var(--muted); font-size: 16px; margin-top: 10px;">
        Three modes · <span class="mono accent">propose</span> · <span class="mono accent">selective</span> · <span class="mono accent">auto</span> — pick per call.
      </p>
      <div class="actions" style="margin-top: 24px;">
        <a href="/docs/helm" class="btn">Read the Helm docs <span class="arrow">→</span></a>
      </div>
    </div>
  </div>
</section>

<section class="reveal">
  <div class="section-ref"><span>§03 · Open by design</span><span class="rule"></span><span>Apache 2.0 · community-driven</span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Free&nbsp;to run.<br>Pro when you need hands.</h2>
    </div>
    <div>
      <p>
        Open Think is Apache-2.0 forever. Deploy it to your own Cloudflare account in
        a single click — zero cost when idle, generous free tier for Workers AI and
        Durable Objects.
      </p>
      <p>
        For teams who want a managed instance with priority support, or a one-shot
        concierge to configure everything live, we sell hands and time — not software.
      </p>
      <div class="actions" style="margin-top: 22px;">
        <a href="/pricing" class="btn primary">See pricing <span class="arrow">→</span></a>
        <a href="/concierge" class="btn ghost">Book a concierge session</a>
      </div>
    </div>
  </div>
</section>

<section class="reveal">
  <div class="section-ref"><span>§04 · Shipped, recently</span><span class="rule"></span><a href="/changelog" class="mono" style="font-size: 11px; letter-spacing: 0.14em;">Full changelog →</a></div>
  <div class="cl-preview-grid">
    ${ENTRIES.slice(0, 3).map((e) => renderChangelogPreviewCard(e)).join("")}
  </div>
</section>

<section class="reveal">
  <div class="section-ref"><span>§05 · See it move</span><span class="rule"></span><span>~40 seconds</span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">A <em>Helm</em> turn, played back.</h2>
    </div>
    <div>
      <p>
        A scripted transcript of a real-shape turn: a streaming reply, a tool
        invocation, an approve-to-run exhibit, and Helm's conclusion. No backend —
        just the protocol visualized.
      </p>
      <div class="actions" style="margin-top: 22px;">
        <a href="/demo" class="btn primary">Watch the demo <span class="arrow">→</span></a>
      </div>
    </div>
  </div>
</section>

<section class="reveal">
  <div class="section-ref"><span>§06 · Marketplace</span><span class="rule"></span><a href="/marketplace" class="mono" style="font-size: 11px; letter-spacing: 0.14em;">Browse all →</a></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Plug in. <em>Chain up.</em></h2>
    </div>
    <div>
      <p>
        First-party plugins, MCP servers, and skill packs — plus honest pointers
        to community projects that inspired us. Verified entries are wired and
        tested. Reference entries are linked with integration notes, not promises.
      </p>
      <div class="actions" style="margin-top: 22px; gap: 10px; flex-wrap: wrap;">
        <a href="/marketplace?type=plugin" class="btn ghost">Plugins</a>
        <a href="/marketplace?type=mcp-server" class="btn ghost">MCP servers</a>
        <a href="/marketplace?type=skill-pack" class="btn ghost">Skill packs</a>
      </div>
    </div>
  </div>
</section>

<section class="reveal">
  <div class="section-ref"><span>§07 · Inspired by Project Think</span><span class="rule"></span><span>Carrying the tradition forward</span></div>
  <blockquote class="serif italic" style="font-size: clamp(26px, 3vw, 40px); line-height: 1.3; color: var(--ink); max-width: 28ch; margin-left: 0; border-left: 2px solid var(--accent); padding-left: 28px; margin-top: 24px;">
    "Durable, distributed, structurally&nbsp;safe, and serverless."
  </blockquote>
  <p class="mono" style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-top: 18px;">
    — Cloudflare, <a href="https://blog.cloudflare.com/project-think/">Project Think announcement</a>
  </p>
  <p style="margin-top: 26px; max-width: 58ch;">
    Cloudflare's Project Think laid out the third wave of agents: durable execution, fibers, facets, session APIs, and a sandboxed execution ladder. Open Think is a community reading of that vision — plugin-first, multi-provider, and deployable today by anyone with a Cloudflare account.
  </p>
</section>

</main>
${htmlFoot()}`;
}

/**
 * Animated node-graph hero illustration. Five primitives orbit a center node
 * with pulsing "live" rings on the accent-colored ones.
 */
function heroGraphSvg(): string {
  void logoSvg; // keep the logo utility imported so tree-shaking doesn't kill it
  return `<svg viewBox="0 0 420 420" aria-hidden="true">
    <defs>
      <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.6" fill="currentColor" opacity="0.12"/>
      </pattern>
    </defs>
    <rect width="420" height="420" fill="url(#dots)" style="color: var(--ink)"/>

    <!-- edges -->
    <line x1="210" y1="210" x2="70" y2="80" class="edge edge-live"/>
    <line x1="210" y1="210" x2="350" y2="80" class="edge edge-live"/>
    <line x1="210" y1="210" x2="350" y2="340" class="edge"/>
    <line x1="210" y1="210" x2="70" y2="340" class="edge"/>
    <line x1="210" y1="210" x2="210" y2="60" class="edge edge-live"/>

    <!-- center -->
    <circle cx="210" cy="210" r="12" class="node"/>
    <text x="210" y="244" text-anchor="middle" class="node-label">agent</text>

    <!-- primitives -->
    <g>
      <circle cx="70" cy="80" r="7" class="node accent"/>
      <circle cx="70" cy="80" class="node-ring n1" cx="70" cy="80"/>
      <text x="70" y="60" text-anchor="middle" class="node-label">Durable Object</text>
    </g>
    <g>
      <circle cx="350" cy="80" r="7" class="node"/>
      <circle cx="350" cy="80" class="node-ring n2" cx="350" cy="80"/>
      <text x="350" y="60" text-anchor="middle" class="node-label">Workers AI</text>
    </g>
    <g>
      <circle cx="210" cy="60" r="7" class="node accent"/>
      <circle cx="210" cy="60" class="node-ring n3" cx="210" cy="60"/>
      <text x="210" y="40" text-anchor="middle" class="node-label">MCP</text>
    </g>
    <g>
      <circle cx="350" cy="340" r="7" class="node"/>
      <text x="350" y="370" text-anchor="middle" class="node-label">Browser</text>
    </g>
    <g>
      <circle cx="70" cy="340" r="7" class="node"/>
      <text x="70" y="370" text-anchor="middle" class="node-label">Sandbox</text>
    </g>
  </svg>`;
}
