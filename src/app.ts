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
.conductor-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 14px 18px;
  border-bottom: 1px solid var(--rule);
}
.conductor-header .title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; font-variation-settings: 'opsz' 48, 'WONK' 1; }
.conductor-header .meta { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.conductor-body { padding: 18px; min-height: 240px; max-height: 520px; overflow-y: auto; }
.msg {
  border-bottom: 1px dotted var(--muted-2);
  padding: 14px 0;
}
.msg:first-child { padding-top: 0; }
.msg:last-child { border-bottom: none; }
.msg .who {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
  display: flex;
  gap: 10px;
  align-items: center;
}
.msg.assistant .who { color: var(--accent); }
.msg .content { font-size: 16px; line-height: 1.55; white-space: pre-wrap; }
.msg .content :is(code, pre) { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.msg .content pre { background: transparent; padding: 10px 14px; border-left: 2px solid var(--accent); overflow-x: auto; margin: 10px 0; white-space: pre; }
.action-card {
  margin: 14px 0;
  border: 1px solid var(--rule);
  background: var(--paper);
  padding: 14px 16px;
  position: relative;
}
.action-card::before {
  content: "Exhibit";
  position: absolute;
  top: -10px; left: 14px;
  background: var(--paper);
  padding: 0 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.action-card .skill-id { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--accent); }
.action-card .input-preview { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); margin-top: 4px; max-height: 80px; overflow-y: auto; white-space: pre-wrap; }
.action-card button {
  margin-top: 10px;
  border: 1px solid var(--accent);
  color: var(--paper);
  background: var(--accent);
  padding: 6px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: filter 0.15s;
}
.action-card button:hover { filter: brightness(1.1); }

.composer {
  border-top: 1px solid var(--rule);
  padding: 14px 18px;
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  min-height: 50px;
  max-height: 180px;
  resize: vertical;
  font-family: 'Newsreader', serif;
  font-size: 16px;
  background: transparent;
  color: var(--ink);
  border: 1px solid transparent;
  outline: none;
  padding: 6px 0;
  line-height: 1.5;
}
.composer textarea:focus { border-bottom-color: var(--accent); }
.composer button {
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--paper);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 10px 18px;
  cursor: pointer;
}
.composer button:disabled { opacity: 0.4; cursor: progress; }
.composer .kbd { font-size: 10px; color: var(--muted); white-space: nowrap; }
.mode-toggle {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--rule);
  padding: 2px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.mode-toggle label {
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--muted);
}
.mode-toggle label:has(input:checked) { background: var(--accent); color: var(--paper); }
.mode-toggle input { position: absolute; opacity: 0; pointer-events: none; }
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

  <section class="reveal d2">
    <div class="panel-header">
      <span class="h display">Runtime readiness</span>
      <span class="meta" id="readiness-score">—</span>
    </div>
    <div class="readiness-bar-wrap"><div class="readiness-bar" id="readiness-bar"></div></div>
    <div id="recommended" class="recommended"></div>
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
  '/plugins': renderPlugins,
  '/skills': renderSkills,
  '/sessions': renderSessions,
  '/providers': renderProviders,
  '/settings': renderSettings,
  '/debug': renderDebug
};

function currentRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return routes[raw] ? raw : '/';
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
  mountConductor($('#conductor-full'), false);
}

function mountConductor(host, compact) {
  host.innerHTML = \`
    <div class="conductor-header">
      <span class="title display">✦ Conductor</span>
      <span class="meta">session: <span id="c-session"></span></span>
    </div>
    <div class="conductor-body" id="c-body"></div>
    <div class="composer">
      <textarea id="c-input" placeholder="Ask the Conductor (e.g. 'check my runtime health' · 'help me set up Anthropic')"></textarea>
      <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-end;">
        <div class="mode-toggle mono" role="radiogroup" aria-label="execution mode">
          <label><input type="radio" name="c-mode" value="propose" checked> propose</label>
          <label><input type="radio" name="c-mode" value="selective"> selective</label>
          <label><input type="radio" name="c-mode" value="auto"> auto</label>
          <label><input type="radio" name="c-mode" value="stream"> stream</label>
        </div>
        <button id="c-send">Send</button>
        <span class="kbd">⌘↵ · propose = exhibit cards · selective = auto-safe · auto = end-to-end · stream = codex app-server SSE</span>
      </div>
    </div>
  \`;
  host.querySelector('#c-session').textContent = state.conductorSession;
  const body = host.querySelector('#c-body');
  const input = host.querySelector('#c-input');
  const btn = host.querySelector('#c-send');

  renderConductorBody(body);

  const send = async () => {
    const content = input.value.trim();
    if (!content) return;
    const mode = (host.querySelector('input[name="c-mode"]:checked')?.value) || 'propose';
    input.value = '';
    btn.disabled = true;
    btn.textContent = mode === 'auto' ? 'Running…' : mode === 'selective' ? 'Selecting…' : mode === 'stream' ? 'Streaming…' : 'Planning…';
    appendMessageToBody(body, { role: 'user', content });

    if (mode === 'stream') {
      await sendStreaming(body, content);
      btn.disabled = false;
      btn.textContent = 'Send';
      return;
    }

    try {
      const r = await j('/conductor/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionName: state.conductorSession, content, mode })
      });
      const data = r.data?.data;
      if (!r.data?.ok || !data) {
        appendMessageToBody(body, {
          role: 'assistant',
          content: '[conductor] ' + (r.data?.error || 'request failed')
        });
      } else {
        appendMessageToBody(body, {
          role: 'assistant',
          content: data.assistantMessage?.content ?? '(empty reply)',
          suggestedActions: data.suggestedActions ?? [],
          trace: data.trace ?? [],
          halted: data.halted,
          mode: data.mode,
          iterationsUsed: data.iterationsUsed,
          provider: data.providerUsed
        });
      }
    } catch (err) {
      appendMessageToBody(body, { role: 'assistant', content: '[conductor-error] ' + String(err) });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  };

  btn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });

  if (compact) {
    appendMessageToBody(body, {
      role: 'assistant',
      content: 'Try asking: check runtime health, what plugins are enabled?, or help me enable Anthropic.'
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
  for (const m of state.conductorHistory) appendMessageToBody(body, m);
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
async function renderSettings() {
  $('#view').appendChild($('#tpl-settings').content.cloneNode(true));

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
