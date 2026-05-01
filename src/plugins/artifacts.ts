/**
 * helm-artifacts — Cloudflare Artifacts as the canonical source of truth
 * for the user's Worker source code + wrangler.toml. Artifacts is a real
 * git remote backed by Cloudflare's storage (public beta as of May 2026):
 * the user clones it locally, the agent clones it inside the helm-shell
 * container, and both push to the same place. No GitHub required.
 *
 * Why Artifacts over GitHub:
 *   - Zero external auth: tokens are scoped + short-lived, minted on
 *     demand by the binding or REST API. Users don't need a GitHub
 *     account to run Open Think.
 *   - Works for "deploy on push": the same credentials that read source
 *     also let the Worker hot-redeploy itself when main moves.
 *   - Per-tenant isolation: one repo per user (or per project) inside
 *     a namespace, scoped tokens, no cross-talk.
 *
 * Architecture:
 *   - CONTROL PLANE  (create / import / list / mint-token) — REST API.
 *     Falls back to env.ARTIFACTS binding if the binding is bound and
 *     the user prefers it. Both work; REST is simpler to mock + more
 *     forward-compatible.
 *   - FILE OPS       (clone / read / write / commit / push / log / diff)
 *     — git smart-HTTP via the helm-shell container. The container
 *     already has `git`; we just point it at the Artifacts remote with
 *     a freshly-minted token. Same pattern helm-toml uses for the
 *     legacy GitHub flow.
 *
 * Skills (registered in src/core/skills.ts):
 *   helm-artifacts-status         binding + REST + repo accessibility
 *   helm-artifacts-init           create or import a repo (idempotent)
 *   helm-artifacts-list-repos     list repos in the namespace
 *   helm-artifacts-repo-info      get repo metadata
 *   helm-artifacts-mint-token     mint a scoped time-bounded token
 *   helm-artifacts-clone          ensure repo is cloned into the container
 *   helm-artifacts-pull           git pull on the container clone
 *   helm-artifacts-read-file      read a file from the container clone
 *   helm-artifacts-write-file     atomic edit + commit + push
 *   helm-artifacts-ls             list files in HEAD
 *   helm-artifacts-history        git log
 *   helm-artifacts-diff           git diff
 *   helm-artifacts-sync-toml      drift-fix wrangler.toml against live Worker
 *   helm-artifacts-deploy         PUT /workers/scripts from the clone
 *   helm-artifacts-import-github  one-shot bootstrap from a public GitHub URL
 *   helm-artifacts-cron-sync      drift-check + notify (called by scheduled handler)
 *
 * Env config:
 *   CLOUDFLARE_API_TOKEN     CF API token with Artifacts:Edit scope
 *   CLOUDFLARE_ACCOUNT_ID    auto-resolved if missing
 *   ARTIFACTS_NAMESPACE      default "default"
 *   ARTIFACTS_REPO           default env.AGENT_NAME ?? "helm"
 *   ARTIFACTS_BRANCH         default "main"
 *   ARTIFACTS_TOKEN          optional pre-minted long-lived token
 *   ARTIFACTS_BOOTSTRAP_URL  optional GitHub URL to import on init
 *   ARTIFACTS_CHECKOUT_PATH  where to clone in the container
 *                            (default /workspace/<repo>)
 *   ARTIFACTS_AUTO_SYNC      "1" enables scheduled-handler drift checks
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { ArtifactsBinding, ArtifactsCreateTokenResult, Env } from "../types";
import { AppError } from "../core/errors";
import {
  buildTomlSnippet,
  diffBindings,
  mergeTomlBlock,
  parseTomlBindings
} from "./helmToml";
import { resolveShellSession } from "./helmShellSession";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ExecResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  code?: number;
  durationMs?: number;
  truncated?: boolean;
  timedOut?: boolean;
}

interface CfApiEnvelope<T> {
  result?: T;
  success?: boolean;
  errors?: Array<{ message: string; code?: number }>;
  messages?: Array<{ message: string }>;
}

interface ArtifactsRepoApiShape {
  id: string;
  name: string;
  description: string | null;
  default_branch: string;
  remote: string;
  read_only?: boolean;
  source?: string | null;
  created_at?: string;
  updated_at?: string;
  last_push_at?: string | null;
}

interface ArtifactsTokenApiShape {
  id: string;
  plaintext?: string;
  scope: "read" | "write";
  expires_at: string;
  state?: "active" | "expired" | "revoked";
  created_at?: string;
}

function asObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function resolveNamespace(env: Env, input: unknown): string {
  const fromInput = asObj(input).namespace;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  return (env.ARTIFACTS_NAMESPACE && env.ARTIFACTS_NAMESPACE.trim()) || "default";
}

function resolveRepoName(env: Env, input: unknown): string {
  const fromInput = asObj(input).repo;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  if (env.ARTIFACTS_REPO && env.ARTIFACTS_REPO.trim()) return env.ARTIFACTS_REPO.trim();
  return env.AGENT_NAME && env.AGENT_NAME.trim() ? env.AGENT_NAME.trim() : "helm";
}

function resolveBranch(env: Env, input: unknown): string {
  const fromInput = asObj(input).branch;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  return (env.ARTIFACTS_BRANCH && env.ARTIFACTS_BRANCH.trim()) || "main";
}

function resolveCheckoutPath(env: Env, repoName: string, input: unknown): string {
  const fromInput = asObj(input).checkoutPath;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  if (env.ARTIFACTS_CHECKOUT_PATH && env.ARTIFACTS_CHECKOUT_PATH.trim()) {
    return env.ARTIFACTS_CHECKOUT_PATH.trim();
  }
  return `/workspace/${repoName}`;
}

function resolveTomlRel(env: Env, input: unknown): string {
  const fromInput = asObj(input).tomlPath;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  return (env.HELM_WRANGLER_TOML_PATH && env.HELM_WRANGLER_TOML_PATH.trim()) || "wrangler.toml";
}

function shellEscape(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Parse the `?expires=<unix>` suffix off an Artifacts token; null if missing. */
function tokenExpiresAt(token: string | undefined): number | null {
  if (!token) return null;
  const m = /[?&]expires=(\d+)/.exec(token);
  if (!m) return null;
  return Number(m[1]) * 1000;
}

function tokenStillFresh(token: string | undefined, marginSec = 60): boolean {
  const expMs = tokenExpiresAt(token);
  if (!expMs) return false;
  return expMs - marginSec * 1000 > Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

export class HelmArtifactsPlugin implements AgentPlugin {
  readonly id = "helm-artifacts";
  readonly version = "1.0.0";
  readonly description =
    "Cloudflare Artifacts as the canonical source-of-truth for wrangler.toml + Worker source. Replaces GitHub for users who don't want to manage a GitHub PAT. Provides bidirectional sync: the user clones the Artifacts repo locally; the agent clones it inside helm-shell; both push to the same canonical remote. Auto-deploy on push supported.";
  readonly capabilities = ["admin", "tools"] as const;

  private ctx?: PluginContext;
  /** Cached short-lived write token (with `?expires=...` suffix). */
  private cachedToken: string | undefined;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  // ─── env / config ───────────────────────────────────────────────────────

  private requireCtx(): PluginContext {
    if (!this.ctx) throw new AppError("E_NOT_INIT", "helm-artifacts not initialized", 500);
    return this.ctx;
  }

  private env(): Env {
    return this.requireCtx().env as Env;
  }

  private async resolveAccountId(): Promise<string> {
    const env = this.env();
    if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID.trim()) {
      return env.CLOUDFLARE_ACCOUNT_ID.trim();
    }
    // Fallback: ask CF for the first visible account.
    const tok = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN;
    if (!tok) {
      throw new AppError(
        "E_CF_TOKEN_MISSING",
        "CLOUDFLARE_API_TOKEN required to resolve account id (set via cf-put-secret).",
        400
      );
    }
    const r = await this.requireCtx().fetch("https://api.cloudflare.com/client/v4/accounts", {
      headers: { Authorization: `Bearer ${tok}`, accept: "application/json" }
    });
    const j = (await r.json().catch(() => ({}))) as CfApiEnvelope<Array<{ id: string }>>;
    if (!r.ok || !j.success || !j.result?.length) {
      throw new AppError(
        "E_CF_NO_ACCOUNTS",
        `Could not resolve account id: ${j.errors?.[0]?.message ?? r.statusText}`,
        400
      );
    }
    return j.result[0].id;
  }

  private requireToken(): string {
    const env = this.env();
    const tok = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN;
    if (!tok) {
      throw new AppError(
        "E_CF_TOKEN_MISSING",
        "CLOUDFLARE_API_TOKEN required (Artifacts:Edit scope). Set via cf-put-secret.",
        400
      );
    }
    return tok;
  }

  /** Account-scoped artifacts host, e.g. `<acct>.artifacts.cloudflare.net`. */
  private async artifactsHost(): Promise<string> {
    const acct = await this.resolveAccountId();
    return `${acct}.artifacts.cloudflare.net`;
  }

  private async remoteUrl(input: unknown): Promise<string> {
    const env = this.env();
    const namespace = resolveNamespace(env, input);
    const repo = resolveRepoName(env, input);
    const host = await this.artifactsHost();
    return `https://${host}/git/${namespace}/${repo}.git`;
  }

  // ─── REST API helper ────────────────────────────────────────────────────

  private async cfArtifactsFetch<T = unknown>(
    pathSuffix: string,
    init: RequestInit & { namespace?: string } = {}
  ): Promise<{ status: number; ok: boolean; data: CfApiEnvelope<T>; raw: string }> {
    const accountId = await this.resolveAccountId();
    const namespace = init.namespace ?? resolveNamespace(this.env(), {});
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId
    )}/artifacts/namespaces/${encodeURIComponent(namespace)}${pathSuffix}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.requireToken()}`,
      accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {})
    };
    if (init.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    const response = await this.requireCtx().fetch(url, { ...init, headers });
    const text = await response.text();
    let data: CfApiEnvelope<T> = {};
    try {
      data = text ? (JSON.parse(text) as CfApiEnvelope<T>) : {};
    } catch {
      /* leave as empty envelope */
    }
    return { status: response.status, ok: response.ok, data, raw: text };
  }

  private envelopeError<T>(env: CfApiEnvelope<T>, fallback: string): string {
    return env.errors?.[0]?.message ?? fallback;
  }

  // ─── token cache + mint ─────────────────────────────────────────────────

  /** Mint or reuse a write token good for at least `marginSec` more seconds. */
  private async getWriteToken(input: unknown, ttlSec = 900): Promise<string> {
    // 1. Pre-set long-lived token wins if still fresh.
    const env = this.env();
    if (env.ARTIFACTS_TOKEN && tokenStillFresh(env.ARTIFACTS_TOKEN)) {
      return env.ARTIFACTS_TOKEN;
    }
    // 2. Cached short-lived mint.
    if (this.cachedToken && tokenStillFresh(this.cachedToken)) {
      return this.cachedToken;
    }
    // 3. Try the binding first (faster, no REST hop).
    const repo = resolveRepoName(env, input);
    const bindingTok = await this.tryBindingMint(repo, "write", ttlSec);
    if (bindingTok) {
      this.cachedToken = bindingTok;
      return bindingTok;
    }
    // 4. Fall back to REST.
    const restTok = await this.restMintToken(repo, "write", ttlSec);
    this.cachedToken = restTok;
    return restTok;
  }

  private async tryBindingMint(
    repoName: string,
    scope: "read" | "write",
    ttlSec: number
  ): Promise<string | null> {
    const binding = (this.env() as Env & { ARTIFACTS?: ArtifactsBinding }).ARTIFACTS;
    if (!binding) return null;
    try {
      const handle = await binding.get(repoName);
      const result: ArtifactsCreateTokenResult = await handle.createToken(scope, ttlSec);
      return result.plaintext;
    } catch {
      // Binding may be bound but repo doesn't exist yet; fall through to REST.
      return null;
    }
  }

  private async restMintToken(
    repoName: string,
    scope: "read" | "write",
    ttlSec: number
  ): Promise<string> {
    const r = await this.cfArtifactsFetch<ArtifactsTokenApiShape>(`/tokens`, {
      method: "POST",
      body: JSON.stringify({ repo: repoName, scope, ttl: ttlSec })
    });
    if (!r.ok || !r.data.success || !r.data.result?.plaintext) {
      throw new AppError(
        "E_ARTIFACTS_MINT",
        `Token mint failed (${r.status}): ${this.envelopeError(r.data, r.raw.slice(0, 200))}`,
        500
      );
    }
    return r.data.result.plaintext;
  }

  // ─── shell-container exec ───────────────────────────────────────────────

  private async exec(
    cmd: string,
    cwd?: string,
    timeoutMs = 60_000
  ): Promise<ExecResult> {
    const env = this.env();
    if (!env.SHELL_CONTAINER) {
      return {
        ok: false,
        stderr: "SHELL_CONTAINER binding missing — redeploy with v0.8+",
        code: -1
      };
    }
    const sessionName = resolveShellSession(env);
    const stub = env.SHELL_CONTAINER.get(env.SHELL_CONTAINER.idFromName(sessionName));
    const resp = await stub.fetch(
      new Request("https://shell-do/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmd, cwd, timeoutMs })
      })
    );
    if (!resp.ok) {
      return { ok: false, stderr: `exec proxy failed (${resp.status})`, code: -1 };
    }
    return (await resp.json()) as ExecResult;
  }

  /**
   * Run a git command against the Artifacts remote with a freshly-minted
   * token in `Authorization: Bearer ...` (passed via -c http.extraHeader
   * so the token never lands in git config or process listings).
   */
  private async git(
    args: string,
    cwd: string,
    input: unknown,
    timeoutMs = 60_000
  ): Promise<ExecResult> {
    const token = await this.getWriteToken(input);
    // git -c http.extraHeader='Authorization: Bearer art_v1_...' <args>
    const cmd = `git -c http.extraHeader=${shellEscape("Authorization: Bearer " + token)} ${args}`;
    return this.exec(cmd, cwd, timeoutMs);
  }

  /**
   * Idempotent ensure-clone-exists. Returns the path it landed in.
   * If the repo doesn't exist on Artifacts yet, this returns
   * `{ ok:false, error: "..." }` rather than silently creating one;
   * use helm-artifacts-init for that.
   */
  private async ensureClone(input: unknown): Promise<{
    ok: boolean;
    path?: string;
    error?: string;
    cloned?: boolean;
    pulled?: boolean;
  }> {
    const env = this.env();
    const repo = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repo, input);
    const branch = resolveBranch(env, input);

    // Already cloned?
    const probe = await this.exec(
      `[ -d ${shellEscape(path + "/.git")} ] && echo CLONED || echo MISSING`,
      "/workspace"
    );
    const lines = (probe.stdout ?? "").trim();
    if (lines.endsWith("CLONED")) {
      // Refresh from remote.
      const url = await this.remoteUrl(input);
      const setUrl = await this.exec(
        `git remote set-url origin ${shellEscape(url)}`,
        path
      );
      if (!setUrl.ok) {
        return { ok: false, error: `git remote set-url failed: ${(setUrl.stderr ?? "").slice(0, 300)}` };
      }
      const pull = await this.git(`pull --ff-only origin ${shellEscape(branch)}`, path, input);
      if (!pull.ok) {
        return {
          ok: false,
          path,
          error: `git pull failed: ${(pull.stderr ?? pull.stdout ?? "").slice(0, 300)}`
        };
      }
      return { ok: true, path, cloned: false, pulled: true };
    }
    // Fresh clone.
    const url = await this.remoteUrl(input);
    const mk = await this.exec(`mkdir -p ${shellEscape(path)}`, "/workspace");
    if (!mk.ok) {
      return { ok: false, error: `mkdir failed: ${(mk.stderr ?? "").slice(0, 200)}` };
    }
    const clone = await this.git(
      `clone --depth 50 -b ${shellEscape(branch)} ${shellEscape(url)} ${shellEscape(path)}`,
      "/workspace",
      input,
      120_000
    );
    if (!clone.ok) {
      return {
        ok: false,
        path,
        error: `git clone failed: ${(clone.stderr ?? clone.stdout ?? "").slice(0, 400)}`
      };
    }
    // Pin the agent's identity for any subsequent commits.
    await this.exec(
      `git config user.email helm@open-think && git config user.name Helm`,
      path
    );
    return { ok: true, path, cloned: true, pulled: false };
  }

  // ─── action dispatch ────────────────────────────────────────────────────

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };

    try {
      switch (action) {
        case "status":
          return await this.actStatus(input);
        case "init":
          return await this.actInit(input);
        case "list-repos":
          return await this.actListRepos(input);
        case "repo-info":
          return await this.actRepoInfo(input);
        case "mint-token":
          return await this.actMintToken(input);
        case "clone":
          return await this.actClone(input);
        case "pull":
          return await this.actPull(input);
        case "read-file":
          return await this.actReadFile(input);
        case "write-file":
          return await this.actWriteFile(input);
        case "ls":
          return await this.actLs(input);
        case "history":
          return await this.actHistory(input);
        case "diff":
          return await this.actDiff(input);
        case "sync-toml":
          return await this.actSyncToml(input);
        case "deploy":
          return await this.actDeploy(input);
        case "import-github":
          return await this.actImportGithub(input);
        case "cron-sync":
          return await this.actCronSync(input);
        default:
          return { ok: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── actions ────────────────────────────────────────────────────────────

  private async actStatus(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const namespace = resolveNamespace(env, input);
    const repoName = resolveRepoName(env, input);
    const branch = resolveBranch(env, input);
    const hasBinding = !!(env as Env & { ARTIFACTS?: ArtifactsBinding }).ARTIFACTS;
    const hasToken = !!(env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN);
    if (!hasToken && !hasBinding) {
      return {
        ok: true,
        data: {
          ready: false,
          hasBinding,
          hasApiToken: hasToken,
          namespace,
          repoName,
          branch,
          hint:
            "Neither CLOUDFLARE_API_TOKEN (Artifacts:Edit scope) nor the [[artifacts]] binding is wired. Set the token via cf-put-secret OR uncomment [[artifacts]] in wrangler.toml and redeploy."
        }
      };
    }
    let accountId: string | null = null;
    try {
      accountId = await this.resolveAccountId();
    } catch (err) {
      return {
        ok: true,
        data: {
          ready: false,
          hasBinding,
          hasApiToken: hasToken,
          namespace,
          repoName,
          branch,
          error: err instanceof Error ? err.message : String(err)
        }
      };
    }
    // Probe the repo via REST.
    const probe = await this.cfArtifactsFetch<ArtifactsRepoApiShape>(
      `/repos/${encodeURIComponent(repoName)}`,
      { namespace }
    );
    return {
      ok: true,
      data: {
        ready: probe.ok && !!probe.data.success,
        hasBinding,
        hasApiToken: hasToken,
        accountId,
        namespace,
        repoName,
        branch,
        repoExists: probe.ok && !!probe.data.success,
        repoInfo: probe.data.result ?? null,
        host: `${accountId}.artifacts.cloudflare.net`,
        remoteUrl: probe.data.result?.remote ??
          `https://${accountId}.artifacts.cloudflare.net/git/${namespace}/${repoName}.git`,
        hint: probe.ok && probe.data.success
          ? "Artifacts repo accessible. Use helm-artifacts-clone to land it in /workspace, then helm-artifacts-sync-toml to drift-fix wrangler.toml."
          : `Repo not found in namespace "${namespace}". Run helm-artifacts-init to create it (optionally with bootstrapUrl to import from GitHub).`
      }
    };
  }

  private async actInit(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const namespace = resolveNamespace(env, input);
    const repoName = resolveRepoName(env, input);
    const branch = resolveBranch(env, input);
    const bootstrapUrl =
      (typeof o.bootstrapUrl === "string" && o.bootstrapUrl) ||
      (env.ARTIFACTS_BOOTSTRAP_URL ?? "");
    const description =
      typeof o.description === "string" ? o.description : `Open Think — ${repoName}`;

    // Idempotent: check first.
    const probe = await this.cfArtifactsFetch<ArtifactsRepoApiShape>(
      `/repos/${encodeURIComponent(repoName)}`,
      { namespace }
    );
    if (probe.ok && probe.data.success) {
      return {
        ok: true,
        data: {
          alreadyExisted: true,
          namespace,
          repoName,
          branch,
          remoteUrl: probe.data.result?.remote,
          hint: "Repo already exists; nothing to do. Use helm-artifacts-clone to land it locally."
        }
      };
    }

    // Create or import.
    let result: ArtifactsRepoApiShape | undefined;
    let token: string | undefined;
    if (bootstrapUrl) {
      // Two-step: create + import. CF allows a single `import` call which
      // creates the repo from a URL atomically.
      const r = await this.cfArtifactsFetch<ArtifactsRepoApiShape & { token?: string }>(
        `/repos/${encodeURIComponent(repoName)}/import`,
        {
          namespace,
          method: "POST",
          body: JSON.stringify({ url: bootstrapUrl, branch, depth: 100 })
        }
      );
      if (!r.ok || !r.data.success) {
        return {
          ok: false,
          error: `import failed (${r.status}): ${this.envelopeError(r.data, r.raw.slice(0, 200))}`
        };
      }
      result = r.data.result;
      token = (r.data.result as ArtifactsRepoApiShape & { token?: string })?.token;
    } else {
      const r = await this.cfArtifactsFetch<ArtifactsRepoApiShape & { token?: string }>(`/repos`, {
        namespace,
        method: "POST",
        body: JSON.stringify({ name: repoName, description, default_branch: branch })
      });
      if (!r.ok || !r.data.success) {
        return {
          ok: false,
          error: `create failed (${r.status}): ${this.envelopeError(r.data, r.raw.slice(0, 200))}`
        };
      }
      result = r.data.result;
      token = (r.data.result as ArtifactsRepoApiShape & { token?: string })?.token;
    }
    return {
      ok: true,
      data: {
        alreadyExisted: false,
        bootstrapped: !!bootstrapUrl,
        namespace,
        repoName,
        branch,
        remoteUrl: result?.remote,
        initialToken: token,
        hint:
          "Repo ready. Set ARTIFACTS_REPO + ARTIFACTS_NAMESPACE secrets so subsequent calls don't re-resolve. Then run helm-artifacts-clone.",
        nextSteps: [
          `cf-put-secret ARTIFACTS_REPO=${repoName}`,
          `cf-put-secret ARTIFACTS_NAMESPACE=${namespace}`,
          "helm-artifacts-clone"
        ]
      }
    };
  }

  private async actListRepos(input: unknown): Promise<PluginResult> {
    const namespace = resolveNamespace(this.env(), input);
    const o = asObj(input);
    const params = new URLSearchParams();
    if (typeof o.limit === "number") params.set("limit", String(o.limit));
    if (typeof o.cursor === "string") params.set("cursor", o.cursor);
    if (typeof o.search === "string") params.set("search", o.search);
    if (typeof o.sort === "string") params.set("sort", o.sort);
    if (typeof o.direction === "string") params.set("direction", o.direction);
    const qs = params.toString();
    const r = await this.cfArtifactsFetch<ArtifactsRepoApiShape[]>(
      `/repos${qs ? "?" + qs : ""}`,
      { namespace }
    );
    if (!r.ok || !r.data.success) {
      return { ok: false, error: this.envelopeError(r.data, `list-repos ${r.status}`) };
    }
    return {
      ok: true,
      data: {
        namespace,
        repos: r.data.result ?? [],
        count: (r.data.result ?? []).length
      }
    };
  }

  private async actRepoInfo(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const namespace = resolveNamespace(env, input);
    const repoName = resolveRepoName(env, input);
    const r = await this.cfArtifactsFetch<ArtifactsRepoApiShape>(
      `/repos/${encodeURIComponent(repoName)}`,
      { namespace }
    );
    if (!r.ok || !r.data.success) {
      return { ok: false, error: this.envelopeError(r.data, `repo-info ${r.status}`) };
    }
    return { ok: true, data: { namespace, repo: r.data.result } };
  }

  private async actMintToken(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const repoName = resolveRepoName(env, input);
    const scope = (o.scope === "read" ? "read" : "write") as "read" | "write";
    const ttl = typeof o.ttl === "number" && o.ttl > 0 ? Math.min(o.ttl, 86400) : 900;
    // Prefer binding when present.
    const binding = (env as Env & { ARTIFACTS?: ArtifactsBinding }).ARTIFACTS;
    if (binding) {
      try {
        const handle = await binding.get(repoName);
        const result = await handle.createToken(scope, ttl);
        // Cache write tokens for reuse within this isolate's lifetime.
        if (scope === "write") this.cachedToken = result.plaintext;
        return {
          ok: true,
          data: {
            via: "binding",
            scope: result.scope,
            expiresAt: result.expiresAt,
            tokenId: result.id,
            // Returning the token to callers is intentional — they need
            // it for downstream git ops. Never echo to the user.
            token: result.plaintext
          }
        };
      } catch (err) {
        // Fall through to REST.
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!errMsg.includes("not found") && !errMsg.includes("404")) {
          // Genuine binding error — surface it.
          return { ok: false, error: `binding mint failed: ${errMsg}` };
        }
      }
    }
    const r = await this.cfArtifactsFetch<ArtifactsTokenApiShape>(`/tokens`, {
      method: "POST",
      body: JSON.stringify({ repo: repoName, scope, ttl })
    });
    if (!r.ok || !r.data.success || !r.data.result?.plaintext) {
      return { ok: false, error: this.envelopeError(r.data, `mint ${r.status}`) };
    }
    if (scope === "write") this.cachedToken = r.data.result.plaintext;
    return {
      ok: true,
      data: {
        via: "rest",
        scope: r.data.result.scope,
        expiresAt: r.data.result.expires_at,
        tokenId: r.data.result.id,
        token: r.data.result.plaintext
      }
    };
  }

  private async actClone(input: unknown): Promise<PluginResult> {
    const r = await this.ensureClone(input);
    if (!r.ok) return { ok: false, error: r.error ?? "clone failed" };
    return {
      ok: true,
      data: {
        path: r.path,
        cloned: r.cloned ?? false,
        pulled: r.pulled ?? false,
        containerSession: resolveShellSession(this.env()),
        hint: r.cloned
          ? "Repo freshly cloned. Subsequent calls will git pull instead."
          : "Repo already present; pulled latest from origin."
      }
    };
  }

  private async actPull(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const branch = resolveBranch(env, input);
    const probe = await this.exec(
      `[ -d ${shellEscape(path + "/.git")} ] && echo OK || echo MISSING`,
      "/workspace"
    );
    if (!(probe.stdout ?? "").trim().endsWith("OK")) {
      return {
        ok: false,
        error: `${path} not cloned yet. Run helm-artifacts-clone first.`
      };
    }
    const url = await this.remoteUrl(input);
    await this.exec(`git remote set-url origin ${shellEscape(url)}`, path);
    const pull = await this.git(
      `pull --ff-only origin ${shellEscape(branch)}`,
      path,
      input
    );
    if (!pull.ok) {
      return {
        ok: false,
        error: `git pull failed: ${(pull.stderr ?? pull.stdout ?? "").slice(0, 400)}`
      };
    }
    const headSha = await this.exec(`git rev-parse HEAD`, path);
    return {
      ok: true,
      data: {
        path,
        branch,
        headSha: (headSha.stdout ?? "").trim(),
        output: ((pull.stdout ?? "") + (pull.stderr ?? "")).slice(0, 800)
      }
    };
  }

  private async actReadFile(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const filePath = String(o.path ?? "wrangler.toml");
    if (filePath.includes("..")) {
      return { ok: false, error: "path must not contain '..'" };
    }
    // Ensure clone exists (idempotent).
    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };
    const cat = await this.exec(
      `if [ -f ${shellEscape(filePath)} ]; then cat ${shellEscape(filePath)}; else echo __HELM_NO_FILE__; fi`,
      path
    );
    if (!cat.ok) {
      return { ok: false, error: `cat failed: ${(cat.stderr ?? "").slice(0, 200)}` };
    }
    const out = (cat.stdout ?? "").replace(/\r\n/g, "\n");
    if (out.trim() === "__HELM_NO_FILE__") {
      return { ok: false, error: `${filePath} not found in ${path}` };
    }
    const sha = await this.exec(`git rev-parse HEAD`, path);
    return {
      ok: true,
      data: {
        path: filePath,
        repoPath: path,
        content: out,
        bytes: out.length,
        headSha: (sha.stdout ?? "").trim()
      }
    };
  }

  private async actWriteFile(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const branch = resolveBranch(env, input);
    const filePath = String(o.path ?? "");
    const content = String(o.content ?? "");
    const message = String(o.message ?? `helm: update ${filePath}`);
    const push = o.push !== false; // default true
    if (!filePath || filePath.includes("..")) {
      return { ok: false, error: "input.path required and must not contain '..'" };
    }
    if (!content) return { ok: false, error: "input.content required" };

    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };

    // Write via base64 round-trip to avoid quoting hell.
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const mkdir = dir
      ? await this.exec(`mkdir -p ${shellEscape(dir)}`, path)
      : { ok: true } as ExecResult;
    if (!mkdir.ok) {
      return { ok: false, error: `mkdir failed: ${(mkdir.stderr ?? "").slice(0, 200)}` };
    }
    const write = await this.exec(
      `printf %s ${shellEscape(encoded)} | base64 -d > ${shellEscape(filePath)}`,
      path
    );
    if (!write.ok) {
      return { ok: false, error: `write failed: ${(write.stderr ?? "").slice(0, 300)}` };
    }
    const diff = await this.exec(
      `git diff --no-color -- ${shellEscape(filePath)}`,
      path
    );
    const add = await this.exec(`git add ${shellEscape(filePath)}`, path);
    if (!add.ok) {
      return { ok: false, error: `git add failed: ${(add.stderr ?? "").slice(0, 200)}` };
    }
    const commit = await this.exec(
      `git -c user.name=Helm -c user.email=helm@open-think commit -m ${shellEscape(message)}`,
      path
    );
    // No-change is reported by git as exit 1 + "nothing to commit"; treat
    // as success-with-noop.
    const noChange = (commit.stdout ?? "").includes("nothing to commit");
    if (!commit.ok && !noChange) {
      return {
        ok: false,
        error: `git commit failed: ${((commit.stderr ?? "") + (commit.stdout ?? "")).slice(0, 400)}`
      };
    }
    let pushResult: ExecResult | null = null;
    let commitSha: string | undefined;
    if (push && !noChange) {
      pushResult = await this.git(
        `push origin ${shellEscape(branch)}`,
        path,
        input,
        90_000
      );
      const headSha = await this.exec(`git rev-parse HEAD`, path);
      commitSha = (headSha.stdout ?? "").trim();
    }
    return {
      ok: true,
      data: {
        path: filePath,
        repoPath: path,
        diff: (diff.stdout ?? "").slice(0, 4000),
        committed: !noChange,
        noChange,
        pushed: pushResult ? pushResult.ok : false,
        pushOutput: pushResult
          ? ((pushResult.stdout ?? "") + (pushResult.stderr ?? "")).slice(0, 800)
          : null,
        commitSha,
        message,
        branch,
        notes: noChange
          ? "File already had this content. No commit was made."
          : pushResult && pushResult.ok
            ? "Committed + pushed."
            : pushResult
              ? "Committed but push failed — see pushOutput."
              : "Committed locally; push:false skipped the upload."
      }
    };
  }

  private async actLs(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };
    const r = await this.exec(`git ls-files`, path);
    if (!r.ok) {
      return { ok: false, error: `git ls-files failed: ${(r.stderr ?? "").slice(0, 200)}` };
    }
    const files = (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    return { ok: true, data: { repoPath: path, files, count: files.length } };
  }

  private async actHistory(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const limit = typeof o.limit === "number" && o.limit > 0 ? Math.min(o.limit, 200) : 20;
    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };
    const r = await this.exec(
      `git log -n ${limit} --pretty=format:'%H%x09%an%x09%ae%x09%aI%x09%s'`,
      path
    );
    if (!r.ok) {
      return { ok: false, error: `git log failed: ${(r.stderr ?? "").slice(0, 200)}` };
    }
    const commits = (r.stdout ?? "")
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts) => parts.length === 5)
      .map(([sha, name, email, date, subject]) => ({
        sha,
        author: { name, email },
        date,
        subject
      }));
    return { ok: true, data: { repoPath: path, commits, count: commits.length } };
  }

  private async actDiff(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const refA = typeof o.from === "string" ? o.from : "HEAD~1";
    const refB = typeof o.to === "string" ? o.to : "HEAD";
    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };
    const r = await this.exec(
      `git diff --no-color ${shellEscape(refA)}..${shellEscape(refB)}`,
      path
    );
    if (!r.ok) {
      return { ok: false, error: `git diff failed: ${(r.stderr ?? "").slice(0, 200)}` };
    }
    return {
      ok: true,
      data: {
        repoPath: path,
        from: refA,
        to: refB,
        diff: (r.stdout ?? "").slice(0, 16000),
        truncated: (r.stdout ?? "").length > 16000
      }
    };
  }

  /**
   * Drift-fix wrangler.toml against the live Worker bindings. Default
   * dry-run; pass apply:true to commit + push.
   */
  private async actSyncToml(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const apply = Boolean(o.apply);
    const repoName = resolveRepoName(env, input);
    const tomlRel = resolveTomlRel(env, input);
    const branch = resolveBranch(env, input);
    const checkoutPath = resolveCheckoutPath(env, repoName, input);
    const accountId = await this.resolveAccountId();
    const cfToken = this.requireToken();
    const scriptName =
      (typeof o.scriptName === "string" && o.scriptName) ||
      env.WORKER_SCRIPT_NAME ||
      env.AGENT_NAME ||
      "helm";

    // 1. Ensure repo is current.
    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };

    // 2. Read wrangler.toml.
    const cat = await this.exec(`cat ${shellEscape(tomlRel)}`, checkoutPath);
    if (!cat.ok) {
      return {
        ok: false,
        error: `wrangler.toml not found at ${checkoutPath}/${tomlRel}: ${(cat.stderr ?? "").slice(0, 200)}`
      };
    }
    const tomlContent = (cat.stdout ?? "").replace(/\r\n/g, "\n");

    // 3. Fetch live bindings.
    const cfResp = await this.requireCtx().fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        accountId
      )}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
      { headers: { Authorization: `Bearer ${cfToken}`, accept: "application/json" } }
    );
    if (!cfResp.ok) {
      const t = await cfResp.text();
      return { ok: false, error: `cf-list-bindings ${scriptName}: ${t.slice(0, 200)}` };
    }
    const cfJson = (await cfResp.json()) as {
      result?: { bindings?: Array<Record<string, unknown>> };
    };
    const liveBindings = cfJson.result?.bindings ?? [];

    // 4. Compute drift.
    const drift = diffBindings(liveBindings, tomlContent);
    const inSync =
      drift.missingFromToml.length === 0 && drift.missingFromLive.length === 0;

    if (!apply) {
      return {
        ok: true,
        data: {
          dryRun: true,
          namespace: resolveNamespace(env, input),
          repoName,
          branch,
          tomlRel,
          scriptName,
          liveBindingCount: liveBindings.length,
          tomlBindingCount: parseTomlBindings(tomlContent).length,
          drift,
          inSync,
          hint: inSync
            ? "wrangler.toml in sync with live Worker."
            : `wrangler.toml is missing ${drift.missingFromToml.length} live binding(s); has ${drift.missingFromLive.length} stale binding(s). Re-run with apply:true to fix.`
        }
      };
    }

    if (drift.missingFromToml.length === 0) {
      return {
        ok: true,
        data: {
          dryRun: false,
          applied: 0,
          inSync,
          drift,
          note: "Already in sync; no edits made."
        }
      };
    }

    // 5. Merge missing-from-toml blocks into the file.
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
    if (appliedBlocks.length === 0) {
      return {
        ok: true,
        data: {
          dryRun: false,
          applied: 0,
          drift,
          note: "Nothing to merge — all missing bindings produced empty snippets."
        }
      };
    }

    // 6. Write + commit + push.
    const write = await this.actWriteFile({
      path: tomlRel,
      content: merged,
      message: `helm: sync wrangler.toml (${appliedBlocks.length} binding${
        appliedBlocks.length === 1 ? "" : "s"
      })`,
      push: true,
      ...input as object
    });
    if (!write.ok) return write;

    return {
      ok: true,
      data: {
        dryRun: false,
        applied: appliedBlocks.length,
        blocks: appliedBlocks,
        commit: write.data,
        drift,
        scriptName,
        branch
      }
    };
  }

  /**
   * Trigger a Workers Upload Worker deploy from the artifact tree.
   * Reads `worker.js` (or `dist/worker.js` if present) and pushes a
   * single-file Worker. For multi-module deploys, run `wrangler deploy`
   * inside the container instead — same checkout, full fidelity.
   */
  private async actDeploy(input: unknown): Promise<PluginResult> {
    const env = this.env();
    const o = asObj(input);
    const repoName = resolveRepoName(env, input);
    const path = resolveCheckoutPath(env, repoName, input);
    const scriptName =
      (typeof o.scriptName === "string" && o.scriptName) ||
      env.WORKER_SCRIPT_NAME ||
      env.AGENT_NAME ||
      "helm";
    const useWrangler = o.useWrangler !== false; // default true — full fidelity
    const accountId = await this.resolveAccountId();

    const ensure = await this.ensureClone(input);
    if (!ensure.ok) return { ok: false, error: ensure.error ?? "clone failed" };

    if (useWrangler) {
      // Full deploy via the wrangler binary (multi-module, migrations, etc.).
      const r = await this.exec(
        `CLOUDFLARE_API_TOKEN=${shellEscape(this.requireToken())} CLOUDFLARE_ACCOUNT_ID=${shellEscape(
          accountId
        )} wrangler deploy --name ${shellEscape(scriptName)}`,
        path,
        180_000
      );
      return {
        ok: r.ok,
        data: {
          via: "wrangler",
          scriptName,
          repoPath: path,
          stdout: (r.stdout ?? "").slice(0, 4000),
          stderr: (r.stderr ?? "").slice(0, 2000),
          exitCode: r.code,
          note: r.ok
            ? "Deployed via `wrangler deploy`. Live Worker now matches Artifacts source."
            : "wrangler deploy failed — see stderr. Try useWrangler:false for a single-file fallback."
        }
      };
    }

    // Single-file fallback path.
    const candidates = ["worker.js", "dist/worker.js", "src/index.js"];
    let workerSrc: string | undefined;
    let usedPath: string | undefined;
    for (const candidate of candidates) {
      const cat = await this.exec(
        `if [ -f ${shellEscape(candidate)} ]; then cat ${shellEscape(candidate)}; else echo __HELM_NO_FILE__; fi`,
        path
      );
      if (cat.ok && (cat.stdout ?? "").trim() !== "__HELM_NO_FILE__") {
        workerSrc = (cat.stdout ?? "").replace(/\r\n/g, "\n");
        usedPath = candidate;
        break;
      }
    }
    if (!workerSrc) {
      return {
        ok: false,
        error: `No worker source found at any of: ${candidates.join(", ")}. Pass useWrangler:true (default) to invoke wrangler deploy on the full repo.`
      };
    }
    const fd = new FormData();
    fd.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: "worker.js",
            compatibility_date: env.AGENT_NAME ?? "2026-04-25"
          })
        ],
        { type: "application/json" }
      ),
      "metadata"
    );
    fd.append("worker.js", new Blob([workerSrc], { type: "application/javascript+module" }), "worker.js");
    const resp = await this.requireCtx().fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        accountId
      )}/workers/scripts/${encodeURIComponent(scriptName)}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${this.requireToken()}` },
        body: fd
      }
    );
    const text = await resp.text();
    return {
      ok: resp.ok,
      data: {
        via: "rest",
        scriptName,
        sourceFile: usedPath,
        bytes: workerSrc.length,
        httpStatus: resp.status,
        response: text.slice(0, 1500)
      }
    };
  }

  private async actImportGithub(input: unknown): Promise<PluginResult> {
    const o = asObj(input);
    const url = String(o.url ?? "");
    if (!url.startsWith("https://")) {
      return { ok: false, error: "input.url must be an https:// git URL" };
    }
    const env = this.env();
    const namespace = resolveNamespace(env, input);
    const repoName = resolveRepoName(env, input);
    const branch = resolveBranch(env, input);
    const depth = typeof o.depth === "number" ? o.depth : 100;
    const r = await this.cfArtifactsFetch<ArtifactsRepoApiShape & { token?: string }>(
      `/repos/${encodeURIComponent(repoName)}/import`,
      {
        namespace,
        method: "POST",
        body: JSON.stringify({ url, branch, depth })
      }
    );
    if (!r.ok || !r.data.success) {
      return {
        ok: false,
        error: `import failed (${r.status}): ${this.envelopeError(r.data, r.raw.slice(0, 200))}`
      };
    }
    return {
      ok: true,
      data: {
        namespace,
        repoName,
        branch,
        sourceUrl: url,
        remoteUrl: r.data.result?.remote,
        initialToken: (r.data.result as ArtifactsRepoApiShape & { token?: string })?.token,
        hint:
          "GitHub repo imported. Set ARTIFACTS_REPO + ARTIFACTS_NAMESPACE secrets, then helm-artifacts-clone."
      }
    };
  }

  /**
   * Cron-friendly wrapper. Runs a sync-toml dry-run; returns drift +
   * a structured "should-notify" flag the scheduled() handler can use to
   * fan out to notifier without awakening the chat path.
   *
   * NOTE: still cold-starts the helm-shell container because we need to
   * read wrangler.toml. To skip that cost, the scheduled() handler can
   * inspect ARTIFACTS_AUTO_SYNC and only call this on change-of-state
   * (e.g. after a known cf-patch-binding event).
   */
  private async actCronSync(input: unknown): Promise<PluginResult> {
    const env = this.env();
    if (!env.ARTIFACTS_REPO && !env.AGENT_NAME) {
      return {
        ok: true,
        data: {
          skipped: true,
          reason: "ARTIFACTS_REPO not configured; nothing to drift-check."
        }
      };
    }
    const dry = await this.actSyncToml({ ...asObj(input), apply: false });
    if (!dry.ok) return dry;
    const data = dry.data as {
      drift: { missingFromToml: unknown[]; missingFromLive: unknown[] };
      inSync: boolean;
    };
    return {
      ok: true,
      data: {
        ...data,
        shouldNotify: !data.inSync,
        notifyTitle: data.inSync
          ? null
          : "Helm: wrangler.toml drift detected",
        notifyBody: data.inSync
          ? null
          : `Live Worker has ${data.drift.missingFromToml.length} binding(s) not in your Artifacts wrangler.toml. Run helm-artifacts-sync-toml apply:true to fix.`
      }
    };
  }
}
