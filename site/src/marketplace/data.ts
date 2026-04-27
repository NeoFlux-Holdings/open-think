import type { MarketplaceEntry } from "./types";

// Per-entry imports. One file per slug, under ./entries/.
// Adding an entry: create entries/<slug>.ts exporting `entry: MarketplaceEntry`
// and add one line below. Run `npm run marketplace:validate` to sanity-check.
import { entry as cfAiGateway } from "./entries/cf-ai-gateway";
import { entry as cloudflareApiMcp } from "./entries/cloudflare-api-mcp";
import { entry as workersAi } from "./entries/workers-ai";
import { entry as anthropic } from "./entries/anthropic";
import { entry as openaiCompatible } from "./entries/openai-compatible";
import { entry as codex } from "./entries/codex";
import { entry as codexBridgeWorker } from "./entries/codex-bridge-worker";
import { entry as mcpClient } from "./entries/mcp-client";
import { entry as browser } from "./entries/browser";
import { entry as sandbox } from "./entries/sandbox";
import { entry as mcpCloudflare } from "./entries/mcp-cloudflare";
import { entry as mcpGithub } from "./entries/mcp-github";
import { entry as mcpNotion } from "./entries/mcp-notion";
import { entry as gbrain } from "./entries/gbrain";
import { entry as andrejKarpathy } from "./entries/andrej-karpathy-skills";
import { entry as multica } from "./entries/multica";
import { entry as vercelAgentResources } from "./entries/vercel-agent-resources";
// PA-stack plugins (auth, memory, email, notifier, calendar — added 2026-04).
import { entry as memory } from "./entries/memory";
import { entry as email } from "./entries/email";
import { entry as notifier } from "./entries/notifier";
import { entry as calendar } from "./entries/calendar";

/**
 * Marketplace catalog. Aggregated from one-file-per-entry under ./entries/.
 *
 * Display order: first-party (official: true) sorted by type (plugin → mcp-server →
 * skill-pack → agent-template → companion), then community entries in the same
 * order. `sortEntries()` below enforces this so importers can shuffle without
 * touching the display.
 *
 * Honesty conventions:
 *   - `verified: true` only if the entry is wired + tested against the current
 *     Open Think runtime (our own first-party plugins all pass this).
 *   - `verified: false` = we've linked it as a discovery reference. The install
 *     steps are best-effort; readers should expect to read the upstream docs.
 *   - External entries (gbrain, Karpathy, Multica, Vercel) are listed as
 *     inspiration / bridge targets. We document integration paths, not promises.
 */

const ALL_ENTRIES: MarketplaceEntry[] = [
  cfAiGateway,
  cloudflareApiMcp,
  workersAi,
  anthropic,
  openaiCompatible,
  codex,
  codexBridgeWorker,
  mcpClient,
  browser,
  sandbox,
  memory,
  email,
  notifier,
  calendar,
  mcpCloudflare,
  mcpGithub,
  mcpNotion,
  gbrain,
  andrejKarpathy,
  multica,
  vercelAgentResources
];

const TYPE_ORDER: Record<MarketplaceEntry["type"], number> = {
  plugin: 0,
  "mcp-server": 1,
  "skill-pack": 2,
  "agent-template": 3,
  companion: 4
};

function sortEntries(entries: MarketplaceEntry[]): MarketplaceEntry[] {
  return [...entries].sort((a, b) => {
    // Official first, then by type, then by title
    if (a.official !== b.official) return a.official ? -1 : 1;
    const t = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    if (t !== 0) return t;
    return a.title.localeCompare(b.title);
  });
}

export const ENTRIES: MarketplaceEntry[] = sortEntries(ALL_ENTRIES);

export function byType(type: MarketplaceEntry["type"]): MarketplaceEntry[] {
  return ENTRIES.filter((e) => e.type === type);
}

export function findBySlug(slug: string): MarketplaceEntry | undefined {
  return ENTRIES.find((e) => e.slug === slug);
}

/**
 * Structural validation. Called by `scripts/validate_marketplace.mjs` in CI and
 * by the build so broken entries fail-fast instead of 500ing the marketplace
 * detail page. Exported for the script; not used at runtime in the deployed
 * Worker (the cost would be measured per cold-start).
 */
export function validate(entries: MarketplaceEntry[] = ALL_ENTRIES): string[] {
  const errors: string[] = [];
  const slugs = new Set<string>();
  const slugPattern = /^[a-z0-9-]+$/;

  for (const e of entries) {
    if (!e.slug) {
      errors.push(`Entry with title "${e.title}" has no slug.`);
      continue;
    }
    if (!slugPattern.test(e.slug)) {
      errors.push(`Slug "${e.slug}" must be lowercase-hyphenated (a-z, 0-9, -).`);
    }
    if (slugs.has(e.slug)) {
      errors.push(`Duplicate slug: "${e.slug}".`);
    }
    slugs.add(e.slug);

    if (!e.title) errors.push(`${e.slug}: title required.`);
    if (!e.tagline) errors.push(`${e.slug}: tagline required.`);
    if (!e.description) errors.push(`${e.slug}: description required.`);
    if (e.tagline && e.tagline.length > 120) {
      errors.push(`${e.slug}: tagline is ${e.tagline.length} chars (max 120).`);
    }
    if (!e.source) errors.push(`${e.slug}: source URL required.`);
    if (e.source && !/^https?:\/\//.test(e.source)) {
      errors.push(`${e.slug}: source must be a URL.`);
    }

    for (const host of e.install.allowedHostsAdd ?? []) {
      if (!/^[a-z0-9.-]+(\.[a-z]{2,})+$/i.test(host)) {
        errors.push(`${e.slug}: allowedHostsAdd contains invalid hostname "${host}".`);
      }
    }
    for (const secret of e.install.secrets ?? []) {
      if (!secret.name || !/^[A-Z][A-Z0-9_]*$/.test(secret.name)) {
        errors.push(`${e.slug}: secret "${secret.name}" must be UPPER_SNAKE_CASE.`);
      }
      if (!secret.description) {
        errors.push(`${e.slug}: secret "${secret.name}" needs a description.`);
      }
    }
  }

  return errors;
}
