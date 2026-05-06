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
        <p class="mono" style="font-size: 12px; color: var(--muted); margin-top: 8px;">
          The pre-fill URL uses Cloudflare's exact short keys for each permission group (e.g. <span class="mono">aig:edit</span> for AI Gateway). If any row is missing when the dash opens, click <b>+ Add more</b> and search the permission name — the list is still correct.
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
        <label for="cf-worker">Worker name <span class="field-hint">— deploys at &lt;name&gt;.&lt;your-account-subdomain&gt;.workers.dev</span></label>
        <input id="cf-worker" type="text" placeholder="helm" maxlength="48" />
      </div>

      <fieldset class="opts">
        <legend>What to provision</legend>
        <label class="opt-row">
          <input id="cf-d1" type="checkbox" checked />
          <span class="opt-label">
            <span class="opt-title">D1 database</span>
            <span class="opt-sub">memory · scheduler · cost rollups</span>
          </span>
        </label>
        <label class="opt-row">
          <input id="cf-access" type="checkbox" checked />
          <span class="opt-label">
            <span class="opt-title">Cloudflare Access app <span class="badge-rec">recommended</span></span>
            <span class="opt-sub">gates /app on the emails below</span>
          </span>
        </label>
      </fieldset>

      <div id="access-emails" class="field">
        <label for="cf-owner">Owner email <span class="field-hint">— receives Access OTPs &amp; PA notifications</span></label>
        <input id="cf-owner" type="email" placeholder="you@example.com" autocomplete="email" />
        <details style="margin-top: 10px;">
          <summary class="opt-summary">Add additional allowed emails (optional)</summary>
          <p class="opt-help">
            One per line. Each becomes an entry in the Access policy and is added to <span class="mono">CF_ACCESS_ALLOWED_EMAILS</span>.
            Useful for a co-founder, a support handoff, or a shared inbox.
          </p>
          <textarea id="cf-extra-emails" rows="3" placeholder="alice@example.com&#10;bob@example.com" autocomplete="off" spellcheck="false"></textarea>
        </details>
      </div>

      <fieldset class="opts" style="margin-top: 18px;">
        <legend>Default chat model</legend>
        <label class="opt-row">
          <input id="cf-model-kimi" type="radio" name="cf-model" value="kimi-k2.6" checked />
          <span class="opt-label">
            <span class="opt-title">Kimi K2.6 <span class="badge-rec">free</span></span>
            <span class="opt-sub">1T params, 262K context · auto-routes via Workers AI when no key is pasted</span>
          </span>
        </label>
        <label class="opt-row">
          <input id="cf-model-gpt55" type="radio" name="cf-model" value="gpt-5.5" />
          <span class="opt-label">
            <span class="opt-title">GPT-5.5</span>
            <span class="opt-sub">paste OpenRouter key below · supports reasoning effort</span>
          </span>
        </label>
        <label class="opt-row">
          <input id="cf-model-opus" type="radio" name="cf-model" value="opus-4.7" />
          <span class="opt-label">
            <span class="opt-title">Claude Opus 4.7</span>
            <span class="opt-sub">paste Anthropic or OpenRouter key · Anthropic preferred (direct, no markup)</span>
          </span>
        </label>
        <label class="opt-row">
          <input id="cf-model-sonnet" type="radio" name="cf-model" value="sonnet-4.6" />
          <span class="opt-label">
            <span class="opt-title">Claude Sonnet 4.6</span>
            <span class="opt-sub">faster + cheaper than Opus · same Anthropic / OpenRouter key paths</span>
          </span>
        </label>
        <label class="opt-row">
          <input id="cf-model-custom" type="radio" name="cf-model" value="custom" />
          <span class="opt-label">
            <span class="opt-title">Custom model id</span>
            <span class="opt-sub">advanced — paste any provider/model id you've configured below</span>
          </span>
        </label>
        <div id="cf-model-custom-row" class="field" hidden style="margin-top: 8px;">
          <input id="cf-model-custom-id" type="text" autocomplete="off" placeholder="e.g. openrouter/x-ai/grok-4 · @cf/qwen/qwen3-30b-a3b-fp8 · anthropic/claude-haiku-4-5" />
        </div>
        <div id="cf-model-reasoning-row" class="field" hidden style="margin-top: 12px; padding-top: 8px; border-top: 1px dotted var(--rule);">
          <label for="cf-model-reasoning">Reasoning effort
            <span class="field-hint">— <span id="cf-model-reasoning-hint">how hard the model thinks before answering</span></span>
          </label>
          <select id="cf-model-reasoning">
            <option value="none">None — fastest, no reasoning</option>
            <option value="low">Low</option>
            <option value="medium" selected>Medium (default)</option>
            <option value="high">High</option>
            <option value="xhigh">XHigh — slowest, deepest</option>
          </select>
        </div>
      </fieldset>

      <details class="advanced">
        <summary class="opt-summary">Bring-your-own model keys (optional)</summary>
        <p class="opt-help">
          Paste a key for the provider matching the model you picked above. Helm's chat works zero-key with Kimi K2.6 via Workers AI — keys here just unlock the other model presets and (where supported) cheaper routing.
        </p>
        <div class="field">
          <label for="cf-or">OpenRouter API key <span class="field-hint">— covers Kimi, GPT-5.5, Claude, and 100+ others</span></label>
          <input id="cf-or" type="password" autocomplete="off" placeholder="sk-or-…" />
        </div>
        <div class="field">
          <label for="cf-anth">Anthropic API key <span class="field-hint">— direct path for Opus / Sonnet (no OpenRouter markup)</span></label>
          <input id="cf-anth" type="password" autocomplete="off" placeholder="sk-ant-…" />
        </div>
        <div class="field">
          <label for="cf-oai">OpenAI API key <span class="field-hint">— stored as a secret; not yet wired to a default provider</span></label>
          <input id="cf-oai" type="password" autocomplete="off" placeholder="sk-…" />
        </div>
      </details>

      <button id="deploy-btn" class="btn primary" style="margin-top: 22px;">Deploy →</button>
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
      <p style="margin: 0 0 14px; font-size: 13px; color: var(--muted);">
        <b>What works now:</b> chat (via Workers AI through the auto-provisioned gateway), Files (R2-backed /persist), the Access login wall, plus the full plugin stack (memory, email, helm-setup, helm-artifacts, etc.).
      </p>
      <details style="margin-top: 8px; font-size: 13px; color: var(--muted);">
        <summary style="cursor: pointer; color: var(--ink);">What still needs a local <span class="mono">wrangler deploy</span></summary>
        <ul style="margin-top: 8px; padding-left: 20px; line-height: 1.6;">
          <li><b>Helm Shell</b> (the <span class="mono">/shell</span> tab). Backed by Cloudflare Containers — the bash image is built from <span class="mono">docker/shell/Dockerfile</span> during <span class="mono">wrangler deploy</span>. CF Containers only supports images in their managed registry scoped to the deploying account, so a browser deploy can't push it. Fork the repo, paste the wrangler.toml from below, run <span class="mono">npx wrangler deploy</span> — your shell will appear at <span class="mono" id="deploy-shell-link">/shell</span>.</li>
          <li><b>R2 persistence inside the shell</b>. The container would <span class="mono">rclone</span>-mount <span class="mono">/persist</span> using <span class="mono">R2_ACCESS_KEY_ID</span> + <span class="mono">R2_SECRET_ACCESS_KEY</span>, but Cloudflare doesn't expose long-lived R2 S3 credentials via API yet. Until they do: dash → R2 → "Manage R2 API Tokens" → create one for your bucket → <span class="mono">wrangler secret put R2_ACCESS_KEY_ID</span>, then <span class="mono">R2_SECRET_ACCESS_KEY</span>.</li>
        </ul>
      </details>
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
.cloud-steps li.warn::marker { color: #b88a2c; content: "⚠ "; }
.cloud-steps li.running {
  /* "Currently doing X" placeholder shown at the bottom of the list
     while the deploy streams. Removed when the final event lands. */
  list-style: none;
  margin-left: -22px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  color: var(--muted);
  font-size: 14px;
}
.cloud-steps li.running .running-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  animation: helm-pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
.cloud-steps li.running .running-label {
  flex: 1;
  font-style: italic;
}
.cloud-steps li.running .running-elapsed {
  color: var(--muted);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}
@keyframes helm-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}
.cloud-steps li small { color: var(--muted); display: block; }
.cloud-steps li .step-error,
.cloud-steps li .step-warn {
  display: block;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 6px 0 0;
  padding: 8px 12px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink);
}
.cloud-steps li .step-error {
  background: rgba(243, 128, 32, 0.05);
  border-left: 2px solid var(--accent);
}
.cloud-steps li .step-warn {
  /* Amber, dimmer than the orange used for hard failures. The whole
     point of a warning is that the deploy continued — the visual weight
     should match. */
  background: rgba(184, 138, 44, 0.05);
  border-left: 2px solid #b88a2c;
  color: var(--muted);
}
.field { margin: 14px 0; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.field-hint { color: var(--muted); font-size: 12px; font-weight: normal; }
.field input[type="text"], .field input[type="email"], .field input[type="password"], .field select,
.field textarea {
  width: 100%; max-width: 480px; padding: 10px 12px; font-family: 'IBM Plex Mono', monospace;
  font-size: 14px; border: 1px solid var(--rule); background: transparent; color: var(--ink);
}
.field textarea { line-height: 1.6; resize: vertical; min-height: 64px; }

/* What-to-provision fieldset: keeps the two checkboxes grouped + bordered.
   The previous markup used bare <label> rows with default checkbox glyphs
   that browsers (esp. with Forced Colors mode or some dark themes)
   render as opaque red squares — fixed here with appearance:none + a
   custom checkmark, plus solid contrast for both ticked + unticked. */
.opts {
  margin: 18px 0 8px;
  padding: 14px 16px;
  border: 1px solid var(--rule);
  background: rgba(255, 255, 255, 0.015);
}
.opts legend {
  padding: 0 6px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.opt-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  cursor: pointer;
  font-size: 14px;
  color: var(--ink);
}
.opt-row + .opt-row { border-top: 1px dotted var(--rule); }
.opt-row-tight { padding: 6px 0; margin-top: 6px; border-top: 1px dotted var(--rule); }
.opt-row input[type="checkbox"],
.opt-row input[type="radio"] {
  /* Reset the platform default — it was rendering as a solid red block in
     the user's screenshot. Replace with an explicit, theme-consistent box. */
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  border: 1px solid var(--rule);
  background: transparent;
  display: inline-block;
  flex-shrink: 0;
  cursor: pointer;
  position: relative;
  transition: background 120ms, border-color 120ms;
}
.opt-row input[type="radio"] { border-radius: 50%; }
.opt-row input[type="checkbox"]:hover,
.opt-row input[type="radio"]:hover { border-color: var(--ink); }
.opt-row input[type="checkbox"]:checked,
.opt-row input[type="radio"]:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.opt-row input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 0px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.opt-row input[type="radio"]:checked::after {
  /* Inner dot for the radio's "selected" state — circular, white, centered. */
  content: "";
  position: absolute;
  left: 4px;
  top: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
}
.opt-row input[type="checkbox"]:focus-visible,
.opt-row input[type="radio"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.opt-label { display: flex; flex-direction: column; gap: 2px; line-height: 1.4; }
.opt-title { color: var(--ink); }
.opt-sub { color: var(--muted); font-size: 12px; }
.badge-rec {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  font-size: 10px;
  font-family: 'IBM Plex Mono', monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  border: 1px solid var(--accent);
}

/* Disclosure / collapse styling — uses CSS for the rotation chevron
   so the BYOK + extra-emails groups feel like one consistent system. */
.opt-summary {
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 6px 0;
  list-style: none;
  user-select: none;
}
.opt-summary::-webkit-details-marker { display: none; }
.opt-summary::before {
  content: "▸";
  display: inline-block;
  margin-right: 8px;
  transition: transform 120ms;
  color: var(--muted);
}
details[open] > .opt-summary::before { transform: rotate(90deg); }
.opt-summary-thin { font-size: 11px; }
.opt-help {
  font-size: 13px;
  color: var(--muted);
  margin: 6px 0 12px;
  line-height: 1.55;
  max-width: 480px;
}
.advanced {
  margin-top: 18px;
  padding: 4px 0 0;
  border-top: 1px solid var(--rule);
}
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

  // Defensive: fail loudly if any wired-up element is missing instead of
  // silently failing somewhere downstream. If the page renders without
  // verify-btn / verify-out, every later listener attaches to null and
  // blows up at click time with no visible feedback — exactly the
  // "nothing happens when I click" UX the user hit.
  const requiredEls = {
    tokenInput, verifyBtn, verifyOut, step2, step3, accountSelect,
    workerInput, ownerInput, deployBtn, stepsList, out, wranglerPre,
    cmdsPre, urlSpan
  };
  for (const [k, el] of Object.entries(requiredEls)) {
    if (!el) {
      console.error('[deploy] required element missing: ' + k + ' — page is broken; reload or report');
      const banner = document.createElement('div');
      banner.style.cssText = 'background:#fef2f2;color:#991b1b;padding:12px;margin:12px 0;border-left:3px solid #dc2626;font-family:monospace;';
      banner.textContent = 'Deploy form broken: missing element #' + k + '. Refresh the page; if the issue persists, file a bug.';
      document.body.prepend(banner);
      return;
    }
  }
  console.info('[deploy] form ready · ' + Object.keys(requiredEls).length + ' elements wired');

  // --- Model preset show/hide logic -------------------------------------
  // - "Custom" radio reveals the text input row underneath the radios.
  // - GPT-5.5 + Opus 4.7 reveal the reasoning-effort dropdown; the others
  //   hide it (Kimi doesn't support reasoning yet on Moonshot's API, and
  //   Sonnet 4.6's extended_thinking is binary not graded so we hide).
  // - Reasoning hint text adapts per preset.
  const modelRadios = document.querySelectorAll('input[name="cf-model"]');
  const customRow = document.getElementById('cf-model-custom-row');
  const reasoningRow = document.getElementById('cf-model-reasoning-row');
  const reasoningHint = document.getElementById('cf-model-reasoning-hint');
  function syncModelUI() {
    const sel = document.querySelector('input[name="cf-model"]:checked');
    const v = sel ? sel.value : 'kimi-k2.6';
    if (customRow) {
      if (v === 'custom') customRow.removeAttribute('hidden');
      else customRow.setAttribute('hidden', '');
    }
    if (reasoningRow) {
      if (v === 'gpt-5.5' || v === 'opus-4.7') reasoningRow.removeAttribute('hidden');
      else reasoningRow.setAttribute('hidden', '');
    }
    if (reasoningHint) {
      if (v === 'gpt-5.5') {
        reasoningHint.textContent = 'GPT-5.5 reasoning.effort. Higher = more deliberation, more tokens, slower.';
      } else if (v === 'opus-4.7') {
        reasoningHint.textContent = 'Maps to extended_thinking budget on Anthropic. Off / Low keeps it snappy; High lets it think before tool calls.';
      }
    }
  }
  modelRadios.forEach(function (r) { r.addEventListener('change', syncModelUI); });
  syncModelUI();

  verifyBtn.addEventListener('click', async () => {
    console.info('[deploy] verify clicked');
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
      // Surface non-JSON / non-200 cleanly. The previous code blindly
      // called r.json() and a 502/HTML response would throw with no
      // visible feedback.
      if (!r.ok) {
        const body = await r.text();
        verifyOut.textContent = 'verify failed (' + r.status + '): ' + (body.slice(0, 200) || r.statusText);
        console.error('[deploy] verify HTTP ' + r.status + ':', body.slice(0, 500));
        return;
      }
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        const body = await r.text();
        verifyOut.textContent = 'verify failed: server returned ' + ct + ' (expected JSON)';
        console.error('[deploy] non-JSON response from /api/cloud/verify-token:', body.slice(0, 500));
        return;
      }
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
      // Pre-fill the owner email from the token's user-details record so
      // the user doesn't have to retype something CF already knows. Only
      // fills empty fields — never overwrites a value the user typed.
      if (data.userEmail && !ownerInput.value) {
        ownerInput.value = data.userEmail;
        ownerInput.placeholder = data.userEmail;
      }
      const accountWord = (data.accounts || []).length === 1 ? 'account' : 'accounts';
      verifyOut.textContent = 'token ok · ' + (data.accounts || []).length + ' ' + accountWord
        + (data.userEmail ? ' · ' + data.userEmail : '');
      step2.removeAttribute('hidden');
      step2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      verifyOut.textContent = 'error: ' + (err && err.message ? err.message : String(err));
      console.error('[deploy] verify threw:', err);
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
    const extraEmailsRaw = ($('#cf-extra-emails')?.value || '').trim();
    const extraEmails = extraEmailsRaw
      .split(/[\\n,]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0 && s.indexOf('@') > 0; });
    const anth = $('#cf-anth').value.trim();
    const oai = $('#cf-oai').value.trim();
    const or = $('#cf-or').value.trim();

    // Read the model preset radio + reasoning effort. The custom row's
    // text input is only used when preset === 'custom'; the reasoning
    // dropdown is hidden (and ignored) for Kimi which doesn't support it.
    const modelPresetRadio = document.querySelector('input[name="cf-model"]:checked');
    const modelPreset = modelPresetRadio ? modelPresetRadio.value : 'kimi-k2.6';
    const customModelId = ($('#cf-model-custom-id')?.value || '').trim();
    const modelReasoningEffort = ($('#cf-model-reasoning')?.value || '').trim();

    if (!accountId) { alert('Pick an account.'); return; }
    if (!workerName) { alert('Pick a worker name.'); return; }
    if (enableAccess && !owner) {
      alert('An owner email is required when Cloudflare Access is enabled (it\\'s the email Access lets in).');
      ownerInput.focus();
      return;
    }
    if (modelPreset === 'custom' && !customModelId) {
      alert('Custom model selected but no id provided. Pick a different preset or paste a model id.');
      return;
    }

    const secrets = {};
    if (owner) secrets.OWNER_EMAIL = owner;
    if (owner) secrets.AGENT_OWNER_EMAIL = owner;
    if (anth) secrets.ANTHROPIC_API_KEY = anth;
    if (oai) secrets.OPENAI_API_KEY = oai;
    if (or) secrets.OPENROUTER_API_KEY = or;

    step3.removeAttribute('hidden');
    out.setAttribute('hidden', '');
    stepsList.innerHTML = '';
    deployBtn.disabled = true;
    step3.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Live-deploy state machine. We render each step as it streams in
    // from the server (NDJSON, one event per line) so the user never
    // sits on a static "kicking off…" screen while a 60-120s deploy
    // happens behind the scenes.
    //
    // Three event types:
    //   - { phase: "step", step }      — landed step; render permanently
    //   - { phase: "running", kind, summary } — slow stage starting; show
    //                                           a pulsing "doing X..." row
    //   - { phase: "final", result }   — terminal; show success/error UI
    const runningLi = document.createElement('li');
    runningLi.className = 'running';
    runningLi.innerHTML = '<span class="running-dot"></span><span class="running-label">Connecting to Cloudflare…</span><span class="running-elapsed">0s</span>';
    stepsList.appendChild(runningLi);
    const deployStart = Date.now();
    const tickElapsed = setInterval(function () {
      const secs = Math.floor((Date.now() - deployStart) / 1000);
      const elap = runningLi.querySelector('.running-elapsed');
      if (elap) elap.textContent = secs + 's';
    }, 1000);
    const updateRunning = function (summary) {
      const label = runningLi.querySelector('.running-label');
      if (label) label.textContent = summary;
    };
    const renderStep = function (s) {
      const li = document.createElement('li');
      li.className = !s.ok ? 'fail' : s.warning ? 'warn' : 'ok';
      li.textContent = s.summary;
      if (s.error) {
        const detail = document.createElement('pre');
        detail.className = 'step-error';
        detail.textContent = s.error;
        li.appendChild(detail);
      } else if (s.warning) {
        const detail = document.createElement('pre');
        detail.className = 'step-warn';
        detail.textContent = s.warning;
        li.appendChild(detail);
      }
      // Insert ABOVE the running placeholder so the running row stays at
      // the bottom as the next-pending stage.
      stepsList.insertBefore(li, runningLi);
    };

    try {
      const payload = {
        token: currentToken,
        accountId,
        workerName,
        enableD1,
        enableAccess,
        additionalAllowedEmails: extraEmails,
        modelPreset,
        secrets
      };
      if (modelPreset === 'custom' && customModelId) {
        payload.customModelId = customModelId;
      }
      // Reasoning effort applies only to thinking-capable presets
      // (GPT-5.5, Opus 4.7). The form's UI hides the dropdown for the
      // others, but we still send the value if set — the server is
      // the one that knows whether the chosen preset can route it.
      if (modelReasoningEffort && modelReasoningEffort !== 'medium') {
        payload.modelReasoningEffort = modelReasoningEffort;
      }
      // Tell the server we want to persist this deploy as a managed
      // subscriber. The server reads our actual customer_id from the
      // signed intent cookie — never from this body.
      if (subscribed) payload.persist = true;
      const r = await fetch('/api/cloud/deploy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Ask the server to stream NDJSON. The server still falls
          // back to the legacy single-JSON response if it doesn't
          // understand this header, in which case the .json() path
          // below catches the whole result at once.
          'accept': 'application/x-ndjson'
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      let data = null;
      const ctype = (r.headers.get('content-type') || '').toLowerCase();
      if (ctype.indexOf('x-ndjson') >= 0 && r.body && r.body.getReader) {
        // Streaming branch — read line-delimited JSON.
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.phase === 'step' && evt.step) {
                renderStep(evt.step);
              } else if (evt.phase === 'running' && evt.summary) {
                updateRunning(evt.summary);
              } else if (evt.phase === 'final' && evt.result) {
                data = evt.result;
              }
            } catch (parseErr) {
              console.warn('[deploy] bad NDJSON line:', line, parseErr);
            }
          }
        }
        if (!data) {
          throw new Error('deploy stream ended without final result');
        }
      } else {
        // Non-streaming fallback (legacy server, or proxy that buffered
        // the response). Render whatever steps came back at the end.
        data = await r.json();
        for (const s of (data.steps || [])) renderStep(s);
      }
      // Stop the elapsed-time ticker + remove the running row now that
      // the deploy is terminal. The visible step list stays intact.
      clearInterval(tickElapsed);
      runningLi.remove();
      // The post-stream render path below uses the final result and the
      // existing step-grouping/filtering logic to render the FINAL
      // summary panels (live URL, partial-deploy banner, fallback
      // details). The streamed steps were progressive; we re-render
      // to apply grouping (Secrets set N) + drop noise.
      stepsList.innerHTML = '';
      // Render a CONCISE log by default. Implementation noise the user
      // doesn't need to see (manifest fetch, wrangler.toml compose,
      // local-fallback commands when direct-deploy succeeded, individual
      // secret puts, redundant subdomain-enable when upload already
      // confirmed it) gets folded into either summaries or dropped.
      // Failed steps ALWAYS render so the user can act on them.
      const allSteps = (data.steps || []);
      const directDeployed = !!data.directDeployed;
      const dropKindsOnSuccess = new Set([
        'compose-wrangler-toml',     // implementation detail
        'render-cli-commands',       // only matters when direct-deploy fails
        'fetch-bundle',              // implementation detail
        'enable-subdomain'           // redundant with upload-worker's "Worker live at..."
      ]);
      const visible = [];
      const setSecretGroup = [];
      for (const s of allSteps) {
        // Always show failures + errors regardless of kind.
        if (!s.ok || s.error) {
          // Flush any pending set-secret group before the failure.
          if (setSecretGroup.length > 0) {
            visible.push({
              ok: setSecretGroup.every((x) => x.ok),
              summary: setSecretGroup.length === 1
                ? setSecretGroup[0].summary
                : 'Secrets set (' + setSecretGroup.length + ')',
              kind: 'set-secret-group'
            });
            setSecretGroup.length = 0;
          }
          visible.push(s);
          continue;
        }
        // Group consecutive set-secret rows.
        if (s.kind === 'set-secret') {
          setSecretGroup.push(s);
          continue;
        }
        if (setSecretGroup.length > 0) {
          visible.push({
            ok: true,
            summary: setSecretGroup.length === 1
              ? setSecretGroup[0].summary
              : 'Secrets set (' + setSecretGroup.length + ')',
            kind: 'set-secret-group'
          });
          setSecretGroup.length = 0;
        }
        // Drop implementation-noise kinds when direct-deploy succeeded.
        if (directDeployed && dropKindsOnSuccess.has(s.kind)) continue;
        // Trim verbose token-id from the verify summary.
        // NOTE: \\(  → \( in the rendered page → /(...)/ regex paren.
        // Single backslash gets eaten by the outer template literal.
        if (s.kind === 'verify-token' && /\\(id [a-f0-9]/.test(s.summary)) {
          visible.push({ ...s, summary: 'Cloudflare token verified' });
          continue;
        }
        visible.push(s);
      }
      // Flush any trailing set-secret group.
      if (setSecretGroup.length > 0) {
        visible.push({
          ok: true,
          summary: setSecretGroup.length === 1
            ? setSecretGroup[0].summary
            : 'Secrets set (' + setSecretGroup.length + ')',
          kind: 'set-secret-group'
        });
      }
      for (const s of visible) {
        const li = document.createElement('li');
        // Three states: ok (green check), warning (amber, deploy continues),
        // fail (red x). The "warning" property is set on a step that
        // succeeded with a caveat (e.g. AI Gateway skipped because the
        // token was missing a scope) — the deploy does not abort, but
        // the user should know.
        li.className = !s.ok ? 'fail' : s.warning ? 'warn' : 'ok';
        li.textContent = s.summary;
        if (s.error) {
          const detail = document.createElement('pre');
          detail.className = 'step-error';
          detail.textContent = s.error;
          li.appendChild(detail);
        } else if (s.warning) {
          const detail = document.createElement('pre');
          detail.className = 'step-warn';
          detail.textContent = s.warning;
          li.appendChild(detail);
        }
        stepsList.appendChild(li);
      }
      if (data.ok) {
        out.removeAttribute('hidden');
        wranglerPre.textContent = data.wranglerToml || '';
        cmdsPre.textContent = (data.commands || []).join('\\n');
        // Prefer the actual worker host the server resolved
        // (<name>.<account-subdomain>.workers.dev). The fallback is the
        // legacy "<name>.workers.dev" pattern, which doesn't actually
        // resolve — only used if the server didn't return workerUrl.
        const fullUrl = data.workerUrl || ('https://' + workerName + '.workers.dev');
        urlSpan.textContent = fullUrl.replace(/^https?:\\/\\//, '');
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
          const shellLink = $('#deploy-shell-link');
          if (shellLink) {
            shellLink.textContent = fullUrl + '/shell';
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
