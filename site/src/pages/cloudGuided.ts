import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import { TOKEN_TEMPLATE_URL } from "../cloud/types";
import { renderNoAccountPanel } from "./cloudNoAccount";

/**
 * /deploy/guided — terminal-styled, click-through deploy walkthrough.
 *
 * Same target as /deploy/cloud (provision a Helm in the user's CF account)
 * but the visual framing is a series of "wrangler" command blocks the user
 * runs by clicking [Run]. Under the hood every Run hits our existing CF
 * API endpoints; we never actually shell out to wrangler. The walkthrough
 * is for users who want to SEE what's happening — show your work — rather
 * than the form-y /deploy/cloud which assumes you trust the magic.
 *
 * Design notes:
 *   - No real PTY. wterm-the-library is a beautiful in-browser terminal
 *     UI (Zig + WASM, ~12 KB), but it needs a backend with Node + wrangler
 *     to do anything. Workers can't host that. This page uses styled
 *     <pre> blocks to FEEL like a terminal while the real action runs in
 *     a Worker fetch.
 *   - Each scene is independent — the user can re-run a step if it fails.
 *   - The visible commands are intentionally close to the real wrangler
 *     commands the user could run on their own machine. That makes this
 *     also a learning tool.
 */

interface GuidedPageInput {
  /** Optional ?session_id= passed through from Stripe — same handling as /deploy/cloud. */
  fromCheckout?: boolean;
}

export function renderCloudGuided(_params: GuidedPageInput = {}): string {
  return `${htmlHead({
    title: "Guided deploy — terminal walkthrough",
    description:
      "A step-by-step terminal walkthrough that deploys Helm into your Cloudflare account. Click each command to run it; we use the Cloudflare API under the hood — no wrangler install required."
  })}
<main class="guided-main">

<section class="reveal d1" style="padding-top: 28px;">
  <div class="edition mono">§13 · Guided deploy · terminal walkthrough</div>
  <h1 class="serif" style="font-size: clamp(40px, 6.4vw, 72px); max-width: 22ch;">
    Deploy Helm with <em>your</em> hands —<br>without the install.
  </h1>
  <p class="sub" style="max-width: 60ch;">
    Each step looks like a wrangler command you'd run locally. Click <span class="mono">[Run]</span>
    and we execute the equivalent against the Cloudflare API on your behalf. Same result,
    no <span class="mono">npm install -g wrangler</span> required, full audit trail.
    For the form-style version, see <a href="/deploy/cloud">/deploy/cloud</a>.
  </p>
  ${renderNoAccountPanel()}
</section>

<section class="reveal d2 guided-section">
  <div class="terminal" id="terminal">
    <div class="terminal-chrome">
      <span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span>
      <span class="terminal-title">helm@open-think — guided deploy</span>
    </div>
    <div class="terminal-body" id="terminal-body">
      <!-- Scene 1: login -->
      <div class="scene" data-scene="login">
        <div class="prompt">
          <span class="prompt-arrow">$</span>
          <span class="prompt-cmd">wrangler login</span>
          <span class="prompt-status" data-status="login"></span>
        </div>
        <div class="scene-body">
          <p class="scene-help">
            <span class="comment"># wrangler login normally opens your browser to OAuth. We don't have a backend</span><br>
            <span class="comment"># PTY, so paste a scoped API token instead — </span><a href="${escapeHtml(TOKEN_TEMPLATE_URL)}" target="_blank" rel="noopener">create one ↗</a>
          </p>
          <input id="g-token" type="password" class="g-input" placeholder="paste your CF API token" autocomplete="off" spellcheck="false" />
          <button class="g-run" data-action="login">[Run]</button>
          <pre class="scene-out" id="out-login"></pre>
        </div>
      </div>

      <!-- Scene 2: whoami -->
      <div class="scene scene-locked" data-scene="whoami">
        <div class="prompt">
          <span class="prompt-arrow">$</span>
          <span class="prompt-cmd">wrangler whoami</span>
          <span class="prompt-status" data-status="whoami"></span>
        </div>
        <div class="scene-body">
          <p class="scene-help">
            <span class="comment"># Shows the accounts your token can deploy to. Pick the one you want.</span>
          </p>
          <select id="g-account" class="g-input" disabled></select>
          <button class="g-run" data-action="whoami">[Run]</button>
          <pre class="scene-out" id="out-whoami"></pre>
        </div>
      </div>

      <!-- Scene 3: name + secrets -->
      <div class="scene scene-locked" data-scene="config">
        <div class="prompt">
          <span class="prompt-arrow">$</span>
          <span class="prompt-cmd">cat &gt; wrangler.toml &lt;&lt;EOF</span>
          <span class="prompt-status" data-status="config"></span>
        </div>
        <div class="scene-body">
          <p class="scene-help">
            <span class="comment"># Configure your deployment. Deploys at &lt;name&gt;.&lt;your-account-subdomain&gt;.workers.dev.</span>
          </p>
          <label class="g-label">Worker name</label>
          <input id="g-worker" type="text" class="g-input" value="helm" placeholder="helm" maxlength="48" />
          <label class="g-label">Owner email <span class="g-label-hint">— used for Cloudflare Access policy + PA notifications</span></label>
          <input id="g-owner" type="email" class="g-input" placeholder="you@example.com" />
          <label class="g-checkbox"><input id="g-d1" type="checkbox" checked /> Provision D1 database (memory + scheduler)</label>
          <label class="g-checkbox"><input id="g-access" type="checkbox" checked /> Provision Cloudflare Access app</label>
          <details style="margin-top: 12px;">
            <summary class="comment" style="cursor:pointer;"># Optional model keys</summary>
            <label class="g-label">ANTHROPIC_API_KEY</label>
            <input id="g-anth" type="password" class="g-input" placeholder="sk-ant-…" autocomplete="off" />
            <label class="g-label">OPENAI_API_KEY</label>
            <input id="g-oai" type="password" class="g-input" placeholder="sk-…" autocomplete="off" />
          </details>
          <button class="g-run" data-action="config">[Save]</button>
          <pre class="scene-out" id="out-config"></pre>
        </div>
      </div>

      <!-- Scene 4: deploy -->
      <div class="scene scene-locked" data-scene="deploy">
        <div class="prompt">
          <span class="prompt-arrow">$</span>
          <span class="prompt-cmd">wrangler deploy</span>
          <span class="prompt-status" data-status="deploy"></span>
        </div>
        <div class="scene-body">
          <p class="scene-help">
            <span class="comment"># Provisions D1 + Access (if enabled), composes wrangler.toml,</span><br>
            <span class="comment"># sets every secret you supplied, uploads the Worker bundle.</span>
          </p>
          <button class="g-run" data-action="deploy">[Run]</button>
          <pre class="scene-out" id="out-deploy"></pre>
          <div id="g-deploy-cards" hidden>
            <div class="g-card g-card-live" id="g-live-card" hidden>
              <div class="g-card-label" style="color: #62c8a0;">✓ Worker live</div>
              <div class="g-card-value mono" id="g-worker-url-live"></div>
              <p style="font-size: 12px; color: #aaa; margin-top: 8px;">
                Open <span class="mono" id="g-app-link"></span> to chat with Helm.
              </p>
            </div>
            <div class="g-card" id="g-partial-card" hidden style="border-color: #f38020; background: rgba(243, 128, 32, 0.05);">
              <div class="g-card-label" style="color: #f38020;">⏳ Almost there — finish locally</div>
              <p style="color: #ccc; font-size: 13px; margin-top: 6px;">
                CF resources are set up but auto-deploy of the Worker bundle isn't
                available yet (<span id="g-partial-reason">manifest not published</span>).
                Paste the wrangler.toml below into a fork + run <span class="mono">wrangler deploy</span>,
                or use Cloudflare's <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think" target="_blank" rel="noopener">Deploy button</a>.
              </p>
            </div>
            <div class="g-card" id="g-worker-card">
              <div class="g-card-label">Your Worker (after deploy)</div>
              <div class="g-card-value mono" id="g-worker-url"></div>
            </div>
            <details class="g-card" style="background: #08080a;">
              <summary style="cursor: pointer; color: #aaa; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">wrangler.toml — local fallback</summary>
              <pre id="g-wrangler-toml" class="g-card-pre" style="margin-top: 10px;"></pre>
              <button id="g-copy-toml" class="g-card-btn">Copy</button>
            </details>
            <div class="g-card g-card-manage" id="g-manage-card" hidden>
              <div class="g-card-label">Helm Cloud · manage URL — bookmark this!</div>
              <pre id="g-manage-url" class="g-card-pre"></pre>
              <button id="g-copy-manage" class="g-card-btn">Copy</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="reveal" style="margin-top: 36px;">
  <div class="section-ref"><span>§13.1 · How this works under the hood</span><span class="rule"></span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Real <em>wrangler</em> is local. We're remote.</h2>
    </div>
    <div>
      <p>
        Each click runs the equivalent Cloudflare API call from <em>this</em>
        Worker (open-think.app), authenticated with your token. Nothing
        executes on your machine. Same result as running wrangler locally:
        a script in your account, secrets in CF's secret store, your D1 bound.
      </p>
      <p style="margin-top: 14px;">
        We don't spin up a per-session container or a real PTY — projects
        like <a href="https://github.com/vercel-labs/wterm" target="_blank" rel="noopener">vercel-labs/wterm</a>
        give you a beautiful in-browser terminal UI but still need a backend
        with Node + wrangler installed. For the deploy use-case, going
        directly through the CF API is simpler, fully audited, and skips
        50&nbsp;MB of WASM payload.
      </p>
      <p style="margin-top: 14px;">
        If you want the real wrangler experience, the form-style page at
        <a href="/deploy/cloud">/deploy/cloud</a> still emits a paste-ready
        <span class="mono">wrangler.toml</span> + a single
        <span class="mono">wrangler deploy</span> for you to run locally.
      </p>
    </div>
  </div>
</section>
</main>

<style>
.guided-main { max-width: 1100px; }
.guided-section { padding-top: 24px; }
.terminal {
  background: #0e0e10;
  border: 1px solid #25252a;
  border-radius: 6px;
  overflow: hidden;
  font-family: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace;
  color: #e8e6e3;
  font-size: 14px;
  line-height: 1.55;
  box-shadow: 0 24px 60px -28px rgba(0,0,0,0.5);
}
.terminal-chrome {
  background: #16161a;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #25252a;
}
.terminal-chrome .dot { width: 11px; height: 11px; border-radius: 999px; display: inline-block; }
.dot-r { background: #ff5f56; }
.dot-y { background: #ffbd2e; }
.dot-g { background: #27c93f; }
.terminal-title { color: #777; font-size: 12px; margin-left: 12px; letter-spacing: 0.04em; }
.terminal-body { padding: 22px 24px 28px; }

.scene { padding: 18px 0; border-bottom: 1px dashed #2a2a30; }
.scene:last-child { border-bottom: none; }
.scene.scene-locked { opacity: 0.4; pointer-events: none; }
.scene.scene-active { opacity: 1; }
.scene.scene-done .scene-body { display: none; }

.prompt { display: flex; align-items: baseline; gap: 8px; }
.prompt-arrow { color: #62c8a0; font-weight: 600; }
.prompt-cmd { color: #f0eadb; }
.prompt-status { font-size: 12px; color: #888; margin-left: auto; letter-spacing: 0.04em; text-transform: uppercase; }
.prompt-status.is-running { color: #ffbd2e; }
.prompt-status.is-ok { color: #27c93f; }
.prompt-status.is-fail { color: #ff5f56; }

.scene-body { margin-top: 12px; padding-left: 18px; }
.scene-help { color: #888; font-size: 13px; margin-bottom: 10px; }
.comment { color: #6a8062; }

.g-input {
  display: block;
  width: 100%;
  max-width: 560px;
  background: #1a1a1f;
  border: 1px solid #2c2c33;
  color: #e8e6e3;
  padding: 9px 12px;
  font-family: inherit;
  font-size: 13px;
  border-radius: 4px;
  margin: 6px 0 12px;
}
.g-input:focus { outline: none; border-color: #f38020; }
.g-input:disabled { color: #777; background: #14141a; }
.g-label { display: block; color: #aaa; font-size: 12px; margin-top: 8px; }
.g-label-hint { color: #666; font-weight: 400; }
.g-checkbox { display: flex; align-items: center; gap: 8px; color: #ddd; font-size: 13px; margin: 6px 0; cursor: pointer; }
.g-checkbox input[type="checkbox"] { accent-color: #f38020; }

.g-run {
  display: inline-block;
  background: #1a2622;
  border: 1px solid #3a5e51;
  color: #62c8a0;
  font-family: inherit;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 8px;
  transition: all 0.15s;
}
.g-run:hover { background: #25382f; border-color: #62c8a0; }
.g-run:disabled { opacity: 0.5; cursor: not-allowed; }
.g-run.is-fail { background: #2a1a1a; border-color: #5e3a3a; color: #ff8870; }

.scene-out {
  background: #08080a;
  border-left: 2px solid #2a2a30;
  margin-top: 10px;
  padding: 10px 14px;
  color: #c8c5be;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-wrap: break-word;
  display: none;
}
.scene-out.has-content { display: block; }
.scene-out .ok { color: #62c8a0; }
.scene-out .fail { color: #ff8870; }
.scene-out .info { color: #88aacc; }

.g-card {
  background: #0a0a0c;
  border: 1px solid #25252a;
  border-radius: 4px;
  padding: 14px 16px;
  margin-top: 14px;
}
.g-card-manage { border-color: #f38020; background: rgba(243, 128, 32, 0.05); }
.g-card-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #999; margin-bottom: 6px; }
.g-card-value { color: #f0eadb; font-size: 14px; }
.g-card-pre { background: #08080a; border-left: 2px solid #2a2a30; padding: 10px 14px; font-size: 12px; color: #c8c5be; white-space: pre-wrap; word-wrap: break-word; margin: 6px 0 8px; max-height: 280px; overflow-y: auto; }
.g-card-btn { background: #1a2622; border: 1px solid #3a5e51; color: #62c8a0; font-family: inherit; font-size: 12px; padding: 5px 12px; border-radius: 4px; cursor: pointer; }
.g-card-btn:hover { background: #25382f; }

@media (max-width: 720px) {
  .terminal { font-size: 13px; }
  .terminal-body { padding: 16px 14px 22px; }
  .scene-body { padding-left: 8px; }
  .prompt { flex-wrap: wrap; }
  .prompt-status { margin-left: 0; flex-basis: 100%; }
}
</style>

<script>
(function () {
  const $ = (s) => document.querySelector(s);

  // Walkthrough state. Survives across scenes; the deploy step packs it
  // into one POST.
  const state = {
    token: '',
    accountId: '',
    workerName: 'helm',
    enableD1: true,
    enableAccess: true,
    secrets: {},
    accounts: []
  };

  // Stripe redirect (same as /deploy/cloud) — exchange the session for a
  // signed cookie. We don't show a banner here (terminal aesthetic), but
  // the cookie is what /api/cloud/deploy reads to decide whether to persist.
  (async () => {
    const sid = new URLSearchParams(location.search).get('session_id');
    if (sid) {
      try {
        await fetch('/api/cloud/exchange-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sid })
        });
      } catch {}
      const clean = location.pathname + location.hash;
      history.replaceState(null, '', clean);
    }
  })();

  function setStatus(name, label, cls) {
    const el = document.querySelector('[data-status="' + name + '"]');
    if (!el) return;
    el.textContent = label;
    el.className = 'prompt-status ' + (cls || '');
  }

  function unlockScene(name) {
    const sc = document.querySelector('.scene[data-scene="' + name + '"]');
    if (!sc) return;
    sc.classList.remove('scene-locked');
    sc.classList.add('scene-active');
    sc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function out(name, text, cls) {
    const el = document.getElementById('out-' + name);
    if (!el) return;
    el.classList.add('has-content');
    if (cls) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(text));
    }
  }
  function outln(name, text, cls) {
    out(name, text + '\\n', cls);
  }

  function bindRun(action, handler) {
    const btn = document.querySelector('.g-run[data-action="' + action + '"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.remove('is-fail');
      setStatus(action, 'running…', 'is-running');
      const out = document.getElementById('out-' + action);
      if (out) { out.textContent = ''; out.classList.remove('has-content'); }
      try {
        const ok = await handler();
        if (ok) {
          setStatus(action, '✓ ok', 'is-ok');
          // Mark this scene as done so the next-scene reveal scrolls into view.
          const sc = document.querySelector('.scene[data-scene="' + action + '"]');
          if (sc) sc.classList.add('scene-done');
        } else {
          setStatus(action, '✗ fail', 'is-fail');
          btn.classList.add('is-fail');
          btn.disabled = false;
        }
      } catch (err) {
        setStatus(action, '✗ ' + (err && err.message ? err.message : 'error'), 'is-fail');
        btn.classList.add('is-fail');
        btn.disabled = false;
      }
    });
  }

  // ----- Scene 1: login (paste token, verify) -----
  bindRun('login', async () => {
    const t = ($('#g-token').value || '').trim();
    if (!t) { outln('login', 'paste a token first', 'fail'); return false; }
    outln('login', 'verifying…');
    const r = await fetch('/api/cloud/verify-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: t })
    });
    const data = await r.json();
    if (!data.ok) { outln('login', '✗ ' + (data.error || 'verify failed'), 'fail'); return false; }
    state.token = t;
    state.accounts = data.accounts || [];
    outln('login', '✓ token verified', 'ok');
    outln('login', '  ' + state.accounts.length + ' account(s) accessible', 'info');
    // Populate the account picker for scene 2.
    const sel = $('#g-account');
    sel.innerHTML = '';
    for (const a of state.accounts) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + ' (' + a.id.slice(0, 8) + '…)';
      sel.appendChild(opt);
    }
    sel.disabled = false;
    unlockScene('whoami');
    return true;
  });

  // ----- Scene 2: whoami (pick account) -----
  bindRun('whoami', async () => {
    const id = $('#g-account').value;
    if (!id) { outln('whoami', 'pick an account', 'fail'); return false; }
    state.accountId = id;
    const acc = state.accounts.find((a) => a.id === id);
    outln('whoami', '✓ using ' + (acc ? acc.name : id), 'ok');
    outln('whoami', '  account_id = ' + id);
    unlockScene('config');
    return true;
  });

  // ----- Scene 3: config (worker name, options, secrets) -----
  bindRun('config', async () => {
    const name = ($('#g-worker').value || 'helm').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48);
    if (!name) { outln('config', 'worker name required', 'fail'); return false; }
    state.workerName = name;
    state.enableD1 = $('#g-d1').checked;
    state.enableAccess = $('#g-access').checked;
    const secrets = {};
    const owner = ($('#g-owner').value || '').trim();
    if (owner) { secrets.OWNER_EMAIL = owner; secrets.AGENT_OWNER_EMAIL = owner; }
    const anth = ($('#g-anth').value || '').trim();
    if (anth) secrets.ANTHROPIC_API_KEY = anth;
    const oai = ($('#g-oai').value || '').trim();
    if (oai) secrets.OPENAI_API_KEY = oai;
    state.secrets = secrets;
    outln('config', '✓ wrangler.toml staged', 'ok');
    outln('config', '  name = "' + name + '"');
    outln('config', '  d1 = ' + (state.enableD1 ? 'yes' : 'no'));
    outln('config', '  access = ' + (state.enableAccess ? 'yes' : 'no'));
    outln('config', '  secrets = ' + Object.keys(secrets).length);
    unlockScene('deploy');
    return true;
  });

  // ----- Scene 4: deploy (run the full deploy) -----
  bindRun('deploy', async () => {
    outln('deploy', 'POST /api/cloud/deploy …');
    const payload = {
      token: state.token,
      accountId: state.accountId,
      workerName: state.workerName,
      enableD1: state.enableD1,
      enableAccess: state.enableAccess,
      secrets: state.secrets,
      // The server reads its actual customer_id from the intent cookie,
      // so this flag just opts us in to the persist path if eligible.
      persist: true
    };
    const r = await fetch('/api/cloud/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    for (const s of (data.steps || [])) {
      const cls = s.ok ? 'ok' : 'fail';
      const mark = s.ok ? '✓ ' : '✗ ';
      outln('deploy', mark + s.summary, cls);
      if (s.error) outln('deploy', '  ↳ ' + s.error);
    }
    if (data.ok) {
      // Reveal the result cards.
      const cards = $('#g-deploy-cards');
      cards.removeAttribute('hidden');
      const fullUrl = data.workerUrl || ('https://' + state.workerName + '.workers.dev');
      $('#g-worker-url').textContent = fullUrl;
      $('#g-wrangler-toml').textContent = data.wranglerToml || '';
      bindCopy($('#g-copy-toml'), $('#g-wrangler-toml'));
      // Three states: live / partial / not-attempted.
      const fbStep = (data.steps || []).find(function (s) {
        return s.kind === 'fetch-bundle' || s.kind === 'upload-worker';
      });
      const directAttempted = Boolean(fbStep);
      if (data.directDeployed) {
        $('#g-live-card').removeAttribute('hidden');
        $('#g-worker-url-live').textContent = fullUrl;
        $('#g-app-link').textContent = fullUrl + '/app';
        $('#g-worker-card').setAttribute('hidden', '');
      } else if (directAttempted) {
        const failed = (data.steps || []).find(function (s) {
          return (s.kind === 'fetch-bundle' || s.kind === 'upload-worker') && !s.ok;
        });
        if (failed && failed.error) $('#g-partial-reason').textContent = failed.error;
        $('#g-partial-card').removeAttribute('hidden');
      }
      if (data.manageToken) {
        const url = location.origin + '/cloud/manage?token=' + encodeURIComponent(data.manageToken);
        $('#g-manage-url').textContent = url;
        $('#g-manage-card').removeAttribute('hidden');
        bindCopy($('#g-copy-manage'), $('#g-manage-url'));
      }
    }
    return Boolean(data.ok);
  });

  function bindCopy(btn, src) {
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    const original = btn.textContent;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(src.textContent || '');
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch {}
    });
  }
})();
</script>

${htmlFoot()}`;
}
