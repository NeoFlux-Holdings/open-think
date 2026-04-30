export function appHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Open Think — Cloudflare-native agent runtime</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
:root {
  --paper: #f4eee0;
  --ink: #121110;
  --rule: #1a1814;
  --muted: #625a4a;
  --muted-2: #a19883;
  --accent: #e25822;
  --accent-deep: #9a3a12;
  --ok: #2d5c3e;
  --warn: #886414;
  --red: #8b1d1d;
  --selection: #ffd37a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #14120f;
    --ink: #f0e6d1;
    --rule: #e4d7b8;
    --muted: #8a7e65;
    --muted-2: #443d30;
    --accent: #ff7a3d;
    --accent-deep: #ffb088;
    --ok: #7fc79a;
    --warn: #f0c775;
    --red: #ff9690;
    --selection: #4a3a1a;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--paper); color: var(--ink); }
body {
  font-family: 'Newsreader', Georgia, serif;
  font-optical-sizing: auto;
  font-size: 17px;
  line-height: 1.5;
  min-height: 100vh;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  background-image:
    repeating-linear-gradient(0deg, transparent 0 39px, rgba(0,0,0,0.012) 39px 40px);
  background-attachment: fixed;
}
::selection { background: var(--selection); color: var(--ink); }
.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-feature-settings: 'ss01', 'ss02'; }
.display { font-family: 'Fraunces', 'Newsreader', Georgia, serif; font-variation-settings: 'opsz' 144, 'SOFT' 0, 'WONK' 0; }
.small-caps { font-variant: small-caps; letter-spacing: 0.12em; text-transform: lowercase; }

/* -------- masthead -------- */
.masthead {
  border-bottom: 3px double var(--rule);
  padding: 22px 0 18px;
  position: relative;
}
.masthead .container { max-width: 1400px; margin: 0 auto; padding: 0 28px; }
.masthead-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--rule);
  padding-bottom: 10px;
  margin-bottom: 14px;
}
.masthead-top .dot { color: var(--accent); }
.wordmark {
  font-family: 'Fraunces', serif;
  font-size: clamp(56px, 10vw, 128px);
  line-height: 0.9;
  letter-spacing: -0.035em;
  font-weight: 900;
  font-variation-settings: 'opsz' 144, 'WONK' 1;
  display: flex;
  align-items: center;
  gap: 26px;
  margin-bottom: 8px;
}
.wordmark .compass {
  width: clamp(60px, 10vw, 112px);
  height: clamp(60px, 10vw, 112px);
  flex-shrink: 0;
  opacity: 0.92;
}
.tagline {
  font-family: 'Newsreader', serif;
  font-style: italic;
  font-size: clamp(15px, 1.5vw, 19px);
  color: var(--muted);
  border-top: 1px solid var(--rule);
  padding-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.tagline .edition { color: var(--ink); letter-spacing: 0.12em; font-style: normal; font-size: 11px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; }

/* -------- nav -------- */
nav.tabs {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--paper);
  border-bottom: 1px solid var(--rule);
  padding: 10px 28px;
}
nav.tabs .container { max-width: 1400px; margin: 0 auto; display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
nav.tabs a {
  color: var(--ink);
  text-decoration: none;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 6px 0;
  position: relative;
  cursor: pointer;
}
nav.tabs a[aria-current="true"] { color: var(--accent); }
nav.tabs a[aria-current="true"]::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: var(--accent);
}
nav.tabs a:hover { color: var(--accent-deep); }
nav.tabs .spacer { flex: 1; }
nav.tabs .kbd-hint { font-size: 10px; color: var(--muted); }

/* -------- main layout -------- */
main { max-width: 1400px; margin: 0 auto; padding: 36px 28px 72px; }
.section-ref {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
h1.section-title {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-variation-settings: 'opsz' 96;
  font-size: clamp(32px, 4vw, 56px);
  line-height: 1.02;
  letter-spacing: -0.02em;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 18px;
}
.lede { font-size: 19px; color: var(--muted); font-style: italic; max-width: 72ch; margin-top: -4px; margin-bottom: 26px; }

/* -------- overview -------- */
.overview-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 40px;
  align-items: flex-start;
}
@media (max-width: 900px) { .overview-grid { grid-template-columns: 1fr; } }
.column-rule { border-left: 1px solid var(--rule); padding-left: 28px; }
.hero-block { border-bottom: 1px solid var(--rule); padding-bottom: 28px; margin-bottom: 28px; }
.hero-block p { font-size: 19px; line-height: 1.55; max-width: 60ch; }
.hero-block p + p { margin-top: 14px; }

/* -------- first-run banner -------- */
.first-run-banner {
  position: relative;
  margin-bottom: 28px;
  padding: 16px 56px 16px 18px;
  border: 1px solid var(--accent);
  background: rgba(243, 128, 32, 0.07);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.55;
}
.first-run-banner[hidden] { display: none; }
.frb-head {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 4px;
}
.frb-body { margin: 0; }
.frb-link {
  display: inline-block;
  margin-left: 6px;
  color: var(--accent);
  border-bottom: 1px solid var(--accent);
  padding-bottom: 1px;
}
.frb-dismiss {
  position: absolute;
  top: 8px; right: 10px;
  width: 28px; height: 28px;
  background: transparent;
  border: 0;
  font-size: 22px;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
}
.frb-dismiss:hover { color: var(--accent); }

/* -------- stat tiles -------- */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
  margin-bottom: 28px;
}
@media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }
.stat { background: var(--paper); padding: 16px 14px; }
.stat .label { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.stat .value { font-family: 'Fraunces', serif; font-weight: 900; font-size: 42px; line-height: 1; font-variant-numeric: tabular-nums; font-variation-settings: 'opsz' 96, 'WONK' 1; }
.stat.accent .value { color: var(--accent); }
.stat .footnote { font-size: 11px; color: var(--muted); margin-top: 8px; font-family: 'JetBrains Mono', monospace; }

/* -------- conductor panel -------- */
.conductor {
  border: 1px solid var(--rule);
  background: var(--paper);
  position: relative;
}
.conductor::before {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid var(--rule);
  pointer-events: none;
}
/* ---------- Conductor / chat surface ---------- */
.conductor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--rule);
  gap: 12px;
}
.conductor-title { display: flex; align-items: center; gap: 10px; }
.conductor-header .title {
  font-family: 'Fraunces', serif; font-weight: 600;
  font-size: 24px; font-variation-settings: 'opsz' 48, 'WONK' 1;
  letter-spacing: -0.01em;
}
.conn-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--muted-2);
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s, box-shadow 0.2s;
}
.conn-dot[data-state="live"] {
  background: #2d8c4f;
  box-shadow: 0 0 0 2px rgba(45,140,79,0.18);
  animation: dot-pulse-live 2.4s ease-in-out infinite;
}
.conn-dot[data-state="connecting"] {
  background: var(--accent);
  animation: dot-pulse-connecting 1.0s ease-in-out infinite;
}
.conn-dot[data-state="reconnecting"] {
  background: #b6590f;
  animation: dot-pulse-connecting 0.7s ease-in-out infinite;
}
.conn-dot[data-state="error"] { background: #c0392b; }
.conn-dot[data-state="idle"] { background: var(--muted-2); }
@keyframes dot-pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes dot-pulse-connecting { 0%,100% { transform: scale(1); } 50% { transform: scale(0.6); } }

/* ---- Shell tab (CF-Container-backed bash session) ---- */
.shell-card {
  background: #0b0b0d;
  border: 1px solid var(--rule);
  border-radius: 10px;
  overflow: hidden;
  display: flex; flex-direction: column;
  margin-top: 18px;
}
.shell-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid var(--rule);
}
.shell-bar .spacer { flex: 1; }
.shell-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.shell-title span { color: var(--ink); }
.shell-bar .ghost {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
}
.shell-mount {
  height: 64vh;
  min-height: 360px;
  padding: 10px 12px;
  background: #0b0b0d;
  outline: none;
}
.shell-mount .xterm { height: 100%; }
.shell-mount .xterm-viewport { background-color: #0b0b0d !important; }
.shell-foot {
  padding: 8px 14px;
  border-top: 1px solid var(--rule);
  background: rgba(255,255,255,0.02);
}
.shell-hint {
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
@media (max-width: 600px) {
  .shell-mount { height: 56vh; min-height: 280px; padding: 6px 8px; }
  .shell-bar { padding: 8px 10px; gap: 8px; }
  .shell-hint { display: none; }
}
/* Active-sessions registry table */
.shell-sessions {
  margin-top: 22px;
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper);
  overflow: hidden;
}
.shell-sessions .panel-header { padding: 12px 16px; border-bottom: 1px solid var(--rule); }
.shell-sessions-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.shell-sessions-table th { text-align: left; padding: 8px 16px; font-weight: 600; color: var(--muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid var(--rule); }
.shell-sessions-table td { padding: 10px 16px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
.shell-sessions-table tr:last-child td { border-bottom: 0; }
.shell-sessions-table .badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; letter-spacing: 0.04em; font-family: 'JetBrains Mono', monospace; }
.shell-sessions-table .badge.live { background: rgba(45, 140, 79, 0.12); color: #2d8c4f; border: 1px solid rgba(45, 140, 79, 0.25); }
.shell-sessions-table .badge.idle { background: rgba(140, 140, 140, 0.08); color: var(--muted); border: 1px solid var(--rule); }
.shell-sessions-table .ghost { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.shell-sessions-actions { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-top: 1px solid var(--rule); background: rgba(0,0,0,0.02); font-size: 12px; }
.shell-sessions-actions label { color: var(--muted); display: flex; align-items: center; gap: 6px; }
.shell-sessions-actions .spacer { flex: 1; }

/* Totals strip above the sessions table */
.shell-sessions-totals {
  display: flex; gap: 24px; padding: 10px 16px;
  border-bottom: 1px solid var(--rule);
  background: rgba(240,198,116,0.04);
  font-size: 12px;
}
.shell-sessions-totals .totals-cell { display: flex; flex-direction: column; gap: 2px; }
.shell-sessions-totals .totals-label {
  font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted-2);
}
.shell-sessions-totals .totals-val {
  font-family: 'JetBrains Mono', monospace;
  color: var(--ink); font-weight: 600;
}

/* Secrets manager — grouped slots with paste-and-save UI */
.secrets-card { padding: 22px 26px; border: 1px solid var(--rule); border-radius: 8px; }
.secrets-group { margin-bottom: 26px; }
.secrets-group:last-child { margin-bottom: 0; }
.secrets-group-title {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 12px; padding-bottom: 6px;
  border-bottom: 1px solid var(--rule);
}
.secrets-grid { display: flex; flex-direction: column; gap: 14px; }
.secret-row { padding: 12px 14px; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); }
.secret-row.is-set { border-left: 3px solid #2d8c4f; }
.secret-name { font-size: 13px; color: var(--ink); margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.secret-name .secret-state {
  font-size: 10px; padding: 1px 6px; border-radius: 999px;
  background: rgba(140,140,140,0.08); color: var(--muted);
  border: 1px solid var(--rule);
}
.secret-row.is-set .secret-name .secret-state { background: rgba(45,140,79,0.12); color: #2d8c4f; border-color: rgba(45,140,79,0.25); }
.secret-hint { font-size: 12px; color: var(--muted); margin-bottom: 10px; line-height: 1.5; }
.secret-hint a { color: var(--accent); text-decoration: none; }
.secret-hint a:hover { text-decoration: underline; }
.secret-input-row { display: flex; gap: 8px; align-items: stretch; }
.secret-input { flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 6px 10px; border: 1px solid var(--rule); border-radius: 4px; background: var(--paper); color: var(--ink); }
.secret-input:focus { outline: none; border-color: var(--accent); }
.secret-save, .secret-delete { font-size: 12px; padding: 6px 12px; border-radius: 4px; }
.secret-delete { color: #c0392b; border-color: rgba(192,57,43,0.3); }

/* CLI device-code approve page */
.cli-auth-card { padding: 32px; border: 1px solid var(--rule); border-radius: 8px; max-width: 580px; margin: 0 auto; }
.cli-auth-loading { color: var(--muted); text-align: center; padding: 24px 0; }
.cli-auth-error { color: #c0392b; padding: 16px; border: 1px solid rgba(192,57,43,0.3); border-radius: 4px; background: rgba(192,57,43,0.06); }
.cli-auth-success { color: #2d8c4f; padding: 16px; border: 1px solid rgba(45,140,79,0.3); border-radius: 4px; background: rgba(45,140,79,0.06); }
.cli-auth-summary { display: flex; flex-direction: column; gap: 16px; }
.cli-auth-code {
  font-size: 32px; letter-spacing: 0.12em; font-weight: 600;
  text-align: center; padding: 18px;
  background: var(--paper); border: 2px dashed var(--accent);
  border-radius: 4px; color: var(--ink);
}
.cli-auth-meta { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.cli-auth-meta strong { color: var(--ink); margin-right: 8px; }
.cli-auth-warn { font-size: 13px; color: var(--muted); padding: 12px; background: rgba(240,198,116,0.08); border-left: 3px solid var(--accent); border-radius: 0 4px 4px 0; line-height: 1.5; }
.cli-auth-actions { display: flex; gap: 10px; align-items: center; }

/* Files tab */
.files-card {
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 10px;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.files-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--rule);
  background: rgba(255,255,255,0.02);
}
.files-toolbar .spacer { flex: 1; }
.files-toolbar .ghost { font-size: 12px; padding: 4px 10px; border-radius: 4px; }
.files-breadcrumb { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 2px; }
.files-breadcrumb a { color: var(--ink); text-decoration: none; padding: 2px 4px; border-radius: 3px; }
.files-breadcrumb a:hover { background: rgba(0,0,0,0.04); }
.files-dropzone {
  margin: 14px;
  border: 2px dashed var(--rule);
  border-radius: 8px;
  padding: 28px;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}
.files-dropzone.is-dragover { border-color: var(--accent); background: rgba(240,198,116,0.06); }
.files-dropzone-inner { display: flex; flex-direction: column; gap: 8px; align-items: center; color: var(--muted); }
.files-drop-icon { font-size: 28px; color: var(--accent); }
.files-drop-text { font-size: 13px; }
.files-pick-btn { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; }
.files-uploads { padding: 0 14px; display: flex; flex-direction: column; gap: 6px; }
.files-uploads:empty { display: none; }
.upload-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: rgba(0,0,0,0.02); border-radius: 4px; font-size: 12px; }
.upload-bar { flex: 1; height: 4px; background: var(--rule); border-radius: 2px; overflow: hidden; }
.upload-bar-fill { display: block; height: 100%; background: var(--accent); width: 0; transition: width 0.2s; }
.upload-status { font-size: 11px; color: var(--muted); min-width: 50px; text-align: right; }
.upload-status.ok { color: #2d8c4f; }
.upload-status.err { color: #c0392b; }
.files-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.files-table th { text-align: left; padding: 8px 14px; font-weight: 600; color: var(--muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid var(--rule); }
.files-table td { padding: 8px 14px; border-bottom: 1px solid var(--rule); }
.files-table tr:last-child td { border-bottom: 0; }
.files-table .ghost { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.files-table a { color: var(--ink); text-decoration: none; }
.files-table a:hover { text-decoration: underline; }
.files-table .folder-row { background: rgba(240,198,116,0.03); }
.files-foot { padding: 8px 14px; border-top: 1px solid var(--rule); background: rgba(255,255,255,0.02); }

/* "Ask Helm to set me up" card */
.ask-helm-card {
  padding: 22px 26px;
  background: linear-gradient(180deg, rgba(240,198,116,0.06), rgba(240,198,116,0.02));
  border: 1px solid var(--accent);
  border-radius: 8px;
}
.ask-helm-flex { display: flex; gap: 18px; align-items: flex-start; }
.ask-helm-icon {
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent); color: var(--paper);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
}
.ask-helm-body { flex: 1; }
.ask-helm-title { font-size: 18px; margin: 0 0 4px 0; font-weight: 600; color: var(--ink); }
.ask-helm-lede { font-size: 14px; color: var(--muted); margin: 0 0 14px 0; line-height: 1.55; max-width: 64ch; }
.ask-helm-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.ask-helm-hint { font-size: 11px; color: var(--muted-2); }

.conductor-meta { display: flex; align-items: center; gap: 12px; min-width: 0; }
.meta-session {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; letter-spacing: 0.06em;
  color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 200px;
}
@media (max-width: 600px) {
  .conductor-header { padding: 12px 14px; }
  .meta-session { display: none; }
}

.conductor-body {
  padding: 20px 24px;
  min-height: 280px;
  max-height: 60vh;
  overflow-y: auto;
  display: flex; flex-direction: column;
  gap: 22px;
}
@media (max-width: 600px) {
  .conductor-body {
    padding: 16px 14px;
    max-height: calc(100vh - 320px);
  }
}

/* ---------- Message bubbles ---------- */
.msg {
  padding: 0;
  border: none;
  display: flex; flex-direction: column;
  gap: 8px;
  max-width: 100%;
}
.msg .who {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted);
  display: flex; gap: 8px; align-items: center;
}
.msg .who .sigil {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  font-family: 'Fraunces', serif; font-size: 14px;
}
.msg.assistant .who { color: var(--accent); }
.msg.assistant .who .sigil { color: var(--accent); font-weight: 600; }

.msg .content {
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
  max-width: 70ch;
  word-wrap: break-word;
}
.msg .content p { margin: 0; }
.msg .content p + p { margin-top: 10px; }
.msg .content code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9em;
  background: rgba(18,17,16,0.06);
  padding: 1px 6px;
  border-radius: 3px;
}
.msg .content pre {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  background: rgba(18,17,16,0.04);
  border-left: 2px solid var(--accent);
  padding: 12px 16px;
  margin: 12px 0;
  overflow-x: auto;
  border-radius: 0 3px 3px 0;
}
@media (prefers-color-scheme: dark) {
  .msg .content code { background: rgba(239,234,219,0.08); }
  .msg .content pre { background: rgba(239,234,219,0.04); }
}
.msg.is-streaming .stream-cursor {
  display: inline-block;
  width: 2px; height: 1.05em;
  background: var(--accent);
  vertical-align: text-bottom;
  margin-left: 2px;
  animation: stream-blink 0.9s step-end infinite;
}
@keyframes stream-blink { 0%,55% { opacity: 1; } 56%,100% { opacity: 0; } }

.msg.is-halted .stream-cursor { animation: none; opacity: 0; }
.msg.is-halted .content::after {
  content: " · halted";
  color: var(--muted);
  font-style: italic;
  font-size: 13px;
}

/* ---------- Tool-call inline cards ---------- */
.tool-card {
  margin: 12px 0 0;
  padding: 10px 14px;
  background: rgba(18,17,16,0.03);
  border-left: 2px solid var(--muted-2);
  border-radius: 0 4px 4px 0;
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  transition: border-color 0.18s, background 0.18s;
}
.tool-card.is-running { border-left-color: var(--accent); }
.tool-card.is-done { border-left-color: #2d8c4f; }
.tool-card.is-failed {
  border-left-color: #8b1d1d;
  background: rgba(139,29,29,0.06);
}
.tool-card .tool-head { display: flex; align-items: center; gap: 8px; }
.tool-card .tool-arrow { color: var(--accent); }
.tool-card .tool-name { color: var(--accent); flex: 1; word-break: break-all; }
.tool-card .tool-status {
  font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.tool-card.is-running .tool-status { color: var(--accent); }
.tool-card.is-done .tool-status { color: #2d8c4f; }
.tool-card.is-failed .tool-status { color: #8b1d1d; }
.tool-card .tool-input,
.tool-card .tool-result {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(0,0,0,0.04);
  border-radius: 3px;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 12px;
  max-height: 180px;
  overflow-y: auto;
}
@media (prefers-color-scheme: dark) {
  .tool-card { background: rgba(255,255,255,0.03); }
  .tool-card .tool-input, .tool-card .tool-result { background: rgba(255,255,255,0.04); }
}

/* ---------- Composer ---------- */
.composer {
  border-top: 1px solid var(--rule);
  padding: 12px 16px 16px;
  display: flex; flex-direction: column;
  gap: 10px;
  background: var(--paper);
  position: sticky;
  bottom: 0;
  z-index: 1;
}
.composer-row {
  display: flex;
  gap: 10px;
  align-items: end;
}
.composer textarea {
  flex: 1;
  min-height: 44px;
  max-height: 240px;
  resize: none;
  font-family: 'Newsreader', serif;
  font-size: 17px;
  line-height: 1.45;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--rule);
  border-radius: 12px;
  outline: none;
  padding: 11px 14px;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.composer textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(226,88,34,0.18);
}
.composer-send {
  flex-shrink: 0;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--paper);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px;
  font-weight: 600;
  transition: background 0.12s, transform 0.08s;
}
.composer-send:hover:not(:disabled) { background: var(--accent-deep); }
.composer-send:active:not(:disabled) { transform: scale(0.95); }
.composer-send.is-stop {
  background: #8b1d1d;
}
.composer-send.is-stop:hover { background: #6b1414; }
.composer-send .ic-arrow {
  display: inline-flex; align-items: center; justify-content: center;
  line-height: 1;
}

.composer-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
}
.composer-hint {
  font-size: 10px; letter-spacing: 0.12em;
  color: var(--muted);
}
@media (max-width: 600px) {
  .composer { padding: 10px 12px 14px; }
  .composer-hint { display: none; }
  .composer textarea { font-size: 16px; }  /* prevents iOS zoom-on-focus */
}

/* ---------- Mode segmented control ---------- */
.mode-seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 3px;
  background: var(--paper);
}
.seg-btn {
  appearance: none;
  border: none;
  background: transparent;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  min-height: 28px;
}
.seg-btn[aria-selected="true"] {
  background: var(--accent);
  color: var(--paper);
}
.seg-btn:not([aria-selected="true"]):hover { color: var(--ink); }
.seg-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.trace {
  border-left: 2px solid var(--muted-2);
  padding: 6px 14px;
  margin: 10px 0;
  font-size: 13px;
}
.trace-step {
  padding: 8px 0;
  border-bottom: 1px dotted var(--muted-2);
}
.trace-step:last-child { border-bottom: none; }
.trace-step .tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.trace-step .tag .ok { color: var(--ok); }
.trace-step .tag .err { color: var(--red); }
.trace-step .payload {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--muted);
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin-top: 4px;
}
.halted-banner {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 2px solid var(--warn);
  background: rgba(136, 100, 20, 0.06);
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--warn);
}
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.provider-card {
  border: 1px solid var(--rule);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  background: var(--paper);
}
.provider-card::before {
  content: attr(data-ref);
  position: absolute;
  top: -9px; left: 14px;
  padding: 0 6px;
  background: var(--paper);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.provider-card .title {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 22px;
  font-variation-settings: 'opsz' 48, 'WONK' 1;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.provider-card .subtitle {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.4;
}
.provider-card .indicators {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 6px;
  border-top: 1px dotted var(--muted-2);
}
.provider-card .setup {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  white-space: pre-wrap;
}
.provider-card.active { border-color: var(--accent); }
.provider-card.active .title .pill { background: var(--accent); color: var(--paper); border-color: var(--accent); }
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px;
}
.catalog-grid .entry {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--muted);
  padding: 6px 10px;
  border-left: 2px solid var(--muted-2);
}
.catalog-grid .entry:hover { color: var(--accent); border-color: var(--accent); cursor: default; }

.readiness-bar-wrap {
  height: 10px;
  border: 1px solid var(--rule);
  background: rgba(0,0,0,0.03);
  position: relative;
  overflow: hidden;
  margin-bottom: 14px;
}
.readiness-bar {
  height: 100%;
  background: var(--accent);
  width: 0%;
  transition: width 0.6s ease-out;
}
.recommended {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: var(--muted);
}
.recommended .item {
  padding: 10px 14px;
  border-left: 2px solid var(--accent);
  background: rgba(226,88,34,0.04);
}

.capability-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.capability-card {
  border: 1px solid var(--rule);
  padding: 14px 16px;
  background: var(--paper);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.capability-card.configured { border-color: var(--ok); }
.capability-card.missing { border-color: var(--warn); }
.capability-card .c-title {
  font-family: 'Fraunces', serif;
  font-size: 18px;
  font-weight: 600;
  font-variation-settings: 'opsz' 48;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.capability-card .c-missing {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--warn);
}
.capability-card .c-hint {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.45;
}

.snippet-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 18px;
  border-bottom: 1px dotted var(--muted-2);
  padding-bottom: 14px;
}
.snippet-picker label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 4px 10px;
  border: 1px solid var(--rule);
  cursor: pointer;
  color: var(--muted);
  user-select: none;
}
.snippet-picker label:has(input:checked) { background: var(--accent); color: var(--paper); border-color: var(--accent); }
.snippet-picker input { position: absolute; opacity: 0; pointer-events: none; }
.snippet-out-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
@media (max-width: 900px) { .snippet-out-grid { grid-template-columns: 1fr; } }
.snippet-pre {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.45;
  background: rgba(0,0,0,0.03);
  padding: 12px;
  border-left: 2px solid var(--rule);
  white-space: pre-wrap;
  max-height: 280px;
  overflow-y: auto;
  color: var(--ink);
}
@media (prefers-color-scheme: dark) { .snippet-pre { background: rgba(255,255,255,0.03); } }

/* ---- Lock-it-down wizard ---- */
.lockdown-card {
  border: 1px solid var(--rule);
  background: linear-gradient(180deg, rgba(226, 88, 34, 0.04) 0%, transparent 60%);
  padding: 28px 32px 32px;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}
.lockdown-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 4px; height: 100%;
  background: var(--accent);
}
.lockdown-card .panel-header { margin-bottom: 8px; }
.lockdown-card .panel-header .h { color: var(--accent); }
.lockdown-card .meta.accent { color: var(--accent); font-weight: 500; }
.lockdown-card.is-strict::before { background: var(--ok, #2d5c3e); }
.lockdown-card.is-strict .panel-header .h { color: var(--ok, #2d5c3e); }

.lockdown-form { display: flex; flex-direction: column; gap: 18px; }
.lockdown-row { display: flex; flex-direction: column; gap: 6px; }
.lockdown-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}
.lockdown-input {
  width: 100%;
  padding: 11px 14px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  color: var(--ink);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.lockdown-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(226, 88, 34, 0.18);
}
.lockdown-input:disabled { opacity: 0.5; }
.lockdown-input.is-invalid { border-color: var(--red, #8b1d1d); }
.lockdown-hint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--muted);
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.lockdown-hint a { color: var(--accent); }

.lockdown-confirmrow {
  display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
  padding: 14px 16px; background: var(--paper);
  border: 1px dashed var(--muted-2); border-radius: 3px;
}
@media (max-width: 700px) { .lockdown-confirmrow { grid-template-columns: 1fr; } }
.lockdown-tinylabel { font-size: 10px; color: var(--muted); margin-bottom: 4px; }

.lockdown-scopes-details summary { cursor: pointer; font-size: 11px; color: var(--muted); padding: 4px 0; }
.lockdown-scopes-details summary:hover { color: var(--accent); }
.lockdown-scopes { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); list-style: none; padding: 8px 0 0; margin: 0; }
.lockdown-scopes li { padding: 2px 0; }
.lockdown-scopes li::before { content: '→ '; color: var(--accent); }

/* Scope-probe results — surfaced inline before submit so the user sees
   which scopes their token actually has. */
.lockdown-scope-probe {
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: var(--paper);
}
.lockdown-scope-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.lockdown-scope-title.ok { color: var(--ok, #2d5c3e); }
.lockdown-scope-title.fail { color: var(--accent); }
.lockdown-scope-list {
  list-style: none; padding: 0; margin: 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
}
.lockdown-scope-list li {
  display: flex; gap: 8px; align-items: baseline;
  padding: 2px 0;
}
.lockdown-scope-list li.ok { color: var(--ink); }
.lockdown-scope-list li.fail { color: var(--accent); }
.lockdown-scope-list .ic { display: inline-block; width: 14px; flex-shrink: 0; }
.lockdown-scope-list li.ok .ic { color: var(--ok, #2d5c3e); }
.lockdown-scope-list .lockdown-scope-err { color: var(--muted); font-size: 11px; margin-left: 8px; }
.lockdown-scope-hint {
  font-size: 12px; color: var(--muted);
  margin-top: 10px; line-height: 1.55;
}

/* "Token already configured" banner — replaces the token field when prefilled */
.lockdown-prefilled {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 14px 16px;
  background: rgba(45, 92, 62, 0.08);
  border: 1px solid var(--ok, #2d5c3e);
  border-radius: 3px;
}
.lockdown-prefilled-mark {
  width: 28px; height: 28px; flex-shrink: 0;
  border-radius: 50%;
  background: var(--ok, #2d5c3e); color: var(--paper);
  display: flex; align-items: center; justify-content: center;
  font-weight: bold; font-size: 14px;
}
.lockdown-prefilled-text { font-size: 14px; color: var(--ink); line-height: 1.5; }
.lockdown-prefilled-text strong { display: block; margin-bottom: 2px; }
.lockdown-prefilled-text span { color: var(--muted); font-size: 13px; }

/* One-click auto-setup card — same look as a prefilled banner but with
   a power-action vibe (electric ⚡, gold accent border on the button). */
.lockdown-autosetup { display: flex; flex-direction: column; gap: 14px; }
.lockdown-autosetup .lockdown-prefilled {
  background: rgba(240, 198, 116, 0.08);
  border-color: var(--accent);
}
.lockdown-autosetup .lockdown-prefilled-mark {
  background: var(--accent); color: var(--paper);
}
.lockdown-prefilled-text a { color: var(--accent); }

/* Numbered "how to create token" instructions panel */
.lockdown-instructions {
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  padding: 16px 20px;
}
.lockdown-instructions-header {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.lockdown-instructions-header .mono {
  font-size: 11px; letter-spacing: 0.14em; color: var(--muted);
  text-transform: uppercase;
}
.lockdown-copy-btn {
  background: transparent;
  border: 1px solid var(--muted-2);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 5px 10px;
  cursor: pointer;
  color: var(--muted);
  border-radius: 3px;
  transition: all 0.12s;
}
.lockdown-copy-btn:hover { border-color: var(--accent); color: var(--accent); }
.lockdown-copy-btn.is-copied { border-color: var(--ok, #2d5c3e); color: var(--ok, #2d5c3e); }
.lockdown-instructions-list {
  margin: 0; padding: 0 0 0 22px;
  font-size: 14px; color: var(--ink);
  line-height: 1.7;
}
.lockdown-instructions-list li { padding: 2px 0; }
.lockdown-instructions-list li .mono {
  background: rgba(0,0,0,0.05);
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 12.5px;
}
@media (prefers-color-scheme: dark) {
  .lockdown-instructions-list li .mono { background: rgba(255,255,255,0.06); }
}
.lockdown-instructions-list a { color: var(--accent); }
.lockdown-instructions-scopes {
  list-style: none; padding: 8px 0 4px; margin: 6px 0 0;
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  color: var(--muted);
}
.lockdown-instructions-scopes li {
  padding: 3px 0 3px 16px;
  position: relative;
}
.lockdown-instructions-scopes li::before {
  content: '→';
  position: absolute; left: 0;
  color: var(--accent);
}

.lockdown-actions { display: flex; gap: 12px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
.lockdown-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 22px;
  background: transparent;
  border: 1px solid var(--rule);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 3px;
  color: var(--ink);
  transition: all 0.12s;
}
.lockdown-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.lockdown-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.lockdown-btn-primary {
  background: var(--accent); color: var(--paper); border-color: var(--accent);
}
.lockdown-btn-primary:hover:not(:disabled) {
  background: var(--accent-deep, #b6590f);
  border-color: var(--accent-deep, #b6590f);
  color: var(--paper);
}
.lockdown-btn-arrow { transition: transform 0.12s; }
.lockdown-btn:hover .lockdown-btn-arrow { transform: translateX(2px); }
.lockdown-btn-dismiss { font-size: 11px; padding: 12px 14px; border: none; }

.lockdown-error {
  padding: 12px 14px;
  background: rgba(139, 29, 29, 0.08);
  border-left: 3px solid var(--red, #8b1d1d);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--red, #8b1d1d);
  border-radius: 2px;
}

/* progress steps */
.lockdown-progress { padding: 8px 0; }
.lockdown-steps {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 10px;
}
.lockdown-steps li {
  display: flex; align-items: center; gap: 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--muted);
  padding: 8px 12px;
  border-left: 2px solid var(--muted-2);
  transition: all 0.18s;
}
.lockdown-steps li.is-running {
  color: var(--accent);
  border-left-color: var(--accent);
}
.lockdown-steps li.is-done {
  color: var(--ok, #2d5c3e);
  border-left-color: var(--ok, #2d5c3e);
}
.lockdown-steps li.is-failed {
  color: var(--red, #8b1d1d);
  border-left-color: var(--red, #8b1d1d);
}
.ld-bullet {
  display: inline-block;
  width: 16px; height: 16px; border-radius: 50%;
  border: 1.5px solid currentColor;
  flex-shrink: 0;
  position: relative;
}
.is-running .ld-bullet {
  border-color: var(--accent);
  animation: ld-pulse 1.0s ease-in-out infinite;
}
.is-done .ld-bullet {
  background: var(--ok, #2d5c3e);
  border-color: var(--ok, #2d5c3e);
}
.is-done .ld-bullet::after {
  content: '✓';
  color: var(--paper);
  position: absolute;
  inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: bold;
}
.is-failed .ld-bullet {
  background: var(--red, #8b1d1d);
  border-color: var(--red, #8b1d1d);
}
.is-failed .ld-bullet::after {
  content: '!';
  color: var(--paper);
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: bold;
}
@keyframes ld-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.85); opacity: 0.6; }
}

/* success */
.lockdown-success { text-align: center; padding: 24px 16px 16px; }
.lockdown-success-mark {
  width: 64px; height: 64px; line-height: 64px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: var(--ok, #2d5c3e);
  color: var(--paper);
  font-size: 32px;
  animation: ld-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.lockdown-success-title {
  font-family: 'Fraunces', serif;
  font-size: 32px;
  margin: 0 0 8px;
  color: var(--ok, #2d5c3e);
}
.lockdown-success-body {
  color: var(--muted);
  max-width: 52ch;
  margin: 0 auto 20px;
  font-size: 15px;
}
.lockdown-success-actions { margin-bottom: 18px; display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.lockdown-cleanup { font-size: 13px; color: var(--muted); margin-top: 18px; max-width: 56ch; margin-left: auto; margin-right: auto; text-align: left; }
.lockdown-cleanup summary { cursor: pointer; padding: 6px 0; }
.lockdown-cleanup ul { list-style: none; padding-left: 0; margin-top: 8px; }
.lockdown-cleanup li { padding: 4px 0; padding-left: 18px; position: relative; }
.lockdown-cleanup li::before { content: '◇'; position: absolute; left: 0; color: var(--muted-2); }
@keyframes ld-pop {
  0% { transform: scale(0); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

/* failure */
.lockdown-failure { text-align: center; padding: 24px 16px 16px; }
.lockdown-failure-mark {
  width: 56px; height: 56px; line-height: 56px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--paper);
  font-size: 28px;
  animation: ld-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.lockdown-failure-title {
  font-family: 'Fraunces', serif;
  font-size: 28px;
  margin: 0 0 8px;
  color: var(--accent);
}
.lockdown-failure-body {
  color: var(--ink);
  max-width: 56ch;
  margin: 0 auto 16px;
  font-size: 15px;
}
.lockdown-failure-recovery {
  text-align: left;
  font-size: 13px;
  color: var(--muted);
  margin-top: 8px;
}

/* strict-mode collapsed view (when auth is already configured) */
.lockdown-strict-summary {
  padding: 14px 18px;
  border: 1px solid var(--ok, #2d5c3e);
  border-radius: 3px;
  display: flex; align-items: center; gap: 14px;
  background: rgba(45, 92, 62, 0.05);
}
.lockdown-strict-mark {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--ok, #2d5c3e); color: var(--paper);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: bold;
  flex-shrink: 0;
}
.lockdown-strict-text { font-size: 14px; color: var(--ink); }
.lockdown-strict-text .mono { color: var(--muted); font-size: 12px; display: block; margin-top: 2px; }

.stream-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.stream-controls button {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 4px 10px;
  cursor: pointer;
  background: transparent;
  color: var(--red);
  border: 1px solid var(--red);
}
.stream-controls button:hover { background: var(--red); color: var(--paper); }
.stream-controls .stream-id { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); }

/* -------- tables -------- */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}
thead th {
  text-align: left;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 8px 10px 8px 0;
  border-bottom: 2px solid var(--rule);
  vertical-align: bottom;
}
tbody td { padding: 10px 10px 10px 0; border-bottom: 1px solid var(--muted-2); vertical-align: top; }
tbody tr:hover td { background: rgba(226, 88, 34, 0.04); }
tbody td.mono { font-size: 13px; }
.pill {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid currentColor;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border-radius: 999px;
}
.pill.ok { color: var(--ok); }
.pill.warn { color: var(--warn); }
.pill.muted { color: var(--muted); }
.pill.accent { color: var(--accent); }

/* -------- side column -------- */
.side-head { font-family: 'Fraunces', serif; font-weight: 600; font-size: 24px; font-variation-settings: 'opsz' 48; margin-bottom: 14px; border-bottom: 1px solid var(--rule); padding-bottom: 10px; }
.side-list { list-style: none; }
.side-list li { padding: 10px 0; border-bottom: 1px dotted var(--muted-2); font-size: 15px; }
.side-list li:last-child { border-bottom: none; }
.side-list li .head { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; margin-bottom: 2px; }
.side-list li .body a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
.side-list li .body a:hover { color: var(--accent); border-bottom-color: var(--accent); }

/* -------- panels -------- */
.panel + .panel { margin-top: 48px; }
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 10px;
  margin-bottom: 18px;
  gap: 16px;
}
.panel-header .h {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 28px;
  font-variation-settings: 'opsz' 72, 'WONK' 1;
}
.panel-header .meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; }

/* -------- run output -------- */
.run-output {
  margin-top: 10px;
  border-left: 2px solid var(--ok);
  padding: 10px 14px;
  background: rgba(45, 92, 62, 0.05);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
}
.run-output.err { border-color: var(--red); background: rgba(139, 29, 29, 0.05); }

/* -------- footer -------- */
footer {
  border-top: 3px double var(--rule);
  margin-top: 64px;
  padding: 30px 28px 60px;
  font-size: 13px;
  color: var(--muted);
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.05em;
}
footer .container { max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 20px; }
footer a { color: inherit; border-bottom: 1px dotted var(--muted); text-decoration: none; }
footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }

/* -------- misc -------- */
.hidden { display: none !important; }
.ascii-rule { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted); letter-spacing: 0.2em; text-align: center; margin: 20px 0; user-select: none; }

button.ghost {
  background: transparent;
  border: 1px solid var(--rule);
  color: var(--ink);
  padding: 6px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
}
button.ghost:hover { border-color: var(--accent); color: var(--accent); }

.load-dot::after {
  content: "";
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  margin-left: 6px;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

.reveal { opacity: 0; transform: translateY(8px); animation: reveal 0.6s ease-out forwards; }
.reveal.d1 { animation-delay: 0.1s; }
.reveal.d2 { animation-delay: 0.2s; }
.reveal.d3 { animation-delay: 0.3s; }
.reveal.d4 { animation-delay: 0.4s; }
@keyframes reveal { to { opacity: 1; transform: translateY(0); } }

input[type="text"], select, textarea {
  font-family: inherit;
  font-size: 15px;
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  padding: 6px 0;
  outline: none;
}
input[type="text"]:focus, select:focus, textarea:focus { border-bottom-color: var(--accent); }
</style>
</head>
<body>
<header class="masthead">
  <div class="container">
    <div class="masthead-top">
      <span>VOL. 0.2 <span class="dot">·</span> ISSUE IV <span class="dot">·</span> AGENT EDITION</span>
      <span id="edition-date"></span>
      <span>PAGE §00.0</span>
    </div>
    <div class="wordmark display">
      <svg class="compass" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" stroke-width="1"/>
        <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" stroke-width="0.5"/>
        <g stroke="currentColor" stroke-width="1" fill="none">
          <line x1="60" y1="2" x2="60" y2="118"/>
          <line x1="2" y1="60" x2="118" y2="60"/>
          <line x1="19" y1="19" x2="101" y2="101"/>
          <line x1="19" y1="101" x2="101" y2="19"/>
        </g>
        <polygon points="60,10 66,60 60,54 54,60" fill="var(--accent)" stroke="var(--accent)"/>
        <polygon points="60,110 66,60 60,66 54,60" fill="currentColor"/>
        <circle cx="60" cy="60" r="3" fill="currentColor"/>
        <text x="60" y="7" text-anchor="middle" font-family="JetBrains Mono" font-size="6" fill="var(--accent)" font-weight="bold">N</text>
        <text x="60" y="119" text-anchor="middle" font-family="JetBrains Mono" font-size="6" fill="currentColor">S</text>
        <text x="6" y="62" font-family="JetBrains Mono" font-size="6" fill="currentColor">W</text>
        <text x="114" y="62" text-anchor="end" font-family="JetBrains Mono" font-size="6" fill="currentColor">E</text>
      </svg>
      <span>Open&nbsp;Think</span>
    </div>
    <div class="tagline">
      <span>A Cloudflare-native agent runtime, laid out in the tradition of Project Think — plugins for tools, Durable Objects for memory, MCP for reach.</span>
      <span class="edition" id="worker-origin">DEV · localhost</span>
    </div>
  </div>
</header>

<nav class="tabs" aria-label="sections">
  <div class="container">
    <a href="#/" data-route="/">Overview</a>
    <a href="#/conductor" data-route="/conductor">Helm</a>
    <a href="#/shell" data-route="/shell">Shell</a>
    <a href="#/files" data-route="/files">Files</a>
    <a href="#/plugins" data-route="/plugins">Plugins</a>
    <a href="#/skills" data-route="/skills">Skills</a>
    <a href="#/sessions" data-route="/sessions">Sessions</a>
    <a href="#/providers" data-route="/providers">Providers</a>
    <a href="#/settings" data-route="/settings">Settings</a>
    <a href="#/debug" data-route="/debug">Debug</a>
    <span class="spacer"></span>
    <span class="kbd-hint mono">⌘K / g p / g c</span>
  </div>
</nav>

<main id="view"></main>

<footer>
  <div class="container">
    <span>§99.9 · Open Think <span id="footer-version">v0.2.0</span> · Cloudflare-native, Project-Think inspired</span>
    <span>
      <a href="/openapi.json">openapi</a> ·
      <a href="/playground">playground</a> ·
      <a href="https://blog.cloudflare.com/project-think/">project think</a> ·
      <a href="https://developers.cloudflare.com/agents/">agents sdk</a>
    </span>
  </div>
</footer>

<template id="tpl-overview">
  <section class="reveal d1">
    <div id="first-run-banner" class="first-run-banner" hidden>
      <div class="frb-head">First run · auth not configured</div>
      <p class="frb-body">
        Helm is running with permissive auth — anyone who finds this URL can talk to it.
        Configure Cloudflare Access before sharing this Worker.
        <a href="#/settings" class="frb-link">Finish setup →</a>
      </p>
      <button id="first-run-dismiss" class="frb-dismiss" aria-label="Dismiss">×</button>
    </div>
    <div class="section-ref">§01.0 · Overview</div>
    <h1 class="section-title">The harbor pilot for your Cloudflare account.</h1>
    <p class="lede">Wire up a Worker, talk to Helm, ship an agent. The runtime is plugin-first — bring Workers&nbsp;AI, Anthropic, any OpenAI-compatible endpoint, or your own MCP servers — without rewriting your base class.</p>
  </section>

  <section class="stats reveal d2">
    <div class="stat"><div class="label">Plugins</div><div class="value" data-stat="plugins">—</div><div class="footnote">loaded / registered</div></div>
    <div class="stat"><div class="label">Skills</div><div class="value" data-stat="skills">—</div><div class="footnote">listed in catalog</div></div>
    <div class="stat accent"><div class="label">Sessions DO</div><div class="value" data-stat="do">—</div><div class="footnote">sqlite-backed</div></div>
    <div class="stat"><div class="label">Workers AI</div><div class="value" data-stat="ai">—</div><div class="footnote">binding present</div></div>
  </section>

  <div class="overview-grid reveal d3">
    <div>
      <div class="hero-block">
        <div class="section-ref">§01.1 · Helm preview</div>
        <p>Ask in prose; Helm plans in skills. Proposals are rendered as approve-to-run exhibits — nothing executes without your tap.</p>
      </div>
      <div id="overview-conductor" class="conductor" data-preview="true"></div>
    </div>
    <aside class="column-rule">
      <div class="side-head display">Compass bearings</div>
      <ul class="side-list">
        <li>
          <div class="head">§02 · Plugins</div>
          <div class="body">9 first-party plugins covering models, tools, MCP, browser, sandbox, artifacts. <a href="#/plugins">Inspect the catalog.</a></div>
        </li>
        <li>
          <div class="head">§03 · Skills</div>
          <div class="body">16 opinionated skill entries map to plugin actions with tagged metadata. <a href="#/skills">Browse or run.</a></div>
        </li>
        <li>
          <div class="head">§04 · Sessions</div>
          <div class="body">Each session is a Durable Object with SQLite, FTS5 search, and idempotent fibers. <a href="#/sessions">Open the browser.</a></div>
        </li>
        <li>
          <div class="head">§05 · Deploy</div>
          <div class="body">One-click via the Cloudflare deploy button; or <span class="mono">npm run cf:bootstrap</span> for guided setup.</div>
        </li>
      </ul>
    </aside>
  </div>
</template>

<template id="tpl-conductor">
  <section class="reveal d1">
    <div class="section-ref">§10.0 · Helm</div>
    <h1 class="section-title">Speak in intent. Ship in skills.</h1>
    <p class="lede">Helm is a meta-agent that proposes skill invocations against your runtime. It reads your plugin catalog, plans a move, and hands you a signed exhibit to approve.</p>
  </section>
  <div class="ascii-rule">· · · ────────  ✦  ──────── · · ·</div>
  <section class="reveal d2">
    <div id="conductor-full" class="conductor"></div>
  </section>
</template>

<template id="tpl-files">
  <section class="reveal d1">
    <div class="section-ref">§12.0 · Files</div>
    <h1 class="section-title">Drop a file. Ask the agent about it.</h1>
    <p class="lede">Per-user durable storage in R2 (via the <span class="mono">/persist</span> proxy — no R2 keys needed). Drop a CSV, ask Helm to analyze it. Save outputs from a shell session, download later. Files survive container sleeps; <span class="mono">helm-fetch &lt;key&gt;</span> inside the shell pulls them into /workspace.</p>
  </section>
  <section class="reveal d2">
    <div class="files-card">
      <div class="files-toolbar">
        <div class="files-breadcrumb mono" id="files-breadcrumb">files/</div>
        <span class="spacer"></span>
        <button class="ghost" id="files-mkdir" type="button">+ folder</button>
        <button class="ghost" id="files-refresh" type="button">Refresh</button>
      </div>
      <div id="files-dropzone" class="files-dropzone">
        <div class="files-dropzone-inner">
          <span class="files-drop-icon">⬆</span>
          <span class="files-drop-text">Drop files here, or <button id="files-pick" class="files-pick-btn" type="button">browse</button></span>
          <input type="file" id="files-input" multiple style="display: none;">
        </div>
      </div>
      <div id="files-uploads" class="files-uploads"></div>
      <table class="files-table">
        <thead>
          <tr>
            <th style="width: 4%"></th>
            <th>name</th>
            <th style="width: 14%">size</th>
            <th style="width: 22%">modified</th>
            <th style="width: 26%"></th>
          </tr>
        </thead>
        <tbody id="files-body"><tr><td colspan="5" class="mono">loading<span class="load-dot"></span></td></tr></tbody>
      </table>
      <div class="files-foot">
        <span class="mono shell-hint">Backed by R2 (env.WORKSPACE). Per-user prefix: <span id="files-prefix-display">files/</span>. Files are durable; ephemeral disk in /workspace inside the shell isn't.</span>
      </div>
    </div>
  </section>
</template>

<template id="tpl-cli-auth">
  <section class="reveal d1">
    <div class="section-ref">§13.0 · CLI auth</div>
    <h1 class="section-title">Approve a device.</h1>
    <p class="lede">Your CLI started a login flow. Verify the code matches what your terminal shows, then approve.</p>
  </section>
  <section class="reveal d2">
    <div class="cli-auth-card">
      <div id="cli-auth-content">
        <div class="cli-auth-loading mono">looking up device code<span class="load-dot"></span></div>
      </div>
    </div>
  </section>
</template>

<template id="tpl-shell">
  <section class="reveal d1">
    <div class="section-ref">§11.0 · Shell</div>
    <h1 class="section-title">A real Linux shell, one tab away.</h1>
    <p class="lede">Cloudflare-Container-hosted bash, fronted by a Node WebSocket↔PTY bridge. Per-session container, ephemeral disk (15-min idle sleep). Works from this browser tab and from terminal via <span class="mono">scripts/open-think-shell.mjs</span>.</p>
  </section>
  <section class="reveal d2">
    <div class="shell-card">
      <div class="shell-bar">
        <span class="conn-dot" id="shell-dot" data-state="idle" aria-label="connection state"></span>
        <span class="shell-title">helm:<span id="shell-session">default</span></span>
        <span class="spacer"></span>
        <button class="ghost" id="shell-reconnect" type="button">Reconnect</button>
        <button class="ghost" id="shell-clear" type="button">Clear</button>
        <button class="ghost" id="shell-sessions-toggle" type="button">Sessions</button>
      </div>
      <div id="shell-mount" class="shell-mount" tabindex="0" aria-label="terminal"></div>
      <div class="shell-foot">
        <span class="mono shell-hint">Tip: ⌘K clears, ⌘⇧V pastes, Ctrl-C kills the foreground process. Container sleeps after 15 min idle.</span>
      </div>
    </div>
    <div id="shell-sessions" class="shell-sessions" hidden>
      <div class="panel-header">
        <span class="h display">Active sessions</span>
        <span class="meta" id="shell-sessions-count">—</span>
      </div>
      <div id="shell-sessions-totals" class="shell-sessions-totals" hidden></div>
      <table class="shell-sessions-table">
        <thead>
          <tr>
            <th style="width: 22%">session</th>
            <th style="width: 18%">user</th>
            <th style="width: 10%">live</th>
            <th style="width: 14%">awake</th>
            <th style="width: 10%">est. cost</th>
            <th style="width: 14%">last seen</th>
            <th style="width: 12%"></th>
          </tr>
        </thead>
        <tbody id="shell-sessions-body"><tr><td colspan="7" class="mono">loading<span class="load-dot"></span></td></tr></tbody>
      </table>
      <div class="shell-sessions-actions">
        <label class="mono"><input type="checkbox" id="shell-sessions-all"> Show everyone's sessions</label>
        <button class="ghost" id="shell-sessions-refresh" type="button">Refresh</button>
      </div>
    </div>
  </section>
</template>

<template id="tpl-plugins">
  <section class="reveal d1">
    <div class="section-ref">§02.0 · Plugin catalog</div>
    <h1 class="section-title">A small bus. Many kinds of tools.</h1>
    <p class="lede">Every row is a typed contract: id, capabilities, required secrets. Plugins that need unbound resources refuse to initialize.</p>
  </section>
  <section class="reveal d2">
    <div class="panel-header"><span class="h display">Loaded plugins</span><span class="meta" id="plugins-count">—</span></div>
    <table>
      <thead>
        <tr><th style="width: 22%">id</th><th style="width: 10%">ver</th><th>description</th><th style="width: 26%">capabilities</th></tr>
      </thead>
      <tbody id="plugins-body"><tr><td colspan="4" class="mono">loading<span class="load-dot"></span></td></tr></tbody>
    </table>
  </section>
</template>

<template id="tpl-skills">
  <section class="reveal d1">
    <div class="section-ref">§03.0 · Skill catalog</div>
    <h1 class="section-title">Named moves. Instant replay.</h1>
    <p class="lede">Skills are opinionated defaults over plugin actions. Pick one, give it JSON input, and run it — or paste the id into a Helm reply to queue a proposal.</p>
  </section>
  <section class="reveal d2">
    <div class="panel-header"><span class="h display">All skills</span><span class="meta" id="skills-count">—</span></div>
    <table>
      <thead>
        <tr><th style="width: 22%">id</th><th>description</th><th style="width: 10%">plugin</th><th style="width: 16%">tags</th><th style="width: 8%">run</th></tr>
      </thead>
      <tbody id="skills-body"><tr><td colspan="5" class="mono">loading<span class="load-dot"></span></td></tr></tbody>
    </table>
    <div id="skill-runner-slot"></div>
  </section>
</template>

<template id="tpl-sessions">
  <section class="reveal d1">
    <div class="section-ref">§04.0 · Sessions</div>
    <h1 class="section-title">One Durable Object per agent. One SQLite each.</h1>
    <p class="lede">Point at a session by name and inspect its message tree, fiber ledger, or FTS search. Sessions are created on first write.</p>
  </section>
  <section class="reveal d2">
    <div class="panel-header"><span class="h display">Session inspector</span><span class="meta">by name</span></div>
    <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 20px;">
      <input type="text" id="session-name" placeholder="session name (e.g. conductor:default)" style="flex: 1; max-width: 380px;">
      <button class="ghost" id="session-describe">Describe</button>
      <button class="ghost" id="session-tree">Tree</button>
      <button class="ghost" id="session-fibers">Fibers</button>
    </div>
    <pre class="run-output" id="session-output" style="display: none;"></pre>
  </section>
</template>

<template id="tpl-providers">
  <section class="reveal d1">
    <div class="section-ref">§07.0 · Providers</div>
    <h1 class="section-title">Pick one of five paths to your model.</h1>
    <p class="lede">BYOK through Cloudflare AI Gateway covers 23 providers with one config. Direct paths (Anthropic, OpenAI-compatible, Workers AI) skip the gateway. For ChatGPT Plus/Pro, paste your Codex tokens after <code class="mono">codex login</code>.</p>
  </section>
  <section class="reveal d2">
    <div class="panel-header"><span class="h display">Provider status</span><button class="ghost" id="providers-refresh">Refresh</button></div>
    <div id="providers-body" class="provider-grid"><div class="mono">loading<span class="load-dot"></span></div></div>
  </section>
  <section class="reveal d3" style="margin-top: 48px;">
    <div class="panel-header"><span class="h display">Cloudflare AI Gateway catalog</span></div>
    <p style="font-size: 16px; color: var(--muted); margin-bottom: 14px;">Models that ship through the gateway. Use the <span class="mono">provider/model-name</span> syntax when calling the <span class="mono">cf-gateway-chat</span> skill.</p>
    <div id="providers-catalog" class="catalog-grid"></div>
  </section>
</template>

<template id="tpl-settings">
  <section class="reveal d1">
    <div class="section-ref">§08.0 · Settings</div>
    <h1 class="section-title">One panel to configure the whole runtime.</h1>
    <p class="lede">Probe every capability, generate wrangler.toml + .dev.vars snippets on demand, or hand the job to Helm — it will use the Cloudflare MCP to provision infrastructure while you approve each move.</p>
  </section>

  <!-- One-click "ask Helm to set me up" — primes a conductor session
       with a curated cf-admin prompt and jumps to /app#/conductor with
       it preselected. Different from the free-form "Guided setup" panel
       further down: this is the no-decisions path. -->
  <section class="reveal d2 ask-helm-card" style="margin-top: 28px;">
    <div class="ask-helm-flex">
      <div class="ask-helm-icon">⚡</div>
      <div class="ask-helm-body">
        <h2 class="ask-helm-title">Ask Helm to set me up</h2>
        <p class="ask-helm-lede">
          Helm reads your current capability matrix, then proposes the smallest set of
          <span class="mono">cf-admin</span> skill calls to reach a fully-configured state —
          D1 + R2 + Access + secrets + bindings. Each skill is a card you approve before it runs.
          Takes ~30 seconds.
        </p>
        <div class="ask-helm-actions">
          <button id="ask-helm-go" class="lockdown-btn lockdown-btn-primary">
            <span class="lockdown-btn-text">Set me up</span>
            <span class="lockdown-btn-arrow">⚡</span>
          </button>
          <span class="mono ask-helm-hint">requires CLOUDFLARE_API_TOKEN already set</span>
        </div>
        <div id="ask-helm-result" class="mono" style="margin-top: 10px; font-size: 12px; color: var(--muted);"></div>
      </div>
    </div>
  </section>

  <section class="reveal d2">
    <div class="panel-header">
      <span class="h display">Runtime readiness</span>
      <span class="meta" id="readiness-score">—</span>
    </div>
    <div class="readiness-bar-wrap"><div class="readiness-bar" id="readiness-bar"></div></div>
    <div id="recommended" class="recommended"></div>
  </section>

  <!-- Lock-it-down wizard. Only visible when auth.configured === false; the
       JS in renderSettings() flips its display: none on load based on
       /setup/access/discover. -->
  <section class="reveal d3 lockdown-card" id="lockdown-card" style="display: none; margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">⚠ Auth · first-run permissive</span>
      <span class="meta accent" id="lockdown-status">unlocked</span>
    </div>
    <p style="font-size: 16px; color: var(--ink); margin-bottom: 18px; max-width: 64ch;">
      Anyone with this URL can talk to your agent right now. Lock it down with
      Cloudflare Access in 30 seconds — paste a scoped token, pick an email,
      hit the button. We create the Access app, attach an email-only policy,
      and persist the resulting <span class="mono">CF_ACCESS_TEAM_DOMAIN</span> +
      <span class="mono">CF_ACCESS_AUD</span> as Worker secrets so the runtime
      flips into strict mode automatically.
    </p>

    <!-- Step 1: form. Three live states based on what's pre-configured:
         (a) BOTH token + email pre-set  → one-click banner, no fields
         (b) Token pre-set, no email      → just the email field
         (c) Neither pre-set              → full form (default visible) -->
    <div id="lockdown-form" class="lockdown-form">

      <!-- Prefilled-token badge: replaces the token field when present -->
      <div id="ld-token-prefilled" class="lockdown-prefilled" hidden>
        <div class="lockdown-prefilled-mark">✓</div>
        <div class="lockdown-prefilled-text">
          <strong>Token already configured</strong>
          <span>Reusing <span class="mono">env.CLOUDFLARE_API_TOKEN</span> set at deploy time. <a href="#" id="ld-use-different">Paste a different one instead ↻</a></span>
        </div>
      </div>

      <div class="lockdown-row" id="ld-token-row">
        <label for="ld-token" class="lockdown-label">Cloudflare API token</label>
        <input id="ld-token" type="password" class="lockdown-input" placeholder="paste — abcdef…" autocomplete="off" spellcheck="false" />
        <div class="lockdown-hint">
          <a href="#" id="ld-token-link" target="_blank" rel="noopener">Create scoped token ↗</a>
          <span style="color: var(--muted-2);">·</span>
          <span class="mono">used once · never stored · revoke after</span>
        </div>
      </div>

      <!-- Inline numbered steps so users don't have to hunt the CF dash -->
      <div class="lockdown-instructions" id="ld-instructions">
        <div class="lockdown-instructions-header">
          <span class="mono">How to create the token (3 minutes)</span>
          <button type="button" id="ld-copy-scopes" class="lockdown-copy-btn">Copy scope names</button>
        </div>
        <ol class="lockdown-instructions-list">
          <li>Click <a href="#" id="ld-step-link" target="_blank" rel="noopener">Create scoped token ↗</a> — opens dash → API Tokens.</li>
          <li>Click <span class="mono">Create Token</span> → <span class="mono">Get started</span> (Custom token).</li>
          <li>Under <span class="mono">Permissions</span>, add these <strong>4</strong> rows (paste the names from the copy button above):
            <ul class="lockdown-instructions-scopes" id="ld-scopes"></ul>
          </li>
          <li>Set <span class="mono">Account Resources</span> → <span class="mono">Include</span> → <span class="mono">All accounts</span>.</li>
          <li>Click <span class="mono">Continue to summary</span> → <span class="mono">Create Token</span> → <span class="mono">Copy</span>.</li>
          <li>Paste it in the field above.</li>
        </ol>
      </div>

      <div class="lockdown-row">
        <label for="ld-email" class="lockdown-label">Email allowed in</label>
        <input id="ld-email" type="email" class="lockdown-input" placeholder="you@example.com" autocomplete="email" />
        <div class="lockdown-hint" id="ld-email-hint">Comma-separate to allow multiple addresses.</div>
      </div>

      <!-- Account picker (hidden unless multi-account) -->
      <div class="lockdown-row" id="ld-account-row" style="display: none;">
        <label for="ld-account" class="lockdown-label">Cloudflare account</label>
        <select id="ld-account" class="lockdown-input"></select>
      </div>

      <!-- Read-only confirmations -->
      <div class="lockdown-confirmrow">
        <div>
          <div class="mono small-caps lockdown-tinylabel">Will gate</div>
          <div class="mono" id="ld-host-display">—</div>
        </div>
        <div>
          <div class="mono small-caps lockdown-tinylabel">Worker name</div>
          <div class="mono" id="ld-script-display">—</div>
        </div>
      </div>

      <div class="lockdown-actions">
        <button id="ld-submit" class="lockdown-btn lockdown-btn-primary" disabled>
          <span class="lockdown-btn-text">Lock it down</span>
          <span class="lockdown-btn-arrow">→</span>
        </button>
        <button id="ld-dismiss" class="ghost lockdown-btn-dismiss" type="button">Skip for now</button>
      </div>
      <div id="ld-error" class="lockdown-error" hidden></div>
    </div>

    <!-- One-click banner: shown ONLY when both CLOUDFLARE_API_TOKEN
         and AGENT_OWNER_EMAIL/OWNER_EMAIL are pre-set on the Worker.
         Posts to /setup/auto and rides the same progress UI. -->
    <div id="lockdown-autosetup" class="lockdown-autosetup" hidden>
      <div class="lockdown-prefilled">
        <div class="lockdown-prefilled-mark">⚡</div>
        <div class="lockdown-prefilled-text">
          <strong>One-click ready</strong>
          <span>
            Token + owner email already configured on this Worker. Click below
            to verify the token, pick the account, create the Access app + policy,
            and persist <span class="mono">CF_ACCESS_TEAM_DOMAIN</span> +
            <span class="mono">CF_ACCESS_AUD</span> — no fields to fill.
          </span>
        </div>
      </div>
      <div class="lockdown-actions">
        <button id="ld-auto" class="lockdown-btn lockdown-btn-primary">
          <span class="lockdown-btn-text">Auto-setup with CF API</span>
          <span class="lockdown-btn-arrow">⚡</span>
        </button>
        <button id="ld-auto-fallback" class="ghost lockdown-btn-dismiss" type="button">
          Use the form instead
        </button>
      </div>
    </div>

    <!-- Step 2: progress -->
    <div id="lockdown-progress" class="lockdown-progress" hidden>
      <ol class="lockdown-steps" id="ld-steps">
        <li data-step="preflight"><span class="ld-bullet"></span><span class="ld-label">Verifying token</span></li>
        <li data-step="team-domain"><span class="ld-bullet"></span><span class="ld-label">Looking up team domain</span></li>
        <li data-step="create-app"><span class="ld-bullet"></span><span class="ld-label">Creating Access app</span></li>
        <li data-step="create-policy"><span class="ld-bullet"></span><span class="ld-label">Adding email policy</span></li>
        <li data-step="set-secret-team-domain"><span class="ld-bullet"></span><span class="ld-label">Persisting CF_ACCESS_TEAM_DOMAIN</span></li>
        <li data-step="set-secret-aud"><span class="ld-bullet"></span><span class="ld-label">Persisting CF_ACCESS_AUD</span></li>
        <li data-step="set-secret-allowed-emails"><span class="ld-bullet"></span><span class="ld-label">Persisting CF_ACCESS_ALLOWED_EMAILS</span></li>
        <li data-step="verify-strict"><span class="ld-bullet"></span><span class="ld-label">Waiting for redeploy + strict mode</span></li>
      </ol>
    </div>

    <!-- Step 3: success -->
    <div id="lockdown-success" class="lockdown-success" hidden>
      <div class="lockdown-success-mark">✓</div>
      <h2 class="lockdown-success-title">Locked down.</h2>
      <p class="lockdown-success-body">
        Auth is now strict. Refresh and Cloudflare Access will ask for your
        email — click the link in the verification email and you're back in.
      </p>
      <div class="lockdown-success-actions">
        <button id="ld-refresh" class="lockdown-btn lockdown-btn-primary">Refresh now →</button>
      </div>
      <details class="lockdown-cleanup">
        <summary class="mono">Cleanup (optional)</summary>
        <ul>
          <li>Revoke the API token at <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">dash → API Tokens</a> — its job is done.</li>
          <li>Edit allow-list later at <a id="ld-app-link" href="https://dash.cloudflare.com/?to=/:account/access/apps" target="_blank" rel="noopener">dash → Zero Trust → Access → Apps</a>.</li>
        </ul>
      </details>
    </div>

    <!-- Step 4: failure with recovery copy -->
    <div id="lockdown-failure" class="lockdown-failure" hidden>
      <div class="lockdown-failure-mark">⚠</div>
      <h2 class="lockdown-failure-title">Stopped before finishing.</h2>
      <p class="lockdown-failure-body" id="ld-failure-reason">—</p>
      <details class="lockdown-cleanup" open>
        <summary class="mono">Recovery</summary>
        <p id="ld-failure-recovery" class="lockdown-failure-recovery">—</p>
      </details>
      <div class="lockdown-success-actions">
        <button id="ld-retry" class="lockdown-btn lockdown-btn-primary">Try again</button>
      </div>
    </div>
  </section>

  <section class="reveal d3 secrets-card" id="secrets-card" style="margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">Manage secrets</span>
      <span class="meta" id="secrets-status">—</span>
    </div>
    <p style="font-size: 14px; color: var(--muted); margin-bottom: 18px; max-width: 64ch;">
      Set / rotate / clear Worker secrets without touching <span class="mono">wrangler secret put</span>.
      Writes go through the Cloudflare API using your <span class="mono">CLOUDFLARE_API_TOKEN</span>.
      The Worker auto-redeploys ~15s after each change. Names are bounded to a known allowlist —
      we don't let arbitrary env vars get set from this UI.
    </p>
    <div id="secrets-groups"></div>
    <div id="secrets-error" class="lockdown-error" hidden></div>
  </section>

  <section class="reveal d3" style="margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">Guided setup</span>
      <span class="meta">Helm + Cloudflare MCP</span>
    </div>
    <p style="font-size: 16px; color: var(--muted); margin-bottom: 14px;">Drop into a pre-primed Helm session with your current runtime state and — if Cloudflare MCP is wired — live account tools. Helm proposes every mutation as an exhibit card; you approve.</p>
    <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
      <input type="text" id="setup-goal" placeholder="What do you want to set up? (e.g. 'add Anthropic via the gateway')" style="flex: 1; min-width: 280px;">
      <button id="setup-start">Start guided setup →</button>
    </div>
    <div id="setup-start-result" class="mono" style="font-size: 12px; color: var(--muted); margin-top: 10px;"></div>
  </section>

  <section class="reveal d4" style="margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">Capability checklist</span>
      <button class="ghost" id="capabilities-refresh">Refresh</button>
    </div>
    <div id="capabilities-body" class="capability-grid"><div class="mono">loading<span class="load-dot"></span></div></div>
  </section>

  <section class="reveal d4" style="margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">Push notifications</span>
      <span class="meta" id="webpush-status">checking…</span>
    </div>
    <p style="font-size: 16px; color: var(--muted); margin-bottom: 14px;">Reach this browser when Helm has something to say — morning briefing, mentions, alerts. The button below registers the service worker (<span class="mono">/sw.js</span>) and subscribes via the VAPID public key your Worker hosts at <span class="mono">/webpush/public-key</span>.</p>
    <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
      <button id="webpush-enable">Enable notifications</button>
      <button id="webpush-test" class="ghost" disabled>Send test push</button>
    </div>
    <div id="webpush-result" class="mono" style="font-size: 12px; color: var(--muted); margin-top: 10px;"></div>
  </section>

  <section class="reveal d4" style="margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">VAPID keys · operator setup</span>
      <span class="meta">browser-side · keys never sent to the server</span>
    </div>
    <p style="font-size: 16px; color: var(--muted); margin-bottom: 14px;">Generate a fresh VAPID key pair right here — the private key is created with <span class="mono">SubtleCrypto.generateKey</span> in your browser and is never POSTed anywhere. After clicking, copy the three <span class="mono">wrangler secret put</span> commands into a terminal to install them on your Worker.</p>
    <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
      <button id="vapid-gen">Generate VAPID keys</button>
      <button id="vapid-copy" class="ghost" disabled>Copy all</button>
    </div>
    <pre id="vapid-out" class="snippet-pre" style="margin-top: 14px; display: none;"></pre>
    <div id="vapid-warning" class="mono" style="font-size: 11px; color: var(--accent); margin-top: 8px; display: none;">
      ⚠ Save these now. The private key cannot be re-derived — close this tab and it's gone.
    </div>
  </section>

  <section class="reveal d4" style="margin-top: 36px;">
    <div class="panel-header">
      <span class="h display">Snippet generator</span>
      <span class="meta">copy → wrangler.toml / .dev.vars</span>
    </div>
    <p style="font-size: 15px; color: var(--muted); margin-bottom: 14px;">Select the plugins you want to enable. The snippet panel updates live with the exact config + env deltas to paste.</p>
    <div id="snippet-picker" class="snippet-picker"></div>
    <div class="snippet-out-grid">
      <div>
        <div class="mono small-caps" style="color: var(--muted); font-size: 11px; margin-bottom: 6px;">wrangler.toml</div>
        <pre class="snippet-pre" id="snippet-wrangler">(select at least one plugin)</pre>
      </div>
      <div>
        <div class="mono small-caps" style="color: var(--muted); font-size: 11px; margin-bottom: 6px;">.dev.vars / wrangler secret put</div>
        <pre class="snippet-pre" id="snippet-envvars">(select at least one plugin)</pre>
      </div>
    </div>
    <div id="snippet-notes" class="mono" style="font-size: 11px; color: var(--muted); margin-top: 10px;"></div>
  </section>
</template>

<template id="tpl-debug">
  <section class="reveal d1">
    <div class="section-ref">§98.0 · Debug</div>
    <h1 class="section-title">Wire it up. Watch it tick.</h1>
    <p class="lede">Metrics, health, request IDs. No stack traces here — dig into <span class="mono">wrangler tail</span> for the full audit stream.</p>
  </section>
  <section class="reveal d2">
    <div class="stats" id="debug-stats"></div>
    <div class="panel">
      <div class="panel-header"><span class="h display">Health report</span><button class="ghost" id="debug-refresh">Refresh</button></div>
      <pre class="run-output" id="debug-output"></pre>
    </div>
  </section>
</template>

<script>
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function j(path, init) {
  const response = await fetch(path, init);
  const text = await response.text();
  try { return { status: response.status, data: JSON.parse(text) }; }
  catch { return { status: response.status, data: text }; }
}

const state = {
  health: null,
  plugins: [],
  skills: [],
  conductorSession: 'conductor:default',
  conductorHistory: []
};

function renderEditionDate() {
  const el = document.getElementById('edition-date');
  if (!el) return;
  const d = new Date();
  const mo = d.toLocaleString('en-US', { month: 'long' });
  el.textContent = \`\${mo.toUpperCase()} \${d.getDate()}, \${d.getFullYear()}\`;
  document.getElementById('worker-origin').textContent = location.host.toUpperCase();
}

async function loadHealth() {
  const r = await j('/health');
  state.health = r.data?.data ?? {};
  return state.health;
}

async function loadPlugins() {
  const r = await j('/plugins');
  state.plugins = r.data?.data?.plugins ?? [];
  return state.plugins;
}

async function loadSkills() {
  const r = await j('/skills');
  state.skills = r.data?.data?.skills ?? [];
  return state.skills;
}

async function bootData() {
  await Promise.all([loadHealth(), loadPlugins(), loadSkills()]);
}

/* ---------------- router ---------------- */
const routes = {
  '/': renderOverview,
  '/conductor': renderConductor,
  '/shell': renderShell,
  '/files': renderFiles,
  '/plugins': renderPlugins,
  '/skills': renderSkills,
  '/sessions': renderSessions,
  '/providers': renderProviders,
  '/settings': renderSettings,
  '/debug': renderDebug,
  '/cli-auth': renderCliAuth
};

function currentRoute() {
  // Hash may contain a query string (e.g. "#/cli-auth?code=ABCD-1234") —
  // strip everything from "?" onward when matching the route table.
  const raw = location.hash.replace(/^#/, '').split('?')[0] || '/';
  return routes[raw] ? raw : '/';
}
function currentRouteQuery() {
  const hash = location.hash.replace(/^#/, '');
  const idx = hash.indexOf('?');
  if (idx < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(idx + 1));
}

async function route() {
  const r = currentRoute();
  $$('nav.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === r ? 'true' : 'false'));
  const view = $('#view');
  view.innerHTML = '';
  await routes[r]();
}

window.addEventListener('hashchange', route);
window.addEventListener('load', async () => {
  renderEditionDate();
  await bootData();
  route();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.target.matches('input,textarea')) {
    document.addEventListener('keydown', (e2) => {
      const map = { p: '/plugins', s: '/skills', c: '/conductor', o: '/', d: '/debug', x: '/sessions', v: '/providers', t: '/settings' };
      if (map[e2.key]) {
        location.hash = '#' + map[e2.key];
        e2.preventDefault();
      }
    }, { once: true });
  }
});

/* ---------------- overview ---------------- */
async function renderOverview() {
  const tpl = $('#tpl-overview').content.cloneNode(true);
  const view = $('#view');
  view.appendChild(tpl);

  $('[data-stat="plugins"]', view).textContent = String(state.plugins.length).padStart(2, '0');
  $('[data-stat="skills"]', view).textContent = String(state.skills.length).padStart(2, '0');
  $('[data-stat="do"]', view).textContent = state.health?.durableObjects ? 'ON' : 'OFF';
  $('[data-stat="ai"]', view).textContent = state.health?.workersAi ? 'ON' : 'OFF';

  // First-run banner — show until the operator either configures Cloudflare
  // Access (auth capability becomes "configured") or dismisses it. Dismissal
  // persists in localStorage but resets if the auth state changes back to
  // unconfigured, so a future Worker fork starts the banner fresh.
  const banner = view.querySelector('#first-run-banner');
  const dismiss = view.querySelector('#first-run-dismiss');
  if (banner && dismiss) {
    try {
      const r = await j('/setup/status');
      const caps = r.data?.data?.capabilities || [];
      const auth = caps.find((c) => c.id === 'auth');
      const stillFirstRun = auth && !auth.configured;
      const stamp = (auth && auth.configured) ? 'configured' : 'first-run';
      const lastDismiss = localStorage.getItem('helm-frb-dismissed');
      if (stillFirstRun && lastDismiss !== stamp) {
        banner.removeAttribute('hidden');
      }
      dismiss.addEventListener('click', () => {
        banner.setAttribute('hidden', '');
        localStorage.setItem('helm-frb-dismissed', stamp);
      });
    } catch (err) {
      // /setup/status unreachable — leave banner hidden, the user has bigger problems.
    }
  }

  mountConductor($('#overview-conductor'), true);
}

/* ---------------- conductor ---------------- */
function renderConductor() {
  const tpl = $('#tpl-conductor').content.cloneNode(true);
  $('#view').appendChild(tpl);
  // ?session=... in the hash overrides state.conductorSession so
  // "Ask Helm to set me up" can deep-link into a primed session.
  const session = currentRouteQuery().get('session');
  if (session) {
    state.conductorSession = session;
    state.conductorHistory = [];
  }
  mountConductor($('#conductor-full'), false);
}

/* ---------------- cli-auth (device-code approval) ---------------- */
async function renderCliAuth() {
  const tpl = $('#tpl-cli-auth').content.cloneNode(true);
  $('#view').appendChild(tpl);
  const container = $('#cli-auth-content');
  const code = currentRouteQuery().get('code') || '';
  if (!code) {
    container.innerHTML = '<div class="cli-auth-error mono">No code in URL. Your CLI should have opened this page with <span class="mono">?code=XXXX-YYYY</span>.</div>';
    return;
  }
  // Lookup device record so we can show metadata.
  let lookup = null;
  try {
    const r = await j('/cli-auth/lookup?code=' + encodeURIComponent(code));
    lookup = r.data?.data ?? r.data ?? null;
  } catch (err) {
    container.innerHTML = '<div class="cli-auth-error mono">Failed to look up code: ' + escapeHtml(String(err.message || err)) + '</div>';
    return;
  }
  if (!lookup || lookup.status === 'expired') {
    container.innerHTML = '<div class="cli-auth-error mono">This code has expired. Re-run your CLI to start a fresh flow.</div>';
    return;
  }
  if (lookup.status === 'denied') {
    container.innerHTML = '<div class="cli-auth-error mono">This code was already denied.</div>';
    return;
  }
  if (lookup.status === 'approved') {
    container.innerHTML = '<div class="cli-auth-success mono">This code was already approved. Your CLI should have it now.</div>';
    return;
  }
  const expiresAt = new Date(lookup.expiresAt).toLocaleTimeString();
  container.innerHTML =
    '<div class="cli-auth-summary">' +
    '  <div class="cli-auth-code mono">' + escapeHtml(lookup.userCode) + '</div>' +
    '  <div class="cli-auth-meta">' +
    '    <div><strong>App:</strong> <span class="mono">' + escapeHtml(lookup.appName || 'open-think') + '</span></div>' +
    '    <div><strong>CLI signature:</strong> <span class="mono">' + escapeHtml(lookup.cliInfo || '(none provided)') + '</span></div>' +
    '    <div><strong>Code expires:</strong> <span class="mono">' + escapeHtml(expiresAt) + '</span></div>' +
    '  </div>' +
    '  <p class="cli-auth-warn">' +
    '    Approving will mint a 30-day bearer for this CLI. The bearer authenticates as <em>your</em> email. ' +
    '    Only approve if the code above matches what your CLI printed.' +
    '  </p>' +
    '  <div class="cli-auth-actions">' +
    '    <button id="cli-approve" class="lockdown-btn lockdown-btn-primary"><span class="lockdown-btn-text">Approve this CLI</span><span class="lockdown-btn-arrow">→</span></button>' +
    '    <button id="cli-deny" class="ghost">Deny</button>' +
    '  </div>' +
    '  <div id="cli-auth-result" class="mono" style="margin-top: 14px; font-size: 12px;"></div>' +
    '</div>';
  $('#cli-approve').addEventListener('click', async () => {
    const btn = $('#cli-approve');
    const out = $('#cli-auth-result');
    btn.disabled = true;
    btn.querySelector('.lockdown-btn-text').textContent = 'Approving…';
    try {
      const r = await j('/cli-auth/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userCode: lookup.userCode })
      });
      const d = r.data?.data ?? r.data ?? r;
      if (d?.status === 'approved') {
        out.innerHTML = '<span style="color: #2d8c4f;">✓ Approved. Return to your terminal — the CLI should pick up the token within 2–4 seconds.</span>';
        btn.querySelector('.lockdown-btn-text').textContent = 'Approved ✓';
      } else {
        out.innerHTML = '<span style="color: #c0392b;">' + escapeHtml(d?.error || 'unexpected response') + '</span>';
        btn.querySelector('.lockdown-btn-text').textContent = 'Approve this CLI';
        btn.disabled = false;
      }
    } catch (err) {
      out.innerHTML = '<span style="color: #c0392b;">' + escapeHtml(String(err.message || err)) + '</span>';
      btn.querySelector('.lockdown-btn-text').textContent = 'Approve this CLI';
      btn.disabled = false;
    }
  });
  $('#cli-deny').addEventListener('click', async () => {
    if (!confirm('Deny this CLI login?')) return;
    await j('/cli-auth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userCode: lookup.userCode, deny: true })
    });
    $('#cli-auth-result').innerHTML = '<span style="color: var(--muted);">Denied. Your CLI will see "denied" on its next poll.</span>';
  });
}

/* ---------------- files ---------------- */
async function renderFiles() {
  const tpl = $('#tpl-files').content.cloneNode(true);
  $('#view').appendChild(tpl);
  await mountFiles();
}

async function mountFiles() {
  // Per-user prefix derived from the auth context's email (resolved by
  // the Worker — we just ask /me). Uploads land at "files/<userPrefix>/path".
  // Falls back to "files/anon/" if /me isn't reachable.
  let userPrefix = 'anon';
  try {
    const me = await j('/me');
    const email = me.data?.data?.email ?? me.data?.email ?? '';
    if (email) {
      // FNV-1a same as the worker's session-name derivation, so the
      // browser prefix and the auth-derived prefix line up.
      let h = 0x811c9dc5;
      for (let i = 0; i < email.length; i++) { h ^= email.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      userPrefix = 'u-' + h.toString(16).padStart(8, '0');
    }
  } catch { /* /me unauthenticated → anon */ }

  let currentDir = ''; // relative to "files/<userPrefix>/"
  const breadcrumb = $('#files-breadcrumb');
  const tableBody = $('#files-body');
  const dropzone = $('#files-dropzone');
  const fileInput = $('#files-input');
  const uploadsEl = $('#files-uploads');
  const prefixDisplay = $('#files-prefix-display');
  prefixDisplay.textContent = 'files/' + userPrefix + '/';

  function fullPrefix() {
    const dir = currentDir ? currentDir.replace(/^\\/+|\\/+$/g, '') + '/' : '';
    return 'files/' + userPrefix + '/' + dir;
  }
  function updateBreadcrumb() {
    const parts = ['files/'].concat(currentDir ? currentDir.split('/').filter(Boolean) : []);
    breadcrumb.innerHTML = parts.map((p, i) => {
      if (i === 0) return '<a href="#" data-dir="">' + escapeHtml(p) + '</a>';
      const dir = parts.slice(1, i + 1).join('/');
      return '<span class="muted">/</span><a href="#" data-dir="' + escapeHtml(dir) + '">' + escapeHtml(p) + '</a>';
    }).join('');
    breadcrumb.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        currentDir = a.dataset.dir || '';
        load();
      });
    });
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString();
  }

  async function load() {
    updateBreadcrumb();
    tableBody.innerHTML = '<tr><td colspan="5" class="mono">loading<span class="load-dot"></span></td></tr>';
    try {
      const r = await j('/persist?prefix=' + encodeURIComponent(fullPrefix()));
      const keys = r.data?.data?.keys ?? [];
      // Group children of currentDir into folders + files.
      const prefix = fullPrefix();
      const folders = new Map();
      const files = [];
      for (const k of keys) {
        if (!k.key.startsWith(prefix)) continue;
        const rel = k.key.slice(prefix.length);
        const slash = rel.indexOf('/');
        if (slash < 0) {
          files.push({ name: rel, ...k });
        } else {
          const folder = rel.slice(0, slash);
          if (!folders.has(folder)) folders.set(folder, { count: 0, size: 0, latest: '' });
          const v = folders.get(folder);
          v.count += 1; v.size += k.size; if (k.uploaded > v.latest) v.latest = k.uploaded;
        }
      }
      const rows = [];
      // Folders first
      for (const [name, v] of Array.from(folders.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        rows.push('<tr class="folder-row" data-folder="' + escapeHtml(name) + '">' +
          '<td>📁</td>' +
          '<td class="mono"><a href="#" class="folder-open" data-folder="' + escapeHtml(name) + '">' + escapeHtml(name) + '/</a></td>' +
          '<td class="mono muted">' + v.count + ' item' + (v.count === 1 ? '' : 's') + ' · ' + fmtSize(v.size) + '</td>' +
          '<td class="mono muted">' + fmtTime(v.latest) + '</td>' +
          '<td></td>' +
          '</tr>');
      }
      for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
        rows.push('<tr>' +
          '<td>📄</td>' +
          '<td class="mono">' + escapeHtml(f.name) + '</td>' +
          '<td class="mono muted">' + fmtSize(f.size) + '</td>' +
          '<td class="mono muted">' + fmtTime(f.uploaded) + '</td>' +
          '<td>' +
            '<button class="ghost file-download" data-key="' + escapeHtml(prefix + f.name) + '" data-name="' + escapeHtml(f.name) + '">↓</button> ' +
            '<button class="ghost file-copy" data-key="' + escapeHtml(prefix + f.name) + '">copy path</button> ' +
            '<button class="ghost file-delete" data-key="' + escapeHtml(prefix + f.name) + '">×</button>' +
          '</td>' +
          '</tr>');
      }
      if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="mono muted">empty — drop files above to add some.</td></tr>';
      } else {
        tableBody.innerHTML = rows.join('');
      }
      // Wire row buttons.
      tableBody.querySelectorAll('.folder-open').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          currentDir = (currentDir ? currentDir + '/' : '') + a.dataset.folder;
          load();
        });
      });
      tableBody.querySelectorAll('.file-download').forEach((b) => {
        b.addEventListener('click', () => {
          // Use a tab navigation so the cookie/auth flows naturally.
          window.open('/persist/' + encodeURIComponent(b.dataset.key).replace(/%2F/g, '/'), '_blank');
        });
      });
      tableBody.querySelectorAll('.file-copy').forEach((b) => {
        b.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(b.dataset.key);
            const orig = b.textContent;
            b.textContent = 'copied ✓';
            setTimeout(() => { b.textContent = orig; }, 1500);
          } catch { /* clipboard might be denied */ }
        });
      });
      tableBody.querySelectorAll('.file-delete').forEach((b) => {
        b.addEventListener('click', async () => {
          if (!confirm('Delete ' + b.dataset.key + '? R2 deletions are immediate and irreversible.')) return;
          try {
            await fetch('/persist/' + encodeURIComponent(b.dataset.key).replace(/%2F/g, '/'), { method: 'DELETE' });
            load();
          } catch (err) { alert('delete failed: ' + (err.message || err)); }
        });
      });
    } catch (err) {
      tableBody.innerHTML = '<tr><td colspan="5" class="mono muted">failed to load: ' + escapeHtml(String(err.message || err)) + '</td></tr>';
    }
  }

  // ---- upload ----
  async function uploadFile(file) {
    const key = fullPrefix() + (file.webkitRelativePath || file.name);
    const id = 'up-' + Math.random().toString(36).slice(2, 8);
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.id = id;
    row.innerHTML = '<span class="mono">' + escapeHtml(file.name) + '</span><span class="upload-bar"><span class="upload-bar-fill" id="' + id + '-fill"></span></span><span class="mono upload-status" id="' + id + '-status">queued</span>';
    uploadsEl.appendChild(row);

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', '/persist/' + encodeURIComponent(key).replace(/%2F/g, '/'));
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          const fill = document.getElementById(id + '-fill');
          if (fill) fill.style.width = pct + '%';
          const status = document.getElementById(id + '-status');
          if (status) status.textContent = pct + '%';
        }
      };
      xhr.onload = () => {
        const status = document.getElementById(id + '-status');
        if (xhr.status >= 200 && xhr.status < 300) {
          if (status) { status.textContent = '✓'; status.classList.add('ok'); }
          setTimeout(() => row.remove(), 2500);
        } else {
          if (status) { status.textContent = 'failed'; status.classList.add('err'); }
        }
        resolve();
      };
      xhr.onerror = () => {
        const status = document.getElementById(id + '-status');
        if (status) { status.textContent = 'error'; status.classList.add('err'); }
        resolve();
      };
      xhr.send(file);
    });
  }
  async function handleFiles(fileList) {
    const arr = Array.from(fileList);
    for (const f of arr) {
      await uploadFile(f);
    }
    load();
  }

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });
  $('#files-pick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });

  $('#files-mkdir').addEventListener('click', async () => {
    const name = prompt('New folder name (relative to ' + breadcrumb.textContent + '):');
    if (!name) return;
    // R2 has no real folders — we create an empty marker file so the
    // folder appears in listings until something else lands inside.
    const key = fullPrefix() + name.replace(/[/]+$/, '') + '/.keep';
    await fetch('/persist/' + encodeURIComponent(key).replace(/%2F/g, '/'), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: ''
    });
    load();
  });

  $('#files-refresh').addEventListener('click', load);
  load();
}

/* ---------------- shell ---------------- */
async function renderShell() {
  const tpl = $('#tpl-shell').content.cloneNode(true);
  $('#view').appendChild(tpl);
  await mountShell();
}

// Lazy-load xterm.js from our own /assets/xterm/ proxy so the static /app
// HTML stays small AND we don't depend on the CDN being reachable from
// the user's network. The proxy fetches from jsdelivr the first time and
// caches forever (see src/index.ts /assets/xterm route).
//
// Pinning specific versions of @xterm/xterm + @xterm/addon-fit so an
// upstream breaking change can't silently hose this tab. Bump in
// lock-step with the proxy's allowlist.
const XTERM_CSS = '/assets/xterm/xterm.css';
const XTERM_JS = '/assets/xterm/xterm.js';
const XTERM_FIT = '/assets/xterm/addon-fit.js';

let _xtermLoaded = null;
function loadXterm() {
  if (_xtermLoaded) return _xtermLoaded;
  _xtermLoaded = new Promise((resolve, reject) => {
    if (!document.querySelector(\`link[href="\${XTERM_CSS}"]\`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = XTERM_CSS;
      document.head.appendChild(link);
    }
    let pending = 2;
    const done = () => { if (--pending === 0) resolve(true); };
    const addScript = (src) => {
      if (document.querySelector(\`script[src="\${src}"]\`)) { done(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = done;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    };
    addScript(XTERM_JS);
    addScript(XTERM_FIT);
  });
  return _xtermLoaded;
}

async function mountShell() {
  const mount = $('#shell-mount');
  const dot = $('#shell-dot');
  const sessionEl = $('#shell-session');
  // Empty/null sessionName ⇒ Worker derives one from the authenticated
  // email (hash → "u-XXXXXXXX"). Power users can override by setting
  // helm-shell-session in localStorage (e.g. from the dev console) to
  // run multiple parallel containers for the same email.
  const sessionName = (typeof localStorage !== 'undefined' && localStorage.getItem('helm-shell-session')) || '';
  sessionEl.textContent = sessionName || '(per-user)';

  const setState = (s) => { dot.dataset.state = s; dot.setAttribute('aria-label', s); };
  setState('connecting');

  try {
    await loadXterm();
  } catch (err) {
    mount.innerHTML = '<pre class="run-output">Failed to load xterm.js from CDN. Check your network or self-host the assets.</pre>';
    setState('error');
    return;
  }

  // eslint-disable-next-line no-undef
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    theme: {
      background: '#0b0b0d',
      foreground: '#f0eee6',
      cursor: '#f0c674',
      selectionBackground: '#3a3a3d'
    },
    allowProposedApi: true,
    convertEol: false
  });
  // eslint-disable-next-line no-undef
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(mount);
  fit.fit();

  let ws = null;
  let pingTimer = 0;
  let reconnectTimer = 0;
  let manuallyClosed = false;

  const wsUrl = (() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Empty session ⇒ Worker derives from auth (hash of email).
    return sessionName
      ? \`\${proto}//\${location.host}/shell/ws/\${encodeURIComponent(sessionName)}\`
      : \`\${proto}//\${location.host}/shell/ws\`;
  })();

  function sendResize() {
    if (!ws || ws.readyState !== 1) return;
    const cols = term.cols;
    const rows = term.rows;
    ws.send('r' + JSON.stringify({ cols, rows }));
  }

  // Cold-start progress: first request to a sleeping container takes 5–10s
  // for image pull + cmd start. We show a stage-by-stage message so the user
  // doesn't think it's hung. Cleared as soon as the bridge sends 'm' (motd)
  // or any 'o' (stdout) frame.
  let coldStartTimer = 0;
  let coldStartStage = 0;
  let connectStartedAt = 0;
  let receivedFirstByte = false;
  function tickColdStart() {
    if (receivedFirstByte) return;
    const elapsed = Math.floor((Date.now() - connectStartedAt) / 1000);
    coldStartStage += 1;
    let line = '';
    if (coldStartStage === 1) line = \`\\x1b[36m· still booting (\${elapsed}s) — first wake on a cold container takes ~10s while CF pulls the image\\x1b[0m\`;
    else if (coldStartStage === 2) line = \`\\x1b[36m· still booting (\${elapsed}s) — initializing PTY + bridge\\x1b[0m\`;
    else if (coldStartStage === 3) line = \`\\x1b[33m· still booting (\${elapsed}s) — taking longer than usual; check container logs in CF dashboard if this persists\\x1b[0m\`;
    else line = \`\\x1b[31m· no response after \${elapsed}s — try Reconnect, or check the deploy.\\x1b[0m\`;
    term.writeln(line);
    if (coldStartStage < 5) coldStartTimer = setTimeout(tickColdStart, 5000);
  }

  function connect() {
    setState('connecting');
    term.writeln('\\x1b[36m· connecting to helm-shell container…\\x1b[0m');
    connectStartedAt = Date.now();
    coldStartStage = 0;
    receivedFirstByte = false;
    clearTimeout(coldStartTimer);
    coldStartTimer = setTimeout(tickColdStart, 4000);

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setState('live');
      sendResize();
      // Heartbeat — Cloudflare's edge will close idle WSs after ~100s.
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === 1) ws.send('p');
      }, 30000);
    };

    ws.onmessage = (ev) => {
      const data = ev.data;
      const markFirstByte = () => {
        if (receivedFirstByte) return;
        receivedFirstByte = true;
        clearTimeout(coldStartTimer);
        const ms = Date.now() - connectStartedAt;
        if (ms > 3000) term.writeln(\`\\x1b[36m· container ready (\${(ms / 1000).toFixed(1)}s)\\x1b[0m\`);
      };
      if (typeof data === 'string') {
        if (data.length < 1) return;
        const op = data[0];
        const payload = data.slice(1);
        if (op === 'o' || op === 'm' || op === 'E') {
          markFirstByte();
          term.write(payload);
          if (op === 'E') term.writeln('\\x1b[31m[bridge error]\\x1b[0m');
          return;
        }
        if (op === 'e') {
          term.writeln('\\x1b[33m· pty exited\\x1b[0m');
          setState('idle');
          return;
        }
        if (op === 'P') return; // pong
      } else if (data instanceof ArrayBuffer) {
        // Binary frame — first byte opcode, rest payload.
        const arr = new Uint8Array(data);
        if (arr.length < 1) return;
        const op = String.fromCharCode(arr[0]);
        const payload = arr.slice(1);
        const dec = new TextDecoder('utf-8', { fatal: false });
        if (op === 'o' || op === 'm' || op === 'E') {
          markFirstByte();
          term.write(dec.decode(payload));
          return;
        }
      }
    };

    ws.onclose = (ev) => {
      clearInterval(pingTimer);
      if (manuallyClosed) {
        setState('idle');
        return;
      }
      setState('reconnecting');
      term.writeln(\`\\x1b[33m· disconnected (code \${ev.code}) — reconnecting in 2s…\\x1b[0m\`);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      // onclose will fire after onerror; let it handle the reconnect.
    };
  }

  // Pipe local input → ws ('i' opcode + UTF-8 bytes).
  term.onData((data) => {
    if (!ws || ws.readyState !== 1) return;
    ws.send('i' + data);
  });

  // Resize on window resize + refit.
  const onResize = () => { try { fit.fit(); sendResize(); } catch {} };
  window.addEventListener('resize', onResize);

  $('#shell-clear').addEventListener('click', () => term.clear());
  $('#shell-reconnect').addEventListener('click', () => {
    manuallyClosed = true;
    if (ws) ws.close(1000, 'manual reconnect');
    clearTimeout(reconnectTimer);
    setTimeout(() => { manuallyClosed = false; connect(); }, 100);
  });

  // Sessions panel — toggles on, fetches /shell/list, renders rows.
  const sessionsCard = $('#shell-sessions');
  const sessionsBody = $('#shell-sessions-body');
  const sessionsCount = $('#shell-sessions-count');
  const sessionsAll = $('#shell-sessions-all');
  let sessionsVisible = false;
  function fmtRelative(ts) {
    if (!ts) return '—';
    const ms = Date.now() - ts;
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function fmtDuration(ms) {
    if (!ms || ms < 1000) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }
  function fmtCost(usd) {
    if (!usd || usd < 0.0001) return '$0.00';
    if (usd < 1) return '$' + usd.toFixed(3);
    return '$' + usd.toFixed(2);
  }
  async function loadSessions() {
    sessionsBody.innerHTML = '<tr><td colspan="7" class="mono">loading<span class="load-dot"></span></td></tr>';
    try {
      const qs = sessionsAll.checked ? '?all=1' : '';
      const r = await j('/shell/list' + qs);
      const list = (r.data?.sessions ?? r.sessions ?? []);
      const totals = r.data?.totals;
      sessionsCount.textContent = list.length === 0 ? 'no sessions' : list.length + ' session' + (list.length === 1 ? '' : 's');
      // Totals strip — only show when we have real data.
      const totalsEl = $('#shell-sessions-totals');
      if (totals && list.length > 0) {
        totalsEl.innerHTML =
          '<div class="totals-cell"><span class="totals-label">today (UTC)</span>' +
          '<span class="totals-val">' + fmtDuration(totals.awakeMsToday) + ' awake</span></div>' +
          '<div class="totals-cell"><span class="totals-label">est. cost today</span>' +
          '<span class="totals-val">' + fmtCost(totals.estCostTodayUsd) + '</span></div>' +
          '<div class="totals-cell"><span class="totals-label">live now</span>' +
          '<span class="totals-val">' + totals.live + ' / ' + totals.sessions + '</span></div>';
        totalsEl.removeAttribute('hidden');
      } else {
        totalsEl.setAttribute('hidden', '');
      }
      if (list.length === 0) {
        sessionsBody.innerHTML = '<tr><td colspan="7" class="mono muted">no recent sessions yet — connect once to populate.</td></tr>';
        return;
      }
      sessionsBody.innerHTML = list.map((s) => {
        const live = (s.connections > 0)
          ? '<span class="badge live">live · ' + s.connections + '</span>'
          : '<span class="badge idle">idle</span>';
        return '<tr>' +
          '<td class="mono">' + escapeHtml(s.session) + '</td>' +
          '<td class="mono muted">' + escapeHtml(s.email || 'anon') + '</td>' +
          '<td>' + live + '</td>' +
          '<td class="mono">' + fmtDuration(s.awakeMsLive ?? s.awakeMs ?? 0) + '</td>' +
          '<td class="mono">' + fmtCost(s.estCostUsd ?? 0) + '</td>' +
          '<td class="mono muted">' + fmtRelative(s.lastSeen) + '</td>' +
          '<td><button class="ghost session-attach" data-session="' + escapeHtml(s.session) + '">Attach</button> <button class="ghost session-forget" data-session="' + escapeHtml(s.session) + '">Forget</button></td>' +
          '</tr>';
      }).join('');
      // Wire row buttons.
      sessionsBody.querySelectorAll('.session-attach').forEach((b) => {
        b.addEventListener('click', () => {
          const name = b.dataset.session;
          if (typeof localStorage !== 'undefined') localStorage.setItem('helm-shell-session', name);
          location.reload();
        });
      });
      sessionsBody.querySelectorAll('.session-forget').forEach((b) => {
        b.addEventListener('click', async () => {
          const name = b.dataset.session;
          if (!confirm('Forget session "' + name + '" from the registry? The container itself sleeps on its own.')) return;
          await j('/shell/forget', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: name })
          });
          loadSessions();
        });
      });
    } catch (err) {
      sessionsBody.innerHTML = '<tr><td colspan="7" class="mono muted">failed to load: ' + escapeHtml(String(err.message ?? err)) + '</td></tr>';
    }
  }
  $('#shell-sessions-toggle').addEventListener('click', () => {
    sessionsVisible = !sessionsVisible;
    if (sessionsVisible) {
      sessionsCard.removeAttribute('hidden');
      loadSessions();
    } else {
      sessionsCard.setAttribute('hidden', '');
    }
  });
  $('#shell-sessions-refresh').addEventListener('click', loadSessions);
  sessionsAll.addEventListener('change', loadSessions);

  connect();

  // Autofocus terminal on click anywhere in the mount container.
  mount.addEventListener('click', () => term.focus());
  term.focus();
}

function mountConductor(host, compact) {
  // Read persisted mode preference; default to "execute".
  const savedMode = (typeof localStorage !== 'undefined' && localStorage.getItem('helm-chat-mode')) || 'execute';

  host.innerHTML = \`
    <div class="conductor-header">
      <div class="conductor-title">
        <span class="title display">Helm</span>
        <span class="conn-dot" id="c-conn" data-state="connecting" aria-label="connecting"></span>
      </div>
      <div class="conductor-meta">
        <span class="meta-session" id="c-session" title="session"></span>
      </div>
    </div>
    <div class="conductor-body" id="c-body" role="log" aria-live="polite"></div>
    <div class="composer">
      <div class="composer-row">
        <textarea id="c-input" rows="1" placeholder="Ask Helm…"></textarea>
        <button id="c-send" type="button" class="composer-send" aria-label="Send"><span class="ic-arrow" aria-hidden="true">↑</span></button>
      </div>
      <div class="composer-foot">
        <div class="mode-seg" role="tablist" aria-label="response mode">
          <button type="button" role="tab" data-mode="plan" class="seg-btn" aria-selected="\${savedMode === 'plan'}">Plan</button>
          <button type="button" role="tab" data-mode="execute" class="seg-btn" aria-selected="\${savedMode === 'execute'}">Execute</button>
        </div>
        <span class="composer-hint mono" aria-hidden="true">⌘↵ to send</span>
      </div>
    </div>
  \`;
  host.querySelector('#c-session').textContent = state.conductorSession;
  const body = host.querySelector('#c-body');
  const input = host.querySelector('#c-input');
  const btn = host.querySelector('#c-send');
  const segButtons = host.querySelectorAll('.seg-btn');
  const connDot = host.querySelector('#c-conn');

  let currentMode = savedMode;
  let isStreaming = false;

  renderConductorBody(body);

  // Auto-resize textarea up to a sane max — grows with content, capped on
  // mobile so the message list stays readable.
  function autoResize() {
    input.style.height = 'auto';
    const max = window.innerWidth < 700 ? 140 : 240;
    input.style.height = Math.min(input.scrollHeight, max) + 'px';
  }
  input.addEventListener('input', autoResize);
  autoResize();

  // Mode segmented control. Single click switches; persists to localStorage.
  segButtons.forEach((b) => {
    b.addEventListener('click', () => {
      currentMode = b.dataset.mode;
      segButtons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      try { localStorage.setItem('helm-chat-mode', currentMode); } catch {}
    });
  });

  // WS-backed chat. Connection state flows into the dot; streaming events
  // (text-delta, tool-use-*, loop-done) drive incremental rendering.
  const chat = makeChatStream(state.conductorSession, body, {
    onConnState: (s) => {
      connDot.dataset.state = s;
      connDot.setAttribute('aria-label', s);
    },
    onStreamingChange: (streaming) => {
      isStreaming = streaming;
      btn.classList.toggle('is-stop', streaming);
      btn.setAttribute('aria-label', streaming ? 'Stop' : 'Send');
      btn.querySelector('.ic-arrow').textContent = streaming ? '■' : '↑';
    }
  });

  const send = () => {
    if (isStreaming) {
      chat.interrupt();
      return;
    }
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    autoResize();
    const clientMessageId = 'c-' + Math.random().toString(36).slice(2, 10);
    appendMessageToBody(body, { role: 'user', content, clientMessageId });
    chat.markSeen(clientMessageId);
    chat.send({ content, mode: currentMode, clientMessageId });
  };

  btn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    // Cmd/Ctrl-Enter sends. Plain Enter inserts a newline (textarea default).
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    // Escape interrupts an active stream.
    if (e.key === 'Escape' && isStreaming) { e.preventDefault(); chat.interrupt(); }
  });

  if (compact && state.conductorHistory.length === 0) {
    appendMessageToBody(body, {
      role: 'assistant',
      content: 'Hey — I\\'m Helm. Ask me anything about your runtime: \\"what plugins are enabled?\\", \\"check runtime health\\", \\"help me add Anthropic\\". Toggle Plan to see what I\\'d do without running it.'
    });
  }
}

async function sendStreaming(body, content) {
  const enabled = new Set((state.plugins || []).map((p) => p.id));
  // Any native-tool-use-capable provider unlocks the /conductor/stream-tools
  // route. Selection priority (server re-validates): anthropic → cf-ai-gateway →
  // openai-compatible. Falls back to the codex app-server WebSocket bridge if
  // that's what's configured (via /conductor/stream).
  let streamToolsProvider = null;
  if (enabled.has('anthropic')) streamToolsProvider = 'anthropic';
  else if (enabled.has('cf-ai-gateway')) streamToolsProvider = 'cf-ai-gateway';
  else if (enabled.has('openai-compatible')) streamToolsProvider = 'openai-compatible';
  const usesToolStream = streamToolsProvider !== null;
  const route = usesToolStream ? '/conductor/stream-tools' : '/conductor/stream';
  const providerLabel = usesToolStream
    ? streamToolsProvider + ' · stream-tools'
    : 'codex:app-server · stream';

  const msg = { role: 'assistant', content: '', mode: 'stream', provider: providerLabel, streaming: true, events: [] };
  state.conductorHistory.push(msg);
  const el = document.createElement('div');
  el.className = 'msg assistant';
  const who = document.createElement('div');
  who.className = 'who';
  who.innerHTML = '<span>✦</span><span>Conductor · ' + providerLabel + '<span class="load-dot"></span></span>';
  el.appendChild(who);
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  el.appendChild(contentEl);

  const controls = document.createElement('div');
  controls.className = 'stream-controls';
  const streamIdLabel = document.createElement('span');
  streamIdLabel.className = 'stream-id';
  streamIdLabel.textContent = 'stream: (starting…)';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '◈ Cancel turn';
  cancelBtn.style.display = 'none';
  controls.appendChild(streamIdLabel);
  controls.appendChild(cancelBtn);
  el.appendChild(controls);

  const trace = document.createElement('div');
  trace.className = 'trace';
  el.appendChild(trace);
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;

  let response;
  try {
    response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ sessionName: state.conductorSession, content, mode: usesToolStream ? 'selective' : 'auto' })
    });
  } catch (err) {
    contentEl.textContent = '[stream-error] ' + String(err);
    who.innerHTML = '<span>✦</span><span>Conductor · stream · error</span>';
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    contentEl.textContent = '[stream-error] ' + response.status + ' ' + text;
    who.innerHTML = '<span>✦</span><span>Conductor · stream · error</span>';
    return;
  }

  const streamId = response.headers.get('x-stream-id');
  if (streamId) {
    streamIdLabel.textContent = 'stream: ' + streamId;
    cancelBtn.style.display = 'inline-block';
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      cancelBtn.textContent = '◈ Cancelling…';
      try {
        await fetch('/conductor/stream/' + encodeURIComponent(streamId) + '/interrupt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'user-clicked-cancel' })
        });
      } catch (err) {
        cancelBtn.textContent = '◈ Cancel failed';
      }
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';

  const pushEvent = (event, data) => {
    let parsed = data;
    try { parsed = JSON.parse(data); } catch {}
    const step = document.createElement('div');
    step.className = 'trace-step';
    step.innerHTML = \`<div class="tag"><span>▸ \${escapeHtml(event)}</span></div><div class="payload">\${escapeHtml(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2))}</div>\`;
    trace.appendChild(step);
    body.scrollTop = body.scrollHeight;

    // --- Anthropic stream-tools events ---
    if (event === 'text-delta' && parsed && typeof parsed.text === 'string') {
      assistantText += parsed.text;
      contentEl.textContent = assistantText;
    }
    if (event === 'tool-held' && parsed && parsed.skill) {
      const card = document.createElement('div');
      card.className = 'action-card';
      card.innerHTML = \`
        <div><span class="small-caps mono" style="color: var(--muted)">held for approval:</span>
        <span class="skill-id">\${escapeHtml(parsed.skill)}</span>
        <span style="color: var(--muted); font-style: italic;">· \${escapeHtml(parsed.reason || 'dangerous')}</span></div>
        <div class="input-preview">\${escapeHtml(JSON.stringify(parsed.input ?? {}, null, 2))}</div>
        <button>Execute →</button>
      \`;
      const runOutput = document.createElement('pre');
      runOutput.className = 'run-output hidden';
      card.appendChild(runOutput);
      card.querySelector('button').addEventListener('click', async () => {
        runOutput.classList.remove('hidden', 'err');
        runOutput.textContent = 'Running…';
        const r = await j('/skills/invoke/' + encodeURIComponent(parsed.skill), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: parsed.input ?? {} })
        });
        if (!r.data?.ok) runOutput.classList.add('err');
        runOutput.textContent = JSON.stringify(r.data, null, 2);
      });
      el.appendChild(card);
    }
    if (event === 'loop-done') {
      cancelBtn.style.display = 'none';
      who.innerHTML = '<span>✦</span><span>Conductor · ' + providerLabel + ' · ' + (parsed.reason || 'done') + '</span>';
      checkPendingRollbacks();
    }

    // --- Codex app-server events ---
    if (event === 'notification' && parsed && parsed.params) {
      const delta = parsed.params.text || parsed.params.delta;
      if (typeof delta === 'string') {
        assistantText += delta;
        contentEl.textContent = assistantText;
      }
    }
    if (event === 'result' && parsed && Array.isArray(parsed.output)) {
      const finalText = parsed.output.map((b) => (b && typeof b === 'object' && typeof b.text === 'string') ? b.text : '').join('');
      if (finalText) {
        assistantText = finalText;
        contentEl.textContent = assistantText;
      }
    }
    if (event === 'cancelled') {
      who.innerHTML = '<span>✦</span><span>Conductor · stream · cancelled</span>';
      cancelBtn.style.display = 'none';
    }
    if (event === 'done') {
      who.innerHTML = '<span>✦</span><span>Conductor · ' + providerLabel + ' · done</span>';
      cancelBtn.style.display = 'none';
      checkPendingRollbacks();
    }
    if (event === 'error') {
      who.innerHTML = '<span>✦</span><span>Conductor · stream · error</span>';
      cancelBtn.style.display = 'none';
      if (!assistantText) contentEl.textContent = '[stream-error] ' + (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
    }
  };

  const checkPendingRollbacks = async () => {
    try {
      const r = await j('/sessions/' + encodeURIComponent(state.conductorSession) + '/rollbacks');
      const list = r.data?.data;
      if (!Array.isArray(list) || list.length === 0) return;
      for (const m of list.slice(0, 3)) {
        if (!m.rollback) continue;
        const banner = document.createElement('div');
        banner.className = 'action-card';
        banner.style.borderColor = 'var(--warn)';
        banner.innerHTML = \`
          <div><span class="small-caps mono" style="color: var(--warn)">rollback available:</span>
          <span class="skill-id">\${escapeHtml(m.rollback.label)}</span></div>
          <div class="input-preview">\${escapeHtml(JSON.stringify(m.rollback.input ?? {}, null, 2))}</div>
          <button style="background: var(--warn); border-color: var(--warn);">↻ Undo</button>
        \`;
        const output = document.createElement('pre');
        output.className = 'run-output hidden';
        banner.appendChild(output);
        banner.querySelector('button').addEventListener('click', async () => {
          output.classList.remove('hidden', 'err');
          output.textContent = 'Reverting…';
          const resp = await j('/sessions/' + encodeURIComponent(state.conductorSession) + '/apply-rollback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId: m.id })
          });
          if (!resp.data?.ok) output.classList.add('err');
          output.textContent = JSON.stringify(resp.data, null, 2);
        });
        el.appendChild(banner);
      }
    } catch {
      // non-fatal
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\\n\\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (data) pushEvent(event, data);
    }
  }

  if (!assistantText) contentEl.textContent = '(no assistant text)';
}

function renderConductorBody(body) {
  body.innerHTML = '';
  if (state.conductorHistory.length === 0) return;
  // Snapshot + clear before iterating: appendMessageToBody pushes back to
  // state.conductorHistory, which would create an infinite for-of loop if
  // we iterated the live array. After this loop, history is restored.
  const snapshot = state.conductorHistory.slice();
  state.conductorHistory.length = 0;
  for (const m of snapshot) appendMessageToBody(body, m);
}

function appendMessageToBody(body, msg) {
  state.conductorHistory.push(msg);
  const el = document.createElement('div');
  el.className = 'msg ' + (msg.role === 'assistant' ? 'assistant' : '');
  const who = document.createElement('div');
  who.className = 'who';
  const sigil = msg.role === 'assistant' ? '✦' : '§';
  const modeTag = msg.mode && msg.mode !== 'propose' ? ' · ' + msg.mode : '';
  const iterTag = msg.iterationsUsed ? ' · ' + msg.iterationsUsed + ' iter' : '';
  const label = msg.role === 'assistant'
    ? 'Conductor' + (msg.provider ? ' · ' + msg.provider : '') + modeTag + iterTag
    : msg.role === 'user' ? 'You' : msg.role;
  who.innerHTML = '<span>' + sigil + '</span><span>' + escapeHtml(label) + '</span>';
  el.appendChild(who);

  const content = document.createElement('div');
  content.className = 'content';
  content.innerHTML = renderMarkdownLite(msg.content);
  el.appendChild(content);

  if (Array.isArray(msg.trace) && msg.trace.length > 0) {
    const traceEl = document.createElement('div');
    traceEl.className = 'trace';
    for (const step of msg.trace) {
      const stepEl = document.createElement('div');
      stepEl.className = 'trace-step';
      const okTag = step.ok ? '<span class="ok">ok</span>' : '<span class="err">err</span>';
      stepEl.innerHTML = \`
        <div class="tag">
          <span>▸ \${escapeHtml(step.skill)}<span style="opacity:0.5"> · \${step.durationMs}ms</span></span>
          \${okTag}
        </div>
        <div class="payload">\${escapeHtml(JSON.stringify({ input: step.input, result: step.result ?? step.error }, null, 2))}</div>
      \`;
      traceEl.appendChild(stepEl);
    }
    el.appendChild(traceEl);
  }

  if (msg.halted === 'dangerous-skill') {
    const banner = document.createElement('div');
    banner.className = 'halted-banner';
    banner.textContent = '◈ Selective mode halted on a dangerous skill. Approve the exhibit below to continue.';
    el.appendChild(banner);
  } else if (msg.halted === 'iteration-cap') {
    const banner = document.createElement('div');
    banner.className = 'halted-banner';
    banner.textContent = '◈ Iteration cap reached. Ask the Conductor to continue or switch modes.';
    el.appendChild(banner);
  }

  if (Array.isArray(msg.suggestedActions)) {
    for (const action of msg.suggestedActions) {
      const card = document.createElement('div');
      card.className = 'action-card';
      const reason = action.reason ? ' <span style="color: var(--muted); font-style: italic;">· ' + escapeHtml(action.reason) + '</span>' : '';
      card.innerHTML = \`
        <div><span class="small-caps mono" style="color: var(--muted)">propose:</span>
        <span class="skill-id">\${escapeHtml(action.skill)}</span>\${reason}</div>
        <div class="input-preview">\${escapeHtml(JSON.stringify(action.input ?? {}, null, 2))}</div>
        <button>Execute →</button>
      \`;
      const runOutput = document.createElement('pre');
      runOutput.className = 'run-output hidden';
      card.appendChild(runOutput);
      card.querySelector('button').addEventListener('click', async () => {
        runOutput.classList.remove('hidden', 'err');
        runOutput.textContent = 'Running…';
        const r = await j('/skills/invoke/' + encodeURIComponent(action.skill), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: action.input ?? {} })
        });
        if (!r.data?.ok) runOutput.classList.add('err');
        runOutput.textContent = JSON.stringify(r.data, null, 2);
      });
      el.appendChild(card);
    }
  }

  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

/* ---------------- WebSocket chat stream ----------------
 * Manages one persistent WS to /chat/ws/<sessionName>. Reconnects with
 * exponential backoff. Outbound user-messages queue while disconnected
 * and flush on (re)open. Inbound events (assistant-message, halted,
 * error, complete) drive UI state.
 *
 * Multi-tab dedup: the originating tab tags each user-message with a
 * clientMessageId before send + addss it to a "seen" set; when the
 * server echoes user-message, we skip rendering if the id matches.
 * Other tabs (which never saw the local optimistic append) render the
 * echo normally.
 */
function makeChatStream(sessionName, body, opts) {
  const onConnState = (opts && opts.onConnState) || (() => {});
  const onStreamingChange = (opts && opts.onStreamingChange) || (() => {});
  const seen = new Set();
  let ws = null;
  let queue = [];
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let closed = false;

  // Streaming state for execute mode — one in-progress assistant bubble
  // accumulates text-delta + tool-use events and finalizes on loop-done.
  let streamEl = null;
  let streamTextEl = null;
  let streamCursorEl = null;
  let streamText = '';
  let streamToolCards = new Map(); // tool-use-id -> DOM card element

  function setConnState(s) {
    onConnState(s);
  }
  function setStreaming(b) {
    onStreamingChange(b);
  }

  function open() {
    setConnState('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const u = proto + '//' + location.host + '/chat/ws/' + encodeURIComponent(sessionName);
    try {
      ws = new WebSocket(u);
    } catch (e) {
      console.warn('[chat-ws] could not open WebSocket:', e);
      setConnState('reconnecting');
      return;
    }
    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      setConnState('live');
      while (queue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(queue.shift());
      }
    });
    ws.addEventListener('message', (e) => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      handleEvent(event);
    });
    ws.addEventListener('close', () => {
      ws = null;
      if (closed) return;
      setConnState('reconnecting');
      reconnectTimer = setTimeout(open, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
    });
    ws.addEventListener('error', () => { /* close handler will fire next */ });
  }

  function ensureStreamBubble(provider) {
    if (streamEl) return streamEl;
    streamEl = document.createElement('div');
    streamEl.className = 'msg assistant is-streaming';
    const who = document.createElement('div');
    who.className = 'who';
    const sigil = '<span class="sigil">✦</span>';
    const label = '<span>Helm' + (provider ? ' · ' + escapeHtml(provider) : '') + '</span>';
    who.innerHTML = sigil + label;
    streamEl.appendChild(who);

    const content = document.createElement('div');
    content.className = 'content';
    streamEl.appendChild(content);

    streamTextEl = document.createElement('span');
    streamTextEl.className = 'stream-text';
    content.appendChild(streamTextEl);

    streamCursorEl = document.createElement('span');
    streamCursorEl.className = 'stream-cursor';
    content.appendChild(streamCursorEl);

    body.appendChild(streamEl);
    body.scrollTop = body.scrollHeight;
    return streamEl;
  }

  function appendDelta(text) {
    ensureStreamBubble();
    streamText += text;
    streamTextEl.textContent = streamText;
    body.scrollTop = body.scrollHeight;
  }

  function startToolCard(event) {
    if (!streamEl) ensureStreamBubble();
    const card = document.createElement('div');
    card.className = 'tool-card is-running';
    card.innerHTML =
      '<div class="tool-head"><span class="tool-arrow">▸</span><span class="tool-name mono">' +
      escapeHtml(event.name || 'tool') +
      '</span><span class="tool-status mono">running</span></div>' +
      '<div class="tool-input mono"></div>' +
      '<div class="tool-result mono" hidden></div>';
    // Insert before cursor so subsequent text-delta keeps streaming below.
    streamEl.insertBefore(card, streamCursorEl ? streamCursorEl.parentElement : null);
    streamToolCards.set(event.id, card);
    body.scrollTop = body.scrollHeight;
  }
  function completeToolInput(event) {
    const card = streamToolCards.get(event.id);
    if (!card) return;
    const inputEl = card.querySelector('.tool-input');
    if (inputEl && event.input) {
      inputEl.textContent = JSON.stringify(event.input, null, 2);
    }
  }
  function finishToolCard(event) {
    const card = streamToolCards.get(event.toolUseId);
    if (!card) return;
    card.classList.remove('is-running');
    card.classList.add(event.ok ? 'is-done' : 'is-failed');
    const status = card.querySelector('.tool-status');
    if (status) {
      status.textContent = event.ok
        ? 'done · ' + Math.round(event.durationMs || 0) + 'ms'
        : 'failed';
    }
    const resultEl = card.querySelector('.tool-result');
    if (resultEl) {
      resultEl.removeAttribute('hidden');
      const payload = event.ok ? event.data : { error: event.error };
      resultEl.textContent = JSON.stringify(payload, null, 2);
    }
  }
  function finishStreaming() {
    if (!streamEl) return;
    streamEl.classList.remove('is-streaming');
    if (streamCursorEl && streamCursorEl.parentNode) {
      streamCursorEl.parentNode.removeChild(streamCursorEl);
    }
    if (streamTextEl) {
      streamTextEl.innerHTML = renderMarkdownLite(streamText);
    }
    state.conductorHistory.push({
      role: 'assistant',
      content: streamText,
      streamed: true
    });
    streamEl = null;
    streamTextEl = null;
    streamCursorEl = null;
    streamText = '';
    streamToolCards.clear();
  }

  function handleEvent(event) {
    switch (event.kind) {
      case 'ready':
        setConnState('live');
        return;
      case 'pong':
        return;
      case 'thinking':
        setStreaming(true);
        return;
      case 'user-message': {
        const cid = event.message && event.message.clientMessageId;
        if (cid && seen.has(cid)) return;
        appendMessageToBody(body, event.message);
        return;
      }
      // Streaming LoopEvents — render incrementally.
      case 'turn-start':
        ensureStreamBubble();
        return;
      case 'text-start':
        ensureStreamBubble();
        return;
      case 'text-delta':
        appendDelta(event.text || '');
        return;
      case 'text-stop':
        return;
      case 'tool-use-start':
        startToolCard(event);
        return;
      case 'tool-use-input':
        // Streaming input args — we render at -stop, not per partial.
        return;
      case 'tool-use-stop':
        completeToolInput(event);
        return;
      case 'tool-result':
        finishToolCard(event);
        return;
      case 'tool-held':
        // Selective mode held a dangerous skill — surface as a card. Rare
        // in execute mode (which runs end-to-end).
        return;
      case 'turn-stop':
        return;
      case 'loop-done':
        // The streaming loop ended — finalize the bubble.
        if (event.finalText && !streamText) {
          streamText = event.finalText;
          if (streamTextEl) streamTextEl.textContent = streamText;
        }
        finishStreaming();
        return;
      case 'assistant-message':
        // For non-streaming (plan) mode, this is the whole reply.
        // For streaming (execute) mode, finishStreaming() already pushed
        // history; skip if we just finished a stream.
        if (streamEl) finishStreaming();
        if (!event.message || !event.message.streamed) {
          appendMessageToBody(body, event.message);
        }
        return;
      case 'halted':
        if (streamEl) {
          streamEl.classList.add('is-halted');
          finishStreaming();
        }
        return;
      case 'error':
        if (streamEl) finishStreaming();
        appendMessageToBody(body, {
          role: 'assistant',
          content: '⚠ ' + (event.message || 'something went wrong')
        });
        return;
      case 'complete':
        setStreaming(false);
        return;
    }
  }

  open();

  return {
    send(payload) {
      const frame = JSON.stringify({ kind: 'user-message', ...payload });
      setStreaming(true);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      } else {
        queue.push(frame);
        if (!ws && !reconnectTimer) open();
      }
    },
    interrupt() {
      const frame = JSON.stringify({ kind: 'interrupt' });
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
    },
    markSeen(cid) { if (cid) seen.add(cid); },
    close() {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    },
    debug: () => ({ sessionName, ws: ws && ws.readyState, queueDepth: queue.length, seen: seen.size })
  };
}

function renderMarkdownLite(src) {
  let out = escapeHtml(src);
  out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  return out;
}

/* ---------------- plugins ---------------- */
async function renderPlugins() {
  $('#view').appendChild($('#tpl-plugins').content.cloneNode(true));
  const rows = state.plugins.map((p) => \`
    <tr>
      <td class="mono"><strong>\${escapeHtml(p.id)}</strong></td>
      <td class="mono">\${escapeHtml(p.version)}</td>
      <td>\${escapeHtml(p.description)}</td>
      <td>\${(p.capabilities || []).map((c) => '<span class="pill accent">' + escapeHtml(c) + '</span>').join(' ')}</td>
    </tr>
  \`).join('');
  $('#plugins-body').innerHTML = rows || '<tr><td colspan="4" class="mono">no plugins enabled — check ENABLED_PLUGINS in wrangler.toml</td></tr>';
  $('#plugins-count').textContent = state.plugins.length + ' loaded';
}

/* ---------------- skills ---------------- */
async function renderSkills() {
  $('#view').appendChild($('#tpl-skills').content.cloneNode(true));
  const rows = state.skills.map((s) => \`
    <tr data-skill="\${escapeHtml(s.id)}">
      <td class="mono"><strong>\${escapeHtml(s.id)}</strong></td>
      <td>\${escapeHtml(s.description)}</td>
      <td class="mono">\${escapeHtml(s.pluginId)}</td>
      <td>\${(s.tags || []).map((t) => '<span class="pill muted">' + escapeHtml(t) + '</span>').join(' ')}</td>
      <td><button class="ghost js-run" data-skill="\${escapeHtml(s.id)}">Run</button></td>
    </tr>
  \`).join('');
  $('#skills-body').innerHTML = rows || '<tr><td colspan="5" class="mono">no skills available</td></tr>';
  $('#skills-count').textContent = state.skills.length + ' listed';
  $$('#skills-body .js-run').forEach((btn) => btn.addEventListener('click', () => openSkillRunner(btn.dataset.skill)));
}

function openSkillRunner(skillId) {
  const slot = $('#skill-runner-slot');
  slot.innerHTML = \`
    <div class="panel" style="margin-top: 36px;">
      <div class="panel-header"><span class="h display">Run · \${escapeHtml(skillId)}</span><button class="ghost" id="close-runner">Close</button></div>
      <label class="mono" style="font-size: 11px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase;">input (JSON)</label>
      <textarea id="runner-input" style="width: 100%; min-height: 90px; font-family: 'JetBrains Mono', monospace; font-size: 13px; border: 1px solid var(--rule); padding: 10px; margin: 8px 0;">{}</textarea>
      <button class="ghost" id="runner-go">Execute</button>
      <pre class="run-output hidden" id="runner-output"></pre>
    </div>
  \`;
  $('#close-runner').addEventListener('click', () => slot.innerHTML = '');
  $('#runner-go').addEventListener('click', async () => {
    const out = $('#runner-output');
    out.classList.remove('hidden', 'err');
    out.textContent = 'Running…';
    let input;
    try { input = JSON.parse($('#runner-input').value || '{}'); }
    catch (e) { out.classList.add('err'); out.textContent = 'Invalid JSON: ' + e.message; return; }
    const r = await j('/skills/invoke/' + encodeURIComponent(skillId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input })
    });
    if (!r.data?.ok) out.classList.add('err');
    out.textContent = JSON.stringify(r.data, null, 2);
  });
}

/* ---------------- sessions ---------------- */
async function renderSessions() {
  $('#view').appendChild($('#tpl-sessions').content.cloneNode(true));
  const out = $('#session-output');
  const name = () => $('#session-name').value.trim();
  const show = async (path) => {
    const n = name();
    if (!n) { alert('session name required'); return; }
    out.style.display = 'block';
    out.textContent = 'Loading…';
    const r = await j('/sessions/' + encodeURIComponent(n) + path);
    out.textContent = JSON.stringify(r.data, null, 2);
  };
  $('#session-describe').addEventListener('click', () => show(''));
  $('#session-tree').addEventListener('click', () => show('/tree'));
  $('#session-fibers').addEventListener('click', () => show('/fibers'));
}

/* ---------------- providers ---------------- */
async function renderProviders() {
  $('#view').appendChild($('#tpl-providers').content.cloneNode(true));

  const providerMetadata = [
    {
      id: 'cf-ai-gateway',
      ref: '§07.1',
      title: 'Cloudflare AI Gateway',
      subtitle: '23+ providers behind one binding — BYOK via Secrets Store, cached, observed, metered.',
      statusSkill: 'cf-gateway-status',
      setup: 'Create a gateway at dash → AI → AI Gateway.\\nSet AI_GATEWAY_ID and CLOUDFLARE_ACCOUNT_ID.\\nAdd provider keys to Secrets Store.\\nCall with model "provider/model-name".'
    },
    {
      id: 'workers-ai',
      ref: '§07.2',
      title: 'Workers AI (direct)',
      subtitle: 'Cloudflare-hosted models through env.AI. Free tier available.',
      statusSkill: 'ai-status',
      setup: 'Add [ai] binding = "AI" in wrangler.toml.\\nNo secrets required for baseline models.'
    },
    {
      id: 'anthropic',
      ref: '§07.3',
      title: 'Anthropic (direct)',
      subtitle: 'Claude Messages API — bypasses CF AI Gateway. Use when you need the raw path.',
      setup: 'wrangler secret put ANTHROPIC_API_KEY\\nAdd api.anthropic.com to ALLOWED_HOSTS.'
    },
    {
      id: 'openai-compatible',
      ref: '§07.4',
      title: 'OpenAI-compatible (direct)',
      subtitle: 'Groq, Together, Ollama, any endpoint speaking OpenAI chat/completions.',
      setup: 'wrangler secret put OPENAI_COMPATIBLE_URL (and ...KEY if needed).\\nAdd hostname to ALLOWED_HOSTS.'
    },
    {
      id: 'codex',
      ref: '§07.5',
      title: 'Codex / ChatGPT',
      subtitle: 'OpenAI API key OR ChatGPT subscription via pasted tokens. OAuth device-code flow scaffolded.',
      statusSkill: 'codex-status',
      setup: "Option A — wrangler secret put OPENAI_API_KEY (classic).\\nOption B — run codex login locally, paste CODEX_ACCESS_TOKEN + CODEX_ID_TOKEN from ~/.codex/auth.json.\\nOption C (roadmap) — POST /oauth/codex/device/start."
    }
  ];

  const enabledIds = new Set(state.plugins.map((p) => p.id));
  const body = $('#providers-body');
  body.innerHTML = '';
  for (const meta of providerMetadata) {
    const enabled = enabledIds.has(meta.id);
    const card = document.createElement('div');
    card.className = 'provider-card' + (enabled ? ' active' : '');
    card.dataset.ref = meta.ref;
    card.innerHTML = \`
      <div class="title"><span>\${escapeHtml(meta.title)}</span>
        <span class="pill \${enabled ? 'ok' : 'muted'}">\${enabled ? 'enabled' : 'not enabled'}</span>
      </div>
      <div class="subtitle">\${escapeHtml(meta.subtitle)}</div>
      <div class="indicators"></div>
      <div class="setup">\${escapeHtml(meta.setup)}</div>
    \`;
    const indicators = card.querySelector('.indicators');
    if (enabled && meta.statusSkill) {
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = 'Probe';
      btn.style.fontSize = '10px';
      btn.addEventListener('click', async () => {
        btn.textContent = '…';
        const r = await j('/skills/invoke/' + meta.statusSkill, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        });
        btn.textContent = r.data?.ok ? 'ok' : 'err';
        const detail = document.createElement('pre');
        detail.className = 'payload mono';
        detail.style.marginTop = '8px';
        detail.style.fontSize = '11px';
        detail.style.color = 'var(--muted)';
        detail.textContent = JSON.stringify(r.data?.data ?? r.data, null, 2);
        card.appendChild(detail);
      });
      indicators.appendChild(btn);
    } else if (enabled) {
      indicators.innerHTML = '<span class="pill ok">ready</span>';
    } else {
      indicators.innerHTML = '<span class="pill muted">add plugin id to ENABLED_PLUGINS</span>';
    }
    body.appendChild(card);
  }

  const catalog = $('#providers-catalog');
  catalog.innerHTML = '';
  const gatewayEnabled = enabledIds.has('cf-ai-gateway');
  if (!gatewayEnabled) {
    catalog.innerHTML = '<div class="mono" style="color: var(--muted)">enable cf-ai-gateway to see the catalog</div>';
  } else {
    const r = await j('/skills/invoke/cf-gateway-list-providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    const providers = r.data?.data?.data?.providers ?? r.data?.data?.providers ?? [];
    if (!providers.length) {
      catalog.innerHTML = '<div class="mono" style="color: var(--muted)">no providers reported</div>';
    } else {
      for (const p of providers) {
        const entry = document.createElement('div');
        entry.className = 'entry';
        entry.textContent = p;
        catalog.appendChild(entry);
      }
    }
  }

  $('#providers-refresh').addEventListener('click', async () => {
    await bootData();
    renderProviders();
  });
}

/* ---------------- settings ---------------- */

/* ---------------- secrets manager ---------------- */
async function mountSecretsManager() {
  const card = document.getElementById('secrets-card');
  if (!card) return;
  const container = document.getElementById('secrets-groups');
  const status = document.getElementById('secrets-status');
  const errEl = document.getElementById('secrets-error');

  function showError(msg) {
    errEl.textContent = msg;
    errEl.removeAttribute('hidden');
    setTimeout(() => errEl.setAttribute('hidden', ''), 8000);
  }

  async function load() {
    try {
      const r = await j('/setup/secrets');
      const slots = r.data?.data?.slots ?? [];
      const configured = slots.filter((s) => s.configured).length;
      status.textContent = configured + ' / ' + slots.length + ' configured';
      // Group + render.
      const groups = {
        auth: { label: 'Auth + identity', slots: [] },
        cf: { label: 'Cloudflare infra', slots: [] },
        providers: { label: 'Model providers', slots: [] },
        persistence: { label: 'Persistence + R2', slots: [] },
        'pa-stack': { label: 'PA stack (memory, push, schedule)', slots: [] }
      };
      for (const s of slots) {
        if (groups[s.group]) groups[s.group].slots.push(s);
      }
      container.innerHTML = '';
      for (const key of Object.keys(groups)) {
        const g = groups[key];
        if (g.slots.length === 0) continue;
        const block = document.createElement('div');
        block.className = 'secrets-group';
        block.innerHTML = '<div class="secrets-group-title mono">' + escapeHtml(g.label) + '</div>';
        const grid = document.createElement('div');
        grid.className = 'secrets-grid';
        for (const s of g.slots) {
          const row = document.createElement('div');
          row.className = 'secret-row' + (s.configured ? ' is-set' : '');
          const docs = s.docsUrl
            ? ' · <a href="' + escapeHtml(s.docsUrl) + '" target="_blank" rel="noopener">where do I get this? ↗</a>'
            : '';
          const allowedHost = s.allowedHost
            ? ' · adds <span class="mono">' + escapeHtml(s.allowedHost) + '</span> to ALLOWED_HOSTS'
            : '';
          row.innerHTML =
            '<div class="secret-name mono">' + escapeHtml(s.name) +
              ' <span class="secret-state">' + (s.configured ? 'set' : 'unset') + '</span></div>' +
            '<div class="secret-hint">' + escapeHtml(s.hint) + allowedHost + docs + '</div>' +
            '<div class="secret-input-row">' +
              '<input type="' + (s.secret ? 'password' : 'text') + '" class="secret-input" data-name="' + escapeHtml(s.name) + '" placeholder="' + escapeHtml(s.placeholder || (s.configured ? '(currently set — paste new value to rotate)' : '')) + '" autocomplete="off" spellcheck="false">' +
              '<button class="ghost secret-save" data-name="' + escapeHtml(s.name) + '">Save</button>' +
              (s.deletable && s.configured ? '<button class="ghost secret-delete" data-name="' + escapeHtml(s.name) + '">Clear</button>' : '') +
            '</div>';
          grid.appendChild(row);
        }
        block.appendChild(grid);
        container.appendChild(block);
      }

      // Wire save buttons.
      container.querySelectorAll('.secret-save').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name;
          const inp = container.querySelector('input[data-name="' + name + '"]');
          const value = (inp.value || '').trim();
          if (!value) { showError('paste a value first for ' + name); inp.focus(); return; }
          btn.disabled = true;
          const orig = btn.textContent;
          btn.textContent = 'Saving…';
          try {
            const r = await j('/setup/secrets/' + encodeURIComponent(name), {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ value })
            });
            if (r.data?.ok === false) {
              showError(r.data?.error || 'failed');
            } else {
              btn.textContent = 'Saved ✓';
              inp.value = '';
              setTimeout(() => { btn.textContent = orig; btn.disabled = false; load(); }, 1500);
              return;
            }
          } catch (e) {
            showError(String(e.message || e));
          }
          btn.textContent = orig;
          btn.disabled = false;
        });
      });
      // Wire delete buttons.
      container.querySelectorAll('.secret-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name;
          if (!confirm('Clear ' + name + '? The Worker will redeploy without this secret.')) return;
          btn.disabled = true;
          try {
            await j('/setup/secrets/' + encodeURIComponent(name), { method: 'DELETE' });
            load();
          } catch (e) {
            showError(String(e.message || e));
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      status.textContent = 'load failed';
      showError(String(err.message || err));
    }
  }

  load();
}

/* ---------------- lock-it-down wizard ---------------- */
async function mountLockdownWizard() {
  const card = document.getElementById('lockdown-card');
  if (!card) return;

  // Discover initial state — host, script name, whether auth is already on.
  let discover;
  try {
    const r = await j('/setup/access/discover');
    discover = r.data?.data;
    if (!discover) return;
  } catch {
    return;
  }

  // If auth is already configured, render the slim "✓ strict mode" summary
  // card and bail. The user doesn't need the wizard.
  if (discover.authConfigured) {
    card.classList.add('is-strict');
    document.getElementById('lockdown-status').textContent = 'strict';
    document.getElementById('lockdown-form').innerHTML = \`
      <div class="lockdown-strict-summary">
        <div class="lockdown-strict-mark">✓</div>
        <div class="lockdown-strict-text">
          Cloudflare Access is gating <span class="mono">\${escapeHtml(discover.workerHost)}</span>.
          <span class="mono">CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD set · auth_mode = strict</span>
        </div>
      </div>
    \`;
    card.querySelector('.panel-header .h').textContent = '✓ Auth · locked down';
    card.style.display = '';
    return;
  }

  // Otherwise, show the wizard form.
  card.style.display = '';

  const els = {
    email: document.getElementById('ld-email'),
    emailHint: document.getElementById('ld-email-hint'),
    token: document.getElementById('ld-token'),
    tokenRow: document.getElementById('ld-token-row'),
    tokenPrefilled: document.getElementById('ld-token-prefilled'),
    tokenLink: document.getElementById('ld-token-link'),
    instructions: document.getElementById('ld-instructions'),
    stepLink: document.getElementById('ld-step-link'),
    copyScopes: document.getElementById('ld-copy-scopes'),
    useDifferent: document.getElementById('ld-use-different'),
    accountRow: document.getElementById('ld-account-row'),
    account: document.getElementById('ld-account'),
    hostDisplay: document.getElementById('ld-host-display'),
    scriptDisplay: document.getElementById('ld-script-display'),
    submit: document.getElementById('ld-submit'),
    submitText: document.querySelector('#ld-submit .lockdown-btn-text'),
    dismiss: document.getElementById('ld-dismiss'),
    error: document.getElementById('ld-error'),
    form: document.getElementById('lockdown-form'),
    progress: document.getElementById('lockdown-progress'),
    success: document.getElementById('lockdown-success'),
    failure: document.getElementById('lockdown-failure'),
    failureReason: document.getElementById('ld-failure-reason'),
    failureRecovery: document.getElementById('ld-failure-recovery'),
    refresh: document.getElementById('ld-refresh'),
    retry: document.getElementById('ld-retry'),
    appLink: document.getElementById('ld-app-link'),
    scopes: document.getElementById('ld-scopes')
  };

  els.tokenLink.href = discover.tokenUrl;
  if (els.stepLink) els.stepLink.href = discover.tokenUrl;
  els.hostDisplay.textContent = discover.workerHost || '—';
  els.scriptDisplay.textContent = discover.scriptName || 'helm';
  els.scopes.innerHTML = (discover.scopes || [])
    .map((s) => '<li>' + escapeHtml(s.resource) + ' · ' + escapeHtml(s.permission) + '</li>')
    .join('');

  // Adapt to prefill state.
  // hasExistingToken=true: hide token field + instructions, show prefilled banner.
  // prefilledOwnerEmail set: pre-fill the email field.
  // Both true: button is enabled immediately, label changes to "Lock it down · 1 click".
  let usingExistingToken = Boolean(discover.hasExistingToken);
  if (usingExistingToken) {
    els.tokenRow.style.display = 'none';
    els.instructions.style.display = 'none';
    els.tokenPrefilled.removeAttribute('hidden');
  }
  if (discover.prefilledOwnerEmail) {
    els.email.value = discover.prefilledOwnerEmail;
    els.emailHint.innerHTML = 'Pre-filled from <span class="mono">env.OWNER_EMAIL</span>. Edit if you want a different address.';
  }
  if (usingExistingToken && discover.prefilledOwnerEmail) {
    els.submitText.textContent = 'Lock it down · 1 click';
    // Both pre-set: also expose the dedicated one-click panel that uses
    // /setup/auto (skips account picker + email entry entirely). The
    // legacy form-based path stays available behind "Use the form".
    const autoCard = document.getElementById('lockdown-autosetup');
    if (autoCard) {
      autoCard.removeAttribute('hidden');
      els.form.setAttribute('hidden', '');
    }
    const autoFallback = document.getElementById('ld-auto-fallback');
    if (autoFallback) {
      autoFallback.addEventListener('click', () => {
        if (autoCard) autoCard.setAttribute('hidden', '');
        els.form.removeAttribute('hidden');
      });
    }
    const autoBtn = document.getElementById('ld-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', async () => {
        autoBtn.disabled = true;
        const origText = autoBtn.querySelector('.lockdown-btn-text').textContent;
        autoBtn.querySelector('.lockdown-btn-text').textContent = 'Setting up…';
        try {
          // Switch to progress UI immediately so user sees motion.
          if (autoCard) autoCard.setAttribute('hidden', '');
          els.progress.removeAttribute('hidden');
          setStepState('preflight', 'is-running');
          const r = await j('/setup/auto', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
          });
          const data = r.data?.data ?? r.data ?? r;
          // Mark preflight + team-domain done if lockdown ran.
          setStepState('preflight', 'is-done');
          const ld = data?.lockdown ?? {};
          (ld.steps || []).forEach((s) => setStepState(s.kind, s.ok ? 'is-done' : 'is-failed', s.error));
          if (!ld.ok) {
            showFailure(ld.error || 'auto-setup failed', ld.recovery || 'See steps above.');
            return;
          }
          setStepState('verify-strict', 'is-running', 'Worker redeploying…');
          const okStrict = await pollForStrictMode();
          setStepState('verify-strict', okStrict ? 'is-done' : 'is-failed',
            okStrict ? null : 'still in progress — refresh in a moment');
          showSuccess(ld);
          // If /setup/auto created a bucket but env.WORKSPACE binding
          // isn't wired, offer a one-click "patch live Worker" button.
          const r2Step = (data?.nextSteps || []).find((s) => /\\[\\[r2_buckets\\]\\]/.test(s.label));
          const bucketName = data?.extras?.find((e) => e.kind === 'create-r2-bucket')?.detail?.match(/"([^"]+)"/)?.[1];
          if (r2Step && !r2Step.done && bucketName) {
            const successPanel = $('#lockdown-success');
            const banner = document.createElement('div');
            banner.className = 'lockdown-prefilled';
            banner.style.marginTop = '18px';
            banner.innerHTML =
              '<div class="lockdown-prefilled-mark">⚡</div>' +
              '<div class="lockdown-prefilled-text">' +
              '  <strong>One last thing — wire R2 binding</strong>' +
              '  <span>Bucket <span class="mono">' + escapeHtml(bucketName) + '</span> exists, but the live Worker has no <span class="mono">env.WORKSPACE</span> binding to it. Patch it now (overwritten on next <span class="mono">wrangler deploy</span> unless you also commit the [[r2_buckets]] block to wrangler.toml).</span>' +
              '  <div style="margin-top: 12px; display: flex; gap: 10px; align-items: center;">' +
              '    <button id="r2-patch-btn" class="lockdown-btn lockdown-btn-primary"><span class="lockdown-btn-text">Patch live Worker</span><span class="lockdown-btn-arrow">⚡</span></button>' +
              '    <span class="mono" style="font-size: 11px; color: var(--muted);">or copy the snippet from the success panel</span>' +
              '  </div>' +
              '  <div id="r2-patch-result" class="mono" style="margin-top: 10px; font-size: 12px; color: var(--muted);"></div>' +
              '</div>';
            successPanel.appendChild(banner);
            $('#r2-patch-btn').addEventListener('click', async () => {
              const btn = $('#r2-patch-btn');
              const out = $('#r2-patch-result');
              btn.disabled = true;
              btn.querySelector('.lockdown-btn-text').textContent = 'Patching…';
              try {
                const r = await j('/setup/r2/bind', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ bucketName })
                });
                const d = r.data?.data ?? r.data ?? r;
                if (d?.ok === false) {
                  out.innerHTML = '<span style="color: #c0392b;">' + escapeHtml(d.error || 'patch failed') + '</span>';
                } else {
                  out.innerHTML = '<span style="color: #2d8c4f;">✓ binding patched onto live Worker. Reload in ~10s.</span>';
                  btn.querySelector('.lockdown-btn-text').textContent = 'Patched ✓';
                }
              } catch (err) {
                out.innerHTML = '<span style="color: #c0392b;">' + escapeHtml(String(err.message || err)) + '</span>';
                btn.querySelector('.lockdown-btn-text').textContent = 'Patch live Worker';
                btn.disabled = false;
              }
            });
          }
        } catch (err) {
          showFailure(
            'auto-setup failed',
            String(err && err.message ? err.message : err) +
              ' · You can fall back to the form below.'
          );
          if (autoCard) autoCard.removeAttribute('hidden');
          els.progress.setAttribute('hidden', '');
        } finally {
          autoBtn.disabled = false;
          autoBtn.querySelector('.lockdown-btn-text').textContent = origText;
        }
      });
    }
  }

  // "Paste a different one instead" — flip back to manual mode.
  if (els.useDifferent) {
    els.useDifferent.addEventListener('click', (e) => {
      e.preventDefault();
      usingExistingToken = false;
      els.tokenPrefilled.setAttribute('hidden', '');
      els.tokenRow.style.display = '';
      els.instructions.style.display = '';
      els.token.focus();
      refreshSubmitState();
    });
  }

  // Copy scope names button — pasteable into CF dash's permission search.
  if (els.copyScopes) {
    els.copyScopes.addEventListener('click', async () => {
      const scopeNames = (discover.scopes || [])
        .map((s) => s.permission)
        .join('\\n');
      try {
        await navigator.clipboard.writeText(scopeNames);
        const orig = els.copyScopes.textContent;
        els.copyScopes.textContent = 'Copied ✓';
        els.copyScopes.classList.add('is-copied');
        setTimeout(() => {
          els.copyScopes.textContent = orig;
          els.copyScopes.classList.remove('is-copied');
        }, 2000);
      } catch {
        els.copyScopes.textContent = 'Copy failed';
      }
    });
  }

  let preflightCache = null; // cached preflight result for current token

  // Validate inputs + cache preflight on token paste/blur.
  function valid() {
    const email = (els.email.value || '').trim();
    if (!email || !email.includes('@')) return false;
    if (!usingExistingToken) {
      const token = (els.token.value || '').trim();
      if (!token) return false;
    }
    return true;
  }
  function refreshSubmitState() { els.submit.disabled = !valid(); }
  els.email.addEventListener('input', refreshSubmitState);
  els.token.addEventListener('input', () => {
    preflightCache = null;
    refreshSubmitState();
  });
  // Initial state — if both prefilled, button is live immediately.
  refreshSubmitState();

  // Preflight the token. When usingExistingToken=true we send no token in
  // the body — the server falls back to env.CLOUDFLARE_API_TOKEN.
  async function preflight(accountIdOverride) {
    const tokenVal = (els.token.value || '').trim();
    if (!usingExistingToken && !tokenVal) return null;
    const accountIdForProbe = accountIdOverride || els.account.value || null;
    const cacheKey = (usingExistingToken ? '__env__' : tokenVal) + ':' + (accountIdForProbe || '');
    if (preflightCache && preflightCache.key === cacheKey) return preflightCache.data;
    els.submit.disabled = true;
    const reqBody = usingExistingToken ? {} : { token: tokenVal };
    if (accountIdForProbe) reqBody.accountId = accountIdForProbe;
    const r = await j('/setup/access/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reqBody)
    });
    refreshSubmitState();
    if (!r.data?.ok) {
      showError(r.data?.error || 'token check failed');
      if (!usingExistingToken) els.token.classList.add('is-invalid');
      return null;
    }
    if (!usingExistingToken) els.token.classList.remove('is-invalid');
    hideError();
    const data = r.data.data;
    preflightCache = { key: cacheKey, data };
    // Show account picker only when >1.
    els.account.innerHTML = '';
    for (const a of (data.accounts || [])) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + '  (' + a.id.slice(0, 8) + '…)';
      els.account.appendChild(opt);
    }
    els.accountRow.style.display = data.accounts.length > 1 ? '' : 'none';
    // Render scope-probe results inline so the user sees missing scopes
    // BEFORE submit. Each scope is a small status pill: ✓ ok / ✗ failed.
    renderScopeProbe(data.scopes || []);
    return data;
  }
  els.token.addEventListener('blur', () => { preflight(); });
  // Re-probe when the user picks a different account (multi-account case).
  els.account.addEventListener('change', () => {
    preflightCache = null;
    preflight(els.account.value);
  });

  function renderScopeProbe(scopes) {
    let host = document.getElementById('ld-scope-probe');
    if (!host) {
      // Lazy-create the host directly above the submit row.
      host = document.createElement('div');
      host.id = 'ld-scope-probe';
      host.className = 'lockdown-scope-probe';
      const actions = document.querySelector('.lockdown-actions');
      if (actions && actions.parentNode) {
        actions.parentNode.insertBefore(host, actions);
      }
    }
    if (!scopes || scopes.length === 0) {
      host.innerHTML = '';
      return;
    }
    const allOk = scopes.every((s) => s.ok);
    const titleClass = allOk ? 'ok' : 'fail';
    const items = scopes.map((s) => {
      const icon = s.ok ? '✓' : '✗';
      const cls = s.ok ? 'ok' : 'fail';
      const err = s.ok ? '' : ' <span class="lockdown-scope-err">' + escapeHtml(s.error || '') + '</span>';
      return '<li class="' + cls + '"><span class="ic">' + icon + '</span>' + escapeHtml(s.scope) + err + '</li>';
    }).join('');
    host.innerHTML =
      '<div class="lockdown-scope-title ' + titleClass + '">' +
        (allOk ? '✓ Token scopes look good' : '✗ Token is missing one or more scopes for this account') +
      '</div>' +
      '<ul class="lockdown-scope-list">' + items + '</ul>' +
      (allOk ? '' :
        '<p class="lockdown-scope-hint">' +
          'Two likely causes: (a) you didn\\'t include the failing permission group ' +
          'when creating the token, OR (b) the token\\'s "Account Resources" filter ' +
          'excludes this account. Re-create with the wizard\\'s pre-filled link and ' +
          'set Account Resources → All accounts.' +
        '</p>');
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.removeAttribute('hidden');
  }
  function hideError() { els.error.setAttribute('hidden', ''); }

  // Submit — preflight (if not already), then run lockdown, stream step results.
  els.submit.addEventListener('click', async () => {
    if (!valid()) return;
    hideError();

    // Make sure we have an account id.
    const pre = await preflight();
    if (!pre) return;
    const accountId = els.account.value || pre.accounts[0]?.id;
    if (!accountId) {
      showError('no account selected');
      return;
    }

    // Switch UI → progress.
    els.form.setAttribute('hidden', '');
    els.progress.removeAttribute('hidden');

    setStepState('preflight', 'is-done');  // already done — token is verified
    setStepState('team-domain', 'is-running');

    const allowedEmails = (els.email.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let result;
    try {
      // When usingExistingToken, omit token from body — server uses env.
      const reqBody = {
        accountId,
        scriptName: discover.scriptName || undefined,
        allowedEmails
      };
      if (!usingExistingToken) {
        reqBody.token = els.token.value.trim();
      }
      const r = await j('/setup/access/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      result = r.data;
    } catch (err) {
      showFailure('network error', String(err && err.message ? err.message : err));
      return;
    }

    // Animate the steps in based on the response.
    const steps = (result?.data?.steps || result?.steps || []);
    for (const s of steps) {
      setStepState(s.kind, s.ok ? 'is-done' : 'is-failed', s.error);
    }

    if (!result?.ok) {
      showFailure(
        result?.error || 'lockdown failed',
        result?.recovery || 'See the steps above for which call failed.'
      );
      return;
    }

    // Now poll /health for auth_mode flip — Worker is auto-redeploying.
    setStepState('verify-strict', 'is-running', 'Worker is redeploying…');
    const ok = await pollForStrictMode();
    setStepState('verify-strict', ok ? 'is-done' : 'is-failed',
      ok ? null : 'still in progress — refresh in a moment');

    // Show success regardless — even if poll timed out, the secrets are set.
    showSuccess(result?.data || result);
  });

  function setStepState(kind, klass, errMsg) {
    const li = document.querySelector('.lockdown-steps li[data-step="' + kind + '"]');
    if (!li) return;
    li.classList.remove('is-running', 'is-done', 'is-failed');
    li.classList.add(klass);
    if (errMsg) {
      const labelEl = li.querySelector('.ld-label');
      if (labelEl && !labelEl.dataset.original) labelEl.dataset.original = labelEl.textContent;
      labelEl.textContent = (labelEl.dataset.original || labelEl.textContent) + ' · ' + errMsg;
    }
  }

  async function pollForStrictMode() {
    const deadline = Date.now() + 60_000; // 60s budget
    while (Date.now() < deadline) {
      try {
        const r = await fetch('/health');
        const d = await r.json();
        // /setup/status is more accurate; check the auth capability there.
        const s = await fetch('/setup/status');
        const sd = await s.json();
        const auth = sd?.data?.capabilities?.find((c) => c.id === 'auth');
        if (auth?.configured) return true;
        // Fallback: also accept presence of CF_ACCESS_AUD via the health response if exposed.
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  }

  function showSuccess(result) {
    els.progress.setAttribute('hidden', '');
    els.success.removeAttribute('hidden');
    card.classList.add('is-strict');
    document.getElementById('lockdown-status').textContent = 'strict';
    card.querySelector('.panel-header .h').textContent = '✓ Auth · locked down';
  }

  function showFailure(reason, recovery) {
    els.progress.setAttribute('hidden', '');
    els.failure.removeAttribute('hidden');
    // Show the actual reason verbatim — no "user-friendly" rewrites that
    // mask the real Cloudflare API error.
    els.failureReason.textContent = reason;
    // Recovery may have multiple lines (we use \\n in classifyApiFailure);
    // preserve them as a <pre>-style block so step-by-step text is readable.
    els.failureRecovery.style.whiteSpace = 'pre-wrap';
    els.failureRecovery.style.fontFamily = "'JetBrains Mono', monospace";
    els.failureRecovery.style.fontSize = '13px';
    els.failureRecovery.textContent = recovery;
  }

  els.refresh.addEventListener('click', () => location.reload());
  els.retry.addEventListener('click', () => {
    els.failure.setAttribute('hidden', '');
    els.form.removeAttribute('hidden');
    // Reset progress markers
    document.querySelectorAll('.lockdown-steps li').forEach((li) => {
      li.classList.remove('is-running', 'is-done', 'is-failed');
      const labelEl = li.querySelector('.ld-label');
      if (labelEl && labelEl.dataset.original) labelEl.textContent = labelEl.dataset.original;
    });
  });

  els.dismiss.addEventListener('click', () => {
    card.style.display = 'none';
  });
}

async function renderSettings() {
  $('#view').appendChild($('#tpl-settings').content.cloneNode(true));

  // ---- Lock-it-down wizard (top of Settings tab) ----
  // Shows a card iff auth.configured === false. Walks the user through
  // creating a Cloudflare Access app + policy + persisting CF_ACCESS_*
  // secrets, all from a single token paste.
  await mountLockdownWizard();

  // ---- Secrets manager ----
  await mountSecretsManager();

  async function loadStatus() {
    const r = await j('/setup/status');
    const data = r.data?.data;
    if (!data) return;

    $('#readiness-bar').style.width = data.readinessScore + '%';
    $('#readiness-score').textContent = data.readinessScore + '% ready · MCP ' + (data.mcpBridge.configured ? 'connected · ' + (data.mcpBridge.provider || 'custom') : 'not configured');

    const recEl = $('#recommended');
    if (!data.recommended || !data.recommended.length) {
      recEl.innerHTML = '<div class="item" style="border-color: var(--ok); background: rgba(45,92,62,0.06); color: var(--ok);">◆ Runtime looks ready — ask the Conductor what to build next.</div>';
    } else {
      recEl.innerHTML = data.recommended.map((r) => '<div class="item">→ ' + escapeHtml(r) + '</div>').join('');
    }

    const body = $('#capabilities-body');
    body.innerHTML = '';
    for (const c of (data.capabilities || [])) {
      const status = c.configured ? 'configured' : c.enabled ? 'missing' : 'off';
      const statusLabel = c.configured ? 'configured' : c.enabled ? 'missing config' : 'disabled';
      const statusClass = c.configured ? 'ok' : c.enabled ? 'warn' : 'muted';
      const card = document.createElement('div');
      card.className = 'capability-card ' + status;
      card.innerHTML = \`
        <div class="c-title">
          <span>\${escapeHtml(c.label)}</span>
          <span class="pill \${statusClass}">\${statusLabel}</span>
        </div>
        \${c.missing && c.missing.length ? '<div class="c-missing">missing: ' + c.missing.map(escapeHtml).join(', ') + '</div>' : ''}
        <div class="c-hint">\${escapeHtml(c.hint)}</div>
        \${c.docs ? '<div class="mono" style="font-size: 10px; color: var(--muted);">→ ' + escapeHtml(c.docs) + '</div>' : ''}
      \`;
      body.appendChild(card);
    }

    return data;
  }

  const status = await loadStatus();

  $('#capabilities-refresh').addEventListener('click', () => loadStatus());

  // Snippet picker
  const picker = $('#snippet-picker');
  const pluginOptions = [
    'cf-ai-gateway',
    'anthropic',
    'openai-compatible',
    'codex',
    'mcp-client',
    'browser',
    'sandbox',
    'artifacts'
  ];
  picker.innerHTML = pluginOptions
    .map((p) => \`<label><input type="checkbox" value="\${p}"> \${p}</label>\`)
    .join('');

  async function updateSnippet() {
    const selected = Array.from(picker.querySelectorAll('input:checked')).map((el) => el.value);
    if (selected.length === 0) {
      $('#snippet-wrangler').textContent = '(select at least one plugin)';
      $('#snippet-envvars').textContent = '(select at least one plugin)';
      $('#snippet-notes').textContent = '';
      return;
    }
    const r = await j('/setup/snippet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enablePlugins: selected })
    });
    const data = r.data?.data;
    if (!data) return;
    $('#snippet-wrangler').textContent = data.wrangler || '';
    $('#snippet-envvars').textContent = data.devVars || '';
    $('#snippet-notes').textContent = (data.notes || []).map((n) => '• ' + n).join('\\n');
  }

  picker.addEventListener('change', updateSnippet);

  // "Ask Helm to set me up" — curated one-click variant of the guided
  // setup flow. Same backend, just a tighter prompt that drives cf-admin
  // skills explicitly so the user doesn't have to think of the goal.
  const askBtn = $('#ask-helm-go');
  if (askBtn) {
    askBtn.addEventListener('click', async () => {
      const out = $('#ask-helm-result');
      const origText = askBtn.querySelector('.lockdown-btn-text').textContent;
      askBtn.disabled = true;
      askBtn.querySelector('.lockdown-btn-text').textContent = 'Priming Helm…';
      out.textContent = '';
      try {
        const goal = [
          'Set me up. Use the cloudflare-admin plugin skills to:',
          '1. Verify CLOUDFLARE_API_TOKEN works (cf-verify)',
          '2. List my accounts and pick one (cf-list-accounts)',
          '3. Check what already exists (cf-list-d1, cf-list-r2, cf-list-access-apps)',
          '4. Propose the SMALLEST set of cf-create-* / cf-put-secret calls to reach',
          '   a fully-configured state: D1 for PA stack, R2 bucket for /persist,',
          '   Access app for auth, HELM_INTERNAL_TOKEN for the in-shell helm REPL.',
          '5. Surface every mutation as an exhibit card before running.',
          'Stop after each major step and ask if I want to continue.'
        ].join('\\n');
        const r = await j('/setup/guided-start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goal, bringCloudflareMcp: true })
        });
        const data = r.data?.data;
        if (!data?.sessionName) {
          out.textContent = 'failed: ' + (r.data?.error || 'unknown');
          askBtn.disabled = false;
          askBtn.querySelector('.lockdown-btn-text').textContent = origText;
          return;
        }
        state.conductorSession = data.sessionName;
        out.innerHTML = '✓ session <span class="mono">' + escapeHtml(data.sessionName) + '</span> primed · jumping to Helm tab…';
        setTimeout(() => { location.hash = '#/conductor?session=' + encodeURIComponent(data.sessionName); }, 600);
      } catch (err) {
        out.textContent = 'failed: ' + String(err.message || err);
        askBtn.disabled = false;
        askBtn.querySelector('.lockdown-btn-text').textContent = origText;
      }
    });
  }

  // Guided start
  $('#setup-start').addEventListener('click', async () => {
    const goal = $('#setup-goal').value.trim() || 'walk me through the recommended minimal setup';
    const btn = $('#setup-start');
    btn.disabled = true;
    btn.textContent = 'Priming Conductor…';
    const result = $('#setup-start-result');
    const r = await j('/setup/guided-start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal })
    });
    btn.disabled = false;
    btn.textContent = 'Start guided setup →';
    const data = r.data?.data;
    if (!data) {
      result.textContent = 'failed: ' + (r.data?.error || 'unknown');
      return;
    }
    state.conductorSession = data.sessionName;
    result.textContent = 'session ' + data.sessionName + ' · recommended mode: ' + data.recommendedMode + ' → jumping to Conductor…';
    setTimeout(() => {
      location.hash = '#/conductor';
    }, 600);
  });

  /* ---------------- web push enable ---------------- */
  const webpushStatus = $('#webpush-status');
  const webpushEnable = $('#webpush-enable');
  const webpushTest = $('#webpush-test');
  const webpushResult = $('#webpush-result');

  function urlB64ToUint8(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function refreshWebpushStatus() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      webpushStatus.textContent = 'unsupported in this browser';
      webpushEnable.disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      webpushStatus.textContent = 'permission denied';
      webpushEnable.disabled = true;
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) {
      webpushStatus.textContent = 'service worker not registered';
      webpushTest.disabled = true;
      return;
    }
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      webpushStatus.textContent = 'subscribed';
      webpushEnable.textContent = 'Re-subscribe';
      webpushTest.disabled = false;
    } else {
      webpushStatus.textContent = 'service worker active, no subscription';
      webpushTest.disabled = true;
    }
  }

  async function enableWebpush() {
    webpushResult.textContent = '';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      webpushResult.textContent = 'browser does not support Web Push';
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        webpushResult.textContent = 'permission ' + perm;
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      const pkResp = await fetch('/webpush/public-key');
      const pkData = await pkResp.json();
      if (!pkData.ok) {
        webpushResult.textContent = 'public key unavailable: ' + (pkData.error || 'unknown');
        return;
      }
      const appKey = urlB64ToUint8(pkData.data.publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });

      const subResp = await fetch('/webpush/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON())
      });
      const subData = await subResp.json();
      if (!subResp.ok || subData.ok === false) {
        webpushResult.textContent = 'subscribe failed: ' + (subData.error || subResp.status);
        return;
      }
      webpushResult.textContent = 'subscribed ✓';
      await refreshWebpushStatus();
    } catch (err) {
      webpushResult.textContent = 'error: ' + (err && err.message ? err.message : String(err));
    }
  }

  async function testWebpush() {
    webpushResult.textContent = '';
    const r = await fetch('/webpush/test', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok !== false) {
      webpushResult.textContent = 'test push fired — check your notification tray';
    } else {
      webpushResult.textContent = 'test failed: ' + (data.error || r.status);
    }
  }

  webpushEnable.addEventListener('click', enableWebpush);
  webpushTest.addEventListener('click', testWebpush);
  refreshWebpushStatus();

  /* ---------------- vapid generator (browser-side) ---------------- */
  const vapidGen = $('#vapid-gen');
  const vapidCopy = $('#vapid-copy');
  const vapidOut = $('#vapid-out');
  const vapidWarn = $('#vapid-warning');

  function b64uEncode(buf) {
    const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str) {
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    const s = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function generateVapidKeys() {
    if (!('subtle' in (crypto || {}))) {
      vapidOut.style.display = 'block';
      vapidOut.textContent = 'SubtleCrypto unavailable in this browser. Use "npm run vapid:generate" from a terminal instead.';
      return;
    }
    vapidGen.disabled = true;
    vapidGen.textContent = 'Generating…';
    try {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );
      const [priv, pub] = await Promise.all([
        crypto.subtle.exportKey('jwk', pair.privateKey),
        crypto.subtle.exportKey('jwk', pair.publicKey)
      ]);
      const x = b64uDecode(pub.x);
      const y = b64uDecode(pub.y);
      const uncompressed = new Uint8Array(65);
      uncompressed[0] = 0x04;
      uncompressed.set(x, 1);
      uncompressed.set(y, 33);
      const publicKey = b64uEncode(uncompressed);
      const privateKey = priv.d;

      const block = [
        '# VAPID keys generated locally — paste into a terminal:',
        '',
        'echo "' + publicKey + '" | wrangler secret put VAPID_PUBLIC_KEY',
        'echo "' + privateKey + '" | wrangler secret put VAPID_PRIVATE_KEY',
        'echo "mailto:you@example.com" | wrangler secret put VAPID_SUBJECT',
        '',
        '# Public key (also exposed at /webpush/public-key after redeploy):',
        publicKey
      ].join('\\n');
      vapidOut.textContent = block;
      vapidOut.style.display = 'block';
      vapidWarn.style.display = 'block';
      vapidCopy.disabled = false;
      vapidCopy.dataset.payload = block;
      vapidGen.textContent = 'Re-generate (overwrites the displayed pair)';
    } catch (err) {
      vapidOut.style.display = 'block';
      vapidOut.textContent = 'generate failed: ' + (err && err.message ? err.message : String(err));
    } finally {
      vapidGen.disabled = false;
    }
  }

  async function copyVapid() {
    const payload = vapidCopy.dataset.payload || vapidOut.textContent;
    try {
      await navigator.clipboard.writeText(payload);
      const prev = vapidCopy.textContent;
      vapidCopy.textContent = 'Copied ✓';
      setTimeout(() => { vapidCopy.textContent = prev; }, 1500);
    } catch (err) {
      vapidCopy.textContent = 'copy failed';
    }
  }

  vapidGen.addEventListener('click', generateVapidKeys);
  vapidCopy.addEventListener('click', copyVapid);
}

/* ---------------- debug ---------------- */
async function renderDebug() {
  $('#view').appendChild($('#tpl-debug').content.cloneNode(true));
  const stats = $('#debug-stats');
  const out = $('#debug-output');
  const refresh = async () => {
    out.classList.remove('err');
    out.textContent = 'Loading…';
    const [m, h] = await Promise.all([j('/metrics'), j('/skills/invoke/admin-health-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })]);
    const metrics = m.data?.data?.metrics ?? {};
    stats.innerHTML = \`
      <div class="stat"><div class="label">Requests</div><div class="value">\${metrics.requestsTotal ?? 0}</div><div class="footnote">total</div></div>
      <div class="stat"><div class="label">Errors</div><div class="value">\${metrics.errorsTotal ?? 0}</div><div class="footnote">total</div></div>
      <div class="stat"><div class="label">Plugin invokes</div><div class="value">\${metrics.pluginInvokes ?? 0}</div><div class="footnote">total</div></div>
      <div class="stat accent"><div class="label">Avg ms</div><div class="value">\${Math.round((metrics.avgDurationMs ?? 0) * 10) / 10}</div><div class="footnote">per request</div></div>
    \`;
    out.textContent = JSON.stringify(h.data, null, 2);
    if (!h.data?.ok) out.classList.add('err');
  };
  $('#debug-refresh').addEventListener('click', refresh);
  refresh();
}
</script>
</body>
</html>`;
}
