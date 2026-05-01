/**
 * helm-github — container-free repo operations via the GitHub REST API.
 *
 * The helm-toml plugin keeps wrangler.toml in sync with the live Worker,
 * but it requires the Helm Shell container to be awake (uses `git` +
 * `cat` + `sed` inside bash). When the container is sleeping (15-min
 * idle default) those calls cold-start it just to read a file.
 *
 * helm-github does the same job over plain HTTPS to api.github.com —
 * no container needed, no cold start, runs in the Worker isolate. Use
 * it for:
 *   - Drift detection on a cron (no container wake-up cost)
 *   - One-shot reads from any file in the repo
 *   - Auto-PR'ing when the agent makes a binding change but doesn't
 *     want to wait for the container to come up
 *
 * Env config:
 *   GITHUB_TOKEN          PAT or fine-grained token (repo: contents + PRs)
 *   GITHUB_REPO           "owner/repo" (e.g. "tzarebczan/tomtom-agent")
 *   GITHUB_DEFAULT_BRANCH default branch to commit to (default "main")
 *   HELM_WRANGLER_TOML_PATH file path inside repo (default "wrangler.toml")
 *
 * Skills (registered in src/core/skills.ts):
 *   helm-github-status     check token + repo accessibility
 *   helm-github-read-file  GET a file's contents
 *   helm-github-write-file commit a file change (creates branch if needed)
 *   helm-github-open-pr    open a PR from a branch
 *   helm-github-sync-toml  one-call: fetch wrangler.toml, diff vs live
 *                          Worker bindings, write merged version back
 *                          (commit to default branch or open a PR)
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";
import { AppError } from "../core/errors";
import { buildTomlSnippet, diffBindings, mergeTomlBlock } from "./helmToml";

const GH_API = "https://api.github.com";
const GH_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28"
};

interface GhError {
  message: string;
  documentation_url?: string;
}

function asObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function resolveRepo(env: Env, input: unknown): { owner: string; repo: string } {
  const fromInput = String(asObj(input).repo ?? "");
  const fromEnv = (env as Env & { GITHUB_REPO?: string }).GITHUB_REPO ?? "";
  const raw = fromInput || fromEnv;
  if (!raw || !raw.includes("/")) {
    throw new AppError(
      "E_GITHUB_REPO_MISSING",
      "GITHUB_REPO not set. Format: \"owner/repo\". Set as a Worker secret or pass input.repo.",
      400
    );
  }
  const [owner, repo] = raw.split("/").map((s) => s.trim());
  return { owner, repo };
}

function resolveBranch(env: Env, input: unknown): string {
  const fromInput = asObj(input).branch;
  if (typeof fromInput === "string" && fromInput) return fromInput;
  const fromEnv = (env as Env & { GITHUB_DEFAULT_BRANCH?: string }).GITHUB_DEFAULT_BRANCH;
  return fromEnv || "main";
}

/** Base64 encode UTF-8 string (for GitHub's contents API). */
function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/\s/g, ""))));
}

export class HelmGithubPlugin implements AgentPlugin {
  readonly id = "helm-github";
  readonly version = "0.1.0";
  readonly description =
    "Container-free repo ops via GitHub REST API. Read/write files, open PRs, sync wrangler.toml against live Worker — without the Helm Shell container needing to be awake.";
  readonly capabilities = ["admin", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  private resolveToken(): string {
    const t = (this.ctx?.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
    if (!t) {
      throw new AppError(
        "E_GITHUB_TOKEN_MISSING",
        "GITHUB_TOKEN missing. Create a fine-grained PAT with repo:contents + pull-requests scopes at https://github.com/settings/personal-access-tokens. Set via cf-put-secret GITHUB_TOKEN.",
        400
      );
    }
    return t;
  }

  private async ghFetch(
    path: string,
    init: RequestInit = {}
  ): Promise<{ status: number; ok: boolean; data: unknown; raw: string }> {
    if (!this.ctx) throw new AppError("E_NOT_INIT", "plugin not initialized", 500);
    const url = path.startsWith("http") ? path : `${GH_API}${path}`;
    const headers: Record<string, string> = {
      ...GH_HEADERS,
      Authorization: `Bearer ${this.resolveToken()}`,
      ...((init.headers as Record<string, string>) ?? {})
    };
    if (init.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    const response = await this.ctx.fetch(url, { ...init, headers });
    const text = await response.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* leave as text */ }
    return { status: response.status, ok: response.ok, data, raw: text };
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };
    const env = this.ctx.env as Env;

    try {
      if (action === "status") {
        const o = asObj(input);
        const repoInput = (o.repo as string) ?? "";
        // Token check.
        const tok = (env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
        if (!tok) {
          return {
            ok: true,
            data: {
              hasToken: false,
              hint: "Set GITHUB_TOKEN as a Worker secret. Fine-grained PAT with repo:contents + pull-requests scopes."
            }
          };
        }
        const repoEnv = (env as Env & { GITHUB_REPO?: string }).GITHUB_REPO;
        const repoStr = repoInput || repoEnv;
        if (!repoStr) {
          return {
            ok: true,
            data: {
              hasToken: true,
              hasRepo: false,
              hint: "Set GITHUB_REPO as a Worker secret or var. Format: \"owner/repo\"."
            }
          };
        }
        const [owner, repo] = repoStr.split("/").map((s) => s.trim());
        // Probe the repo.
        const r = await this.ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
        return {
          ok: true,
          data: {
            hasToken: true,
            hasRepo: true,
            owner,
            repo,
            accessible: r.ok,
            defaultBranch: (r.data as { default_branch?: string })?.default_branch,
            httpStatus: r.status,
            error: r.ok ? null : (r.data as GhError)?.message ?? r.raw.slice(0, 200)
          }
        };
      }

      if (action === "read-file") {
        const { owner, repo } = resolveRepo(env, input);
        const branch = resolveBranch(env, input);
        const path = String(asObj(input).path ?? (env as Env & { HELM_WRANGLER_TOML_PATH?: string }).HELM_WRANGLER_TOML_PATH ?? "wrangler.toml");
        const r = await this.ghFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`
        );
        if (!r.ok) {
          return {
            ok: false,
            error: `read-file ${path} on ${owner}/${repo}@${branch}: ${(r.data as GhError)?.message ?? r.raw.slice(0, 200)}`
          };
        }
        const file = r.data as { content?: string; sha?: string; encoding?: string; size?: number; html_url?: string };
        const content = file.encoding === "base64" && typeof file.content === "string"
          ? b64decode(file.content)
          : "";
        return {
          ok: true,
          data: {
            owner, repo, branch, path,
            sha: file.sha,
            size: file.size,
            content,
            url: file.html_url
          }
        };
      }

      if (action === "write-file") {
        const { owner, repo } = resolveRepo(env, input);
        const branch = resolveBranch(env, input);
        const o = asObj(input);
        const path = String(o.path ?? (env as Env & { HELM_WRANGLER_TOML_PATH?: string }).HELM_WRANGLER_TOML_PATH ?? "wrangler.toml");
        const content = String(o.content ?? "");
        const message = String(o.message ?? `helm: update ${path}`);
        if (!content) return { ok: false, error: "input.content required" };

        // Look up the file's current sha (so we don't blow away concurrent
        // edits — the API requires it for updates; for new files it's omitted).
        const head = await this.ghFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`
        );
        const sha = head.ok ? (head.data as { sha?: string }).sha : undefined;
        const body: Record<string, unknown> = {
          message,
          content: b64encode(content),
          branch
        };
        if (sha) body.sha = sha;
        if (o.committerName || o.committerEmail) {
          body.committer = {
            name: String(o.committerName ?? "Helm"),
            email: String(o.committerEmail ?? "helm@open-think")
          };
        } else {
          body.committer = { name: "Helm", email: "helm@open-think" };
        }
        const r = await this.ghFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        if (!r.ok) {
          return {
            ok: false,
            error: `write-file ${path}: ${(r.data as GhError)?.message ?? r.raw.slice(0, 200)}`
          };
        }
        const result = r.data as { commit?: { sha?: string; html_url?: string } };
        return {
          ok: true,
          data: {
            owner, repo, branch, path,
            commitSha: result.commit?.sha,
            commitUrl: result.commit?.html_url,
            replacedExisting: Boolean(sha)
          }
        };
      }

      if (action === "create-branch") {
        const { owner, repo } = resolveRepo(env, input);
        const o = asObj(input);
        const branch = String(o.branch ?? "");
        const fromBranch = String(o.from ?? resolveBranch(env, input));
        if (!branch) return { ok: false, error: "input.branch required" };
        // Get the SHA of the base.
        const baseRef = await this.ghFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(fromBranch)}`
        );
        if (!baseRef.ok) {
          return { ok: false, error: `lookup ${fromBranch}: ${(baseRef.data as GhError)?.message ?? baseRef.raw.slice(0, 200)}` };
        }
        const baseSha = (baseRef.data as { object?: { sha?: string } }).object?.sha;
        const r = await this.ghFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
          {
            method: "POST",
            body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha })
          }
        );
        if (!r.ok && r.status !== 422) {
          return { ok: false, error: `create-branch ${branch}: ${(r.data as GhError)?.message ?? r.raw.slice(0, 200)}` };
        }
        // 422 = branch already exists; treat as idempotent.
        return {
          ok: true,
          data: { owner, repo, branch, baseBranch: fromBranch, alreadyExisted: r.status === 422 }
        };
      }

      if (action === "open-pr") {
        const { owner, repo } = resolveRepo(env, input);
        const o = asObj(input);
        const head = String(o.head ?? "");
        const base = String(o.base ?? resolveBranch(env, input));
        const title = String(o.title ?? "helm: sync");
        const body = String(o.body ?? "");
        if (!head) return { ok: false, error: "input.head (branch name) required" };
        const r = await this.ghFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
          { method: "POST", body: JSON.stringify({ title, head, base, body }) }
        );
        if (!r.ok) {
          return { ok: false, error: `open-pr: ${(r.data as GhError)?.message ?? r.raw.slice(0, 200)}` };
        }
        const pr = r.data as { number?: number; html_url?: string; state?: string };
        return {
          ok: true,
          data: { owner, repo, head, base, number: pr.number, url: pr.html_url, state: pr.state }
        };
      }

      if (action === "sync-toml") {
        // High-level: fetch wrangler.toml from repo, diff against live
        // Worker bindings, optionally apply the missing-from-toml ones
        // back to the file. Outputs the drift; takes action only when
        // input.apply is true.
        const o = asObj(input);
        const apply = Boolean(o.apply);
        const targetBranch = String(o.targetBranch ?? "");
        const baseBranch = resolveBranch(env, input);
        const path = String(o.path ?? (env as Env & { HELM_WRANGLER_TOML_PATH?: string }).HELM_WRANGLER_TOML_PATH ?? "wrangler.toml");
        const accountId = env.CLOUDFLARE_ACCOUNT_ID;
        const cfToken = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN;
        if (!accountId || !cfToken) {
          return { ok: false, error: "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID required" };
        }
        const scriptName = String(o.scriptName ?? env.AGENT_NAME ?? "helm");

        // 1. Fetch live bindings from CF.
        const cfResp = await this.ctx.fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
          { headers: { Authorization: `Bearer ${cfToken}`, accept: "application/json" } }
        );
        if (!cfResp.ok) {
          const t = await cfResp.text();
          return { ok: false, error: `cf-list-bindings ${scriptName}: ${t.slice(0, 200)}` };
        }
        const cfJson = (await cfResp.json()) as { result?: { bindings?: Array<Record<string, unknown>> } };
        const liveBindings = cfJson.result?.bindings ?? [];

        // 2. Fetch wrangler.toml from GitHub.
        const fileRead = await this.invoke("read-file", { path, branch: baseBranch });
        if (!fileRead.ok) return fileRead;
        const fileData = fileRead.data as { content: string; sha?: string };
        const tomlContent = fileData.content;

        // 3. Compute drift.
        const drift = diffBindings(liveBindings, tomlContent);
        if (!apply) {
          return {
            ok: true,
            data: {
              dryRun: true,
              owner: resolveRepo(env, input).owner,
              repo: resolveRepo(env, input).repo,
              path,
              baseBranch,
              scriptName,
              liveBindingCount: liveBindings.length,
              drift,
              inSync: drift.missingFromToml.length === 0,
              hint: drift.missingFromToml.length === 0
                ? "wrangler.toml is in sync with live Worker."
                : `wrangler.toml is missing ${drift.missingFromToml.length} binding(s). Re-run with apply:true to commit them.`
            }
          };
        }

        // 4. Apply: build TOML snippets for missing bindings + merge.
        if (drift.missingFromToml.length === 0) {
          return { ok: true, data: { dryRun: false, applied: 0, note: "Already in sync; no edits made." } };
        }
        let merged = tomlContent;
        const appliedBlocks: string[] = [];
        for (const b of drift.missingFromToml) {
          const snippet = buildTomlSnippet(b, liveBindings);
          if (!snippet) continue;
          const m = mergeTomlBlock(merged, snippet);
          if (!m.unchanged) {
            merged = m.next;
            appliedBlocks.push(snippet);
          }
        }
        // 5. Write to a branch (target) or directly to base.
        const writeBranch = targetBranch || baseBranch;
        if (targetBranch && targetBranch !== baseBranch) {
          // Ensure target branch exists.
          await this.invoke("create-branch", { branch: targetBranch, from: baseBranch });
        }
        const write = await this.invoke("write-file", {
          path,
          content: merged,
          branch: writeBranch,
          message: `helm: sync wrangler.toml (${appliedBlocks.length} binding${appliedBlocks.length === 1 ? "" : "s"})`
        });
        if (!write.ok) return write;
        // 6. Optionally open a PR.
        let pr = null;
        if (targetBranch && targetBranch !== baseBranch && o.openPR !== false) {
          const prRes = await this.invoke("open-pr", {
            head: targetBranch,
            base: baseBranch,
            title: `helm: sync wrangler.toml drift`,
            body: `Auto-PR from helm-github-sync-toml. Adds ${appliedBlocks.length} binding(s) the live Worker has but wrangler.toml didn't:\n\n${appliedBlocks.map((s) => "```toml\n" + s + "\n```").join("\n\n")}`
          });
          if (prRes.ok) pr = prRes.data;
        }
        return {
          ok: true,
          data: {
            dryRun: false,
            applied: appliedBlocks.length,
            blocks: appliedBlocks,
            commit: write.data,
            pr
          }
        };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// buildTomlSnippet now lives in helmToml.ts so helm-artifacts can reuse it.
