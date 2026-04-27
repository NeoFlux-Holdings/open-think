import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import agentPromptMd from "../../../docs/AGENT_DEPLOY_PROMPT.md";

/**
 * /deploy/agent — surface the AGENT_DEPLOY_PROMPT.md content with copy
 * controls + one-click jumps to popular AI agents.
 *
 * Goal: the user copies the prompt, opens Cloudflare's Agent Lee (or
 * Claude / ChatGPT), pastes, and the agent walks them through deploy.
 *
 * The prompt itself lives in docs/AGENT_DEPLOY_PROMPT.md so it co-evolves
 * with the rest of the docs (and so /docs/agent-deploy-prompt is
 * a browsable copy too — same source of truth).
 */

export function renderCloudAgent(): string {
  // Extract the actual prompt block (between BEGIN PROMPT and END PROMPT).
  const promptBlock = extractPromptBlock(agentPromptMd);

  return `${htmlHead({
    title: "Deploy via AI agent",
    description:
      "Paste this prompt into Cloudflare's Agent Lee, Claude, or ChatGPT and the agent walks you through deploying Open Think — no terminal needed."
  })}
<main>

<section class="reveal d1" style="padding-top: 28px;">
  <div class="edition mono">§14 · Deploy via AI agent</div>
  <h1 class="serif" style="font-size: clamp(40px, 6.4vw, 72px); max-width: 22ch;">
    Hand the deploy to <em>your favorite</em> AI agent.
  </h1>
  <p class="sub" style="max-width: 60ch;">
    Cloudflare ships an AI assistant called <b>Agent Lee</b> in the dashboard.
    Claude and ChatGPT can drive a deploy from anywhere.
    Copy the prompt below, paste it into one of those, and the agent
    walks you through every step. Same outcome as
    <a href="/deploy/cloud">/deploy/cloud</a> — just fewer manual clicks.
  </p>
</section>

<section class="reveal d2" style="margin-top: 28px;">
  <div class="section-ref"><span>§14.1 · Pick an agent</span><span class="rule"></span></div>
  <div class="agent-grid">
    <a class="agent-card" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">
      <div class="agent-card-eyebrow mono">Cloudflare-native</div>
      <h3 class="serif">Agent Lee</h3>
      <p>CF dashboard chat icon. Has direct CF API tool access — can create the token + verify health for you.</p>
      <div class="mono agent-card-cta">Open dash.cloudflare.com →</div>
    </a>
    <a class="agent-card" href="https://claude.ai/new" target="_blank" rel="noopener">
      <div class="agent-card-eyebrow mono">Most capable</div>
      <h3 class="serif">Claude</h3>
      <p>Anthropic's claude.ai. Excellent at multi-step deploys + debugging. Free tier works fine for this.</p>
      <div class="mono agent-card-cta">Open claude.ai →</div>
    </a>
    <a class="agent-card" href="https://chatgpt.com/" target="_blank" rel="noopener">
      <div class="agent-card-eyebrow mono">Most familiar</div>
      <h3 class="serif">ChatGPT</h3>
      <p>OpenAI's chatgpt.com. With browsing on, can verify the docs URLs as it goes.</p>
      <div class="mono agent-card-cta">Open chatgpt.com →</div>
    </a>
  </div>
</section>

<section class="reveal" style="margin-top: 36px;">
  <div class="section-ref"><span>§14.2 · The prompt</span><span class="rule"></span><span>copy → paste</span></div>
  <p style="max-width: 60ch;">
    This is the full prompt — it includes context about Open Think, the
    four deploy paths, the right CF token scopes, common errors, and what
    the agent should do at each step. You can edit the
    <span class="mono">{{USER_GOAL_OR_BLANK}}</span> at the bottom before
    pasting if you want to seed the conversation.
  </p>
  <div class="prompt-actions">
    <button id="copy-prompt" class="btn primary">
      Copy full prompt <span class="arrow" aria-hidden="true">↗</span>
    </button>
    <button id="copy-prompt-min" class="btn ghost">Copy short version</button>
    <a class="btn ghost" href="/docs/agent-deploy-prompt">View as doc →</a>
  </div>
  <pre id="prompt-text" class="prompt-pre">${escapeHtml(promptBlock)}</pre>
</section>

<section class="reveal" style="margin-top: 36px;">
  <div class="section-ref"><span>§14.3 · Then come back</span><span class="rule"></span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">After the agent is done.</h2>
    </div>
    <div>
      <p>
        The agent's job is to get you a live Worker URL. Once it does,
        come back here for the management surface:
      </p>
      <ul style="margin-top: 12px; padding-left: 20px;">
        <li><a href="/deploy/cloud">/deploy/cloud</a> — same form, paste-token deploy if the agent suggests this path</li>
        <li><a href="/deploy/guided">/deploy/guided</a> — terminal-styled walkthrough variant</li>
        <li><a href="/cloud/manage">/cloud/manage</a> — manage page for Helm Cloud subscribers (you'll have a bookmarkable URL after deploy)</li>
        <li><a href="/cloud/recover">/cloud/recover</a> — if you lost your manage URL</li>
        <li><a href="/api/cloud/health">/api/cloud/health</a> — operator status (JSON; safe to share)</li>
      </ul>
    </div>
  </div>
</section>

</main>

<style>
.agent-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  margin-top: 22px;
}
@media (max-width: 900px) { .agent-grid { grid-template-columns: 1fr; } }
.agent-card {
  display: block;
  padding: 26px 28px;
  border-right: 1px solid var(--rule);
  color: var(--ink);
  border-bottom: none;
  transition: background 0.2s;
}
.agent-card:last-child { border-right: none; }
@media (max-width: 900px) {
  .agent-card { border-right: none; border-bottom: 1px solid var(--rule); }
  .agent-card:last-child { border-bottom: none; }
}
.agent-card:hover { background: var(--shade); color: var(--ink); }
.agent-card-eyebrow { font-size: 10px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; margin-bottom: 10px; }
.agent-card h3 { margin-bottom: 10px; }
.agent-card p { font-size: 14px; color: var(--muted); margin-bottom: 14px; }
.agent-card-cta { font-size: 11px; letter-spacing: 0.12em; color: var(--accent); text-transform: uppercase; }

.prompt-actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0 14px; }

.prompt-pre {
  background: #0e0e10;
  color: #e8e6e3;
  padding: 22px 24px;
  font-family: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.55;
  overflow-x: auto;
  max-height: 640px;
  overflow-y: auto;
  border-radius: 6px;
  border: 1px solid #25252a;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin-top: 6px;
}

@media (max-width: 720px) {
  .prompt-pre { font-size: 11px; padding: 14px 16px; max-height: 480px; }
}
</style>

<script>
(function () {
  const full = document.getElementById('prompt-text').textContent || '';

  // Short version: just the BEGIN PROMPT block stripped of everything else.
  // Useful for chat services with strict input-length limits.
  const short = full.replace(
    /\\n\\nUser's stated goal:[\\s\\S]*$/,
    "\\n\\nUser's stated goal: ___\\n\\nBegin by asking what they want to do."
  );

  function copy(text, btn) {
    if (!btn) return;
    const original = btn.textContent;
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = original; }, 1500);
    }).catch(function () {
      btn.textContent = 'Copy failed — select + Cmd/Ctrl-C';
    });
  }

  const fullBtn = document.getElementById('copy-prompt');
  if (fullBtn) fullBtn.addEventListener('click', function () { copy(full, fullBtn); });
  const minBtn = document.getElementById('copy-prompt-min');
  if (minBtn) minBtn.addEventListener('click', function () { copy(short, minBtn); });
})();
</script>

${htmlFoot()}`;
}

/**
 * Pull the BEGIN PROMPT…END PROMPT block out of the markdown so the page
 * shows just the copyable prompt, not the surrounding doc commentary.
 */
function extractPromptBlock(md: string): string {
  const begin = md.indexOf("====================== BEGIN PROMPT ======================");
  const end = md.indexOf("======================= END PROMPT =======================");
  if (begin < 0 || end < 0 || end < begin) {
    return md.trim();
  }
  return md.slice(begin, end + "======================= END PROMPT =======================".length).trim();
}
