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

interface InvokeInput {
  accountId?: string;
  scriptName?: string;
  appName?: string;
  allowedEmails?: string[];
  topic?: string;
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
}
