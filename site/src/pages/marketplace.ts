import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import { ENTRIES } from "../marketplace/data";
import type { EntryType, MarketplaceEntry } from "../marketplace/types";

const TYPE_LABELS: Record<EntryType, string> = {
  plugin: "Plugin",
  "mcp-server": "MCP server",
  "skill-pack": "Skill pack",
  "agent-template": "Agent template",
  companion: "Companion Worker"
};

const TYPE_FILTERS: Array<{ type: EntryType; label: string }> = [
  { type: "plugin", label: "Plugins" },
  { type: "mcp-server", label: "MCP servers" },
  { type: "skill-pack", label: "Skill packs" },
  { type: "agent-template", label: "Agent templates" },
  { type: "companion", label: "Companion Workers" }
];

export function renderMarketplace(filter?: EntryType): string {
  const filtered = filter ? ENTRIES.filter((e) => e.type === filter) : ENTRIES;
  const officialCount = ENTRIES.filter((e) => e.official).length;
  const communityCount = ENTRIES.length - officialCount;
  const verifiedCount = ENTRIES.filter((e) => e.verified).length;

  return `${htmlHead({
    title: filter ? `Marketplace · ${TYPE_LABELS[filter]}` : "Marketplace",
    description:
      "Plugins, MCP servers, skill packs, companion Workers, and agent templates for Open Think. Verified entries are wired and tested; reference entries point upstream with integration notes."
  })}
<main>

<section class="hero" style="padding-top: 48px; grid-template-columns: 1fr;">
  <div class="reveal d1">
    <div class="edition mono">§08 · Marketplace · ${ENTRIES.length} entries · ${verifiedCount} verified</div>
    <h1 class="serif" style="font-size: clamp(48px, 8vw, 96px); max-width: 18ch;">
      Plug in. <em>Chain&nbsp;up.</em>
    </h1>
    <p class="sub" style="max-width: 62ch;">
      Plugins, MCP servers, and companion Workers — plus honest pointers to the
      projects that inspired us. <b>Verified</b> entries are wired and tested against
      the current runtime. <b>Reference</b> entries link upstream with integration notes.
    </p>
    <p class="mono" style="font-size: 12px; letter-spacing: 0.1em; color: var(--muted); margin-top: 12px; text-transform: uppercase;">
      ${officialCount} first-party · ${communityCount} community · verified = tested end-to-end
    </p>
  </div>
</section>

<section class="reveal d2">
  <nav class="mp-filter mono" aria-label="Filter by type">
    <a href="/marketplace"${!filter ? ' data-current="true"' : ""}>All · ${ENTRIES.length}</a>
    ${TYPE_FILTERS.map((f) => {
      const count = ENTRIES.filter((e) => e.type === f.type).length;
      const current = filter === f.type ? ' data-current="true"' : "";
      return `<a href="/marketplace?type=${f.type}"${current}>${f.label} · ${count}</a>`;
    }).join("")}
  </nav>

  <div class="mp-grid">
    ${filtered.map(renderCard).join("")}
  </div>

  ${filtered.length === 0 ? renderEmptyState(filter) : ""}
</section>

<section class="reveal">
  <div class="section-ref"><span>§08.1 · Submit an entry</span><span class="rule"></span></div>
  <div class="grid-2">
    <div>
      <h2 class="headline serif">Your plugin here.<br><em>No fee.</em></h2>
    </div>
    <div>
      <p>
        The marketplace is curated by hand today. Open a pull request adding one file
        under
        <a href="https://github.com/NeoFlux-Holdings/open-think/tree/main/site/src/marketplace/entries">site/src/marketplace/entries/</a>;
        the PR template walks you through the honesty conventions (verified = tested,
        reference = linked, no aspirational claims).
      </p>
      <p style="margin-top: 14px;">
        Run <span class="mono">npm run marketplace:validate</span> locally before you push — it
        checks that every plugin id exists, every hostname is well-formed, and no two
        entries share a slug.
      </p>
      <div class="actions" style="margin-top: 22px;">
        <a href="https://github.com/NeoFlux-Holdings/open-think/blob/main/site/src/marketplace/types.ts" class="btn ghost">See the schema <span class="arrow">→</span></a>
      </div>
    </div>
  </div>
</section>

</main>
${htmlFoot()}`;
}

function renderEmptyState(filter?: EntryType): string {
  if (!filter) {
    return `<div class="mp-empty">
      <div class="mono" style="font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px;">No entries yet</div>
      <p>The catalog is empty. <a href="https://github.com/NeoFlux-Holdings/open-think/issues/new?title=Marketplace+seed">Open an issue</a> with suggestions and we'll seed it.</p>
    </div>`;
  }
  const label = TYPE_LABELS[filter];
  const suggestions = ENTRIES.slice(0, 4);
  return `<div class="mp-empty">
    <div class="mono" style="font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px;">Nothing under ${escapeHtml(label)} yet</div>
    <p>We haven't seeded this category. Until we do, here's what else is in the catalog:</p>
    <div class="mp-grid" style="margin-top: 18px;">
      ${suggestions.map(renderCard).join("")}
    </div>
    <p class="mono" style="font-size: 12px; color: var(--muted); margin-top: 14px; text-transform: uppercase; letter-spacing: 0.1em;">
      <a href="https://github.com/NeoFlux-Holdings/open-think/issues/new?title=Marketplace+${encodeURIComponent(filter)}+entry">Suggest a ${escapeHtml(label).toLowerCase()} →</a>
    </p>
  </div>`;
}

function renderCard(e: MarketplaceEntry): string {
  const accent = e.accents?.[0] ?? "var(--accent)";
  const pills: string[] = [];
  if (e.official) pills.push('<span class="mp-pill mp-official">official</span>');
  if (e.verified) pills.push('<span class="mp-pill mp-verified">verified</span>');
  else pills.push('<span class="mp-pill mp-reference">reference</span>');

  return `<a class="mp-card" href="/marketplace/${e.slug}" style="--mp-accent: ${escapeAttr(accent)};">
    <div class="mp-card-accent" aria-hidden="true"></div>
    <div class="mp-card-type mono">
      <span class="mp-type-label">${TYPE_LABELS[e.type]}</span>
      <span class="mp-pills">${pills.join("")}</span>
    </div>
    <h3 class="mp-card-title serif">${escapeHtml(e.title)}</h3>
    <p class="mp-card-tagline">${escapeHtml(e.tagline)}</p>
    <div class="mp-card-tags mono">
      ${e.tags
        .slice(0, 4)
        .map((t) => `<span>${escapeHtml(t)}</span>`)
        .join("")}
    </div>
    ${e.author ? `<div class="mp-card-author mono">by ${escapeHtml(e.author)}</div>` : ""}
  </a>`;
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
