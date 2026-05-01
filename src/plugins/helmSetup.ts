/**
 * helm-setup — wrapper plugin that exposes the runtime's own setup
 * surface as skills. Lets Helm itself drive the same flow that the
 * /app#/settings panel does, instead of re-deriving it from primitive
 * cf-admin operations every time.
 *
 * Skills exported (registered in src/core/skills.ts):
 *   helm-setup-status   — the capability matrix (configured/missing per slot)
 *   helm-setup-auto     — calls runLockdown + auto-mints HELM_INTERNAL_TOKEN
 *                         + creates R2 bucket; returns the same nextSteps[]
 *                         as POST /setup/auto
 *   helm-docs           — returns curated documentation snippets so Helm
 *                         can self-reference its architecture without
 *                         needing internet access
 *   helm-secrets-status — list known secret slots + which are configured
 *                         (no values)
 *
 * The wrappers call into the same code paths the HTTP endpoints use, so
 * anything Helm proposes via these skills mirrors what the user could do
 * by clicking buttons in /app.
 */

import type { AgentPlugin, PluginContext, PluginResult, RuntimeIntrospection } from "../core/plugin";
import type { Env } from "../types";
import { collectStatus } from "../setup";
import { runLockdown } from "../setup-access";
import { listSecretStatus } from "../setup-secrets";
import { HELM_DOCS } from "./helmDocs";
import { resolveShellSession } from "./helmShellSession";

interface InvokeInput {
  accountId?: string;
  scriptName?: string;
  appName?: string;
  allowedEmails?: string[];
  topic?: string;
  /** When true, helm-setup-deploy skips the Cloudflare Artifacts step. */
  skipArtifacts?: boolean;
  /** Optional public git URL to seed the Artifacts repo from on first init. */
  artifactsBootstrapUrl?: string;
  /** Override repo name; defaults to scriptName. */
  artifactsRepo?: string;
  /** Override namespace; defaults to "default". */
  artifactsNamespace?: string;
}

function asObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

export class HelmSetupPlugin implements AgentPlugin {
  readonly id = "helm-setup";
  readonly version = "0.1.0";
  readonly description =
    "Helm self-setup wrappers — capability matrix, one-click auto-setup, and curated docs the agent can reference about its own architecture.";
  readonly capabilities = ["admin", "tools"] as const;

  private ctx?: PluginContext;
  private runtime?: RuntimeIntrospection;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.runtime) {
      throw new Error("helm-setup requires runtime introspection handle");
    }
    this.ctx = context;
    this.runtime = context.runtime;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx || !this.runtime) {
      return { ok: false, error: "Plugin not initialized" };
    }

    if (action === "status") {
      const env = this.ctx.env as Env;
      return { ok: true, data: collectStatus(env, this.runtime) };
    }

    if (action === "secrets-status") {
      const env = this.ctx.env as Env;
      return { ok: true, data: { slots: listSecretStatus(env) } };
    }

    if (action === "docs") {
      const o = asObj(input) as InvokeInput;
      const topic = (o.topic ?? "").toLowerCase();
      if (!topic) {
        return {
          ok: true,
          data: {
            topics: Object.keys(HELM_DOCS),
            hint: "Pass {topic: \"<topic>\"} to read a specific section. Topics are listed above."
          }
        };
      }
      const doc = HELM_DOCS[topic];
      if (!doc) {
        return {
          ok: false,
          error: `Unknown topic "${topic}". Available: ${Object.keys(HELM_DOCS).join(", ")}`
        };
      }
      return { ok: true, data: { topic, content: doc } };
    }

    if (action === "exec") {
      // helm-exec — run a bash command inside the per-session shell
      // container and get stdout/stderr/exit-code back. We talk to the
      // Container DO directly (DO RPC) instead of going through the
      // public Worker URL, so HELM_WORKER_HOST isn't required.
      const env = this.ctx.env as Env;
      const o = asObj(input) as {
        cmd?: string;
        cwd?: string;
        timeoutMs?: number;
        stdin?: string;
        session?: string;
      };
      if (!o.cmd || typeof o.cmd !== "string") {
        return { ok: false, error: "input.cmd (string) required" };
      }
      if (!env.SHELL_CONTAINER) {
        return {
          ok: false,
          error: "SHELL_CONTAINER binding missing. Redeploy with the v0.8+ wrangler.toml."
        };
      }
      // CRITICAL: default session name matches the user's browser shell
      // session — derived from env.AGENT_OWNER_EMAIL via the same FNV-1a
      // hash that /shell/ws uses. So files the user `git clone`s in the
      // browser tab are visible to helm-exec, and vice versa.
      const sessionName = resolveShellSession(env, o.session);
      const id = env.SHELL_CONTAINER.idFromName(sessionName);
      const stub = env.SHELL_CONTAINER.get(id);
      const resp = await stub.fetch(
        new Request("https://shell-do/exec", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cmd: o.cmd,
            cwd: o.cwd,
            timeoutMs: o.timeoutMs,
            stdin: o.stdin
          })
        })
      );
      const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!resp.ok) {
        return { ok: false, error: `helm-exec failed (${resp.status})`, data };
      }
      return { ok: true, data: { ...data, session: sessionName } };
    }

    if (action === "deploy") {
      // Full deploy-everything chain. The agent's "set me up" button.
      // Does what helm-setup-auto does PLUS:
      //   - Creates D1 PA-stack database (open-think-pa) if missing
      //   - Creates KV cache namespace if missing
      //   - PATCHes Worker bindings live (DB d1, WORKSPACE r2, CACHE kv)
      //   - PATCHes ENABLED_PLUGINS plain_text binding to add memory,
      //     scheduler, cost-tracking, mcp-client
      // No `wrangler deploy` needed — the live Worker has it all.
      // The user only has to commit the matching wrangler.toml additions
      // afterwards so their next local deploy doesn't drop the bindings.
      return await this.runDeploy(input);
    }

    if (action === "auto") {
      // Mirror of POST /setup/auto — we run the same chain inline so
      // the agent can call this as a single skill instead of orchestrating
      // 6 cf-admin calls. The ${this.ctx.fetch} respects the plugin bus
      // host allowlist.
      const env = this.ctx.env as Env;
      const o = asObj(input) as InvokeInput;
      const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
      if (!token) {
        return {
          ok: false,
          error:
            "CLOUDFLARE_API_TOKEN missing. Either paste it in /app#/settings or run `wrangler secret put CLOUDFLARE_API_TOKEN`."
        };
      }
      // Pick account.
      const accountIdOverride = o.accountId || env.CLOUDFLARE_ACCOUNT_ID;
      let pickedAccount: { id: string; name: string };
      if (accountIdOverride) {
        pickedAccount = { id: accountIdOverride, name: "(from input/env)" };
      } else {
        const list = await this.ctx.fetch(
          "https://api.cloudflare.com/client/v4/accounts?per_page=10",
          { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
        );
        const lj = (await list.json().catch(() => ({}))) as {
          success?: boolean;
          result?: Array<{ id: string; name: string }>;
          errors?: Array<{ message: string }>;
        };
        if (!list.ok || !lj.success) {
          return {
            ok: false,
            error: lj.errors?.[0]?.message ?? `list-accounts failed (${list.status})`
          };
        }
        const accounts = lj.result ?? [];
        if (accounts.length === 0) {
          return { ok: false, error: "no accounts visible to this token" };
        }
        pickedAccount = accounts[0];
      }
      const allowedEmails = (o.allowedEmails && o.allowedEmails.length > 0)
        ? o.allowedEmails
        : (env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL)
          ? [(env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL) as string]
          : [];
      if (allowedEmails.length === 0) {
        return {
          ok: false,
          error:
            "No owner email available. Set AGENT_OWNER_EMAIL (or OWNER_EMAIL) as a Worker var, or pass {allowedEmails:[...]}."
        };
      }
      // We don't know the worker host from here; the script name is
      // derivable from env.AGENT_NAME if set, or defaults to "helm".
      const scriptName = o.scriptName || env.AGENT_NAME || "helm";
      const workerHost = `${scriptName}.workers.dev`;
      const lockdown = await runLockdown({
        token,
        accountId: pickedAccount.id,
        scriptName,
        appName: o.appName || `Helm — ${scriptName}`,
        workerHost,
        allowedEmails
      });
      // Auto-mint HELM_INTERNAL_TOKEN if not present.
      const extras: Array<{ kind: string; ok: boolean; detail?: string }> = [];
      if (!env.HELM_INTERNAL_TOKEN) {
        const buf = new Uint8Array(32);
        crypto.getRandomValues(buf);
        const internalToken = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
        const r = await this.ctx.fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(pickedAccount.id)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ name: "HELM_INTERNAL_TOKEN", text: internalToken, type: "secret_text" })
          }
        );
        extras.push({
          kind: "set-helm-internal-token",
          ok: r.ok,
          detail: r.ok ? "auto-generated" : `failed (${r.status})`
        });
      } else {
        extras.push({ kind: "set-helm-internal-token", ok: true, detail: "already set" });
      }
      // Auto-create R2 bucket.
      const bucketName = env.R2_BUCKET || `${scriptName}-persist`;
      if (!env.R2_BUCKET) {
        const r = await this.ctx.fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(pickedAccount.id)}/r2/buckets`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ name: bucketName })
          }
        );
        const text = await r.text();
        const alreadyExists = !r.ok && text.toLowerCase().includes("already exists");
        extras.push({
          kind: "create-r2-bucket",
          ok: r.ok || alreadyExists,
          detail: r.ok ? `created ${bucketName}` : alreadyExists ? `reusing ${bucketName}` : `failed: ${text.slice(0, 200)}`
        });
      } else {
        extras.push({ kind: "create-r2-bucket", ok: true, detail: `already configured: ${env.R2_BUCKET}` });
      }
      return {
        ok: lockdown.ok,
        data: {
          picked: pickedAccount,
          allowedEmails,
          scriptName,
          lockdown,
          extras,
          recommended: {
            wranglerTomlAdditions: [
              `[[r2_buckets]]`,
              `binding = "WORKSPACE"`,
              `bucket_name = "${bucketName}"`
            ].join("\n")
          },
          nextSteps: [
            { done: lockdown.ok, label: "Cloudflare Access locked down" },
            { done: extras[0]?.ok ?? false, label: "HELM_INTERNAL_TOKEN minted" },
            { done: extras[1]?.ok ?? false, label: `R2 bucket ${bucketName}` },
            { done: false, label: "[[r2_buckets]] binding in wrangler.toml (manual step)" }
          ]
        }
      };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }

  /* ---------------- helpers for deploy-everything ---------------- */

  private async runDeploy(input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };
    const env = this.ctx.env as Env;
    const o = asObj(input) as InvokeInput & { skipAccess?: boolean };
    const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
    if (!token) {
      return { ok: false, error: "CLOUDFLARE_API_TOKEN missing — paste it in /app#/settings → Manage secrets first." };
    }

    // ---- 1. Resolve account + scriptName ----
    const accountId = await this.resolveAccount(token, o.accountId || env.CLOUDFLARE_ACCOUNT_ID);
    if (!accountId.ok) return { ok: false, error: accountId.error };
    const acc = accountId.id;
    // scriptName auto-discovery: explicit input → AGENT_NAME →
    // WORKER_SCRIPT_NAME → list workers + pick best. The user's actual
    // deployed name might be "tomtom-agent" not "helm", and we should
    // figure that out instead of asking.
    const scriptName = await this.resolveScript(token, acc, o.scriptName);

    const steps: Array<{ kind: string; ok: boolean; detail?: string }> = [];
    const tomlSnippets: string[] = [];

    // ---- 2. Lockdown (Access) — only if not already done ----
    if (!o.skipAccess && !(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD)) {
      const allowedEmails = (o.allowedEmails && o.allowedEmails.length > 0)
        ? o.allowedEmails
        : (env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL)
          ? [(env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL) as string]
          : [];
      if (allowedEmails.length === 0) {
        steps.push({
          kind: "lockdown",
          ok: false,
          detail: "skipped — no AGENT_OWNER_EMAIL/OWNER_EMAIL set. Set one and re-run, or pass allowedEmails."
        });
      } else {
        const lockdown = await runLockdown({
          token,
          accountId: acc,
          scriptName,
          appName: `Helm — ${scriptName}`,
          workerHost: `${scriptName}.workers.dev`,
          allowedEmails
        });
        steps.push({
          kind: "lockdown",
          ok: lockdown.ok,
          detail: lockdown.ok ? `Access app ${lockdown.aud?.slice(0, 12)}…` : lockdown.error
        });
      }
    } else {
      steps.push({ kind: "lockdown", ok: true, detail: "already configured (CF_ACCESS_* set)" });
    }

    // ---- 3. HELM_INTERNAL_TOKEN ----
    if (!env.HELM_INTERNAL_TOKEN) {
      const tok = this.randomHex(32);
      const r = await this.cfPutSecret(token, acc, scriptName, "HELM_INTERNAL_TOKEN", tok);
      steps.push({ kind: "secret HELM_INTERNAL_TOKEN", ok: r.ok, detail: r.detail });
    } else {
      steps.push({ kind: "secret HELM_INTERNAL_TOKEN", ok: true, detail: "already set" });
    }

    // ---- 4. R2 bucket + WORKSPACE binding ----
    const bucketName = env.R2_BUCKET || `${scriptName}-persist`;
    const bucketCreate = await this.cfCreateR2(token, acc, bucketName);
    steps.push({ kind: `r2 bucket ${bucketName}`, ok: bucketCreate.ok, detail: bucketCreate.detail });
    if (bucketCreate.ok) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "r2_bucket", name: "WORKSPACE", config: { bucket_name: bucketName }
      });
      steps.push({ kind: "binding WORKSPACE (r2)", ok: patch.ok, detail: patch.detail });
      tomlSnippets.push(`[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "${bucketName}"`);
      if (!env.R2_BUCKET) {
        const r = await this.cfPutSecret(token, acc, scriptName, "R2_BUCKET", bucketName);
        steps.push({ kind: "secret R2_BUCKET", ok: r.ok, detail: r.detail });
      }
    }

    // ---- 5. D1 PA-stack + DB binding ----
    const d1Name = `${scriptName}-pa`;
    const d1Create = await this.cfCreateD1(token, acc, d1Name);
    steps.push({ kind: `d1 ${d1Name}`, ok: d1Create.ok, detail: d1Create.detail });
    if (d1Create.uuid) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "d1", name: "DB", config: { database_name: d1Name, database_id: d1Create.uuid }
      });
      steps.push({ kind: "binding DB (d1)", ok: patch.ok, detail: patch.detail });
      tomlSnippets.push(`[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${d1Name}"\ndatabase_id = "${d1Create.uuid}"`);
    }

    // ---- 6. KV cache namespace + CACHE binding ----
    const kvTitle = `${scriptName}-cache`;
    const kvCreate = await this.cfCreateKv(token, acc, kvTitle);
    steps.push({ kind: `kv ${kvTitle}`, ok: kvCreate.ok, detail: kvCreate.detail });
    if (kvCreate.id) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "kv_namespace", name: "CACHE", config: { namespace_id: kvCreate.id }
      });
      steps.push({ kind: "binding CACHE (kv)", ok: patch.ok, detail: patch.detail });
      tomlSnippets.push(`[[kv_namespaces]]\nbinding = "CACHE"\nid = "${kvCreate.id}"`);
    }

    // ---- 7. ENABLED_PLUGINS plain_text binding (merge in PA-stack plugins) ----
    const currentPlugins = (env.ENABLED_PLUGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const wantPlugins = new Set([
      ...currentPlugins,
      "admin", "helm-setup", "cloudflare-admin",
      "workers-ai", "openrouter",
      "memory", "mcp-client",
      "notifier", "email", "calendar", "scheduler"
    ]);
    const newPluginsList = Array.from(wantPlugins).join(",");
    if (newPluginsList !== env.ENABLED_PLUGINS) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "plain_text", name: "ENABLED_PLUGINS", config: { text: newPluginsList }
      });
      steps.push({
        kind: "var ENABLED_PLUGINS",
        ok: patch.ok,
        detail: patch.ok ? `set to ${newPluginsList}` : patch.detail
      });
    } else {
      steps.push({ kind: "var ENABLED_PLUGINS", ok: true, detail: "already includes all PA plugins" });
    }

    // ---- 8. CLOUDFLARE_ACCOUNT_ID secret (so future requests skip /accounts) ----
    if (!env.CLOUDFLARE_ACCOUNT_ID) {
      const r = await this.cfPutSecret(token, acc, scriptName, "CLOUDFLARE_ACCOUNT_ID", acc);
      steps.push({ kind: "secret CLOUDFLARE_ACCOUNT_ID", ok: r.ok, detail: r.detail });
    } else {
      steps.push({ kind: "secret CLOUDFLARE_ACCOUNT_ID", ok: true, detail: "already set" });
    }

    // ---- 9. WORKER_SCRIPT_NAME secret (so future requests skip
    //         /workers/scripts auto-discovery — saves a roundtrip
    //         AND prevents the "wrong default" footgun where /scripts/helm
    //         404s because the user named their Worker something else). ----
    const fromEnv = env.AGENT_NAME ||
      (env as Env & { WORKER_SCRIPT_NAME?: string }).WORKER_SCRIPT_NAME;
    if (!fromEnv) {
      const r = await this.cfPutSecret(token, acc, scriptName, "WORKER_SCRIPT_NAME", scriptName);
      steps.push({ kind: "secret WORKER_SCRIPT_NAME", ok: r.ok, detail: r.detail });
    } else {
      steps.push({ kind: "secret WORKER_SCRIPT_NAME", ok: true, detail: `${fromEnv} (already set)` });
    }

    // ---- 10. Cloudflare Artifacts repo (canonical source-of-truth for
    //          wrangler.toml + Worker source; no GitHub required). ----
    let artifactsCloneUrl: string | null = null;
    let artifactsRemote: string | null = null;
    if (o.skipArtifacts) {
      steps.push({ kind: "artifacts repo", ok: true, detail: "skipped (input.skipArtifacts)" });
    } else {
      const namespace = o.artifactsNamespace || env.ARTIFACTS_NAMESPACE || "default";
      const repoName = o.artifactsRepo || env.ARTIFACTS_REPO || scriptName;
      const bootstrapUrl = o.artifactsBootstrapUrl || env.ARTIFACTS_BOOTSTRAP_URL || "";
      const artifacts = await this.cfEnsureArtifactsRepo(
        token,
        acc,
        namespace,
        repoName,
        bootstrapUrl
      );
      steps.push({
        kind: `artifacts repo ${namespace}/${repoName}`,
        ok: artifacts.ok,
        detail: artifacts.detail
      });
      if (artifacts.ok && artifacts.remote) {
        artifactsRemote = artifacts.remote;
        // Only persist the secrets if they're not already set — avoid
        // pointless writes that trigger redeploy churn.
        if (!env.ARTIFACTS_REPO) {
          const r = await this.cfPutSecret(token, acc, scriptName, "ARTIFACTS_REPO", repoName);
          steps.push({ kind: "secret ARTIFACTS_REPO", ok: r.ok, detail: r.detail });
        } else {
          steps.push({ kind: "secret ARTIFACTS_REPO", ok: true, detail: "already set" });
        }
        if (!env.ARTIFACTS_NAMESPACE && namespace !== "default") {
          const r = await this.cfPutSecret(token, acc, scriptName, "ARTIFACTS_NAMESPACE", namespace);
          steps.push({ kind: "secret ARTIFACTS_NAMESPACE", ok: r.ok, detail: r.detail });
        }
        // The clone URL we surface to the user has a placeholder where
        // their token will go. Tokens are minted on demand via
        // helm-artifacts-mint-token (or the Settings card).
        artifactsCloneUrl = `git clone https://x:<artifacts-token>@${artifacts.remote.replace(/^https:\/\//, "")}`;
      }
    }

    const notes = [
      "Live Worker is now provisioned + bound. CF auto-redeploys on settings change (~15s); wait that long before testing.",
      "Provider keys (OpenRouter / Anthropic / OpenAI) and VAPID keys remain manual — paste in /app#/settings → Manage secrets."
    ];
    if (artifactsRemote) {
      notes.unshift(
        "Cloudflare Artifacts is now the canonical source-of-truth for wrangler.toml. The agent commits drift fixes to it via helm-artifacts-sync-toml; you clone it locally for direct edits. helm-artifacts-mint-token returns a fresh token when you need to push from your machine."
      );
    } else {
      notes.push(
        "Commit the wranglerTomlAdditions to your wrangler.toml so the next `wrangler deploy` from your machine doesn't drop the bindings."
      );
    }

    return {
      ok: steps.every((s) => s.ok),
      data: {
        accountId: acc,
        scriptName,
        steps,
        wranglerTomlAdditions: tomlSnippets.join("\n\n"),
        artifacts: artifactsRemote
          ? { remote: artifactsRemote, cloneCommand: artifactsCloneUrl }
          : null,
        notes
      }
    };
  }

  /**
   * Ensure the canonical Cloudflare Artifacts repo exists for this Worker.
   * Idempotent — probes first, falls back to either /import (when a
   * bootstrap URL is supplied) or /repos (empty create) when missing.
   * Reports gracefully when the API token lacks Artifacts:Edit scope so
   * the rest of the deploy chain still finishes.
   */
  private async cfEnsureArtifactsRepo(
    token: string,
    accId: string,
    namespace: string,
    repoName: string,
    bootstrapUrl: string
  ): Promise<{ ok: boolean; detail: string; remote?: string; bootstrapped?: boolean }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/artifacts/namespaces/${encodeURIComponent(namespace)}`;
    // Probe.
    const probe = await this.ctx.fetch(`${base}/repos/${encodeURIComponent(repoName)}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" }
    });
    if (probe.ok) {
      const j = (await probe.json().catch(() => ({}))) as {
        success?: boolean;
        result?: { remote?: string };
      };
      if (j.success && j.result?.remote) {
        return { ok: true, detail: "already exists — reusing", remote: j.result.remote };
      }
    } else if (probe.status === 403) {
      // Token doesn't have Artifacts:Edit scope. Don't fail the deploy —
      // just tell the user how to wire it.
      return {
        ok: false,
        detail:
          "skipped — CLOUDFLARE_API_TOKEN lacks the Artifacts:Edit scope. Edit the token at dash → Profile → API Tokens, add the scope, retry."
      };
    } else if (probe.status === 404) {
      // Continue to create path.
    } else if (probe.status >= 500) {
      const t = await probe.text();
      return { ok: false, detail: `probe failed (${probe.status}): ${t.slice(0, 200)}` };
    }
    // Create (empty or imported).
    const url = bootstrapUrl
      ? `${base}/repos/${encodeURIComponent(repoName)}/import`
      : `${base}/repos`;
    const body = bootstrapUrl
      ? { url: bootstrapUrl, branch: "main", depth: 100 }
      : { name: repoName, default_branch: "main", description: `Open Think — ${repoName}` };
    const create = await this.ctx.fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await create.text();
    if (!create.ok && create.status === 403) {
      return {
        ok: false,
        detail:
          "skipped — token rejected by Artifacts API. Add the Artifacts:Edit scope and retry."
      };
    }
    if (!create.ok) {
      return { ok: false, detail: `create failed (${create.status}): ${text.slice(0, 200)}` };
    }
    try {
      const j = JSON.parse(text) as { result?: { remote?: string } };
      return {
        ok: true,
        detail: bootstrapUrl ? `imported from ${bootstrapUrl}` : "created (empty)",
        remote: j.result?.remote,
        bootstrapped: !!bootstrapUrl
      };
    } catch {
      return { ok: true, detail: "created (response unparsable)" };
    }
  }

  private randomHex(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Resolve the deployed Worker's script name. The default "helm" is
   * usually wrong — users name their Workers "tomtom-agent" or
   * whatever. Walk the priority ladder + fall back to listing the
   * account's Workers and picking the best match heuristically.
   *
   * Heuristic: prefer single match. If multiple, prefer name matching
   * env.AGENT_NAME, else regex on /helm|agent|open.?think|tomtom/i,
   * else most-recently-modified. Only "helm" as last-resort.
   */
  private async resolveScript(token: string, accId: string, override?: string): Promise<string> {
    if (override) return override;
    if (!this.ctx) return "helm";
    const env = this.ctx.env as Env;
    const fromEnv = env.AGENT_NAME
      || (env as Env & { WORKER_SCRIPT_NAME?: string }).WORKER_SCRIPT_NAME;
    if (fromEnv) return fromEnv;
    try {
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/workers/scripts`,
        { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
      );
      const j = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        result?: Array<{ id?: string; modified_on?: string }>;
      };
      const workers = (j.result ?? []).filter((s): s is { id: string; modified_on?: string } => Boolean(s.id));
      if (workers.length === 0) return "helm";
      if (workers.length === 1) return workers[0].id;
      // Sort by most-recent first.
      workers.sort((a, b) => (b.modified_on ?? "").localeCompare(a.modified_on ?? ""));
      const preferred = workers.find((s) => /^(helm|agent|open[-_]?think|tomtom|tom-tom)/i.test(s.id));
      return (preferred ?? workers[0]).id;
    } catch {
      return "helm";
    }
  }

  private async resolveAccount(token: string, override?: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    if (override) return { ok: true, id: override };
    if (!this.ctx) return { ok: false, error: "no ctx" };
    const r = await this.ctx.fetch(
      "https://api.cloudflare.com/client/v4/accounts?per_page=10",
      { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
    );
    const j = (await r.json().catch(() => ({}))) as {
      success?: boolean; result?: Array<{ id: string }>; errors?: Array<{ message: string }>;
    };
    if (!r.ok || !j.success || !j.result?.[0]) {
      return { ok: false, error: j.errors?.[0]?.message ?? `list-accounts failed (${r.status})` };
    }
    return { ok: true, id: j.result[0].id };
  }

  private async cfCreateR2(token: string, accId: string, name: string): Promise<{ ok: boolean; detail: string }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const r = await this.ctx.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/r2/buckets`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name })
      }
    );
    const text = await r.text();
    const exists = !r.ok && text.toLowerCase().includes("already exists");
    if (r.ok) return { ok: true, detail: "created" };
    if (exists) return { ok: true, detail: "already exists — reusing" };
    return { ok: false, detail: `failed (${r.status}): ${text.slice(0, 200)}` };
  }

  private async cfCreateD1(token: string, accId: string, name: string): Promise<{ ok: boolean; uuid?: string; detail: string }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const r = await this.ctx.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/d1/database`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name })
      }
    );
    const text = await r.text();
    if (r.ok) {
      try {
        const j = JSON.parse(text) as { result?: { uuid?: string } };
        return { ok: true, uuid: j.result?.uuid, detail: "created" };
      } catch {/* noop */}
    }
    if (text.toLowerCase().includes("already")) {
      // Look it up by name.
      const lookup = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/d1/database?name=${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const lj = (await lookup.json().catch(() => ({}))) as { result?: Array<{ uuid: string }> };
      const existing = lj.result?.[0]?.uuid;
      if (existing) return { ok: true, uuid: existing, detail: "already exists — reusing" };
    }
    return { ok: false, detail: `failed (${r.status}): ${text.slice(0, 200)}` };
  }

  private async cfCreateKv(token: string, accId: string, title: string): Promise<{ ok: boolean; id?: string; detail: string }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const r = await this.ctx.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/storage/kv/namespaces`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ title })
      }
    );
    const text = await r.text();
    if (r.ok) {
      try {
        const j = JSON.parse(text) as { result?: { id?: string } };
        return { ok: true, id: j.result?.id, detail: "created" };
      } catch {/* noop */}
    }
    if (text.toLowerCase().includes("already exists") || text.toLowerCase().includes("duplicate")) {
      // List + find by title.
      const list = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/storage/kv/namespaces?per_page=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const lj = (await list.json().catch(() => ({}))) as { result?: Array<{ id: string; title: string }> };
      const existing = lj.result?.find((n) => n.title === title)?.id;
      if (existing) return { ok: true, id: existing, detail: "already exists — reusing" };
    }
    return { ok: false, detail: `failed (${r.status}): ${text.slice(0, 200)}` };
  }

  private async cfPutSecret(token: string, accId: string, scriptName: string, name: string, text: string): Promise<{ ok: boolean; detail: string }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const r = await this.ctx.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name, text, type: "secret_text" })
      }
    );
    return { ok: r.ok, detail: r.ok ? "set" : `failed (${r.status})` };
  }

  /**
   * PATCH the script's settings to add/replace one binding. Multipart
   * because that's what CF expects. We fetch existing, merge, push back.
   */
  private async cfPatchBinding(
    token: string,
    accId: string,
    scriptName: string,
    binding: { type: string; name: string; config: Record<string, unknown> }
  ): Promise<{ ok: boolean; detail: string }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const settingsUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`;
    const get = await this.ctx.fetch(settingsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!get.ok) return { ok: false, detail: `fetch settings failed (${get.status})` };
    const gj = (await get.json().catch(() => ({}))) as { result?: { bindings?: Array<Record<string, unknown>> } };
    const existing = gj.result?.bindings ?? [];
    // Replace any same-name+same-type entry; otherwise append.
    const filtered = existing.filter((b) => !(b.type === binding.type && b.name === binding.name));
    filtered.push({ type: binding.type, name: binding.name, ...binding.config });
    const body = [
      "--BOUNDARY",
      'Content-Disposition: form-data; name="settings"',
      "Content-Type: application/json",
      "",
      JSON.stringify({ bindings: filtered }),
      "--BOUNDARY--",
      ""
    ].join("\r\n");
    const patch = await this.ctx.fetch(settingsUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "multipart/form-data; boundary=BOUNDARY" },
      body
    });
    if (!patch.ok) {
      const t = await patch.text();
      return { ok: false, detail: `patch failed (${patch.status}): ${t.slice(0, 200)}` };
    }
    return { ok: true, detail: "patched" };
  }
}
