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

    if (action === "update") {
      // Self-update: agent uploads a fresher version of itself to its
      // own Worker. Compares env.BUILD_SHA against the upstream manifest
      // sha; downloads + uploads when different (or always, with force).
      // Preserves customer bindings + auto-stamps the new BUILD_SHA so
      // a subsequent call short-circuits.
      return await this.runUpdate(input);
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
      // CF Workers live at <name>.<account-subdomain>.workers.dev — NOT
      // <name>.workers.dev. Resolve the account's subdomain so we pass
      // the right host to runLockdown (which short-circuits on
      // workers.dev anyway, but the messaging needs to be accurate; and
      // when the user later adds a custom domain we pick that up too).
      const scriptName = o.scriptName || env.AGENT_NAME || "helm";
      const workerHost = await this.resolveWorkerHost(token, pickedAccount.id, scriptName);
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
      // Auto-create R2 bucket. Mirrors runDeploy's collision strategy:
      // explicit env.R2_BUCKET → reuse on collision; auto-generated
      // name → suffix `-2`, `-3`, … so we don't bind a fresh agent to
      // a foreign bucket from a prior install.
      let bucketName = env.R2_BUCKET || `${scriptName}-persist`;
      if (!env.R2_BUCKET) {
        const create = await this.cfCreateR2(token, pickedAccount.id, bucketName, {
          suffixOnConflict: true
        });
        if (create.ok && create.name) bucketName = create.name;
        extras.push({
          kind: "create-r2-bucket",
          ok: create.ok,
          detail: create.detail
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

  /* ---------------- helpers for self-update ---------------- */

  /**
   * Self-update: fetch the upstream bundle manifest, compare to
   * env.BUILD_SHA, and (when newer) PUT a fresh upload to our own
   * Worker via the CF API. The new BUILD_SHA is stamped as a plain_text
   * binding so subsequent calls short-circuit.
   *
   * Idempotency: when env.BUILD_SHA === manifest.sha and `force` isn't
   * set, returns `action: "already-up-to-date"` without making any
   * upload. The Worker's bindings are NOT re-read in that fast path
   * (we don't even need a CF token to short-circuit).
   *
   * Preserves customer state: GETs /settings/bindings before upload and
   * keeps every binding NOT in the upstream manifest (so customer-added
   * D1 IDs, secret_text values, KV namespaces, etc. ride through).
   */
  private async runUpdate(input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };
    const env = this.ctx.env as Env;
    const o = asObj(input) as { manifestUrl?: string; force?: boolean };

    const manifestUrl = (typeof o.manifestUrl === "string" && o.manifestUrl)
      || env.HELM_BUNDLE_MANIFEST_URL
      || "https://opentink.dev/helm/manifest.json";
    const currentSha = env.BUILD_SHA ?? null;

    // 1. Fetch manifest.
    let manifest: {
      sha: string;
      version?: string;
      moduleUrl: string;
      metadata: {
        main_module: string;
        compatibility_date?: string;
        compatibility_flags?: string[];
        bindings?: Array<Record<string, unknown> & { name?: unknown; type?: unknown }>;
        migrations?: Array<Record<string, unknown>>;
      };
    };
    try {
      const r = await this.ctx.fetch(manifestUrl, {
        headers: { accept: "application/json" }
      });
      if (!r.ok) {
        return { ok: false, error: `manifest fetch ${r.status}: ${(await r.text()).slice(0, 200)}` };
      }
      manifest = await r.json();
      if (!manifest.sha || !manifest.moduleUrl || !manifest.metadata) {
        return { ok: false, error: "manifest missing required fields (sha, moduleUrl, metadata)" };
      }
    } catch (err) {
      return { ok: false, error: `manifest fetch failed: ${(err as Error).message}` };
    }

    // 2. Short-circuit when already up-to-date.
    if (!o.force && currentSha && currentSha === manifest.sha) {
      return {
        ok: true,
        data: {
          action: "already-up-to-date",
          currentSha,
          manifestSha: manifest.sha,
          version: manifest.version ?? null,
          manifestUrl,
          note: "BUILD_SHA matches the upstream manifest — no upload needed."
        }
      };
    }

    // 3. From here we need the CF token + script identity.
    const token = env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AGENT_TOKEN ?? "";
    if (!token) {
      return {
        ok: false,
        error: "CLOUDFLARE_API_TOKEN missing. Self-update needs the same token used for deploy. Paste it in /app#/settings → Manage secrets."
      };
    }
    const accountResolve = await this.resolveAccount(token, env.CLOUDFLARE_ACCOUNT_ID);
    if (!accountResolve.ok) return { ok: false, error: accountResolve.error };
    const accountId = accountResolve.id;
    const scriptName = await this.resolveScript(token, accountId);

    // 4. Read current bindings so we don't clobber D1 IDs / secrets / extras.
    let existingBindings: Array<Record<string, unknown> & { name?: unknown; type?: unknown }> = [];
    try {
      const settings = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
        { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
      );
      if (settings.ok) {
        const j = (await settings.json().catch(() => ({}))) as {
          result?: { bindings?: Array<Record<string, unknown> & { name?: unknown; type?: unknown }> };
        };
        existingBindings = j.result?.bindings ?? [];
      }
    } catch {
      // Non-fatal — proceed with manifest-only bindings.
    }

    // 5. Merge: manifest is the floor (defines required names), customer
    //    bindings overlay (preserve type-specific fields like database_id),
    //    customer-only names ride through (their additions).
    const manifestBindings = manifest.metadata.bindings ?? [];
    const merged = mergeBindingsByName(manifestBindings, existingBindings);

    // 6. Stamp BUILD_SHA fresh (drop any prior to avoid duplicates).
    const finalBindings = merged.filter(
      (b) => !(b.type === "plain_text" && b.name === "BUILD_SHA")
    );
    finalBindings.push({
      type: "plain_text",
      name: "BUILD_SHA",
      text: manifest.sha
    });

    // 7. Fetch the bundle bytes.
    let moduleBytes: ArrayBuffer;
    try {
      const r = await this.ctx.fetch(manifest.moduleUrl, {
        headers: { accept: "application/javascript+module" }
      });
      if (!r.ok) {
        return { ok: false, error: `module fetch ${r.status}: ${(await r.text()).slice(0, 200)}` };
      }
      moduleBytes = await r.arrayBuffer();
    } catch (err) {
      return { ok: false, error: `module fetch failed: ${(err as Error).message}` };
    }

    // 8. Build metadata + flatten migrations (CF API expects single
    //    object, not array). Identical shape to deployFlow / pushUpdates.
    const metadata: Record<string, unknown> = {
      main_module: manifest.metadata.main_module,
      compatibility_date: manifest.metadata.compatibility_date,
      compatibility_flags: manifest.metadata.compatibility_flags,
      bindings: finalBindings
    };
    const flatMigrations = flattenMigrations(manifest.metadata.migrations);
    if (flatMigrations) metadata.migrations = flatMigrations;

    // 9. Upload via multipart form (CF Workers Scripts API contract).
    const uploadResult = await uploadWorkerMultipart({
      fetchImpl: this.ctx.fetch,
      token,
      accountId,
      scriptName,
      mainModuleName: manifest.metadata.main_module,
      moduleBytes,
      metadata
    });
    if (!uploadResult.ok) {
      return { ok: false, error: uploadResult.error };
    }

    // Clear HELM_CUSTOM_DEPLOY — the user explicitly opted into upstream
    // by calling this skill, so hand the deployment back to the cron.
    // 404 (no flag set) is success. Silent on failure: the upload is
    // what matters; the flag-clear is a follow-up hint.
    let clearedSelfManaged = false;
    try {
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets/HELM_CUSTOM_DEPLOY`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      clearedSelfManaged = r.ok || r.status === 404;
    } catch {
      // Non-fatal — the upstream upload already succeeded.
    }

    return {
      ok: true,
      data: {
        action: "updated",
        previousSha: currentSha,
        newSha: manifest.sha,
        version: manifest.version ?? null,
        manifestUrl,
        scriptName,
        moduleBytes: moduleBytes.byteLength,
        clearedSelfManaged,
        note: currentSha
          ? `Updated from ${currentSha.slice(0, 8)} → ${manifest.sha.slice(0, 8)}. CF will reload the Worker (~15s).${clearedSelfManaged ? " HELM_CUSTOM_DEPLOY cleared; upstream cron will resume on the next tick." : ""}`
          : `Uploaded ${manifest.sha.slice(0, 8)}. CF will reload the Worker (~15s).`
      }
    };
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
          workerHost: await this.resolveWorkerHost(token, acc, scriptName),
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
    // Idempotency + collision strategy: if WORKSPACE is already bound,
    // reuse its bucket. Else try to create the canonical name; if a
    // foreign R2 bucket already owns it (and the user didn't pin
    // R2_BUCKET explicitly), suffix `-2`, `-3`, … so a fresh agent
    // doesn't get bound to someone else's bucket.
    const r2UserExplicit = !!env.R2_BUCKET;
    const r2Preferred = env.R2_BUCKET || `${scriptName}-persist`;
    const r2Existing = await this.findExistingBinding(token, acc, scriptName, "r2_bucket", "WORKSPACE");
    let r2Name: string | undefined;
    if (r2Existing && typeof r2Existing.bucket_name === "string") {
      r2Name = r2Existing.bucket_name as string;
      steps.push({ kind: `r2 bucket ${r2Name}`, ok: true, detail: `WORKSPACE already bound — reusing ${r2Name}` });
    } else {
      const bucketCreate = await this.cfCreateR2(token, acc, r2Preferred, {
        suffixOnConflict: !r2UserExplicit
      });
      steps.push({ kind: `r2 bucket`, ok: bucketCreate.ok, detail: bucketCreate.detail });
      r2Name = bucketCreate.name;
    }
    if (r2Name) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "r2_bucket", name: "WORKSPACE", config: { bucket_name: r2Name }
      });
      steps.push({ kind: "binding WORKSPACE (r2)", ok: patch.ok, detail: patch.detail });
      tomlSnippets.push(`[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "${r2Name}"`);
      // Persist the actual bucket name (may differ from preferred when
      // we suffixed). Update R2_BUCKET secret if it's missing OR if
      // suffixing changed the name.
      if (!env.R2_BUCKET || env.R2_BUCKET !== r2Name) {
        const r = await this.cfPutSecret(token, acc, scriptName, "R2_BUCKET", r2Name);
        steps.push({ kind: "secret R2_BUCKET", ok: r.ok, detail: r.detail });
      }
    }

    // ---- 5. D1 PA-stack + DB binding ----
    const d1Existing = await this.findExistingBinding(token, acc, scriptName, "d1", "DB");
    let d1Name: string | undefined;
    let d1Uuid: string | undefined;
    if (d1Existing && typeof d1Existing.database_name === "string" && typeof d1Existing.database_id === "string") {
      d1Name = d1Existing.database_name as string;
      d1Uuid = d1Existing.database_id as string;
      steps.push({ kind: `d1 ${d1Name}`, ok: true, detail: `DB already bound — reusing ${d1Name}` });
    } else {
      const d1Preferred = `${scriptName}-pa`;
      const d1Create = await this.cfCreateD1(token, acc, d1Preferred, { suffixOnConflict: true });
      steps.push({ kind: `d1`, ok: d1Create.ok, detail: d1Create.detail });
      d1Name = d1Create.name;
      d1Uuid = d1Create.uuid;
    }
    if (d1Name && d1Uuid) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "d1", name: "DB", config: { database_name: d1Name, database_id: d1Uuid }
      });
      steps.push({ kind: "binding DB (d1)", ok: patch.ok, detail: patch.detail });
      tomlSnippets.push(`[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${d1Name}"\ndatabase_id = "${d1Uuid}"`);
    }

    // ---- 6. KV cache namespace + CACHE binding ----
    const kvExisting = await this.findExistingBinding(token, acc, scriptName, "kv_namespace", "CACHE");
    let kvId: string | undefined;
    let kvTitle: string | undefined;
    if (kvExisting && typeof kvExisting.namespace_id === "string") {
      kvId = kvExisting.namespace_id as string;
      // Worker bindings don't carry the human-readable title; leave
      // kvTitle undefined and skip the toml snippet's title field.
      steps.push({ kind: `kv namespace`, ok: true, detail: `CACHE already bound — reusing namespace ${kvId.slice(0, 8)}…` });
    } else {
      const kvPreferred = `${scriptName}-cache`;
      const kvCreate = await this.cfCreateKv(token, acc, kvPreferred, { suffixOnConflict: true });
      steps.push({ kind: `kv namespace`, ok: kvCreate.ok, detail: kvCreate.detail });
      kvId = kvCreate.id;
      kvTitle = kvCreate.title;
    }
    if (kvId) {
      const patch = await this.cfPatchBinding(token, acc, scriptName, {
        type: "kv_namespace", name: "CACHE", config: { namespace_id: kvId }
      });
      steps.push({ kind: "binding CACHE (kv)", ok: patch.ok, detail: patch.detail });
      tomlSnippets.push(`[[kv_namespaces]]\nbinding = "CACHE"\nid = "${kvId}"`);
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
      const userExplicitRepo = !!(o.artifactsRepo || env.ARTIFACTS_REPO);
      const repoPreferred = o.artifactsRepo || env.ARTIFACTS_REPO || scriptName;
      const bootstrapUrl = o.artifactsBootstrapUrl || env.ARTIFACTS_BOOTSTRAP_URL || "";
      const artifacts = await this.cfEnsureArtifactsRepo(
        token,
        acc,
        namespace,
        repoPreferred,
        bootstrapUrl,
        { suffixOnConflict: !userExplicitRepo }
      );
      steps.push({
        kind: `artifacts repo ${namespace}/${artifacts.name ?? repoPreferred}`,
        ok: artifacts.ok,
        detail: artifacts.detail
      });
      if (artifacts.ok && artifacts.remote && artifacts.name) {
        artifactsRemote = artifacts.remote;
        const repoName = artifacts.name;
        // Persist ARTIFACTS_REPO when missing OR when suffixing
        // produced a name that differs from what's stored. Skip the
        // write when nothing changed to avoid redeploy churn.
        if (!env.ARTIFACTS_REPO || env.ARTIFACTS_REPO !== repoName) {
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
   * Probes first; on existence, behavior depends on `suffixOnConflict`:
   *   - false (legacy / explicit name): reuse the existing repo silently
   *   - true (auto-generated name): suffix `-2`, `-3`, … up to maxAttempts
   *     so we don't bind a fresh agent to a foreign repo
   * Reports gracefully when the API token lacks Artifacts:Edit scope so
   * the rest of the deploy chain still finishes.
   */
  private async cfEnsureArtifactsRepo(
    token: string,
    accId: string,
    namespace: string,
    preferredName: string,
    bootstrapUrl: string,
    opts: { suffixOnConflict?: boolean; maxAttempts?: number } = {}
  ): Promise<{ ok: boolean; name?: string; detail: string; remote?: string; bootstrapped?: boolean; suffixed?: boolean; reused?: boolean }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/artifacts/namespaces/${encodeURIComponent(namespace)}`;
    const maxAttempts = opts.maxAttempts ?? 10;

    for (let i = 0; i < maxAttempts; i++) {
      const candidate = i === 0 ? preferredName : `${preferredName}-${i + 1}`;
      // Probe.
      const probe = await this.ctx.fetch(`${base}/repos/${encodeURIComponent(candidate)}`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" }
      });
      if (probe.ok) {
        const j = (await probe.json().catch(() => ({}))) as {
          success?: boolean;
          result?: { remote?: string };
        };
        if (j.success && j.result?.remote) {
          if (opts.suffixOnConflict) {
            // Foreign repo at the canonical name — try next suffix.
            continue;
          }
          // Explicit name (or first attempt with no suffix policy) → reuse.
          return {
            ok: true,
            name: candidate,
            detail: i === 0 ? "already exists — reusing" : `${candidate} already exists — reusing`,
            remote: j.result.remote,
            reused: true
          };
        }
      } else if (probe.status === 403) {
        return {
          ok: false,
          detail:
            "skipped — CLOUDFLARE_API_TOKEN lacks the Artifacts:Edit scope. Edit the token at dash → Profile → API Tokens, add the scope, retry."
        };
      } else if (probe.status >= 500) {
        const t = await probe.text();
        return { ok: false, detail: `probe failed (${probe.status}): ${t.slice(0, 200)}` };
      }
      // probe was 404 OR success-with-no-remote → create at this candidate.
      const url = bootstrapUrl
        ? `${base}/repos/${encodeURIComponent(candidate)}/import`
        : `${base}/repos`;
      const body = bootstrapUrl
        ? { url: bootstrapUrl, branch: "main", depth: 100 }
        : { name: candidate, default_branch: "main", description: `Open Think — ${candidate}` };
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
      // CF can return 409 (or specific message) when repo is already
      // importing/forking — treat as collision and try next suffix.
      if (!create.ok) {
        const lower = text.toLowerCase();
        const collision =
          create.status === 409 ||
          lower.includes("already exists") ||
          lower.includes("already importing") ||
          lower.includes("name is taken");
        if (collision && opts.suffixOnConflict) continue;
        return { ok: false, detail: `create failed (${create.status}): ${text.slice(0, 200)}` };
      }
      try {
        const j = JSON.parse(text) as { result?: { remote?: string } };
        return {
          ok: true,
          name: candidate,
          detail:
            (bootstrapUrl ? `imported from ${bootstrapUrl}` : "created (empty)") +
            (i > 0 ? ` (canonical name was taken — suffixed -${i + 1})` : ""),
          remote: j.result?.remote,
          bootstrapped: !!bootstrapUrl,
          suffixed: i > 0
        };
      } catch {
        return { ok: true, name: candidate, detail: "created (response unparsable)" };
      }
    }
    return { ok: false, detail: `${preferredName} and ${maxAttempts - 1} suffix variants all collided — try a different base name` };
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

  /**
   * Compose the full Worker host: `<script>.<account-subdomain>.workers.dev`.
   * Falls back to the (technically-wrong) `<script>.workers.dev` when the
   * subdomain lookup fails so the lockdown call still goes through with a
   * usable string — runLockdown's workers.dev short-circuit catches both
   * shapes.
   */
  private async resolveWorkerHost(token: string, accId: string, scriptName: string): Promise<string> {
    if (!this.ctx) return `${scriptName}.workers.dev`;
    try {
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/workers/subdomain`,
        { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
      );
      if (!r.ok) return `${scriptName}.workers.dev`;
      const j = (await r.json().catch(() => ({}))) as { result?: { subdomain?: string } };
      const sub = j.result?.subdomain;
      if (!sub) return `${scriptName}.workers.dev`;
      return `${scriptName}.${sub}.workers.dev`;
    } catch {
      return `${scriptName}.workers.dev`;
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

  /**
   * Look up an existing binding on the live Worker. Returns null when
   * Worker doesn't exist, the token can't read settings, or the binding
   * isn't bound. Used by runDeploy to short-circuit creates when we're
   * re-running against an already-provisioned Worker.
   */
  private async findExistingBinding(
    token: string,
    accId: string,
    scriptName: string,
    type: string,
    bindingName: string
  ): Promise<Record<string, unknown> | null> {
    if (!this.ctx) return null;
    const r = await this.ctx.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
      { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
    );
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as {
      result?: { bindings?: Array<Record<string, unknown>> };
    };
    return (j.result?.bindings ?? []).find((b) => b.type === type && b.name === bindingName) ?? null;
  }

  /**
   * Create an R2 bucket. With `suffixOnConflict`, retries with `-2`,
   * `-3`, … up to maxAttempts when the canonical name is taken by a
   * foreign resource — the user is deploying a NEW agent in an account
   * with prior installs, and we'd rather take a fresh name than silently
   * bind to someone else's bucket. Without the flag (legacy default for
   * user-explicit names), reuses on collision.
   */
  private async cfCreateR2(
    token: string,
    accId: string,
    preferredName: string,
    opts: { suffixOnConflict?: boolean; maxAttempts?: number } = {}
  ): Promise<{ ok: boolean; name?: string; detail: string; suffixed?: boolean; reused?: boolean }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const maxAttempts = opts.maxAttempts ?? 10;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = i === 0 ? preferredName : `${preferredName}-${i + 1}`;
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/r2/buckets`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ name: candidate })
        }
      );
      const text = await r.text();
      if (r.ok) {
        return {
          ok: true,
          name: candidate,
          detail: i === 0 ? `created ${candidate}` : `created ${candidate} (canonical name was taken — suffixed -${i + 1})`,
          suffixed: i > 0
        };
      }
      const exists = text.toLowerCase().includes("already exists");
      if (!exists) return { ok: false, detail: `failed (${r.status}): ${text.slice(0, 200)}` };
      if (!opts.suffixOnConflict) {
        // Legacy contract: explicit name + collision = reuse silently.
        return { ok: true, name: candidate, detail: `${candidate} already exists — reusing`, reused: true };
      }
      // suffixOnConflict + collision → try next suffix
    }
    return { ok: false, detail: `${preferredName} and ${maxAttempts - 1} suffix variants all collided — try a different base name` };
  }

  /**
   * Create a D1 database. See `cfCreateR2` for the `suffixOnConflict`
   * semantics. On a non-suffix reuse path we still look up the existing
   * uuid by name so callers get a usable id back.
   */
  private async cfCreateD1(
    token: string,
    accId: string,
    preferredName: string,
    opts: { suffixOnConflict?: boolean; maxAttempts?: number } = {}
  ): Promise<{ ok: boolean; name?: string; uuid?: string; detail: string; suffixed?: boolean; reused?: boolean }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const maxAttempts = opts.maxAttempts ?? 10;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = i === 0 ? preferredName : `${preferredName}-${i + 1}`;
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/d1/database`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ name: candidate })
        }
      );
      const text = await r.text();
      if (r.ok) {
        try {
          const j = JSON.parse(text) as { result?: { uuid?: string } };
          return {
            ok: true,
            name: candidate,
            uuid: j.result?.uuid,
            detail: i === 0 ? `created ${candidate}` : `created ${candidate} (canonical name was taken — suffixed -${i + 1})`,
            suffixed: i > 0
          };
        } catch {
          /* fall through */
        }
      }
      const exists = text.toLowerCase().includes("already");
      if (!exists) return { ok: false, detail: `failed (${r.status}): ${text.slice(0, 200)}` };
      if (!opts.suffixOnConflict) {
        // Legacy: look up existing by name and return its uuid.
        const lookup = await this.ctx.fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/d1/database?name=${encodeURIComponent(candidate)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const lj = (await lookup.json().catch(() => ({}))) as { result?: Array<{ uuid: string; name: string }> };
        const existing = lj.result?.find((d) => d.name === candidate)?.uuid ?? lj.result?.[0]?.uuid;
        if (existing) return { ok: true, name: candidate, uuid: existing, detail: `${candidate} already exists — reusing`, reused: true };
        return { ok: false, detail: `${candidate} already exists but lookup failed` };
      }
      // suffixOnConflict → try next
    }
    return { ok: false, detail: `${preferredName} and ${maxAttempts - 1} suffix variants all collided — try a different base name` };
  }

  /**
   * Create a KV namespace. See `cfCreateR2` for the `suffixOnConflict`
   * semantics.
   */
  private async cfCreateKv(
    token: string,
    accId: string,
    preferredTitle: string,
    opts: { suffixOnConflict?: boolean; maxAttempts?: number } = {}
  ): Promise<{ ok: boolean; title?: string; id?: string; detail: string; suffixed?: boolean; reused?: boolean }> {
    if (!this.ctx) return { ok: false, detail: "no ctx" };
    const maxAttempts = opts.maxAttempts ?? 10;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = i === 0 ? preferredTitle : `${preferredTitle}-${i + 1}`;
      const r = await this.ctx.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/storage/kv/namespaces`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ title: candidate })
        }
      );
      const text = await r.text();
      if (r.ok) {
        try {
          const j = JSON.parse(text) as { result?: { id?: string } };
          return {
            ok: true,
            title: candidate,
            id: j.result?.id,
            detail: i === 0 ? `created ${candidate}` : `created ${candidate} (canonical title was taken — suffixed -${i + 1})`,
            suffixed: i > 0
          };
        } catch {
          /* fall through */
        }
      }
      const lower = text.toLowerCase();
      const exists = lower.includes("already exists") || lower.includes("duplicate");
      if (!exists) return { ok: false, detail: `failed (${r.status}): ${text.slice(0, 200)}` };
      if (!opts.suffixOnConflict) {
        // Legacy: list + match by title.
        const list = await this.ctx.fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accId)}/storage/kv/namespaces?per_page=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const lj = (await list.json().catch(() => ({}))) as { result?: Array<{ id: string; title: string }> };
        const existing = lj.result?.find((n) => n.title === candidate)?.id;
        if (existing) return { ok: true, title: candidate, id: existing, detail: `${candidate} already exists — reusing`, reused: true };
        return { ok: false, detail: `${candidate} already exists but lookup failed` };
      }
      // suffixOnConflict → try next
    }
    return { ok: false, detail: `${preferredTitle} and ${maxAttempts - 1} suffix variants all collided — try a different base name` };
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

/* ---------------- module-level helpers used by runUpdate ----------------
 *
 * These mirror the marketing-site cron path (site/src/cloud/pushUpdates.ts
 * + cfApi.ts) so the agent's self-update produces an identical upload to
 * what the cron would push. Duplicated rather than imported because the
 * agent runtime can't pull from the marketing site at build time.
 */

/**
 * Manifest bindings are the floor — every name we expect must end up in
 * the merged set. Customer bindings overlay so type-specific fields
 * (database_id, secret_text values, KV namespace_id) survive the upload.
 * Extra customer-only names ride through unchanged.
 */
function mergeBindingsByName(
  manifest: Array<Record<string, unknown> & { name?: unknown; type?: unknown }>,
  customer: Array<Record<string, unknown> & { name?: unknown; type?: unknown }>
): Array<Record<string, unknown> & { name?: unknown; type?: unknown }> {
  const byName = new Map<string, Record<string, unknown> & { name?: unknown; type?: unknown }>();
  for (const b of manifest) {
    if (typeof b.name === "string") byName.set(b.name, { ...b });
  }
  for (const b of customer) {
    if (typeof b.name !== "string") continue;
    const existing = byName.get(b.name);
    if (existing) {
      if (existing.type === b.type) {
        byName.set(b.name, { ...existing, ...b });
      }
      // Type mismatch — keep manifest's view; customer's binding will
      // be replaced. Rare; not worth a console.warn from a plugin.
    } else {
      byName.set(b.name, { ...b });
    }
  }
  return Array.from(byName.values());
}

/**
 * CF Workers Scripts API expects metadata.migrations as a SINGLE object
 * describing the diff to apply, not the wrangler.toml-shaped historical
 * array. Collapse [v1, v2, v3] into one {new_tag, new_classes,
 * new_sqlite_classes, ...} using the LAST entry's tag as new_tag.
 *
 * Returns null when there are no migrations — caller should drop the
 * field entirely.
 */
function flattenMigrations(
  migrations: Array<Record<string, unknown>> | undefined
): Record<string, unknown> | null {
  if (!migrations || migrations.length === 0) return null;
  const last = migrations[migrations.length - 1];
  const newClasses = new Set<string>();
  const newSqliteClasses = new Set<string>();
  const renamedClasses: Array<Record<string, unknown>> = [];
  const transferredClasses: Array<Record<string, unknown>> = [];
  const deletedClasses = new Set<string>();
  for (const m of migrations) {
    for (const c of (m.new_classes as string[] | undefined) ?? []) newClasses.add(c);
    for (const c of (m.new_sqlite_classes as string[] | undefined) ?? []) newSqliteClasses.add(c);
    for (const r of (m.renamed_classes as Array<Record<string, unknown>> | undefined) ?? []) renamedClasses.push(r);
    for (const t of (m.transferred_classes as Array<Record<string, unknown>> | undefined) ?? []) transferredClasses.push(t);
    for (const d of (m.deleted_classes as string[] | undefined) ?? []) deletedClasses.add(d);
  }
  const flat: Record<string, unknown> = { new_tag: String(last.tag ?? "") };
  if (newClasses.size > 0) flat.new_classes = Array.from(newClasses);
  if (newSqliteClasses.size > 0) flat.new_sqlite_classes = Array.from(newSqliteClasses);
  if (renamedClasses.length > 0) flat.renamed_classes = renamedClasses;
  if (transferredClasses.length > 0) flat.transferred_classes = transferredClasses;
  if (deletedClasses.size > 0) flat.deleted_classes = Array.from(deletedClasses);
  return flat;
}

/**
 * PUT /workers/scripts/{name} as a multipart form with metadata + the
 * main module bytes. Idempotent (CF replaces the script atomically).
 *
 * Auto-recovers from "Actor migration tag precondition failed" — when
 * the live Worker is already at a newer migration than our `new_tag`,
 * we either drop migrations entirely (same tag) or set old_tag to the
 * expected value (older tag) and retry.
 */
async function uploadWorkerMultipart(input: {
  fetchImpl: typeof fetch;
  token: string;
  accountId: string;
  scriptName: string;
  mainModuleName: string;
  moduleBytes: ArrayBuffer;
  metadata: Record<string, unknown>;
}): Promise<{ ok: true; etag?: string } | { ok: false; error: string }> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(input.scriptName)}`;
  const buildBody = (metadata: Record<string, unknown>): FormData => {
    const fd = new FormData();
    fd.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata"
    );
    fd.append(
      input.mainModuleName,
      new Blob([input.moduleBytes], { type: "application/javascript+module" }),
      input.mainModuleName
    );
    return fd;
  };
  const send = async (metadata: Record<string, unknown>): Promise<Response> =>
    input.fetchImpl(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${input.token}` },
      body: buildBody(metadata)
    });

  let resp = await send(input.metadata);
  if (!resp.ok) {
    const text = await resp.text();
    const tagMismatch = /migration tag precondition failed.*expected tag is ['"]([^'"]+)['"]/i.exec(text);
    const flat = input.metadata.migrations as Record<string, unknown> | undefined;
    if (tagMismatch && flat) {
      const expected = tagMismatch[1];
      const retryMeta = { ...input.metadata };
      if (expected === flat.new_tag) {
        delete (retryMeta as { migrations?: unknown }).migrations;
      } else {
        retryMeta.migrations = { ...flat, old_tag: expected };
      }
      resp = await send(retryMeta);
      if (!resp.ok) {
        const t2 = await resp.text();
        return { ok: false, error: `upload failed after migration-tag retry (${resp.status}): ${t2.slice(0, 200)}` };
      }
    } else {
      return { ok: false, error: `upload failed (${resp.status}): ${text.slice(0, 200)}` };
    }
  }
  const j = (await resp.json().catch(() => ({}))) as { result?: { etag?: string } };
  return { ok: true, etag: j.result?.etag };
}
