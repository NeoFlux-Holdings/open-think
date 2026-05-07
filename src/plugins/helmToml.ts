/**
 * helm-toml — keep the user's local wrangler.toml in lock-step with the
 * live Worker. Solves the drift problem:
 *
 *   1. Agent calls cf-patch-binding to add an R2 binding live
 *   2. User later runs `wrangler deploy` from local machine
 *   3. wrangler reads local wrangler.toml, doesn't see the binding,
 *      drops it from the deployed Worker → silent regression
 *
 * Two skills:
 *
 *   helm-toml-sync — read-only. Diffs live Worker bindings/secrets/vars
 *     against the repo's wrangler.toml. Returns a structured drift report
 *     so the agent can decide what to reconcile.
 *
 *   helm-toml-patch — write. Adds or replaces a TOML block in the repo's
 *     wrangler.toml. Optionally commits + pushes via gh CLI / git.
 *
 * Both skills delegate to the helm-setup-exec mechanism (DO RPC into the
 * shell container), so they work whenever the container has the user's
 * repo cloned at REPO_PATH (default /workspace/repo). If the repo isn't
 * cloned yet, the skill returns instructions for cloning it first.
 *
 * Repo location is resolved from:
 *   1. input.repoPath
 *   2. env.HELM_REPO_PATH
 *   3. /workspace/repo (default)
 *
 * Auth for git pushes: the helm user's git credentials (set via
 * `git config` inside the shell, or via `gh auth login`). We don't
 * embed PATs here.
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";
import { AppError } from "../core/errors";
import { resolveShellSession } from "./helmShellSession";
import { execInSandbox } from "../sandbox";

interface ExecResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  code?: number;
  durationMs?: number;
  truncated?: boolean;
  timedOut?: boolean;
}

function asObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function resolveRepoPath(env: Env, input: unknown): string {
  const fromInput = asObj(input).repoPath;
  if (typeof fromInput === "string" && fromInput) return fromInput;
  const fromEnv = (env as Env & { HELM_REPO_PATH?: string }).HELM_REPO_PATH;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "/workspace/repo";
}

function resolveTomlRelative(env: Env, input: unknown): string {
  const fromInput = asObj(input).tomlPath;
  if (typeof fromInput === "string" && fromInput) return fromInput;
  const fromEnv = (env as Env & { HELM_WRANGLER_TOML_PATH?: string }).HELM_WRANGLER_TOML_PATH;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "wrangler.toml";
}

export class HelmTomlPlugin implements AgentPlugin {
  readonly id = "helm-toml";
  readonly version = "0.1.0";
  readonly description =
    "Keep wrangler.toml in lock-step with the deployed Worker. Detects drift between live bindings/secrets/vars and the repo file; patches + commits the file when the agent makes binding changes.";
  readonly capabilities = ["admin", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  /** Run a one-shot bash command in the container DO. Returns raw exec result. */
  private async execContainer(
    cmd: string,
    cwd?: string,
    timeoutMs = 30_000,
    sessionOverride?: string
  ): Promise<ExecResult> {
    if (!this.ctx) throw new AppError("E_NOT_INIT", "plugin not initialized", 500);
    const env = this.ctx.env as Env;
    // Default session matches the user's browser shell — derived from
    // env.AGENT_OWNER_EMAIL via the same FNV-1a hash /shell/ws uses.
    // So when the user `git clone`s in their browser tab, helm-toml-*
    // sees the files (same /workspace).
    const sessionId = resolveShellSession(env, sessionOverride);
    return execInSandbox(env, cmd, { cwd, timeoutMs, sessionId });
  }

  /**
   * Find the user's wrangler.toml. Tries (in order):
   *   1. Explicit input.repoPath / env.HELM_REPO_PATH
   *   2. /workspace/repo (our default convention)
   *   3. Scan /workspace for any subdirectory containing wrangler.toml
   *      (catches the common case where the user cloned to
   *      /workspace/<repo-name> instead of /workspace/repo)
   *
   * Returns the absolute directory containing wrangler.toml, plus the
   * relative tomlPath (almost always "wrangler.toml"), or null if none
   * found.
   */
  private async autoDetectRepo(repoPathHint: string, tomlRel: string): Promise<{ repoPath: string; tomlRel: string; foundVia: string } | null> {
    // Step 1: try the explicit / configured path.
    const direct = await this.execContainer(
      `[ -f "${tomlRel}" ] && echo OK || echo MISSING`,
      repoPathHint
    );
    if (direct.ok && (direct.stdout ?? "").trim() === "OK") {
      return { repoPath: repoPathHint, tomlRel, foundVia: "configured path" };
    }
    // Step 2: scan /workspace top-level for wrangler.toml.
    const scan = await this.execContainer(
      `find /workspace -maxdepth 3 -name wrangler.toml -not -path '*/node_modules/*' 2>/dev/null | head -5`
    );
    const candidates = (scan.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (candidates.length > 0) {
      const fullPath = candidates[0];
      const lastSlash = fullPath.lastIndexOf("/");
      const dir = fullPath.slice(0, lastSlash);
      const file = fullPath.slice(lastSlash + 1);
      return { repoPath: dir, tomlRel: file, foundVia: `auto-detected via find (also saw: ${candidates.slice(1).join(", ") || "no other matches"})` };
    }
    return null;
  }

  /** Read a wrangler.toml at the resolved path. Returns content + diagnostics. */
  private async readToml(repoPath: string, tomlPath: string): Promise<{ content: string | null; resolved?: { repoPath: string; tomlRel: string; foundVia: string }; diagnostic?: string }> {
    const r = await this.execContainer(
      `if [ -f "${tomlPath}" ]; then cat "${tomlPath}"; else echo "__HELM_NO_TOML__"; fi`,
      repoPath
    );
    if (!r.ok) {
      return {
        content: null,
        diagnostic: `exec failed (code ${r.code}): ${(r.stderr ?? "").slice(0, 200)}`
      };
    }
    const out = (r.stdout ?? "").replace(/\r\n/g, "\n");
    if (out.trim() !== "__HELM_NO_TOML__") {
      return { content: out };
    }
    // File missing at the configured path — try to find it elsewhere.
    const detected = await this.autoDetectRepo(repoPath, tomlPath);
    if (detected) {
      const r2 = await this.execContainer(`cat "${detected.tomlRel}"`, detected.repoPath);
      if (r2.ok) {
        return {
          content: (r2.stdout ?? "").replace(/\r\n/g, "\n"),
          resolved: detected
        };
      }
    }
    // Truly nothing — return diagnostic context.
    const ls = await this.execContainer(`ls -la /workspace/ 2>&1 | head -20`);
    return {
      content: null,
      diagnostic: `wrangler.toml not at ${repoPath}/${tomlPath}. /workspace contents:\n${(ls.stdout ?? "").slice(0, 800)}`
    };
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };
    const env = this.ctx.env as Env;
    const repoPath = resolveRepoPath(env, input);
    const tomlRel = resolveTomlRelative(env, input);

    if (action === "status") {
      // What does our environment look like for syncing?
      const ls = await this.execContainer(
        `if [ -d "${repoPath}/.git" ]; then echo CLONED; else echo NOT_CLONED; fi; echo "---"; if [ -f "${repoPath}/${tomlRel}" ]; then echo HAS_TOML; else echo NO_TOML; fi`,
        "/workspace"
      );
      const lines = (ls.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      // If the configured path has no wrangler.toml, scan for one.
      let detected: { repoPath: string; tomlRel: string; foundVia: string } | null = null;
      if (!lines.includes("HAS_TOML")) {
        detected = await this.autoDetectRepo(repoPath, tomlRel);
      }
      // Show what's in /workspace so the agent has context.
      const workspaceLs = await this.execContainer(`ls -la /workspace/ 2>&1 | head -20`);
      return {
        ok: true,
        data: {
          configuredRepoPath: repoPath,
          configuredTomlRel: tomlRel,
          configuredHasToml: lines.includes("HAS_TOML"),
          configuredHasGit: lines.includes("CLONED"),
          autoDetected: detected,
          // Effective values — what helm-toml-sync/patch will actually use.
          effectiveRepoPath: detected?.repoPath ?? repoPath,
          effectiveTomlRel: detected?.tomlRel ?? tomlRel,
          ready: lines.includes("HAS_TOML") || !!detected,
          workspaceContents: (workspaceLs.stdout ?? "").trim(),
          containerSession: resolveShellSession(env),
          hint: lines.includes("HAS_TOML")
            ? "ready — use configured path"
            : detected
              ? `ready — using auto-detected repo at ${detected.repoPath} (${detected.foundVia}). Pass these as input.repoPath/tomlPath to lock it in.`
              : `wrangler.toml not found anywhere in /workspace. Clone the repo first: helm-exec git clone <url> /workspace/<repo-name>`
        }
      };
    }

    if (action === "sync") {
      // Drift detection. Compare live bindings vs TOML declarations.
      const read = await this.readToml(repoPath, tomlRel);
      if (read.content === null) {
        return {
          ok: false,
          error: `wrangler.toml not found. ${read.diagnostic ?? ""}`,
          data: { configuredRepoPath: repoPath, configuredTomlRel: tomlRel, containerSession: resolveShellSession(env) }
        };
      }
      const toml = read.content;
      const accountId = env.CLOUDFLARE_ACCOUNT_ID;
      const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN;
      if (!token || !accountId) {
        return {
          ok: false,
          error: "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID required to sync."
        };
      }
      const scriptName = (asObj(input).scriptName as string) || env.AGENT_NAME || "helm";
      // Fetch live bindings.
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
        { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
      );
      const j = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        result?: { bindings?: Array<Record<string, unknown>> };
        errors?: Array<{ message: string }>;
      };
      if (!r.ok || !j.success) {
        return { ok: false, error: j.errors?.[0]?.message ?? `fetch settings ${r.status}` };
      }
      const liveBindings = j.result?.bindings ?? [];
      const drift = diffBindings(liveBindings, toml);
      return {
        ok: true,
        data: {
          repoPath: read.resolved?.repoPath ?? repoPath,
          tomlRel: read.resolved?.tomlRel ?? tomlRel,
          autoDetected: read.resolved ?? null,
          scriptName,
          liveBindingCount: liveBindings.length,
          drift,
          inSync: drift.missingFromToml.length === 0 && drift.missingFromLive.length === 0,
          notes: drift.missingFromToml.length > 0
            ? "wrangler.toml is missing bindings that exist on the live Worker. Next `wrangler deploy` from local will REMOVE them. Use helm-toml-patch to add them to the file."
            : drift.missingFromLive.length > 0
              ? "wrangler.toml has bindings the live Worker doesn't. They'll be added on next deploy."
              : "live Worker and wrangler.toml agree on bindings."
        }
      };
    }

    if (action === "patch") {
      // Append or replace a TOML block. The skill is intentionally
      // conservative: it adds blocks idempotently (replaces existing
      // [[r2_buckets]] / [[d1_databases]] etc. with the same `binding`)
      // and never edits unrelated sections.
      const o = asObj(input);
      const snippet = String(o.snippet ?? "").trim();
      if (!snippet) {
        return {
          ok: false,
          error: "input.snippet required — the TOML block to add (e.g. \"[[r2_buckets]]\\nbinding=…\\nbucket_name=…\")"
        };
      }
      const commitMessage = String(o.commitMessage ?? "wrangler.toml: helm-toml-patch sync");
      const push = Boolean(o.push);
      const read = await this.readToml(repoPath, tomlRel);
      if (read.content === null) {
        return {
          ok: false,
          error: `wrangler.toml not found. ${read.diagnostic ?? ""} Clone via helm-exec or set HELM_REPO_PATH.`
        };
      }
      // If autoDetect rerouted us to a different path, use that for the
      // write + git commands too. Otherwise the patch would write to a
      // dir that doesn't have the TOML.
      const effectiveRepo = read.resolved?.repoPath ?? repoPath;
      const effectiveToml = read.resolved?.tomlRel ?? tomlRel;
      const toml = read.content;
      const merged = mergeTomlBlock(toml, snippet);
      if (merged.unchanged) {
        return {
          ok: true,
          data: {
            changed: false,
            note: "Block already present in wrangler.toml; no edit needed."
          }
        };
      }
      // Write the new content via base64 round-trip (avoids quoting hell).
      const encoded = btoa(unescape(encodeURIComponent(merged.next)));
      const writeCmd = `echo "${encoded}" | base64 -d > "${effectiveToml}"`;
      const w = await this.execContainer(writeCmd, effectiveRepo);
      if (!w.ok) {
        return { ok: false, error: `write failed: ${(w.stderr ?? "").slice(0, 300)}` };
      }
      // Diff for the response.
      const d = await this.execContainer(`git diff --no-color -- "${effectiveToml}"`, effectiveRepo);
      // Stage + commit + (optionally) push.
      const commit = await this.execContainer(
        `git add "${effectiveToml}" && git -c user.name=Helm -c user.email=helm@open-think commit -m "${commitMessage.replace(/"/g, '\\"')}"`,
        effectiveRepo
      );
      const commitOk = commit.ok;
      let pushed: ExecResult | null = null;
      if (push && commitOk) {
        pushed = await this.execContainer("git push", effectiveRepo, 60_000);
      }
      return {
        ok: true,
        data: {
          changed: true,
          replaced: merged.replaced,
          appended: !merged.replaced,
          repoPath: effectiveRepo,
          tomlRel: effectiveToml,
          autoDetected: read.resolved ?? null,
          diff: (d.stdout ?? "").slice(0, 4000),
          committed: commitOk,
          commitOutput: (commit.stdout ?? "").slice(0, 800) + (commit.stderr ? "\n" + commit.stderr.slice(0, 400) : ""),
          pushed: pushed
            ? { ok: pushed.ok, output: ((pushed.stdout ?? "") + "\n" + (pushed.stderr ?? "")).slice(0, 800) }
            : null,
          notes: !commitOk
            ? "Edit applied but commit failed. Check `git status` in the shell. Often this means the repo has uncommitted unrelated changes — commit or stash them first."
            : push
              ? "Edit + commit + push complete. The local wrangler.toml now mirrors the live Worker."
              : "Edit + commit complete (not pushed). Run `git push` from the shell when ready."
        }
      };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}

/* ---------------- TOML merging primitives ---------------- */

interface DiffResult {
  /** Bindings on the live Worker but NOT declared in wrangler.toml. */
  missingFromToml: Array<{ type: string; name: string; bucketName?: string; databaseName?: string }>;
  /** Bindings declared in wrangler.toml but NOT on the live Worker. */
  missingFromLive: Array<{ type: string; name: string }>;
}

/**
 * Compare live Worker bindings to wrangler.toml block declarations.
 * We use a regex pass for the TOML side — good enough for the binding
 * blocks we care about (r2_buckets, d1_databases, kv_namespaces, ai,
 * services, queues, hyperdrive, send_email, browser, workflows).
 *
 * Not perfect TOML parsing — for the cases helm-toml-patch generates,
 * the regex is precise enough. Edge cases (multiline strings inside
 * blocks etc.) are very rare in practice for the binding shapes.
 */
export function diffBindings(
  liveBindings: Array<Record<string, unknown>>,
  toml: string
): DiffResult {
  const inToml = parseTomlBindings(toml);
  const liveKeys = new Set<string>();
  const tomlKeys = new Set<string>();
  for (const b of liveBindings) liveKeys.add(`${b.type}:${b.name}`);
  for (const b of inToml) tomlKeys.add(`${b.type}:${b.name}`);
  const missingFromToml: DiffResult["missingFromToml"] = [];
  for (const b of liveBindings) {
    const key = `${b.type}:${b.name}`;
    if (!tomlKeys.has(key)) {
      missingFromToml.push({
        type: String(b.type),
        name: String(b.name),
        bucketName: b.bucket_name as string | undefined,
        databaseName: b.database_name as string | undefined
      });
    }
  }
  const missingFromLive: DiffResult["missingFromLive"] = [];
  for (const b of inToml) {
    const key = `${b.type}:${b.name}`;
    if (!liveKeys.has(key)) {
      missingFromLive.push({ type: b.type, name: b.name });
    }
  }
  return { missingFromToml, missingFromLive };
}

/** Map [[r2_buckets]] / etc. → { type, name } */
const BLOCK_TO_TYPE: Record<string, string> = {
  r2_buckets: "r2_bucket",
  d1_databases: "d1",
  kv_namespaces: "kv_namespace",
  queues: "queue",
  hyperdrive: "hyperdrive",
  send_email: "send_email",
  workflows: "workflow",
  services: "service"
};

export function parseTomlBindings(toml: string): Array<{ type: string; name: string }> {
  const blocks: Array<{ type: string; name: string }> = [];
  // Match `[[<table>]]\n…binding = "<NAME>"…` blocks.
  const re = /\[\[(\w+)\]\][^\[]*?\bbinding\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(toml)) !== null) {
    const type = BLOCK_TO_TYPE[m[1]];
    if (!type) continue;
    blocks.push({ type, name: m[2] });
  }
  // Workers AI uses a single-table `[ai]\nbinding = "AI"` shape.
  const aiMatch = /\[ai\][^\[]*?\bbinding\s*=\s*"([^"]+)"/m.exec(toml);
  if (aiMatch) blocks.push({ type: "ai", name: aiMatch[1] });
  // [browser] same pattern.
  const browserMatch = /\[browser\][^\[]*?\bbinding\s*=\s*"([^"]+)"/m.exec(toml);
  if (browserMatch) blocks.push({ type: "browser", name: browserMatch[1] });
  return blocks;
}

interface MergeResult {
  next: string;
  replaced: boolean;
  unchanged: boolean;
}

/**
 * Merge a TOML snippet into a TOML doc. We extract the (table, binding)
 * pair from the snippet, then either:
 *   - Replace any existing block with the same (table, binding)
 *   - Append the snippet at the end
 * If neither applies (block already identical), return unchanged.
 */
export function mergeTomlBlock(toml: string, snippet: string): MergeResult {
  const trimmedSnippet = snippet.trim() + "\n";
  // Identify the snippet's table + binding name.
  const tableMatch = /\[\[?(\w+)\]?\]/.exec(trimmedSnippet);
  if (!tableMatch) {
    // No recognizable header; just append.
    if (toml.includes(trimmedSnippet.trim())) return { next: toml, replaced: false, unchanged: true };
    const next = toml.endsWith("\n") ? toml + "\n" + trimmedSnippet : toml + "\n\n" + trimmedSnippet;
    return { next, replaced: false, unchanged: false };
  }
  const table = tableMatch[1];
  const bindingMatch = /\bbinding\s*=\s*"([^"]+)"/.exec(trimmedSnippet);
  const bindingName = bindingMatch?.[1];

  const isArrayTable = trimmedSnippet.startsWith("[[");
  if (isArrayTable && bindingName) {
    // Find any existing block with same table + binding name.
    const blockRe = new RegExp(
      `\\[\\[${table}\\]\\][^\\[]*?\\bbinding\\s*=\\s*"${escapeRe(bindingName)}"[^\\[]*`,
      "g"
    );
    const existing = blockRe.exec(toml);
    if (existing) {
      // No-op: existing block already matches snippet content.
      if (existing[0].trim() === trimmedSnippet.trim()) {
        return { next: toml, replaced: false, unchanged: true };
      }
      const before = toml.slice(0, existing.index);
      const after = toml.slice(existing.index + existing[0].length);
      const next = normalizeBlankLines(
        before + trimmedSnippet + (after.startsWith("\n") || after.length === 0 ? after : "\n" + after)
      );
      return { next, replaced: true, unchanged: false };
    }
    // Not present — append.
    const next = toml.endsWith("\n\n") ? toml + trimmedSnippet : toml.endsWith("\n") ? toml + "\n" + trimmedSnippet : toml + "\n\n" + trimmedSnippet;
    return { next: normalizeBlankLines(next), replaced: false, unchanged: false };
  }
  // Single table (e.g. [ai]) — replace if present, else append.
  const singleRe = new RegExp(`\\[${table}\\][^\\[]*`, "g");
  const existing = singleRe.exec(toml);
  if (existing) {
    if (existing[0].trim() === trimmedSnippet.trim()) {
      return { next: toml, replaced: false, unchanged: true };
    }
    const before = toml.slice(0, existing.index);
    const after = toml.slice(existing.index + existing[0].length);
    return {
      next: normalizeBlankLines(before + trimmedSnippet + (after.startsWith("\n") || after.length === 0 ? after : "\n" + after)),
      replaced: true,
      unchanged: false
    };
  }
  const next = toml.endsWith("\n") ? toml + "\n" + trimmedSnippet : toml + "\n\n" + trimmedSnippet;
  return { next: normalizeBlankLines(next), replaced: false, unchanged: false };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse 3+ blank lines to 2. */
function normalizeBlankLines(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n");
}

/**
 * Generate a wrangler.toml block for a live Cloudflare binding. Used by
 * any drift-fix path (helm-github-sync-toml, helm-artifacts-sync-toml,
 * helm-toml-patch's reverse-engineering of cf-patch-binding output) so
 * we have one source of truth for "given a live binding, what does the
 * TOML look like?".
 *
 * `liveBindings` lets us pull richer fields (bucket_name / database_id /
 * etc.) that aren't in the lighter DiffResult entry. Pass the same
 * array helm-toml-sync did its diff against.
 */
export function buildTomlSnippet(
  driftEntry: { type: string; name: string; bucketName?: string; databaseName?: string },
  liveBindings: Array<Record<string, unknown>>
): string | null {
  const full = liveBindings.find(
    (b) => b.type === driftEntry.type && b.name === driftEntry.name
  );
  if (!full) return null;
  switch (driftEntry.type) {
    case "r2_bucket":
      return `[[r2_buckets]]\nbinding = "${driftEntry.name}"\nbucket_name = "${full.bucket_name ?? ""}"`;
    case "d1":
      return `[[d1_databases]]\nbinding = "${driftEntry.name}"\ndatabase_name = "${full.database_name ?? ""}"\ndatabase_id = "${full.database_id ?? ""}"`;
    case "kv_namespace":
      return `[[kv_namespaces]]\nbinding = "${driftEntry.name}"\nid = "${full.namespace_id ?? ""}"`;
    case "ai":
      return `[ai]\nbinding = "${driftEntry.name}"`;
    case "browser":
      return `[browser]\nbinding = "${driftEntry.name}"`;
    case "queue":
      return `[[queues.producers]]\nbinding = "${driftEntry.name}"\nqueue = "${full.queue_name ?? ""}"`;
    case "hyperdrive":
      return `[[hyperdrive]]\nbinding = "${driftEntry.name}"\nid = "${full.id ?? ""}"`;
    default:
      return `# helm: live Worker has ${driftEntry.type} binding "${driftEntry.name}" but the snippet generator doesn't know its TOML shape. Add manually.`;
  }
}
