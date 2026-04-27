/**
 * Marketplace manifest format.
 *
 * Every entry is one of five flavors:
 *   - **plugin** — an Open Think plugin that plugs into the main Worker's bus
 *   - **mcp-server** — an MCP server URL you connect to via the `mcp-client` plugin
 *   - **skill-pack** — a collection of skill prompts you import into your catalog
 *   - **agent-template** — a whole deployable starter repo
 *   - **companion** — a sibling Worker that runs alongside the main Worker
 *     (e.g. the codex-bridge-worker). Not a plugin — it's its own deployment.
 *
 * The shape below is what we hand-maintain in `data.ts` (and the per-entry files
 * under `entries/`) today; later we'll aggregate external sources (GitHub topic
 * search, hosted manifests, etc.) into the same type.
 */

export type EntryType =
  | "plugin"
  | "mcp-server"
  | "skill-pack"
  | "agent-template"
  | "companion";

export type EntryCategory =
  | "model-provider"
  | "account-ops"
  | "memory"
  | "tools"
  | "browser"
  | "code-exec"
  | "orchestration"
  | "discovery"
  | "productivity"
  | "research"
  | "coding"
  | "other";

export interface EntrySecret {
  name: string;
  description: string;
  required: boolean;
  pattern?: string; // e.g. starts with "sk-ant-"
}

export interface EntryInstall {
  /** Plugin ids to append to ENABLED_PLUGINS (if this entry ships an OT plugin). */
  enabledPluginsAdd?: string[];
  /** Hosts to append to ALLOWED_HOSTS. */
  allowedHostsAdd?: string[];
  /** Env vars / Worker secrets the user must configure. */
  secrets?: EntrySecret[];
  /** Arbitrary config snippet to append to wrangler.toml. */
  wranglerSnippet?: string;
  /** For mcp-server: the server URL + auth style. */
  mcpUrl?: string;
  mcpAuth?: "oauth" | "bearer" | "none";
  /** For skill-pack: URL to a JSON manifest of skill definitions we can import. */
  skillsJsonUrl?: string;
  /** For agent-template: repo + Deploy to Cloudflare link. */
  repoUrl?: string;
  deployButton?: string;
  /** Free-form shell commands / notes shown verbatim. */
  manualSteps?: string[];
}

export interface MarketplaceEntry {
  slug: string;
  title: string;
  /** One-line pitch (shown in cards). */
  tagline: string;
  /** Longer description, markdown-ish (used on detail page). */
  description: string;
  type: EntryType;
  category: EntryCategory;
  /** First-party (shipped with Open Think) vs community. */
  official: boolean;
  /** Canonical source (GitHub, docs, homepage). */
  source: string;
  author?: string;
  authorUrl?: string;
  license?: string;
  tags: string[];
  install: EntryInstall;
  /** Link to the doc page for this entry, if we host one on-domain. */
  docsPath?: string;
  /** Verified = we've tried it and it works with current Open Think. */
  verified: boolean;
  /** If we have a version / freshness signal. */
  updatedAt?: string;
  /** Small visual — two or three hex colors for the card accent strip. */
  accents?: [string, string?];
}
