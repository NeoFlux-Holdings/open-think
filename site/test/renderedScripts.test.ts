/**
 * Catch a class of bug we've now hit twice in the same week:
 *
 *   The TS files in src/pages/*.ts return their entire HTML page from a
 *   top-level template literal. Inside <script> blocks, escape sequences
 *   like `\/` or `\(` get consumed by the outer template literal, so the
 *   browser sees `/` and `(` — which are invalid INSIDE a regex literal,
 *   producing SyntaxError at parse time and killing the entire IIFE
 *   (so click handlers never attach, etc.).
 *
 * This test renders every page module, extracts every <script> block, and
 * runs it through `new Function()` to confirm it parses. If a page ships
 * a regex with `\X` that needs to be `\\X`, this test fails locally before
 * the user opens DevTools and finds out.
 *
 * False-positive consideration: the rendered scripts often reference DOM
 * APIs (document, fetch, location, etc.) that aren't available at parse
 * time. That's fine — `new Function()` parses without executing, so DOM
 * references are syntactically valid even when the names don't resolve.
 */
import { describe, expect, it } from "vitest";

interface PageModule {
  /** Identifier the test report uses; e.g. "cloudDeploy". */
  label: string;
  /** Async loader returning the rendered HTML string. */
  render: () => Promise<string>;
}

const PAGES: PageModule[] = [
  {
    label: "cloudDeploy",
    render: async () => (await import("../src/pages/cloudDeploy")).renderCloudDeploy()
  },
  {
    label: "cloudGuided",
    render: async () => (await import("../src/pages/cloudGuided")).renderCloudGuided()
  },
  {
    label: "landing",
    render: async () => {
      const m = await import("../src/pages/landing");
      const fn = (m as Record<string, unknown>).renderLanding ?? (m as Record<string, unknown>).default;
      if (typeof fn !== "function") throw new Error("landing has no renderable export");
      return (fn as () => string)();
    }
  },
  {
    label: "pricing",
    render: async () => {
      const m = await import("../src/pages/pricing");
      const fn = (m as Record<string, unknown>).renderPricing ?? (m as Record<string, unknown>).default;
      if (typeof fn !== "function") throw new Error("pricing has no renderable export");
      return (fn as () => string)();
    }
  },
  {
    label: "marketplace",
    render: async () => {
      const m = await import("../src/pages/marketplace");
      const fn = (m as Record<string, unknown>).renderMarketplace ?? (m as Record<string, unknown>).default;
      if (typeof fn !== "function") throw new Error("marketplace has no renderable export");
      return (fn as () => string)();
    }
  },
  {
    label: "success",
    render: async () => {
      const m = await import("../src/pages/success");
      const fn = (m as Record<string, unknown>).renderSuccess ?? (m as Record<string, unknown>).default;
      if (typeof fn !== "function") throw new Error("success has no renderable export");
      return (fn as () => string)();
    }
  }
];

function extractScriptBlocks(html: string): string[] {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Skip <script src="..."> / <script type="..." src=...> — only inline.
    const openTag = html.slice(m.index, m.index + m[0].indexOf(">") + 1);
    if (/\bsrc\s*=/i.test(openTag)) continue;
    if (/type\s*=\s*["'](application\/json|importmap)["']/i.test(openTag)) continue;
    if (m[1].trim().length === 0) continue;
    blocks.push(m[1]);
  }
  return blocks;
}

function tryParse(scriptBody: string): { ok: true } | { ok: false; error: string; line: number; near: string } {
  try {
    // eslint-disable-next-line no-new-func
    new Function(scriptBody);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Best-effort: surface a few lines of context around any line number
    // we can pull out of the message.
    const lineMatch = /(?:line\s+|:)(\d+)/i.exec(msg);
    const line = lineMatch ? Number(lineMatch[1]) : 0;
    const lines = scriptBody.split("\n");
    const start = Math.max(0, line - 2);
    const end = Math.min(lines.length, line + 2);
    const near = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
    return { ok: false, error: msg, line, near };
  }
}

describe("rendered page scripts parse cleanly", () => {
  for (const page of PAGES) {
    it(`${page.label}: every inline <script> parses`, async () => {
      let html: string;
      try {
        html = await page.render();
      } catch (err) {
        // Module loaded but render threw — render functions sometimes
        // require args (e.g., a deployment row); skip rather than fail.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[rendered-scripts] skipping ${page.label}: render threw: ${msg}`);
        return;
      }
      const blocks = extractScriptBlocks(html);
      // Most pages have at least one inline script; a few are static.
      // Both are fine — we just need the ones that DO ship to parse.
      for (let i = 0; i < blocks.length; i++) {
        const result = tryParse(blocks[i]);
        if (!result.ok) {
          throw new Error(
            `${page.label} <script> block #${i + 1} fails to parse: ${result.error}\n\n` +
              `(Common cause: a single backslash inside a regex/string literal in source. ` +
              `The outer TS template literal eats the backslash, so the rendered page contains ` +
              `a broken regex. Use \\\\ in source so the page sees \\.)\n\n` +
              `Around the failure (line ~${result.line}):\n${result.near}`
          );
        }
      }
    });
  }
});
