export function playgroundHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open Think Playground</title>
<style>
  :root { color-scheme: light dark; --fg: #111; --bg: #fff; --accent: #f38020; --muted: #666; --border: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #0b0b0b; --muted: #aaa; --border: #333; } }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, system-ui, Segoe UI, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 24px; max-width: 960px; margin-inline: auto; }
  h1 { margin-top: 0; }
  h1 .tag { color: var(--accent); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .muted { color: var(--muted); }
  textarea, input, select, button { font: inherit; padding: 8px 10px; border: 1px solid var(--border); background: transparent; color: var(--fg); border-radius: 6px; }
  textarea { width: 100%; min-height: 90px; font-family: ui-monospace, monospace; }
  button { cursor: pointer; background: var(--accent); color: #fff; border: none; font-weight: 600; }
  button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
  pre { background: rgba(0,0,0,0.05); padding: 12px; border-radius: 6px; overflow: auto; max-height: 420px; }
  @media (prefers-color-scheme: dark) { pre { background: rgba(255,255,255,0.05); } }
  label { display: block; margin-bottom: 4px; font-weight: 500; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; margin-left: 8px; }
  .grid-list { display: grid; grid-template-columns: 1fr; gap: 8px; }
  .item { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
  .item b { display: block; }
  .flex { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
</head>
<body>
  <h1>Open Think <span class="tag">Playground</span></h1>
  <p class="muted">Cloudflare-native agent runtime inspired by Project Think. Invoke skills, inspect plugins, manage sessions.</p>

  <div class="row">
    <div class="card">
      <div class="flex"><b>Health</b><button class="secondary" onclick="refreshHealth()">Refresh</button></div>
      <pre id="health">(loading…)</pre>
    </div>
    <div class="card">
      <div class="flex"><b>Metrics</b><button class="secondary" onclick="refreshMetrics()">Refresh</button></div>
      <pre id="metrics">(loading…)</pre>
    </div>
  </div>

  <div class="card">
    <b>Skills</b>
    <div id="skills" class="grid-list"><div class="muted">loading…</div></div>
  </div>

  <div class="card">
    <b>Invoke a skill</b>
    <div class="flex" style="margin: 8px 0;">
      <select id="skillPicker"></select>
      <button onclick="invokeSkill()">Invoke</button>
    </div>
    <label for="skillInput">input JSON</label>
    <textarea id="skillInput">{}</textarea>
    <pre id="skillResult" style="margin-top: 12px;"></pre>
  </div>

  <div class="card">
    <b>Session quickstart</b>
    <p class="muted">Spin up a durable agent session, append messages, fork branches.</p>
    <div class="flex">
      <input id="sessionName" placeholder="session-name (e.g. demo-1)" />
      <button onclick="initSession()">Init</button>
      <button class="secondary" onclick="describeSession()">Describe</button>
    </div>
    <div style="margin-top: 12px;">
      <label>append message</label>
      <div class="flex">
        <select id="msgRole">
          <option>user</option>
          <option>system</option>
          <option>assistant</option>
          <option>tool</option>
        </select>
        <input id="msgContent" placeholder="content" style="flex: 1; min-width: 200px;" />
        <button onclick="appendMessage()">Send</button>
      </div>
    </div>
    <pre id="sessionResult" style="margin-top: 12px;"></pre>
  </div>

<script>
async function j(path, init) {
  const response = await fetch(path, init);
  const text = await response.text();
  try { return { status: response.status, data: JSON.parse(text) }; }
  catch { return { status: response.status, data: text }; }
}

async function refreshHealth() {
  const r = await j('/health');
  document.getElementById('health').textContent = JSON.stringify(r.data, null, 2);
}

async function refreshMetrics() {
  const r = await j('/metrics');
  document.getElementById('metrics').textContent = JSON.stringify(r.data, null, 2);
}

async function loadSkills() {
  const r = await j('/skills');
  const skills = (r.data && r.data.data && r.data.data.skills) || [];
  const skillsEl = document.getElementById('skills');
  const picker = document.getElementById('skillPicker');
  picker.innerHTML = '';
  skillsEl.innerHTML = '';
  for (const s of skills) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.id;
    picker.appendChild(opt);

    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<b>' + s.id + '</b>' + '<span class="muted">' + s.description + '</span>';
    skillsEl.appendChild(row);
  }
  if (!skills.length) skillsEl.innerHTML = '<div class="muted">no skills enabled</div>';
}

async function invokeSkill() {
  const id = document.getElementById('skillPicker').value;
  let body = {};
  try { body = { input: JSON.parse(document.getElementById('skillInput').value || '{}') }; }
  catch (e) { document.getElementById('skillResult').textContent = 'Invalid JSON: ' + e.message; return; }
  const r = await j('/skills/invoke/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('skillResult').textContent = JSON.stringify(r.data, null, 2);
}

function sessionName() { return document.getElementById('sessionName').value.trim(); }

async function initSession() {
  const name = sessionName();
  if (!name) return alert('session name required');
  const r = await j('/sessions/' + encodeURIComponent(name) + '/init', { method: 'POST', body: '{}' });
  document.getElementById('sessionResult').textContent = JSON.stringify(r.data, null, 2);
}

async function describeSession() {
  const name = sessionName();
  if (!name) return alert('session name required');
  const r = await j('/sessions/' + encodeURIComponent(name));
  document.getElementById('sessionResult').textContent = JSON.stringify(r.data, null, 2);
}

async function appendMessage() {
  const name = sessionName();
  if (!name) return alert('session name required');
  const body = { role: document.getElementById('msgRole').value, content: document.getElementById('msgContent').value };
  const r = await j('/sessions/' + encodeURIComponent(name) + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('sessionResult').textContent = JSON.stringify(r.data, null, 2);
}

refreshHealth(); refreshMetrics(); loadSkills();
</script>
</body>
</html>`;
}
