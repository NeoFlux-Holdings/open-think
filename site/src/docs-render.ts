import { marked, Renderer, type Tokens } from "marked";

/**
 * Render a markdown string to HTML with the editorial aesthetic baked in.
 *
 *   - Headings: serif display with a tiny monospaced §-ref on h2/h3
 *   - Code blocks: mono with a left accent-color rule, no syntax highlighting (deliberate)
 *   - Inline code: subtle tinted background
 *   - Blockquotes: accent-color left border + italic serif
 *   - Tables: hairline rules, small-caps headers
 *   - Links: ink with ink underline, accent on hover
 *
 * Also extracts an outline (h2/h3) for the sidebar TOC.
 */

export interface RenderResult {
  html: string;
  toc: TocEntry[];
}

export interface TocEntry {
  depth: 2 | 3;
  text: string;
  anchor: string;
}

/**
 * Re-render inline tokens back to markdown, then let `marked.parseInline` turn
 * them into HTML. `marked.parser(tokens)` is the BLOCK parser — passing inline
 * tokens (strong, em, codespan, link, …) to it throws "Token with X type was
 * not found" because the block parser only knows about block tokens.
 *
 * marked exposes each token's `raw` source text, so concatenating them and
 * running the inline parser gives us exactly what we want for the parts of
 * the renderer that receive inline tokens (table cells, link text, headings).
 */
function parseInlineTokens(tokens: unknown): string {
  if (!Array.isArray(tokens)) return "";
  const source = tokens
    .map((t) => (t && typeof t === "object" && "raw" in t ? String((t as { raw: string }).raw) : ""))
    .join("");
  return marked.parseInline(source, { async: false }) as string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

let anchorCounter = 0;

export function renderMarkdown(body: string): RenderResult {
  anchorCounter = 0;
  const toc: TocEntry[] = [];
  const seenAnchors = new Set<string>();

  const renderer = new Renderer();

  renderer.heading = ({ tokens, depth }: Tokens.Heading) => {
    const text = parseInlineTokens(tokens).trim();
    anchorCounter += 1;
    let anchor = slugify(text.replace(/<[^>]+>/g, "")) || `h-${anchorCounter}`;
    while (seenAnchors.has(anchor)) {
      anchor = `${anchor}-${anchorCounter}`;
      anchorCounter += 1;
    }
    seenAnchors.add(anchor);

    if (depth === 1) {
      // Suppress h1 — the page layout already renders the doc title.
      return "";
    }
    if (depth === 2 || depth === 3) {
      toc.push({ depth, text: text.replace(/<[^>]+>/g, ""), anchor });
    }
    const cls =
      depth === 2
        ? "doc-h2 serif"
        : depth === 3
          ? "doc-h3 serif"
          : "doc-h" + depth + " serif";
    return `<h${depth} id="${anchor}" class="${cls}"><a class="anchor-link" href="#${anchor}" aria-label="link to this heading">§</a>${text}</h${depth}>`;
  };

  renderer.code = ({ text, lang }: Tokens.Code) => {
    const langLabel = lang ? ` data-lang="${escapeAttr(lang)}"` : "";
    return `<pre class="doc-code mono"${langLabel}><code>${escapeHtml(text)}</code></pre>`;
  };

  renderer.codespan = ({ text }: Tokens.Codespan) => {
    return `<code class="doc-inline-code mono">${escapeHtml(text)}</code>`;
  };

  renderer.blockquote = ({ tokens }: Tokens.Blockquote) => {
    const inner = marked.parser(tokens);
    return `<blockquote class="doc-quote serif italic">${inner}</blockquote>`;
  };

  renderer.link = ({ href, title, tokens }: Tokens.Link) => {
    const text = parseInlineTokens(tokens);
    const external = /^https?:\/\//.test(href ?? "");
    const rel = external ? ' rel="noopener noreferrer"' : "";
    const target = external ? ' target="_blank"' : "";
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
    const marker = external ? ' <span class="ext">↗</span>' : "";
    return `<a class="doc-link" href="${escapeAttr(href ?? "")}"${titleAttr}${rel}${target}>${text}${marker}</a>`;
  };

  renderer.table = ({ header, rows }: Tokens.Table) => {
    const headCells = header
      .map((cell) => `<th class="mono">${parseInlineTokens(cell.tokens)}</th>`)
      .join("");
    const bodyRows = rows
      .map((row) => {
        const cells = row
          .map((cell) => `<td>${parseInlineTokens(cell.tokens)}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    return `<div class="doc-table-wrap"><table class="doc-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  };

  renderer.list = ({ ordered, items, start }: Tokens.List) => {
    const tag = ordered ? "ol" : "ul";
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
    const inner = items
      .map((item) => {
        const text = marked.parser(item.tokens);
        return `<li class="doc-li">${text}</li>`;
      })
      .join("");
    return `<${tag} class="doc-list"${startAttr}>${inner}</${tag}>`;
  };

  renderer.paragraph = ({ tokens }: Tokens.Paragraph) => {
    const text = marked.parseInline(
      tokens
        .map((t) => ("raw" in t ? (t as { raw: string }).raw : ""))
        .join("")
    );
    return `<p class="doc-p">${text}</p>`;
  };

  renderer.hr = () => `<hr class="doc-hr" />`;

  const html = marked.parse(body, { renderer, gfm: true, async: false }) as string;
  return { html, toc };
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

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
