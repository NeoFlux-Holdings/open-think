import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import { TOKEN_SCOPES, TOKEN_TEMPLATE_URL } from "../cloud/types";
import { renderNoAccountPanel } from "./cloudNoAccount";

/**
 * /deploy/cloud — the browser-based deploy page.
 *
 * Three steps, rendered in one page (no SPA framework):
 *   1. Open the pre-filled CF token creation page in a new tab; paste back.
 *   2. Pick an account and worker name; pick optional features (D1 + Access).
 *   3. Click Deploy. We show step-by-step progress + the final wrangler.toml
 *      and the one-line `wrangler deploy` to run locally.
 *
 * No JS framework — vanilla DOM + a few `fetch` calls to our own API.
 */

export function renderCloudDeploy(): string {
  const scopeRows = TOKEN_SCOPES.map(
    (s) => `<tr><td class="mono">${escapeHtml(s.resource)}</td><td class="mono">${escapeHtml(s.permission)}</td></tr>`
  ).join("");

  return `${htmlHead({
    title: "Deploy to Cloudflare",
    description:
      "One-click browser deploy of Helm into your own Cloudflare account. We never see your data — your token never leaves the request that creates the resources."
  })}
<main>
<section class="reveal d1" style="padding-top: 36px;">
  <div class="edition mono">§10 · Cloud deploy · browser-based</div>
  <h1 class="serif" style="font-size: clamp(44px, 7vw, 80px); max-width: 22ch;">
    Deploy Helm to <em>your</em> Cloudflare<br>without a terminal.
  </h1>
  <p class="sub" style="max-width: 62ch;">
    Paste a scoped Cloudflare API token. We provision the D1 database,
    optionally create an Access app, and hand you a finished
    <span class="mono">wrangler.toml</span> + a single
    <span class="mono">wrangler deploy</span> to run.
    The token is used once and thrown away — we never see your runtime data.
  </p>
  <p style="margin-top: 14px; font-size: 14px;">
    <span class="mono" style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted);">Other deploy modes:</span>
    &nbsp;<a href="/deploy/guided">→ /deploy/guided</a>
    <span style="color: var(--muted);">terminal walkthrough</span>
    &nbsp;·&nbsp;
    <a href="/deploy/agent">→ /deploy/agent</a>
    <span style="color: var(--muted);">have an AI agent drive it</span>
  </p>
  <div id="hc-banner" hidden style="margin-top: 18px; padding: 14px 18px; border: 1px solid var(--accent); background: rgba(243, 128, 32, 0.07);">
    <div class="mono" style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px;">Helm Cloud · subscribed</div>
    <p style="margin: 0; font-size: 14px;">
      You're on the managed tier as <b id="hc-email">…</b>. Once your deploy
      finishes, your token will be encrypted and stored so we can push updates
      on a schedule. You'll get a private manage URL to bookmark.
    </p>
  </div>
  ${renderNoAccountPanel()}
</section>

<section class="reveal d2 cloud-step">
  <div class="section-ref"><span>§10.1 · Step 1</span><span class="rule"></span><span>create a token</span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Open Cloudflare,<br>paste back here.</h2>
    </div>
    <div>
      <p>
        Click below — Cloudflare's dashboard opens with the exact scopes
        we need pre-filled. Click <b>Continue to summary</b> → <b>Create token</b>,
        copy the value, and paste it into the box.
      </p>
      <div class="actions" style="margin-top: 18px;">
        <a class="btn primary" href="${escapeHtml(TOKEN_TEMPLATE_URL)}" target="_blank" rel="noopener">
          Open token creator <span class="arrow">↗</span>
        </a>
      </div>
      <details style="margin-top: 16px;">
        <summary class="mono" style="cursor: pointer; font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase;">What scopes are requested?</summary>
        <table class="cloud-scopes">
          <thead><tr><th>Resource</th><th>Permission</th></tr></thead>
          <tbody>${scopeRows}</tbody>
        </table>
        <p class="mono" style="font-size: 12px; color: var(--muted); margin-top: 10px;">
          No read access to existing resources. No DNS, no zones, no R2.
          You can revoke any time at dash → API Tokens.
        </p>
      </details>

      <div class="field" style="margin-top: 24px;">
        <label for="cf-token">Paste your token</label>
        <input id="cf-token" type="password" placeholder="abcdef…" autocomplete="off" spellcheck="false" />
      </div>
      <button id="verify-btn" class="btn primary">Verify token →</button>
      <div id="verify-out" class="mono" style="font-size: 12px; color: var(--muted); margin-top: 10px;"></div>
    </div>
  </div>
</section>

<section id="step-2" class="reveal cloud-step" hidden>
  <div class="section-ref"><span>§10.2 · Step 2</span><span class="rule"></span><span>pick options</span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Where, what,<br>and which knobs.</h2>
    </div>
    <div>
      <div class="field">
        <label for="cf-account">Cloudflare account</label>
        <select id="cf-account"></select>
      </div>
      <div class="field">
        <label for="cf-worker">Worker name <span style="color: var(--muted); font-size: 12px;">— becomes &lt;name&gt;.workers.dev</span></label>
        <input id="cf-worker" type="text" placeholder="helm" maxlength="48" />
      </div>
      <div class="field">
        <label>
          <input id="cf-d1" type="checkbox" checked />
          Create a D1 database (memory + scheduler + cost rollups)
        </label>
      </div>
      <div class="field">
        <label>
          <input id="cf-access" type="checkbox" checked />
          Create a Cloudflare Access app (recommended — gates /app on your email)
        </label>
        <div id="cf-access-workersdev-warn" class="workersdev-warn" hidden>
          <strong>⚠ Note:</strong> Cloudflare's API can't create a Self-hosted
          Access app against <span class="mono">*.workers.dev</span> URLs (the domain has to be on a zone in
          your account). We'd recommend leaving this <em>unchecked</em> for now —
          your Worker still runs in first-run permissive mode. Three follow-up
          options:
          <ol>
            <li>Add a custom domain to the Worker first (dash → Workers &amp; Pages → your worker → Settings → Triggers → Add Custom Domain), then redeploy with that domain.</li>
            <li>Create the Access app manually in the dashboard (Zero Trust → Access → Applications → Add → Self-hosted) — it works there, just not via the public API.</li>
            <li>Skip Access; your Worker stays in permissive mode (banner reminds you).</li>
          </ol>
        </div>
      </div>
      <div class="field">
        <label for="cf-owner">Owner email <span style="color: var(--muted); font-size: 12px;">— Access policy + PA notifications</span></label>
        <input id="cf-owner" type="email" placeholder="you@example.com" />
      </div>

      <details style="margin-top: 12px;">
        <summary class="mono" style="cursor: pointer; font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase;">Optional model keys</summary>
        <div class="field">
          <label for="cf-anth">ANTHROPIC_API_KEY</label>
          <input id="cf-anth" type="password" autocomplete="off" placeholder="sk-ant-… (optional)" />
        </div>
        <div class="field">
          <label for="cf-oai">OPENAI_API_KEY</label>
          <input id="cf-oai" type="password" autocomplete="off" placeholder="sk-… (optional)" />
        </div>
      </details>

      <button id="deploy-btn" class="btn primary" style="margin-top: 18px;">Deploy →</button>
    </div>
  </div>
</section>

<section id="step-3" class="reveal cloud-step" hidden>
  <div class="section-ref"><span>§10.3 · Step 3</span><span class="rule"></span><span>finish locally</span></div>
  <h2 class="headline serif">Deploy log</h2>
  <ol id="deploy-steps" class="cloud-steps mono"></ol>

  <div id="deploy-out" hidden>
    <div id="deploy-live" hidden style="margin-top: 24px; padding: 18px 22px; border-left: 3px solid #2d5c3e; background: rgba(45, 92, 62, 0.06);">
      <div class="mono" style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #2d5c3e; margin-bottom: 6px;">✓ Live</div>
      <p style="margin: 0 0 10px;">Your Worker is deployed and running. No terminal step required.</p>
      <p style="margin: 0 0 14px;">Visit it at <a id="deploy-url-live" class="mono" target="_blank" rel="noopener">…</a></p>
      <p style="margin: 0; font-size: 13px; color: var(--muted);">
        <b>What's next:</b> open <span class="mono" id="deploy-app-link">/app</span> to chat with Helm,
        set <span class="mono">CF_ACCESS_AUD</span> via the manage page (if Helm Cloud) or
        <span class="mono">wrangler secret put</span> to lock down auth, and explore the
        <a href="/marketplace">marketplace</a> for plugins.
      </p>
    </div>

    <div id="deploy-partial" hidden style="margin-top: 24px; padding: 18px 22px; border-left: 3px solid var(--accent); background: rgba(243, 128, 32, 0.05);">
      <div class="mono" style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px;">⏳ Almost there — finish locally</div>
      <p style="margin: 0 0 10px;">
        Your Cloudflare resources (D1, Access app, secrets) are set up — but auto-deploy of
        the Worker bundle isn't available yet. <b>Reason:</b> <span id="deploy-partial-reason">…</span>
      </p>
      <p style="margin: 0; font-size: 13px;">
        Use the wrangler.toml + commands below to finish from a terminal. If you don't have
        wrangler, fork <a href="https://github.com/NeoFlux-Holdings/open-think">the repo</a> + use
        Cloudflare's <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think">Deploy button</a> instead — it'll pick up your existing D1 + Access bindings.
      </p>
    </div>

    <details id="deploy-local-fallback" style="margin-top: 24px;">
      <summary class="mono" style="cursor: pointer; font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase;">wrangler.toml + commands (local fallback)</summary>
      <h3 class="serif" style="margin-top: 18px;">wrangler.toml</h3>
      <p style="font-size: 14px; color: var(--muted);">
        Replace your fork's <span class="mono">wrangler.toml</span> with this exact content:
      </p>
      <pre id="deploy-wrangler" class="snippet-pre"></pre>
      <button id="copy-wrangler" class="btn ghost" style="margin-top: 8px;">Copy wrangler.toml</button>

      <h3 class="serif" style="margin-top: 28px;">Run these commands locally</h3>
      <pre id="deploy-cmds" class="snippet-pre"></pre>
      <button id="copy-cmds" class="btn ghost" style="margin-top: 8px;">Copy commands</button>

      <p class="mono" style="font-size: 12px; color: var(--muted); margin-top: 18px;">
        After <span class="mono">wrangler deploy</span> finishes, your Worker is at
        <span id="deploy-url" class="mono"></span>.
      </p>
    </details>

    <div id="hc-manage" hidden style="margin-top: 28px; padding: 18px; border: 1px solid var(--accent); background: rgba(243, 128, 32, 0.05);">
      <div class="mono" style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px;">Bookmark this manage link</div>
      <p style="margin: 0 0 10px;">
        This link is the only way back to your Helm Cloud deployment dashboard.
        We've stored it nowhere else; if you lose it, you'll need to email
        support to issue a new one.
      </p>
      <pre class="snippet-pre" id="hc-manage-url" style="margin: 8px 0;"></pre>
      <button id="hc-copy-manage" class="btn ghost">Copy manage URL</button>
    </div>
  </div>
</section>

<section class="reveal" style="margin-top: 48px;">
  <div class="section-ref"><span>§10.4 · Privacy posture</span><span class="rule"></span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Your data <em>never</em> reaches us.</h2>
    </div>
    <div>
      <p>
        Your CF API token rides only the request that creates the resources.
        We don't log it, don't persist it, don't proxy it. The Worker we
        deploy runs in your account, against your bindings, billed to your
        Cloudflare account. Once deploy is done, revoke the token at
        <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">dash → API Tokens</a>
        — your Helm keeps running.
      </p>
      <p style="margin-top: 14px;">
        Unlike a managed agent service, we have no read path to your D1,
        your DOs, your secrets, or your prompts. The whole runtime is yours.
      </p>
    </div>
  </div>
</section>
</main>

<style>
.cloud-step { margin-top: 56px; }
.cloud-scopes { width: 100%; margin-top: 12px; border-collapse: collapse; font-size: 13px; }
.cloud-scopes th, .cloud-scopes td { text-align: left; padding: 6px 10px; border-bottom: 1px dotted var(--muted-2); }
.cloud-scopes th { color: var(--muted); font-weight: normal; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
.cloud-steps { padding-left: 22px; line-height: 1.7; font-size: 14px; }
.cloud-steps li.ok::marker { color: var(--ok, #2d5c3e); }
.cloud-steps li.fail::marker { color: var(--accent); }
.cloud-steps li small { color: var(--muted); display: block; }
.workersdev-warn {
  margin-top: 8px;
  padding: 12px 14px;
  background: rgba(243, 128, 32, 0.05);
  border-left: 2px solid var(--accent);
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink);
}
.workersdev-warn ol { margin: 8px 0 0 0; padding-left: 20px; }
.workersdev-warn li { padding: 2px 0; }
.cloud-steps li .step-error {
  display: block;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 6px 0 0;
  padding: 8px 12px;
  background: rgba(243, 128, 32, 0.05);
  border-left: 2px solid var(--accent);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink);
}
.field { margin: 14px 0; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.field input[type="text"], .field input[type="email"], .field input[type="password"], .field select {
  width: 100%; max-width: 480px; padding: 10px 12px; font-family: 'IBM Plex Mono', monospace;
  font-size: 14px; border: 1px solid var(--rule); background: transparent; color: var(--ink);
}
.field input[type="checkbox"] { margin-right: 6px; }
.snippet-pre {
  background: rgba(0,0,0,0.04);
  border-left: 2px solid var(--accent);
  padding: 14px 16px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre;
  line-height: 1.55;
  margin: 12px 0;
}
</style>

<script>
(function () {
  const $ = (s) => document.querySelector(s);
  const tokenInput = $('#cf-token');
  const verifyBtn = $('#verify-btn');
  const verifyOut = $('#verify-out');
  const step2 = $('#step-2');
  const step3 = $('#step-3');
  const accountSelect = $('#cf-account');
  const workerInput = $('#cf-worker');
  const ownerInput = $('#cf-owner');
  const deployBtn = $('#deploy-btn');
  const stepsList = $('#deploy-steps');
  const out = $('#deploy-out');
  const wranglerPre = $('#deploy-wrangler');
  const cmdsPre = $('#deploy-cmds');
  const urlSpan = $('#deploy-url');
  const hcBanner = $('#hc-banner');
  const hcEmail = $('#hc-email');
  const hcManage = $('#hc-manage');
  const hcManageUrl = $('#hc-manage-url');
  const hcCopyManage = $('#hc-copy-manage');

  let currentToken = '';
  // Truthy when the page has a verified Helm Cloud intent cookie. The
  // server reads the actual customer_id from that cookie; the client only
  // tracks display state.
  let subscribed = false;

  function showBanner(email) {
    hcEmail.textContent = email || '(subscriber)';
    hcBanner.removeAttribute('hidden');
    subscribed = true;
  }

  // --- Helm Cloud subscription detection ---
  // Stripe redirects back here with ?session_id=cs_... after the user pays.
  // We exchange it server-side: the server validates with Stripe, claims the
  // session in D1 (one-time), and sets a signed HTTP-only cookie. The cookie
  // is the credential the deploy endpoint actually trusts; the response body
  // here is informational, used only to populate the banner.
  (async function detectSubscription() {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    if (sessionId) {
      try {
        const r = await fetch('/api/cloud/exchange-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        const data = await r.json();
        if (!data.ok) {
          // Most common: 409 already-claimed (you refreshed too late, or someone
          // raced you). Show a softer message; the user can still deploy free-tier.
          console.warn('exchange-session failed:', data.error);
          return;
        }
        showBanner(data.email);
      } catch (err) {
        console.warn('exchange-session error:', err);
      } finally {
        // Strip session_id so refreshes don't retry the (now-claimed) exchange.
        const cleanUrl = location.pathname + location.hash;
        history.replaceState(null, '', cleanUrl);
      }
      return;
    }
    // No session_id in URL — but if a refresh just happened, we may still
    // have a valid intent cookie. Ask the server.
    try {
      const r = await fetch('/api/cloud/current-intent', { credentials: 'same-origin' });
      const data = await r.json();
      if (data.ok) showBanner(data.email);
    } catch {
      /* ignore */
    }
  })();

  // Surface the workers.dev Access constraint upfront. Always show the
  // warning when the Access checkbox is checked — the deploy form always
  // creates a *.workers.dev Worker (custom domains are post-deploy work).
  const accessCheckbox = $('#cf-access');
  const workersDevWarn = $('#cf-access-workersdev-warn');
  function refreshWorkersDevWarn() {
    if (accessCheckbox.checked) workersDevWarn.removeAttribute('hidden');
    else workersDevWarn.setAttribute('hidden', '');
  }
  if (accessCheckbox && workersDevWarn) {
    accessCheckbox.addEventListener('change', refreshWorkersDevWarn);
    refreshWorkersDevWarn();
  }

  verifyBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      verifyOut.textContent = 'paste a token first';
      return;
    }
    verifyOut.textContent = 'verifying…';
    verifyBtn.disabled = true;
    try {
      const r = await fetch('/api/cloud/verify-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await r.json();
      if (!data.ok) {
        verifyOut.textContent = 'verify failed: ' + (data.error || 'unknown');
        return;
      }
      currentToken = token;
      accountSelect.innerHTML = '';
      for (const acc of (data.accounts || [])) {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.name + '  (' + acc.id.slice(0, 8) + '…)';
        accountSelect.appendChild(opt);
      }
      verifyOut.textContent = 'token ok · ' + (data.accounts || []).length + ' account(s) found';
      step2.removeAttribute('hidden');
      step2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      verifyOut.textContent = 'error: ' + (err && err.message ? err.message : String(err));
    } finally {
      verifyBtn.disabled = false;
    }
  });

  deployBtn.addEventListener('click', async () => {
    if (!currentToken) {
      alert('Verify your token first.');
      return;
    }
    const accountId = accountSelect.value;
    const workerName = (workerInput.value || 'helm').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48);
    const enableD1 = $('#cf-d1').checked;
    const enableAccess = $('#cf-access').checked;
    const owner = ownerInput.value.trim();
    const anth = $('#cf-anth').value.trim();
    const oai = $('#cf-oai').value.trim();

    if (!accountId) { alert('Pick an account.'); return; }
    if (!workerName) { alert('Pick a worker name.'); return; }

    const secrets = {};
    if (owner) secrets.OWNER_EMAIL = owner;
    if (owner) secrets.AGENT_OWNER_EMAIL = owner;
    if (anth) secrets.ANTHROPIC_API_KEY = anth;
    if (oai) secrets.OPENAI_API_KEY = oai;

    step3.removeAttribute('hidden');
    out.setAttribute('hidden', '');
    stepsList.innerHTML = '<li>kicking off deploy…</li>';
    deployBtn.disabled = true;
    step3.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const payload = {
        token: currentToken,
        accountId,
        workerName,
        enableD1,
        enableAccess,
        secrets
      };
      // Tell the server we want to persist this deploy as a managed
      // subscriber. The server reads our actual customer_id from the
      // signed intent cookie — never from this body.
      if (subscribed) payload.persist = true;
      const r = await fetch('/api/cloud/deploy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      stepsList.innerHTML = '';
      for (const s of (data.steps || [])) {
        const li = document.createElement('li');
        li.className = s.ok ? 'ok' : 'fail';
        li.textContent = s.summary;
        if (s.error) {
          // Errors may be multi-line: the API message on line 1, then a
          // recovery hint on subsequent lines. Render as a <pre> so the
          // step-by-step hint stays readable.
          const detail = document.createElement('pre');
          detail.className = 'step-error';
          detail.textContent = s.error;
          li.appendChild(detail);
        }
        stepsList.appendChild(li);
      }
      if (data.ok) {
        out.removeAttribute('hidden');
        wranglerPre.textContent = data.wranglerToml || '';
        cmdsPre.textContent = (data.commands || []).join('\\n');
        urlSpan.textContent = workerName + '.workers.dev';
        const fullUrl = data.workerUrl || ('https://' + workerName + '.workers.dev');
        // Three result states:
        //   1. directDeployed=true → green "live" panel
        //   2. attempted but failed → orange "almost there" panel + open fallback
        //   3. not attempted (manifest URL unset) → fallback only
        const fetchBundleStep = (data.steps || []).find(function (s) { return s.kind === 'fetch-bundle' || s.kind === 'upload-worker'; });
        const directDeployAttempted = Boolean(fetchBundleStep);
        if (data.directDeployed) {
          const live = $('#deploy-live');
          const liveUrl = $('#deploy-url-live');
          const appLink = $('#deploy-app-link');
          const fallback = $('#deploy-local-fallback');
          liveUrl.textContent = fullUrl;
          liveUrl.href = fullUrl;
          if (appLink) {
            appLink.innerHTML = '<a href="' + fullUrl + '/app" target="_blank" rel="noopener">' + fullUrl + '/app</a>';
          }
          live.removeAttribute('hidden');
          fallback.open = false;
        } else if (directDeployAttempted) {
          // Find the failing step and surface its error.
          const failed = (data.steps || []).find(function (s) {
            return (s.kind === 'fetch-bundle' || s.kind === 'upload-worker') && !s.ok;
          });
          const reason = failed && failed.error
            ? failed.error
            : 'auto-deploy unavailable (no published bundle yet)';
          const partial = $('#deploy-partial');
          $('#deploy-partial-reason').textContent = reason;
          partial.removeAttribute('hidden');
          // Pre-open the fallback details since the user needs them.
          $('#deploy-local-fallback').open = true;
        } else {
          // Not attempted — pre-open fallback so the user sees the commands.
          $('#deploy-local-fallback').open = true;
        }

        if (data.manageToken) {
          const url = location.origin + '/cloud/manage?token=' + encodeURIComponent(data.manageToken);
          hcManageUrl.textContent = url;
          hcManage.removeAttribute('hidden');
          hcCopyManage.dataset.label = hcCopyManage.textContent;
          hcCopyManage.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(url);
              hcCopyManage.textContent = 'Copied ✓';
              setTimeout(() => { hcCopyManage.textContent = hcCopyManage.dataset.label || 'Copy'; }, 1500);
            } catch {}
          });
        }
      }
    } catch (err) {
      const li = document.createElement('li');
      li.className = 'fail';
      li.textContent = 'deploy request failed: ' + (err && err.message ? err.message : String(err));
      stepsList.appendChild(li);
    } finally {
      deployBtn.disabled = false;
    }
  });

  function attachCopy(btn, src) {
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(src.textContent || ''); btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = btn.dataset.label || 'Copy'; }, 1500); } catch {}
    });
  }
  const copyW = $('#copy-wrangler');
  if (copyW) { copyW.dataset.label = copyW.textContent; attachCopy(copyW, wranglerPre); }
  const copyC = $('#copy-cmds');
  if (copyC) { copyC.dataset.label = copyC.textContent; attachCopy(copyC, cmdsPre); }
})();
</script>

${htmlFoot()}`;
}
