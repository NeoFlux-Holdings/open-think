/**
 * Shared layout primitives for open-think.app.
 *
 * Aesthetic: research journal / technical monograph.
 *   - Instrument Serif (display) + IBM Plex Sans (body) + IBM Plex Mono (data)
 *   - Warm off-white paper, ink-black hairlines, single Cloudflare-orange accent
 *   - Numbered sections (§01, §02) and generous negative space
 *   - No cards, no drop shadows — only hairlines, color, typographic hierarchy
 */

export interface PageMeta {
  title: string;
  description?: string;
  canonical?: string;
  ogImage?: string;
}

/** Mutable analytics token populated by the Worker entrypoint so every page inherits it. */
let _analyticsToken: string | undefined;
export function setAnalyticsToken(token: string | undefined): void {
  _analyticsToken = token && token.length > 0 ? token : undefined;
}

export function htmlHead(meta: PageMeta): string {
  const title = meta.title
    ? `${escapeHtml(meta.title)} — Open Think`
    : "Open Think — a Cloudflare-native agent runtime";
  const description = escapeHtml(
    meta.description ??
      "Open Think is an open-source agent runtime for Cloudflare. Durable Objects, Workers AI, MCP, and Browser Rendering behind one plugin bus. Free to run, pro when you need hands."
  );
  const canonical = meta.canonical ?? "https://open-think.app/";
  const og = meta.ogImage ?? "https://open-think.app/og.png";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:image" content="${escapeHtml(og)}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" />
<link rel="icon" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='11' fill='none' stroke='%23111' stroke-width='1.3'/><circle cx='16' cy='16' r='3' fill='%23111'/><line x1='16' y1='3' x2='16' y2='7' stroke='%23f38020' stroke-width='1.5' stroke-linecap='round'/></svg>" />
${commonStyles()}
${
  _analyticsToken
    ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${_analyticsToken}"}'></script>`
    : ""
}
</head>
<body>
${header(meta.title)}`;
}

export function htmlFoot(): string {
  return `${footer()}
</body>
</html>`;
}

export function commonStyles(): string {
  return `<style>
:root {
  --paper: #fafaf5;
  --paper-warm: #f3efe3;
  --ink: #121212;
  --rule: #1a1a1a;
  --muted: #666;
  --muted-2: #bdbdbd;
  --accent: #f38020;
  --accent-deep: #b6590f;
  --shade: rgba(18, 18, 18, 0.03);
  --selection: #ffd89f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101010;
    --paper-warm: #1a1815;
    --ink: #efeadb;
    --rule: #efeadb;
    --muted: #a09787;
    --muted-2: #3a362d;
    --accent: #ff8a35;
    --accent-deep: #ffba84;
    --shade: rgba(239, 234, 219, 0.04);
    --selection: #4d3a1b;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; min-width: 0; }
html, body { background: var(--paper); color: var(--ink); overflow-x: hidden; max-width: 100vw; }
img, svg, video { max-width: 100%; height: auto; }
body {
  font-family: 'IBM Plex Sans', -apple-system, system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.55;
  min-height: 100vh;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  background-image: repeating-linear-gradient(0deg, transparent 0 39px, rgba(18, 18, 18, 0.015) 39px 40px);
  background-attachment: fixed;
}
::selection { background: var(--selection); color: var(--ink); }
a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); transition: color 0.15s, border-color 0.15s; }
a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.serif { font-family: 'Instrument Serif', 'Times New Roman', serif; font-weight: 400; letter-spacing: -0.01em; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-feature-settings: 'ss01', 'ss02'; }
.italic { font-style: italic; }
.small-caps { font-variant: all-small-caps; letter-spacing: 0.15em; text-transform: lowercase; }
.accent { color: var(--accent); }
.muted { color: var(--muted); }

/* ---- Header / nav ---- */
header.masthead {
  border-bottom: 1px solid var(--rule);
  padding: 18px 28px;
  position: sticky;
  top: 0;
  background: var(--paper);
  z-index: 10;
}
header.masthead .container { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
header.masthead .brand { display: flex; align-items: center; gap: 10px; font-family: 'Instrument Serif', serif; font-size: 22px; letter-spacing: -0.02em; border-bottom: none; }
header.masthead .brand:hover { color: var(--accent); }
header.masthead .brand svg { width: 22px; height: 22px; }
header.masthead nav { display: flex; gap: 22px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-left: auto; align-items: center; }
header.masthead nav a { border-bottom: none; color: var(--muted); }
header.masthead nav a:hover { color: var(--accent); }
header.masthead nav a[data-current] { color: var(--ink); }
header.masthead .cta {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 8px 14px;
  background: var(--ink);
  color: var(--paper);
  border-bottom: none;
}
header.masthead .cta:hover { background: var(--accent); color: var(--paper); }

/* ---- Container + sections ---- */
main { max-width: 1200px; margin: 0 auto; padding: 64px 28px 96px; }
section { padding: 48px 0; border-top: 1px solid var(--rule); }
section:first-child { border-top: none; padding-top: 24px; }

.section-ref {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--muted);
  text-transform: uppercase;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.section-ref .rule {
  flex: 1;
  border-bottom: 1px solid var(--muted-2);
  height: 0;
  margin-bottom: 5px;
}
h2.headline {
  font-family: 'Instrument Serif', serif;
  font-size: clamp(40px, 5vw, 64px);
  line-height: 1.02;
  letter-spacing: -0.02em;
  margin-bottom: 18px;
  max-width: 20ch;
}
h3 { font-family: 'Instrument Serif', serif; font-size: 28px; letter-spacing: -0.01em; margin-bottom: 10px; }
p.lede { font-family: 'IBM Plex Sans', sans-serif; font-size: 19px; line-height: 1.55; color: var(--muted); max-width: 58ch; margin-bottom: 22px; }
p { max-width: 62ch; }
p + p { margin-top: 12px; }

.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; }
@media (max-width: 900px) { .grid-3 { grid-template-columns: 1fr; gap: 36px; } }
.grid-2 { display: grid; grid-template-columns: 2fr 3fr; gap: 56px; align-items: start; }
@media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

/* ---- Buttons ---- */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid var(--rule);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  transition: all 0.15s;
  border-bottom: 1px solid var(--rule);
}
.btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.btn.primary:hover { background: var(--accent); border-color: var(--accent); }
.btn.ghost { background: transparent; }
.btn .arrow { transition: transform 0.18s ease-out; }
.btn:hover .arrow { transform: translateX(2px); }

/* ---- Hero ---- */
.hero {
  padding: 90px 0 64px;
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 80px;
  align-items: start;
}
@media (max-width: 1000px) { .hero { grid-template-columns: 1fr; gap: 40px; padding-top: 40px; } }
.hero .edition { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 24px; }
.hero h1 {
  font-family: 'Instrument Serif', serif;
  font-size: clamp(56px, 9vw, 120px);
  line-height: 0.98;
  letter-spacing: -0.035em;
  margin-bottom: 22px;
}
.hero h1 .line { display: block; }
.hero h1 em { color: var(--accent); font-style: italic; font-weight: 400; }
@media (max-width: 520px) {
  .hero h1 .line { display: inline; }
  .hero h1 .line + .line::before { content: " "; }
}
.hero .sub {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 20px;
  line-height: 1.5;
  color: var(--muted);
  max-width: 46ch;
  margin-bottom: 28px;
}
.hero .actions { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 36px; }
.hero .stats { display: flex; gap: 40px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.hero .stats b { font-family: 'Instrument Serif', serif; font-size: 32px; letter-spacing: -0.02em; color: var(--ink); display: block; text-transform: none; font-variant-numeric: tabular-nums; }

/* ---- Node graph visual ---- */
.node-graph { aspect-ratio: 1; width: 100%; max-width: 420px; margin: 0 auto; position: relative; }
.node-graph svg { width: 100%; height: 100%; overflow: visible; }
.node { fill: var(--ink); }
.node.accent { fill: var(--accent); }
.node-ring { fill: none; stroke: var(--accent); stroke-width: 1.5; opacity: 0; animation: ring-pulse 2.2s ease-out infinite; }
.node-ring.n2 { animation-delay: 0.55s; }
.node-ring.n3 { animation-delay: 1.1s; }
.node-ring.n4 { animation-delay: 1.65s; }
@keyframes ring-pulse {
  0% { r: 6; opacity: 0.9; }
  100% { r: 32; opacity: 0; }
}
.edge { stroke: var(--rule); stroke-width: 0.8; fill: none; opacity: 0.6; }
.edge-live {
  stroke-dasharray: 3 5;
  animation: edge-dash 2s linear infinite;
}
@keyframes edge-dash {
  from { stroke-dashoffset: 24; }
  to { stroke-dashoffset: 0; }
}
.node-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 8.5px;
  fill: var(--muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* ---- Pillars ---- */
.pillar .n {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 14px;
  display: inline-block;
  border-bottom: 1px solid var(--accent);
  padding-bottom: 4px;
}
.pillar h3 { margin-bottom: 10px; }
.pillar p { font-size: 16px; color: var(--muted); }

/* ---- Pricing ---- */
.plans {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
@media (max-width: 900px) { .plans { grid-template-columns: 1fr; } }
.plan {
  padding: 40px 32px;
  border-right: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  min-height: 460px;
  position: relative;
}
.plan:last-child { border-right: none; }
@media (max-width: 900px) { .plan { border-right: none; border-bottom: 1px solid var(--rule); } .plan:last-child { border-bottom: none; } }
.plan.featured { background: var(--shade); }
.plan.featured::before {
  content: "recommended";
  position: absolute;
  top: -11px; left: 28px;
  background: var(--accent);
  color: var(--paper);
  padding: 3px 10px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.plan .name { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 14px; }
.plan .price { font-family: 'Instrument Serif', serif; font-size: 56px; line-height: 1; letter-spacing: -0.03em; margin-bottom: 4px; }
.plan .price small { font-size: 16px; font-family: 'IBM Plex Mono', monospace; font-weight: 400; color: var(--muted); letter-spacing: 0.1em; margin-left: 6px; }
.plan .tagline { font-size: 15px; color: var(--muted); font-style: italic; margin-bottom: 24px; font-family: 'Instrument Serif', serif; }
.plan ul { list-style: none; padding: 0; margin: 0 0 28px; flex: 1; }
.plan li { font-size: 14px; padding: 8px 0; color: var(--ink); border-bottom: 1px dotted var(--muted-2); display: flex; align-items: flex-start; gap: 10px; }
.plan li:last-child { border-bottom: none; }
.plan li::before { content: "+"; color: var(--accent); font-family: 'IBM Plex Mono', monospace; font-weight: 500; }
.plan li.minus::before { content: "\u2013"; color: var(--muted-2); }
.plan .cta { width: 100%; justify-content: center; }

/* ---- Footer ---- */
footer.site-foot {
  border-top: 1px solid var(--rule);
  padding: 48px 28px 56px;
  background: var(--paper-warm);
}
footer .container { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 40px; }
@media (max-width: 800px) { footer .container { grid-template-columns: 1fr 1fr; } }
footer h4 { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); margin-bottom: 14px; }
footer ul { list-style: none; padding: 0; }
footer li { padding: 4px 0; font-size: 14px; }
footer .sig { font-family: 'Instrument Serif', serif; font-size: 24px; letter-spacing: -0.01em; }
footer .sig .muted-line { font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; color: var(--muted); margin-top: 10px; font-style: italic; }
footer .meta { margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--muted-2); font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 20px; }

/* ---- Page reveal animation ---- */
.reveal { opacity: 0; transform: translateY(10px); animation: reveal 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.reveal.d1 { animation-delay: 60ms; }
.reveal.d2 { animation-delay: 180ms; }
.reveal.d3 { animation-delay: 300ms; }
.reveal.d4 { animation-delay: 420ms; }
@keyframes reveal { to { opacity: 1; transform: translateY(0); } }

/* ---- Changelog / prose pages ---- */
.entry { padding: 32px 0; border-bottom: 1px solid var(--muted-2); }
.entry .label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.entry h3 { margin-bottom: 14px; }
.entry ul { padding-left: 20px; margin: 10px 0; }
.entry li { margin-bottom: 6px; font-size: 15px; max-width: 62ch; }

/* ---- Forms ---- */
.field { margin-bottom: 18px; }
.field label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.field input, .field textarea {
  width: 100%;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  padding: 8px 0;
  color: var(--ink);
  outline: none;
  transition: border-color 0.15s;
}
.field input:focus, .field textarea:focus { border-bottom-color: var(--accent); }
.field textarea { resize: vertical; min-height: 80px; }

.notice {
  padding: 14px 18px;
  border-left: 2px solid var(--accent);
  background: var(--shade);
  font-size: 14px;
  color: var(--ink);
  margin: 18px 0;
  font-family: 'IBM Plex Sans', sans-serif;
}
.notice b { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); display: block; margin-bottom: 4px; }

.notice.notice-reference {
  border-left-color: var(--muted);
  background: transparent;
  border: 1px dashed var(--muted-2);
  color: var(--muted);
}
.notice.notice-reference b { color: var(--muted); }

.mp-details {
  margin-top: 14px;
  border-top: 1px dotted var(--muted-2);
  padding-top: 12px;
}
.mp-details summary {
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--muted);
  text-transform: uppercase;
  padding: 4px 0;
}
.mp-details summary:hover { color: var(--accent); }
.mp-details pre { margin-top: 10px; }

/* ============================================================
 * Mobile pass — progressive breakpoints with a no-overflow guarantee.
 *
 * Tier 1 (≤1040px): tablet + laptop split — collapse the header nav
 *                    onto its own row so it can wrap freely regardless of item count.
 * Tier 2 (≤760px):  tablet & large phone — compact spacing, smaller type.
 * Tier 3 (≤480px):  phone — aggressive shrink, single-column everything.
 * Tier 4 (≤380px):  tiny phone — last-mile nav compaction.
 * ============================================================ */

/* Tier 1: at tablet + smaller, nav gets its own full-width row under brand+CTA.
 * This runs BEFORE the grid breakpoints (1000px) so the layout stays coherent. */
@media (max-width: 1040px) {
  header.masthead .container { gap: 14px; row-gap: 10px; }
  header.masthead nav {
    order: 3;
    width: 100%;
    flex-basis: 100%;
    flex-wrap: wrap;
    margin-left: 0;
    gap: 16px;
    font-size: 11px;
    padding-top: 10px;
    border-top: 1px dotted var(--muted-2);
  }
  header.masthead nav a { white-space: nowrap; }
}

/* Tier 2: tablet + large phone. */
@media (max-width: 760px) {
  body { font-size: 16px; line-height: 1.5; }
  main { padding: 32px 20px 64px; }
  section { padding: 32px 0; }

  header.masthead { padding: 12px 20px; }
  header.masthead .brand { font-size: 18px; gap: 8px; }
  header.masthead nav { gap: 14px; font-size: 11px; }
  header.masthead .cta { font-size: 11px; padding: 7px 12px; margin-left: auto; }

  .hero { padding: 32px 0 32px; gap: 28px; }
  .hero .edition { font-size: 9px; margin-bottom: 18px; }
  .hero h1 { font-size: clamp(44px, 12vw, 72px); }
  .hero .sub { font-size: 17px; }
  .hero .actions { gap: 10px; }
  .hero .stats { gap: 24px; flex-wrap: wrap; }
  .hero .stats b { font-size: 26px; }
  .node-graph { max-width: 280px; margin-top: 8px; }

  h2.headline { font-size: clamp(32px, 7vw, 44px); max-width: none; }
  h3 { font-size: 22px; }
  p.lede { font-size: 17px; }
  p, .plan li, .entry li { max-width: 100%; }

  .section-ref { flex-wrap: wrap; gap: 8px; }
  .section-ref .rule { flex-basis: 100%; min-width: 40px; }

  .plan { padding: 32px 24px; min-height: 0; }
  .plan .price { font-size: 44px; }

  .btn { padding: 10px 16px; font-size: 11px; }

  footer.site-foot { padding: 32px 20px 44px; }
  footer .container { grid-template-columns: 1fr 1fr; gap: 28px; }
  footer .sig { font-size: 20px; }
  footer .meta { flex-direction: column; gap: 8px; margin-top: 28px; align-items: flex-start; }

  .docs-list-item { grid-template-columns: 44px 1fr !important; gap: 14px !important; padding: 22px 0 !important; }
  .docs-list-item .docs-read-cue { display: none !important; }

  .entry { padding: 22px 0; }
  .entry h3 { font-size: 22px; }

  .notice { padding: 12px 14px; }

  .hero h1 br, .headline br { display: none; }
}

/* Tier 3: phone. */
@media (max-width: 480px) {
  main { padding: 24px 16px 48px; }
  section { padding: 28px 0; }

  header.masthead { padding: 10px 16px; }
  header.masthead .brand { font-size: 17px; }
  header.masthead nav { gap: 12px; font-size: 10px; }
  header.masthead .cta { font-size: 10px; padding: 6px 10px; }

  .hero { padding: 20px 0 24px; gap: 24px; }
  .hero h1 { font-size: clamp(36px, 13vw, 52px); line-height: 1.03; letter-spacing: -0.03em; }
  .hero .sub { font-size: 16px; }
  .hero .stats { gap: 18px; }
  .hero .stats b { font-size: 22px; }
  .node-graph { max-width: 240px; }

  footer .container { grid-template-columns: 1fr; gap: 24px; }
  footer .sig { font-size: 19px; }

  .plan { padding: 24px 18px; }
  .plan .price { font-size: 40px; }
  .plan .price small { font-size: 14px; }

  h2.headline { font-size: clamp(28px, 9vw, 36px); }
  .blockquote, blockquote { padding-left: 18px !important; }
}

/* Tier 4: tiny phone. Last-mile nav compaction; brand goes logo-only. */
@media (max-width: 380px) {
  header.masthead .brand span { display: none; }
  header.masthead nav { gap: 10px; font-size: 9px; }
  header.masthead .cta { padding: 6px 8px; letter-spacing: 0.1em; }
  .hero h1 { font-size: clamp(32px, 14vw, 44px); }
}

/* Motion opt-out. */
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; animation: none; }
  .node-ring, .edge-live { animation: none; }
}

/* ==========================================================
 * Changelog preview grid (landing page)
 * ========================================================== */
.cl-preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
@media (max-width: 900px) { .cl-preview-grid { grid-template-columns: 1fr; } }
.cl-preview-card {
  display: block;
  padding: 26px 28px;
  border-right: 1px solid var(--rule);
  color: var(--ink);
  border-bottom: none;
  transition: background 0.2s;
}
.cl-preview-card:last-child { border-right: none; }
@media (max-width: 900px) {
  .cl-preview-card { border-right: none; border-bottom: 1px solid var(--rule); }
  .cl-preview-card:last-child { border-bottom: none; }
}
.cl-preview-card:hover { background: var(--shade); color: var(--ink); }
.cl-preview-meta { font-size: 10px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; margin-bottom: 10px; }
.cl-preview-title { font-size: 24px; letter-spacing: -0.01em; line-height: 1.15; margin-bottom: 10px; }
.cl-preview-bullet { font-size: 14px; color: var(--muted); line-height: 1.5; }

/* ==========================================================
 * Doc pages — sidebar + article + prose
 * ========================================================== */
.doc-main { max-width: 1200px; margin: 0 auto; padding: 48px 28px 96px; }
.doc-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 64px;
  align-items: start;
}
@media (max-width: 960px) {
  .doc-layout { grid-template-columns: 1fr; gap: 36px; }
}

.doc-sidenav {
  position: sticky;
  top: 88px;
  font-size: 14px;
}
@media (max-width: 960px) {
  .doc-sidenav { position: static; border-bottom: 1px solid var(--rule); padding-bottom: 28px; }
}
.doc-section-ref {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--muted);
  text-transform: uppercase;
  margin-bottom: 10px;
}
.doc-title {
  font-size: clamp(32px, 4vw, 44px);
  line-height: 1.05;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}
.doc-blurb { color: var(--muted); font-size: 14px; line-height: 1.5; max-width: 32ch; margin-bottom: 22px; }
.doc-toc {
  border-top: 1px dotted var(--muted-2);
  border-bottom: 1px dotted var(--muted-2);
  padding: 14px 0;
  margin-bottom: 20px;
}
.doc-toc-label { font-size: 10px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; }
.doc-toc ol { list-style: none; padding: 0; margin: 0; }
.doc-toc li { padding: 4px 0; font-size: 13px; line-height: 1.4; }
.doc-toc li.doc-toc-3 { padding-left: 14px; font-size: 12px; color: var(--muted); }
.doc-toc li a { color: var(--ink); border-bottom: none; }
.doc-toc li.doc-toc-3 a { color: var(--muted); }
.doc-toc li a:hover { color: var(--accent); }
.doc-sidenav-links { display: flex; flex-direction: column; gap: 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
.doc-sidenav-links a { color: var(--muted); border-bottom: none; }
.doc-sidenav-links a:hover { color: var(--accent); }

.doc-article {
  max-width: 68ch;
  font-size: 17px;
  line-height: 1.7;
}
.doc-p { margin: 14px 0; color: var(--ink); }
.doc-article .doc-p:first-child { margin-top: 0; }

.doc-h2, .doc-h3, .doc-h4 { position: relative; }
.doc-h2 {
  font-size: clamp(28px, 3.4vw, 36px);
  line-height: 1.12;
  letter-spacing: -0.015em;
  margin: 40px 0 14px;
  padding-top: 24px;
  border-top: 1px solid var(--rule);
}
.doc-h3 {
  font-size: clamp(22px, 2.4vw, 26px);
  line-height: 1.2;
  letter-spacing: -0.01em;
  margin: 28px 0 10px;
}
.doc-h4 { font-size: 18px; font-weight: 600; letter-spacing: -0.005em; margin: 22px 0 6px; }
.doc-h2 .anchor-link, .doc-h3 .anchor-link, .doc-h4 .anchor-link {
  position: absolute;
  left: -18px;
  top: 0.35em;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  color: var(--muted-2);
  border-bottom: none;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.doc-h2:hover .anchor-link, .doc-h3:hover .anchor-link, .doc-h4:hover .anchor-link { opacity: 1; color: var(--accent); }
@media (max-width: 600px) { .anchor-link { display: none; } }

.doc-code {
  background: var(--shade);
  border-left: 2px solid var(--accent);
  padding: 14px 18px;
  font-size: 13px;
  line-height: 1.55;
  overflow-x: auto;
  margin: 18px 0;
  color: var(--ink);
  border-bottom: none;
}
.doc-code code { background: none; padding: 0; font-family: 'IBM Plex Mono', monospace; }
.doc-inline-code {
  background: var(--shade);
  padding: 1px 6px;
  font-size: 0.88em;
  border-radius: 2px;
  color: var(--ink);
}

.doc-quote {
  border-left: 2px solid var(--accent);
  padding-left: 22px;
  margin: 22px 0;
  color: var(--ink);
  font-size: 20px;
  line-height: 1.45;
}
.doc-quote .doc-p { margin: 6px 0; }

.doc-list { margin: 14px 0 14px 24px; }
.doc-li { padding: 3px 0; }
.doc-li > .doc-list { margin-top: 4px; }

.doc-link { color: var(--ink); border-bottom: 1px solid var(--rule); }
.doc-link:hover { color: var(--accent); border-bottom-color: var(--accent); }
.doc-link .ext { color: var(--muted); font-size: 0.85em; }

.doc-table-wrap { overflow-x: auto; margin: 20px 0; }
.doc-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.doc-table th { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); padding: 10px 14px 10px 0; border-bottom: 2px solid var(--rule); text-align: left; }
.doc-table td { padding: 10px 14px 10px 0; border-bottom: 1px solid var(--muted-2); vertical-align: top; }
.doc-table tr:hover td { background: var(--shade); }

.doc-hr { border: none; border-top: 1px solid var(--muted-2); margin: 36px 0; }

.doc-nav-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 64px;
  padding-top: 28px;
  border-top: 1px solid var(--rule);
}
.doc-nav-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--rule);
  padding: 18px 20px;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  transition: all 0.15s;
}
.doc-nav-card.right { text-align: right; }
.doc-nav-card.empty { border: none; }
.doc-nav-card:hover { border-color: var(--accent); color: var(--accent); }
.doc-nav-card .mono { font-size: 10px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; }
.doc-nav-card .serif { font-size: 18px; line-height: 1.2; }
@media (max-width: 600px) {
  .doc-nav-row { grid-template-columns: 1fr; }
  .doc-nav-card.right { text-align: left; }
}

@media (max-width: 760px) {
  .doc-main { padding: 32px 20px 72px; }
  .doc-article { font-size: 16px; line-height: 1.65; }
  .doc-h2 { margin: 32px 0 10px; padding-top: 20px; }
  .doc-code { font-size: 12px; padding: 12px 14px; }
  .doc-table { font-size: 13px; }
}

/* ==========================================================
 * Marketplace
 * ========================================================== */
.mp-filter {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding: 14px 0 22px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 28px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.mp-filter a {
  color: var(--muted);
  border-bottom: none;
  padding: 4px 0;
  position: relative;
}
.mp-filter a:hover { color: var(--accent); }
.mp-filter a[data-current="true"] { color: var(--ink); }
.mp-filter a[data-current="true"]::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 2px;
  background: var(--accent);
}

.mp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
@media (max-width: 960px) { .mp-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .mp-grid { grid-template-columns: 1fr; } }

.mp-empty {
  grid-column: 1 / -1;
  background: var(--paper);
  padding: 40px 32px;
  border: 1px solid var(--rule);
  color: var(--muted);
  font-size: 15px;
  line-height: 1.55;
  margin-top: 28px;
}
.mp-empty p { max-width: 52ch; }
.mp-empty a { color: var(--accent); }

.mp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 26px 22px;
  background: var(--paper);
  color: var(--ink);
  border-bottom: none;
  position: relative;
  transition: background 0.2s;
  min-height: 220px;
}
.mp-card:hover { background: var(--shade); color: var(--ink); }
.mp-card-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--mp-accent, var(--accent));
  opacity: 0;
  transition: opacity 0.2s;
}
.mp-card:hover .mp-card-accent { opacity: 1; }
.mp-card-type {
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--muted);
  text-transform: uppercase;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.mp-type-label { flex: 1 0 auto; }
.mp-pills {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mp-pill {
  display: inline-block;
  padding: 2px 7px;
  font-size: 9px;
  letter-spacing: 0.14em;
  border: 1px solid var(--muted-2);
  border-radius: 999px;
  line-height: 1.3;
}
.mp-pill.mp-official {
  color: var(--accent);
  border-color: var(--accent);
}
.mp-pill.mp-verified {
  color: var(--ok, #2d5c3e);
  border-color: var(--ok, #2d5c3e);
}
.mp-pill.mp-reference {
  color: var(--muted);
  border-style: dashed;
}
@media (max-width: 480px) {
  .mp-card-type { flex-direction: column; align-items: flex-start; }
}
.mp-card-title {
  font-size: 22px;
  line-height: 1.15;
  letter-spacing: -0.01em;
  font-variation-settings: 'opsz' 48;
}
.mp-card-tagline {
  font-size: 14px;
  color: var(--ink);
  line-height: 1.5;
  flex: 1;
}
.mp-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--muted);
  text-transform: uppercase;
}
.mp-card-tags span {
  padding: 2px 8px;
  border: 1px solid var(--muted-2);
  border-radius: 2px;
}
.mp-card-author { font-size: 10px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; }

/* Detail-page meta list */
.mp-meta {
  border-top: 1px dotted var(--muted-2);
  border-bottom: 1px dotted var(--muted-2);
  padding: 14px 0;
  margin-bottom: 20px;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 4px 12px;
  font-size: 11px;
  letter-spacing: 0.1em;
}
.mp-meta dt { color: var(--muted); text-transform: uppercase; font-size: 10px; letter-spacing: 0.15em; }
.mp-meta dd { color: var(--ink); font-size: 12px; }

.mp-secrets-list { list-style: none; padding: 0; margin: 10px 0 18px; }
.mp-secrets-list li {
  padding: 10px 0;
  border-bottom: 1px dotted var(--muted-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mp-secrets-list li:last-child { border-bottom: none; }
.mp-secret-desc { font-size: 14px; color: var(--muted); line-height: 1.5; }

.mp-tags-block {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 24px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.mp-tags-block span {
  padding: 4px 10px;
  border: 1px solid var(--muted-2);
  color: var(--muted);
  border-radius: 2px;
}

.mp-related { list-style: none; padding: 0; margin: 12px 0 28px; }
.mp-related li { padding: 14px 0; border-bottom: 1px dotted var(--muted-2); }
.mp-related li:last-child { border-bottom: none; }
.mp-related li a { color: var(--ink); border-bottom: none; display: block; }
.mp-related li a:hover strong { color: var(--accent); }
.mp-related strong { display: block; font-size: 18px; margin-bottom: 3px; }
</style>`;
}

export function header(currentPath?: string): string {
  const isPath = (p: string) => (currentPath === p ? ' data-current="true"' : "");
  return `<header class="masthead">
  <div class="container">
    <a class="brand serif" href="/">
      ${logoSvg(22)}
      <span>Open&nbsp;Think</span>
    </a>
    <nav>
      <a href="/"${isPath("/")}>Overview</a>
      <a href="/marketplace"${isPath("/marketplace")}>Marketplace</a>
      <a href="/docs"${isPath("/docs")}>Docs</a>
      <a href="/demo"${isPath("/demo")}>Demo</a>
      <a href="/changelog"${isPath("/changelog")}>Changelog</a>
      <a href="/pricing"${isPath("/pricing")}>Pricing</a>
      <a href="/concierge"${isPath("/concierge")}>Concierge</a>
      <a href="https://github.com/NeoFlux-Holdings/open-think">GitHub ↗</a>
    </nav>
    <a class="cta" href="/deploy/cloud">Deploy →</a>
  </div>
</header>`;
}

export function footer(): string {
  const year = new Date().getUTCFullYear();
  return `<footer class="site-foot">
  <div class="container">
    <div>
      <div class="sig serif">Open&nbsp;Think</div>
      <div class="muted-line">A Cloudflare-native agent runtime, built in public and in the tradition of <a href="https://blog.cloudflare.com/project-think/">Project Think</a>.</div>
    </div>
    <div>
      <h4>Product</h4>
      <ul>
        <li><a href="/">Overview</a></li>
        <li><a href="/marketplace">Marketplace</a></li>
        <li><a href="/docs">Docs</a></li>
        <li><a href="/demo">Demo</a></li>
        <li><a href="/deploy/cloud">Cloud deploy</a></li>
        <li><a href="/deploy/guided">Guided deploy</a></li>
        <li><a href="/deploy/agent">Agent deploy</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/concierge">Concierge</a></li>
        <li><a href="/changelog">Changelog</a></li>
      </ul>
    </div>
    <div>
      <h4>Community</h4>
      <ul>
        <li><a href="https://github.com/NeoFlux-Holdings/open-think">GitHub</a></li>
        <li><a href="https://github.com/NeoFlux-Holdings/open-think/issues">Issues</a></li>
        <li><a href="https://github.com/NeoFlux-Holdings/open-think/discussions">Discussions</a></li>
        <li><a href="mailto:hello@open-think.app">Email us</a></li>
      </ul>
    </div>
    <div>
      <h4>Built on</h4>
      <ul>
        <li><a href="https://blog.cloudflare.com/project-think/">Project Think</a></li>
        <li><a href="https://developers.cloudflare.com/durable-objects/">Durable Objects</a></li>
        <li><a href="https://developers.cloudflare.com/workers-ai/">Workers AI</a></li>
        <li><a href="https://modelcontextprotocol.io/">MCP</a></li>
      </ul>
    </div>
    <div class="meta" style="grid-column: 1 / -1;">
      <span>© ${year} Open Think · Apache-2.0 · community-driven</span>
      <span>§99.9 — thank you for reading to the last page</span>
    </div>
  </div>
</footer>`;
}

/**
 * Current logo — a concentric "aperture" mark.
 *
 *   Outer ring  → the vessel, the openness, the edge
 *   Inner dot   → the thought, the focus, the agent
 *   Orange tick → a compass bearing, a colophon, a single accent
 *
 * Reads as an aperture, an eye, or a typographic colophon depending on size.
 * Stays legible at 16px (favicon) and sharp at 144px (marketing).
 */
export function logoSvg(size = 22): string {
  const strokeWidth = size <= 18 ? 1.6 : 1.3;
  const tickWidth = size <= 18 ? 1.8 : 1.5;
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" class="logomark">
  <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"/>
  <circle cx="16" cy="16" r="3" fill="currentColor"/>
  <line x1="16" y1="3" x2="16" y2="7" stroke="var(--accent)" stroke-width="${tickWidth}" stroke-linecap="round"/>
</svg>`;
}

/**
 * Reference copy of the first logo attempt — a 5-node graph with accent
 * corners. Kept for history / comparison. Don't render in production pages.
 */
export function logoSvgLegacy(size = 22): string {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
  <circle cx="16" cy="16" r="4" class="node"/>
  <circle cx="4" cy="4" r="2" class="node accent"/>
  <circle cx="28" cy="4" r="2" class="node"/>
  <circle cx="4" cy="28" r="2" class="node"/>
  <circle cx="28" cy="28" r="2" class="node accent"/>
  <line x1="16" y1="16" x2="4" y2="4" class="edge"/>
  <line x1="16" y1="16" x2="28" y2="4" class="edge"/>
  <line x1="16" y1="16" x2="4" y2="28" class="edge"/>
  <line x1="16" y1="16" x2="28" y2="28" class="edge"/>
</svg>`;
}

export function escapeHtml(s: string): string {
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

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=86400"
    }
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
