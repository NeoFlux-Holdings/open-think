import { htmlHead, htmlFoot } from "../layout";

/**
 * /demo — a scripted, zero-backend animation of a Helm turn. Demonstrates:
 *   - Streaming text deltas from the model
 *   - A tool-use call landing mid-stream as an Exhibit card
 *   - The tool result streaming into that card
 *   - The final assistant conclusion
 *   - A "Replay" button that restarts the whole sequence
 *
 * All of this is pure HTML + CSS + vanilla JS driven by setTimeout. No network.
 * The script below is a list of timed "beats" — characters, tool-use events,
 * and pauses — played back by a tiny scheduler.
 */

export function renderDemo(): string {
  return `${htmlHead({
    title: "Demo",
    description:
      "A scripted walk-through of a Helm turn — streaming deltas, tool-use exhibits, approve-to-run cards."
  })}
<main>

<section class="hero" style="padding-top: 32px; grid-template-columns: 1fr;">
  <div class="reveal d1">
    <div class="edition mono">§09 · Demo · scripted · ~40 seconds</div>
    <h1 class="serif" style="font-size: clamp(44px, 7vw, 80px); max-width: 20ch;">
      A <em>Helm</em> turn, in full.
    </h1>
    <p class="sub" style="max-width: 60ch;">
      This is canned. The transcript below replays a real-shape turn: a streaming reply,
      a tool invocation, an approve-to-run exhibit, and Helm's final note.
      Your deployed Helm runs the same protocol against any provider you pick.
    </p>
  </div>
</section>

<section class="reveal d2 demo-wrap">
  <div class="section-ref"><span>§09.1 · Transcript</span><span class="rule"></span><span class="demo-status mono" id="demo-status">idle</span></div>

  <div class="conductor-panel" id="demo-panel">
    <div class="conductor-body" id="demo-body"></div>
    <div class="composer">
      <div class="composer-input mono" id="demo-input"></div>
      <button class="btn ghost" id="demo-replay" disabled>Replay ↻</button>
    </div>
  </div>

  <p style="margin-top: 24px; color: var(--muted); font-size: 14px; max-width: 60ch;">
    Want the real thing? <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think">Deploy to Cloudflare</a> and open <span class="mono">/app</span> for your own Helm, wired to whichever provider you enabled.
  </p>
</section>

</main>
<style>
.demo-wrap { padding: 28px 0 56px; }
.conductor-panel {
  border: 1px solid var(--rule);
  background: var(--paper);
  position: relative;
  margin-top: 28px;
}
.conductor-panel::before {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid var(--muted-2);
  pointer-events: none;
}
.conductor-body {
  padding: 20px 22px;
  min-height: 280px;
  max-height: 560px;
  overflow-y: auto;
  font-size: 16px;
  line-height: 1.55;
}
.composer {
  border-top: 1px solid var(--rule);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.composer-input {
  flex: 1;
  min-height: 26px;
  font-size: 14px;
  color: var(--ink);
  padding: 4px 0;
  border-bottom: 1px dotted var(--muted-2);
}
.composer-input.empty::before { content: "▮"; color: var(--accent); animation: caret 1s step-end infinite; }
@keyframes caret { 50% { opacity: 0; } }

.demo-msg {
  border-bottom: 1px dotted var(--muted-2);
  padding: 14px 0;
}
.demo-msg:first-child { padding-top: 0; }
.demo-msg:last-child { border-bottom: none; }
.demo-msg .who {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}
.demo-msg.assistant .who { color: var(--accent); }
.demo-msg .content { font-size: 15px; line-height: 1.55; white-space: pre-wrap; }
.demo-msg .content .caret { color: var(--accent); animation: caret 1s step-end infinite; margin-left: 2px; }

.exhibit {
  margin: 12px 0;
  border: 1px solid var(--rule);
  padding: 12px 14px;
  position: relative;
  background: var(--paper);
}
.exhibit::before {
  content: "Exhibit";
  position: absolute;
  top: -8px; left: 12px;
  background: var(--paper);
  padding: 0 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.exhibit .skill-id { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--accent); }
.exhibit .input-preview {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
  max-height: 80px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.exhibit button {
  margin-top: 8px;
  border: 1px solid var(--accent);
  color: var(--paper);
  background: var(--accent);
  padding: 5px 12px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
}
.exhibit button:disabled { opacity: 0.55; cursor: not-allowed; }
.exhibit .result {
  margin-top: 10px;
  border-left: 2px solid var(--accent);
  padding: 8px 12px;
  background: rgba(243, 128, 32, 0.05);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--ink);
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  display: none;
}
.exhibit .result.visible { display: block; animation: fade-in 0.4s ease-out; }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

.demo-status { color: var(--muted); }
.demo-status.live { color: var(--accent); }

@media (max-width: 600px) {
  .conductor-body { padding: 16px; min-height: 240px; }
  .composer { padding: 12px 14px; }
}
</style>
<script>
(() => {
  const body = document.getElementById('demo-body');
  const input = document.getElementById('demo-input');
  const status = document.getElementById('demo-status');
  const replay = document.getElementById('demo-replay');
  if (!body || !input || !status || !replay) return;

  /**
   * Script as a sequence of beats. Each beat returns a Promise that resolves
   * when its visual effect completes (or its delay elapses).
   */
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function typeInto(el, text, speed = 24) {
    for (let i = 0; i < text.length; i++) {
      el.textContent = text.slice(0, i + 1);
      await wait(speed);
    }
  }

  async function streamAssistantChunks(contentEl, chunks, delay = 36) {
    contentEl.innerHTML = '<span class="caret"></span>';
    for (const chunk of chunks) {
      const current = contentEl.textContent.replace(/\\s*$/, '');
      contentEl.innerHTML = escapeHtml(current + chunk) + '<span class="caret"></span>';
      await wait(delay);
    }
    contentEl.innerHTML = escapeHtml(contentEl.textContent || '');
  }

  function addMessage(role, labelOverride) {
    const el = document.createElement('div');
    el.className = 'demo-msg ' + (role === 'assistant' ? 'assistant' : '');
    const sigil = role === 'assistant' ? '✦' : '§';
    const label = labelOverride || (role === 'assistant' ? 'Helm · anthropic · stream' : 'You');
    el.innerHTML = '<div class="who">' + sigil + '  ' + escapeHtml(label) + '</div><div class="content"></div>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el.querySelector('.content');
  }

  function addExhibit(parent, skill, input, result) {
    const exhibit = document.createElement('div');
    exhibit.className = 'exhibit';
    exhibit.innerHTML = \`
      <div><span class="mono" style="color: var(--muted); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;">propose:</span>
      <span class="skill-id">\${escapeHtml(skill)}</span></div>
      <div class="input-preview">\${escapeHtml(JSON.stringify(input, null, 2))}</div>
      <button type="button">Execute →</button>
      <pre class="result"></pre>
    \`;
    parent.appendChild(exhibit);
    const btn = exhibit.querySelector('button');
    const resultEl = exhibit.querySelector('.result');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Running…';
      await wait(700);
      resultEl.textContent = JSON.stringify(result, null, 2);
      resultEl.classList.add('visible');
      btn.textContent = 'Done ✓';
      body.scrollTop = body.scrollHeight;
    });
    body.scrollTop = body.scrollHeight;
    return { exhibit, btn, resultEl };
  }

  async function runScene() {
    body.innerHTML = '';
    input.textContent = '';
    input.classList.add('empty');
    status.textContent = 'idle';
    status.classList.remove('live');
    replay.disabled = true;

    // 1. User types into the composer
    await wait(600);
    status.textContent = 'live';
    status.classList.add('live');
    input.classList.remove('empty');
    await typeInto(input, 'check my runtime health and propose one next step', 28);
    await wait(400);

    // 2. User message card
    const userContent = addMessage('user');
    userContent.textContent = input.textContent;
    input.textContent = '';
    input.classList.add('empty');
    await wait(350);

    // 3. Assistant starts streaming
    const assistantContent = addMessage('assistant');
    await streamAssistantChunks(assistantContent, [
      'Scanning your runtime… ',
      'nine plugins loaded, ',
      'workers-ai and cf-ai-gateway are enabled. ',
      'Running an admin-health-check now.'
    ], 50);
    await wait(250);

    // 4. Tool exhibit → admin-health-check → auto-execute in the demo
    const healthParent = assistantContent.parentElement;
    const { btn: healthBtn } = addExhibit(
      healthParent,
      'admin-health-check',
      {},
      {
        healthy: true,
        plugins: 9,
        enabled: ['admin','workers-ai','cf-ai-gateway','mcp-client','anthropic','openai-compatible','browser','sandbox','artifacts'],
        issues: []
      }
    );
    await wait(300);
    healthBtn.click();
    await wait(1100);

    // 5. Assistant continues streaming
    const continuation = addMessage('assistant', 'Helm · anthropic · stream');
    await streamAssistantChunks(continuation, [
      'Clean bill of health. ',
      'One meaningful next move: ',
      'your Helm has no ANTHROPIC_API_KEY yet — ',
      'adding it unlocks native tool-use streaming (the path this demo shows). ',
      'Here is the ready-to-paste snippet:'
    ], 44);
    await wait(300);

    // 6. Second exhibit: the user-approved setup action
    const snippetParent = continuation.parentElement;
    const { btn: snippetBtn } = addExhibit(
      snippetParent,
      'admin-env-template',
      { goal: 'Enable native tool-use streaming via Anthropic' },
      {
        dotenv: [
          '# Add to .dev.vars (or run: wrangler secret put ANTHROPIC_API_KEY)',
          'ANTHROPIC_API_KEY=sk-ant-…',
          '# And add api.anthropic.com to ALLOWED_HOSTS.'
        ].join('\\n')
      }
    );
    await wait(500);
    snippetBtn.click();
    await wait(900);

    // 7. Final summary
    const final = addMessage('assistant', 'Helm · anthropic · stream · done');
    await streamAssistantChunks(final, [
      "Paste that into your Worker secrets and you're live. ",
      'Happy to draft the first agent spec next — just ask.'
    ], 44);

    status.textContent = 'done';
    status.classList.remove('live');
    replay.disabled = false;
  }

  replay.addEventListener('click', () => runScene());
  runScene();
})();
</script>
${htmlFoot()}`;
}
