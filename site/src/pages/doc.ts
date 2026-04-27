import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import { getDocBySlug, getAdjacentDocs, DOC_ENTRIES } from "../docs-content";
import { renderMarkdown, type TocEntry } from "../docs-render";

export function renderDocPage(slug: string): { body: string; status: 200 | 404 } {
  const doc = getDocBySlug(slug);
  if (!doc) {
    return { body: renderNotFound(slug), status: 404 };
  }
  const { html, toc } = renderMarkdown(doc.body);
  const { prev, next } = getAdjacentDocs(slug);

  const body = `${htmlHead({
    title: doc.title,
    description: doc.blurb,
    canonical: `https://open-think.app/docs/${doc.slug}`
  })}
<main class="doc-main">
  <div class="doc-layout">
    <aside class="doc-sidenav">
      <div class="doc-section-ref mono">§${String(doc.order).padStart(2, "0")} · ${escapeHtml(doc.section)}</div>
      <h1 class="doc-title serif">${escapeHtml(doc.title)}</h1>
      <p class="doc-blurb">${escapeHtml(doc.blurb)}</p>
      ${renderTocHtml(toc)}
      <div class="doc-sidenav-links">
        <a href="/docs" class="doc-back-link mono">← All docs</a>
        <a href="https://github.com/NeoFlux-Holdings/open-think/blob/main/docs/${docFilenameFromSlug(doc.slug)}" class="doc-source-link mono" rel="noopener noreferrer" target="_blank">Edit on GitHub ↗</a>
      </div>
    </aside>
    <article class="doc-article">
      ${html}
      ${renderFooter(prev, next)}
    </article>
  </div>
</main>
${htmlFoot()}`;
  return { body, status: 200 };
}

function renderTocHtml(toc: TocEntry[]): string {
  if (toc.length === 0) return "";
  return `<nav class="doc-toc" aria-label="On this page">
    <div class="doc-toc-label mono">On this page</div>
    <ol>
      ${toc
        .map(
          (t) =>
            `<li class="doc-toc-${t.depth}"><a href="#${t.anchor}">${escapeHtml(t.text)}</a></li>`
        )
        .join("")}
    </ol>
  </nav>`;
}

function renderFooter(
  prev: { slug: string; title: string } | null,
  next: { slug: string; title: string } | null
): string {
  if (!prev && !next) return "";
  const left = prev
    ? `<a class="doc-nav-card" href="/docs/${prev.slug}">
        <span class="mono">← Previous</span>
        <span class="serif">${escapeHtml(prev.title)}</span>
      </a>`
    : `<span class="doc-nav-card empty"></span>`;
  const right = next
    ? `<a class="doc-nav-card right" href="/docs/${next.slug}">
        <span class="mono">Next →</span>
        <span class="serif">${escapeHtml(next.title)}</span>
      </a>`
    : `<span class="doc-nav-card empty"></span>`;
  return `<div class="doc-nav-row">${left}${right}</div>`;
}

function docFilenameFromSlug(slug: string): string {
  // Reverses the slug → filename mapping used in docs-content.
  const map: Record<string, string> = {
    architecture: "ARCHITECTURE.md",
    "pa-stack": "PA_STACK.md",
    helm: "HELM.md",
    providers: "PROVIDERS.md",
    "codex-appserver": "CODEX_APPSERVER.md",
    rollback: "ROLLBACK.md",
    setup: "SETUP.md",
    "think-alignment": "THINK_ALIGNMENT.md",
    capabilities: "CAPABILITIES.md",
    "plugin-sdk": "PLUGIN_SDK.md",
    deployment: "DEPLOYMENT_RUNBOOK.md",
    "helm-cloud-runbook": "HELM_CLOUD_RUNBOOK.md",
    "agent-deploy-prompt": "AGENT_DEPLOY_PROMPT.md",
    incident: "INCIDENT_PLAYBOOK.md",
    release: "RELEASE_POLICY.md",
    artifacts: "ARTIFACTS_INTEGRATION.md",
    "codex-web": "CODEX_WEB_SETUP.md",
    "execution-plan": "EXECUTION_PLAN.md"
  };
  return map[slug] ?? `${slug.toUpperCase()}.md`;
}

function renderNotFound(slug: string): string {
  const suggestions = DOC_ENTRIES.slice(0, 6);
  return `${htmlHead({ title: "Doc not found" })}
<main class="doc-main">
  <section class="reveal d1" style="padding-top: 48px;">
    <div class="section-ref"><span>§ 404 · Doc not found</span><span class="rule"></span></div>
    <h1 class="serif" style="font-size: clamp(48px, 8vw, 96px); max-width: 18ch;">
      No doc named <em>${escapeHtml(slug)}</em>.
    </h1>
    <p class="sub" style="max-width: 58ch; color: var(--muted); margin-top: 18px;">
      Either the slug moved or we haven't written that one yet. Try one of these:
    </p>
    <ul class="mono" style="list-style: none; padding: 0; margin-top: 24px;">
      ${suggestions
        .map(
          (d) =>
            `<li style="padding: 8px 0; border-bottom: 1px dotted var(--muted-2);"><a href="/docs/${d.slug}" class="doc-link">/docs/${d.slug}</a> — ${escapeHtml(d.blurb)}</li>`
        )
        .join("")}
    </ul>
    <p style="margin-top: 24px;"><a href="/docs" class="btn">All docs</a></p>
  </section>
</main>
${htmlFoot()}`;
}
