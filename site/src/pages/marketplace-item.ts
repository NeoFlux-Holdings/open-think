import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import { findBySlug, ENTRIES } from "../marketplace/data";
import type { MarketplaceEntry } from "../marketplace/types";

const TYPE_LABELS = {
  plugin: "Plugin",
  "mcp-server": "MCP server",
  "skill-pack": "Skill pack",
  "agent-template": "Agent template",
  companion: "Companion Worker"
} as const;

export function renderMarketplaceItem(slug: string): { body: string; status: 200 | 404 } {
  const entry = findBySlug(slug);
  if (!entry) {
    return { body: renderNotFound(slug), status: 404 };
  }

  const relatedEntries = ENTRIES.filter(
    (e) => e.slug !== entry.slug && (e.category === entry.category || hasTagOverlap(e.tags, entry.tags))
  ).slice(0, 3);

  const body = `${htmlHead({
    title: `${entry.title} — Marketplace`,
    description: entry.tagline,
    canonical: `https://open-think.app/marketplace/${entry.slug}`
  })}
<main class="doc-main">
  <div class="doc-layout">
    <aside class="doc-sidenav">
      <div class="doc-section-ref mono">§08 · ${TYPE_LABELS[entry.type]}${entry.official ? " · official" : ""}</div>
      <h1 class="doc-title serif">${escapeHtml(entry.title)}</h1>
      <p class="doc-blurb">${escapeHtml(entry.tagline)}</p>

      <dl class="mp-meta mono">
        <dt>Type</dt><dd>${TYPE_LABELS[entry.type]}</dd>
        <dt>Category</dt><dd>${escapeHtml(entry.category)}</dd>
        ${entry.author ? `<dt>Author</dt><dd>${entry.authorUrl ? `<a href="${escapeAttr(entry.authorUrl)}" rel="noopener">${escapeHtml(entry.author)}</a>` : escapeHtml(entry.author)}</dd>` : ""}
        ${entry.license ? `<dt>License</dt><dd>${escapeHtml(entry.license)}</dd>` : ""}
        <dt>Verified</dt><dd>${entry.verified ? "yes — tested against current Open Think" : "reference — read upstream docs"}</dd>
      </dl>

      <div class="doc-sidenav-links">
        <a href="${escapeAttr(entry.source)}" rel="noopener" target="_blank">Source ↗</a>
        ${entry.docsPath ? `<a href="${escapeAttr(entry.docsPath)}">Related docs →</a>` : ""}
        <a href="/marketplace">← All entries</a>
      </div>
    </aside>

    <article class="doc-article">
      ${
        !entry.verified
          ? `<div class="notice notice-reference" role="note">
        <b>Reference entry.</b>
        This isn't packaged for one-click install. We link it as an inspiration or
        integration target — read the upstream source first, then adapt the pattern to
        Open Think. The install steps below are best-effort, not guaranteed.
      </div>`
          : ""
      }
      <p class="doc-p">${escapeHtml(entry.description)}</p>

      <h2 class="doc-h2 serif" id="install">Install</h2>
      ${renderInstallInstructions(entry)}

      ${entry.tags.length > 0 ? `<h2 class="doc-h2 serif" id="tags">Tags</h2>
      <div class="mp-tags-block mono">${entry.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>` : ""}

      ${
        relatedEntries.length > 0
          ? `<h2 class="doc-h2 serif" id="related">Related</h2>
      <ul class="mp-related">
        ${relatedEntries
          .map(
            (r) =>
              `<li><a href="/marketplace/${r.slug}"><strong class="serif">${escapeHtml(r.title)}</strong> — ${escapeHtml(r.tagline)}</a></li>`
          )
          .join("")}
      </ul>`
          : ""
      }
    </article>
  </div>
</main>
${htmlFoot()}`;
  return { body, status: 200 };
}

function renderInstallInstructions(entry: MarketplaceEntry): string {
  const { install, type } = entry;
  const sections: string[] = [];

  // 1. Config snippets — things that go into wrangler.toml
  const configParts: string[] = [];
  if (install.mcpUrl) {
    configParts.push(`<p class="doc-p">MCP server URL:</p>
      <pre class="doc-code mono">${escapeHtml(install.mcpUrl)}</pre>`);
  }
  if (install.enabledPluginsAdd && install.enabledPluginsAdd.length > 0) {
    configParts.push(`<p class="doc-p">Append to <code class="doc-inline-code">ENABLED_PLUGINS</code> in <code class="doc-inline-code">wrangler.toml</code>:</p>
      <pre class="doc-code mono">${escapeHtml(install.enabledPluginsAdd.join(","))}</pre>`);
  }
  if (install.allowedHostsAdd && install.allowedHostsAdd.length > 0) {
    configParts.push(`<p class="doc-p">Append to <code class="doc-inline-code">ALLOWED_HOSTS</code>:</p>
      <pre class="doc-code mono">${escapeHtml(install.allowedHostsAdd.join(","))}</pre>`);
  }
  if (install.wranglerSnippet) {
    configParts.push(`<p class="doc-p">Wrangler config:</p>
      <pre class="doc-code mono">${escapeHtml(install.wranglerSnippet)}</pre>`);
  }
  if (configParts.length > 0) {
    sections.push(`<h3 class="doc-h3 serif" id="install-config">1 · Config</h3>${configParts.join("\n")}`);
  }

  // 2. Secrets
  if (install.secrets && install.secrets.length > 0) {
    const copyable = install.secrets
      .map((s) => `${s.name}=${s.required ? "" : "# optional — "}${s.description}`)
      .join("\n");
    sections.push(`<h3 class="doc-h3 serif" id="install-secrets">${configParts.length > 0 ? "2" : "1"} · Secrets</h3>
      <p class="doc-p">Run each from your Worker project:</p>
      <ul class="mp-secrets-list">
        ${install.secrets
          .map(
            (s) =>
              `<li>
                <code class="doc-inline-code mono">wrangler secret put ${escapeHtml(s.name)}</code>
                <span class="mp-secret-desc">${s.required ? "" : "<em>optional</em> — "}${escapeHtml(s.description)}${s.pattern ? ` <span class="mono" style="color: var(--muted); font-size: 11px;">· must match <code>${escapeHtml(s.pattern)}</code></span>` : ""}</span>
              </li>`
          )
          .join("")}
      </ul>
      <details class="mp-details">
        <summary class="mono">Copy-paste <code>.dev.vars</code> template</summary>
        <pre class="doc-code mono">${escapeHtml(copyable)}</pre>
      </details>`);
  }

  // 3. Manual steps / repo / deploy button
  const actionParts: string[] = [];
  if (install.skillsJsonUrl) {
    actionParts.push(`<p class="doc-p">Skill manifest to import:</p>
      <pre class="doc-code mono">${escapeHtml(install.skillsJsonUrl)}</pre>`);
  }
  if (install.repoUrl) {
    actionParts.push(`<p class="doc-p">Reference repository:</p>
      <p class="doc-p"><a class="doc-link" href="${escapeAttr(install.repoUrl)}" rel="noopener" target="_blank">${escapeHtml(install.repoUrl)} <span class="ext">↗</span></a></p>`);
  }
  if (install.deployButton) {
    actionParts.push(`<p class="doc-p"><a class="btn primary" href="${escapeAttr(install.deployButton)}">Deploy to Cloudflare →</a></p>`);
  }
  if (install.manualSteps && install.manualSteps.length > 0) {
    actionParts.push(`<ol class="doc-list">${install.manualSteps.map((s) => `<li class="doc-li">${escapeHtml(s)}</li>`).join("")}</ol>`);
  }
  if (actionParts.length > 0) {
    const idx = sections.length + 1;
    sections.push(`<h3 class="doc-h3 serif" id="install-steps">${idx} · Steps</h3>${actionParts.join("\n")}`);
  }

  if (sections.length === 0) {
    sections.push(`<p class="doc-p"><em>No install instructions yet — see the upstream source.</em></p>`);
  }

  // Type-specific footer
  if (type === "mcp-server") {
    sections.push(`<p class="doc-p" style="color: var(--muted); font-size: 15px;">Once the URL is set, Helm's <code class="doc-inline-code">mcp-list-tools</code> skill will enumerate everything this server exposes; each becomes callable via <code class="doc-inline-code">mcp-call-tool</code>.</p>`);
  }

  return sections.join("\n");
}

function hasTagOverlap(a: string[], b: string[]): boolean {
  const s = new Set(a);
  return b.some((t) => s.has(t));
}

function renderNotFound(slug: string): string {
  return `${htmlHead({ title: "Entry not found" })}
<main class="doc-main">
  <section style="padding-top: 48px;">
    <div class="section-ref"><span>§ 404 · Entry not found</span><span class="rule"></span></div>
    <h1 class="serif" style="font-size: clamp(48px, 8vw, 96px); max-width: 18ch;">
      No entry named <em>${escapeHtml(slug)}</em>.
    </h1>
    <p class="sub" style="max-width: 60ch; color: var(--muted); margin-top: 18px;">
      The marketplace catalog is hand-maintained; this one isn't in our manifest.
    </p>
    <p style="margin-top: 24px;"><a href="/marketplace" class="btn">Browse the catalog</a></p>
  </section>
</main>
${htmlFoot()}`;
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
