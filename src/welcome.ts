/**
 * First-run welcome page. Served from `/welcome` always, and from `/` when
 * the caller's `Accept` header asks for HTML.
 *
 * The page is intentionally framework-free: a single self-contained HTML
 * document, ~5 KB after gzip. It probes `/setup/status` on load to tell
 * the operator what's wired up vs. what still needs configuring, then
 * funnels them into `/app` for the rest of the journey.
 *
 * Goals:
 *   - First impression after `wrangler deploy` is friendly, not a route map.
 *   - Auth state is immediately legible (yellow banner if first-run permissive).
 *   - The chat path is one click away — Workers AI runs free out of the box.
 */

export function welcomeHtml(env: { AGENT_NAME?: string; AGENT_OWNER?: string }): string {
  const name = env.AGENT_NAME ?? "Helm";
  const owner = env.AGENT_OWNER ? `${env.AGENT_OWNER}'s ` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)} — first run</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {
  --paper: #fafaf5;
  --ink: #121212;
  --rule: #1a1a1a;
  --muted: #666;
  --muted-2: #bdbdbd;
  --accent: #f38020;
  --warn: #b6590f;
  --warn-bg: #fff4e0;
  --ok: #2d5c3e;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); }
body {
  font-family: 'IBM Plex Sans', -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  padding: 32px 20px;
}
.wrap { max-width: 720px; margin: 0 auto; }
.serif { font-family: 'Instrument Serif', serif; font-style: normal; }
.mono { font-family: 'IBM Plex Mono', monospace; }
.hat {
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 16px;
}
h1 {
  font-family: 'Instrument Serif', serif;
  font-size: clamp(36px, 6vw, 56px);
  line-height: 1.05;
  margin: 0 0 18px;
  letter-spacing: -0.01em;
}
h1 em { font-style: italic; color: var(--accent); }
.lede { font-size: 17px; color: var(--ink); max-width: 56ch; margin: 0 0 28px; }
.banner {
  display: none;
  margin: 0 0 28px;
  padding: 14px 18px;
  border: 1px solid var(--warn);
  background: var(--warn-bg);
  color: var(--warn);
  font-size: 14px;
}
.banner.show { display: block; }
.banner b { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; display: block; margin-bottom: 4px; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 36px; }
.btn {
  display: inline-block;
  padding: 12px 22px;
  font-family: inherit;
  font-size: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-decoration: none;
  background: var(--ink);
  color: var(--paper);
  border: 1px solid var(--ink);
  cursor: pointer;
}
.btn.ghost { background: transparent; color: var(--ink); }
.btn:hover { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.checklist { border: 1px solid var(--rule); background: rgba(0,0,0,0.02); }
.checklist h2 { font-family: 'Instrument Serif', serif; font-size: 22px; margin: 0; padding: 14px 18px; border-bottom: 1px solid var(--muted-2); }
.row {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 14px;
  align-items: baseline;
  padding: 12px 18px;
  border-bottom: 1px dotted var(--muted-2);
}
.row:last-child { border-bottom: none; }
.row .dot { font-size: 14px; line-height: 1; }
.row .dot.ok { color: var(--ok); }
.row .dot.miss { color: var(--muted-2); }
.row .label { font-size: 14px; }
.row .label small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row .state {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.row .state.ok { color: var(--ok); }
footer {
  margin-top: 56px;
  padding-top: 18px;
  border-top: 1px dotted var(--muted-2);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--muted);
  text-transform: uppercase;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
footer a { color: var(--muted); border-bottom: 1px solid var(--muted-2); text-decoration: none; padding-bottom: 1px; }
footer a:hover { color: var(--accent); border-color: var(--accent); }
</style>
</head>
<body>
<main class="wrap">
  <div class="hat">${escapeHtml(owner)}${escapeHtml(name)} · first run</div>
  <h1>Helm is live <em>on Cloudflare</em>.</h1>
  <p class="lede">
    No secrets, no extra config. Workers AI is your free default model and
    Helm is in propose mode. Open <span class="mono">/app</span> to chat — or
    add the bindings below to unlock memory, email, push, and the morning
    briefing.
  </p>

  <div id="auth-banner" class="banner">
    <b>auth not configured</b>
    Anyone who finds this URL can talk to Helm and use your Workers AI quota.
    Set <span class="mono">CF_ACCESS_TEAM_DOMAIN</span> and
    <span class="mono">CF_ACCESS_AUD</span> (or run
    <span class="mono">npm run pa:setup</span>) before exposing this publicly.
  </div>

  <div class="actions">
    <a class="btn" href="/app">Open ${escapeHtml(name)} →</a>
    <a class="btn ghost" href="/setup/status">Check status (JSON)</a>
    <a class="btn ghost" href="https://github.com/NeoFlux-Holdings/open-think/blob/main/docs/PA_STACK.md">PA stack docs</a>
  </div>

  <section class="checklist" aria-label="Configuration checklist">
    <h2>What's wired up</h2>
    <div id="checklist-body">
      <div class="row"><span class="dot mono">·</span><span class="label">Loading status…</span><span class="state mono">…</span></div>
    </div>
  </section>

  <footer>
    <span>Open Think · Apache-2.0 · Cloudflare-native</span>
    <span><a href="/openapi.json">openapi</a> · <a href="/health">/health</a> · <a href="/welcome">/welcome</a></span>
  </footer>
</main>
<script>
(async function () {
  const banner = document.getElementById('auth-banner');
  const body = document.getElementById('checklist-body');
  try {
    const resp = await fetch('/setup/status', { headers: { accept: 'application/json' } });
    if (!resp.ok) {
      body.innerHTML = '<div class="row"><span class="dot mono">·</span><span class="label">Status endpoint returned ' + resp.status + '. Open /app to proceed.</span><span class="state mono">err</span></div>';
      return;
    }
    const json = await resp.json();
    const data = json.data || {};
    const caps = data.capabilities || [];
    const score = data.readinessScore || 0;
    const authMissing = caps.find(function (c) { return c.id === 'auth' && !c.configured; });
    if (authMissing) banner.classList.add('show');

    body.innerHTML = caps.map(function (c) {
      const ok = c.configured;
      const dot = ok ? '✓' : '·';
      const cls = ok ? 'ok' : 'miss';
      const state = ok ? 'OK' : (c.enabled ? 'NEEDS SECRETS' : 'OFF');
      const stateCls = ok ? 'ok' : '';
      const hint = ok ? '' : '<small>' + escape(c.hint || '') + '</small>';
      return '<div class="row">'
        + '<span class="dot ' + cls + '">' + dot + '</span>'
        + '<span class="label">' + escape(c.label) + hint + '</span>'
        + '<span class="state mono ' + stateCls + '">' + state + '</span>'
      + '</div>';
    }).join('') + '<div class="row" style="border-top:1px solid var(--muted-2);"><span class="dot mono">·</span><span class="label"><b>Readiness</b></span><span class="state mono">' + score + '%</span></div>';
  } catch (err) {
    body.innerHTML = '<div class="row"><span class="dot mono">·</span><span class="label">Could not reach /setup/status. Open /app anyway — Workers AI runs without it.</span><span class="state mono">err</span></div>';
  }
})();

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
  });
}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;"
  );
}
