import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import { DOC_ENTRIES, SECTIONS } from "../docs-content";

export function renderDocs(): string {
  const sorted = [...DOC_ENTRIES].sort((a, b) => a.order - b.order);
  return `${htmlHead({
    title: "Docs",
    description: "Every doc for Open Think — Helm, providers, rollback, plugin SDK, runbooks. Rendered on-domain from the repo's docs/ folder."
  })}
<main>

<section class="hero" style="grid-template-columns: 1fr; padding-top: 48px;">
  <div class="reveal d1">
    <div class="edition mono">§07 · Docs · rendered from the repo</div>
    <h1 class="serif" style="font-size: clamp(52px, 8vw, 104px); max-width: 18ch;">
      Every <em>doc</em>, one page.
    </h1>
    <p class="sub" style="max-width: 58ch;">
      Bundled at deploy time from <span class="mono">open-think/docs</span>. Every page has a table of contents, prev/next nav, and an Edit-on-GitHub link.
    </p>
  </div>
</section>

${SECTIONS.map((s) => {
  const section = sorted.filter((d) => d.section === s.id);
  if (section.length === 0) return "";
  return `<section class="reveal">
  <div class="section-ref"><span>§07 · ${s.label}</span><span class="rule"></span><span>${section.length} documents</span></div>
  <ol style="list-style: none; padding: 0;">
    ${section.map((d) => renderDocLink(d)).join("")}
  </ol>
</section>`;
}).join("")}

</main>
${htmlFoot()}`;
}

function renderDocLink(d: { slug: string; title: string; blurb: string; order: number }): string {
  const num = String(d.order).padStart(2, "0");
  return `<li class="docs-list-item" style="border-bottom: 1px solid var(--muted-2); padding: 28px 0; display: grid; grid-template-columns: 60px 1fr auto; gap: 24px; align-items: baseline;">
    <span class="mono" style="font-size: 11px; letter-spacing: 0.15em; color: var(--muted); text-transform: uppercase;">§07.${num}</span>
    <div>
      <h3 class="serif" style="font-size: 26px; margin-bottom: 6px;"><a href="/docs/${d.slug}" style="border-bottom: none;">${escapeHtml(d.title)}</a></h3>
      <p style="color: var(--muted); font-size: 15px; max-width: 60ch;">${escapeHtml(d.blurb)}</p>
    </div>
    <a href="/docs/${d.slug}" class="mono docs-read-cue" style="font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid var(--muted-2);">
      Read →
    </a>
  </li>`;
}
