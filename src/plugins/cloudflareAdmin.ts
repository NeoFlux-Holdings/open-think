/**
 * cloudflare-admin — first-class CF API plugin scoped to the agent's
 * own infrastructure operations.
 *
 * The existing `cloudflare-api-mcp` plugin sticks to a small set of
 * read-only DNS calls (it predates the agent's "set everything up
 * for me" use-case). This plugin is its admin-class counterpart:
 * the agent uses `CLOUDFLARE_API_TOKEN` to verify its own token,
 * pick an account, create D1 databases, write/read KV, manage
 * secrets on the deployed Worker, set up Access apps, and provision
 * R2 buckets. Anything that mutates state goes through here so we
 * have a single place to add capability gating later.
 *
 * Skills built on this plugin (registered in src/core/skills.ts):
 *   cf-verify                — token sanity check
 *   cf-list-accounts         — accounts visible to this token
 *   cf-list-workers          — Workers in an account
 *   cf-list-d1               — D1 databases
 *   cf-create-d1             — create a D1 database (DANGEROUS)
 *   cf-query-d1              — run a SQL query against a D1
 *   cf-list-kv               — KV namespaces
 *   cf-create-kv             — create a KV namespace (DANGEROUS)
 *   cf-kv-put / cf-kv-get / cf-kv-delete
 *   cf-list-r2               — R2 buckets
 *   cf-create-r2             — create an R2 bucket (DANGEROUS)
 *   cf-put-secret            — put a secret on a Worker (DANGEROUS)
 *   cf-list-access-apps      — Access applications
 *   cf-create-access-app     — create an Access application (DANGEROUS)
 *   cf-api                   — generic escape hatch (DANGEROUS)
 *
 * "Dangerous" skills are surfaced as proposals in selective mode rather
 * than auto-executed. The escape-hatch `cf-api` lets the model issue
 * any HTTP request to api.cloudflare.com when it knows what to do.
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import type { Env } from "../types";
import { AppError } from "../core/errors";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface CfResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  errors?: Array<{ code?: number; message: string }>;
  raw?: string;
}

interface InputAccount {
  accountId?: string;
}

function asObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function pickAccountId(env: Env, input: unknown): string | undefined {
  const fromInput = asObj(input).accountId;
  if (typeof fromInput === "string" && fromInput.length > 0) return fromInput;
  return env.CLOUDFLARE_ACCOUNT_ID;
}

export class CloudflareAdminPlugin implements AgentPlugin {
  readonly id = "cloudflare-admin";
  readonly version = "0.1.0";
  readonly description =
    "Cloudflare API admin — provision and operate D1, KV, R2, secrets, Access apps using CLOUDFLARE_API_TOKEN.";
  readonly capabilities = ["cloudflare-api", "tools", "admin"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  private resolveToken(): string {
    const token = this.ctx?.env.CLOUDFLARE_API_TOKEN ?? this.ctx?.env.CLOUDFLARE_AGENT_TOKEN;
    if (!token) {
      throw new AppError(
        "E_CF_TOKEN_MISSING",
        "CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AGENT_TOKEN) is required for cloudflare-admin. Create a scoped token at https://dash.cloudflare.com/profile/api-tokens.",
        400
      );
    }
    return token;
  }

  private async call<T>(
    method: Method,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<CfResponse<T>> {
    if (!this.ctx) throw new AppError("E_NOT_INITIALIZED", "plugin not initialized", 500);
    const token = this.resolveToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...extraHeaders
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined && method !== "GET") {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const url = path.startsWith("http") ? path : `${CF_API_BASE}${path}`;
    const response = await this.ctx.fetch(url, init);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: response.ok, status: response.status, raw: text };
    }
    const env = parsed as { success?: boolean; result?: T; errors?: Array<{ code?: number; message: string }> };
    return {
      ok: response.ok && env.success !== false,
      status: response.status,
      data: env.result,
      errors: env.errors
    };
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };

    try {
      switch (action) {
        case "verify": {
          const r = await this.call<{ id: string; status: string; expires_on?: string }>(
            "GET",
            "/user/tokens/verify"
          );
          return r.ok && r.data
            ? { ok: true, data: { ...r.data, hasAccountId: Boolean(this.ctx.env.CLOUDFLARE_ACCOUNT_ID) } }
            : { ok: false, error: r.errors?.[0]?.message ?? `verify failed (${r.status})` };
        }

        case "list-accounts": {
          const r = await this.call<Array<{ id: string; name: string; type?: string }>>(
            "GET",
            "/accounts?per_page=50"
          );
          return r.ok ? { ok: true, data: r.data ?? [] } : { ok: false, error: r.errors?.[0]?.message ?? "list-accounts failed" };
        }

        case "list-workers": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required (input.accountId or CLOUDFLARE_ACCOUNT_ID)" };
          const r = await this.call<Array<Record<string, unknown>>>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/workers/scripts`
          );
          return r.ok ? { ok: true, data: r.data ?? [] } : { ok: false, error: r.errors?.[0]?.message ?? "list-workers failed" };
        }

        case "list-d1": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const r = await this.call<Array<{ uuid: string; name: string; created_at: string }>>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/d1/database?per_page=50`
          );
          return r.ok ? { ok: true, data: r.data ?? [] } : { ok: false, error: r.errors?.[0]?.message ?? "list-d1 failed" };
        }

        case "create-d1": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const name = String(asObj(input).name ?? "");
          if (!name) return { ok: false, error: "input.name required (D1 database name)" };
          const r = await this.call<{ uuid: string; name: string }>(
            "POST",
            `/accounts/${encodeURIComponent(acc)}/d1/database`,
            { name }
          );
          return r.ok && r.data
            ? { ok: true, data: r.data }
            : { ok: false, error: r.errors?.[0]?.message ?? "create-d1 failed" };
        }

        case "query-d1": {
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const databaseId = String(o.databaseId ?? "");
          const sql = String(o.sql ?? "");
          const params = Array.isArray(o.params) ? o.params : [];
          if (!acc) return { ok: false, error: "accountId required" };
          if (!databaseId) return { ok: false, error: "input.databaseId required" };
          if (!sql) return { ok: false, error: "input.sql required" };
          const r = await this.call<unknown>(
            "POST",
            `/accounts/${encodeURIComponent(acc)}/d1/database/${encodeURIComponent(databaseId)}/query`,
            { sql, params }
          );
          return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.errors?.[0]?.message ?? "query-d1 failed" };
        }

        case "list-kv": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const r = await this.call<Array<{ id: string; title: string }>>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/storage/kv/namespaces?per_page=100`
          );
          return r.ok ? { ok: true, data: r.data ?? [] } : { ok: false, error: r.errors?.[0]?.message ?? "list-kv failed" };
        }

        case "create-kv": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const title = String(asObj(input).title ?? "");
          if (!title) return { ok: false, error: "input.title required" };
          const r = await this.call<{ id: string; title: string }>(
            "POST",
            `/accounts/${encodeURIComponent(acc)}/storage/kv/namespaces`,
            { title }
          );
          return r.ok && r.data
            ? { ok: true, data: r.data }
            : { ok: false, error: r.errors?.[0]?.message ?? "create-kv failed" };
        }

        case "kv-put": {
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const namespaceId = String(o.namespaceId ?? "");
          const key = String(o.key ?? "");
          const value = o.value;
          if (!acc) return { ok: false, error: "accountId required" };
          if (!namespaceId || !key) return { ok: false, error: "input.namespaceId + input.key required" };
          const r = await this.call(
            "PUT",
            `/accounts/${encodeURIComponent(acc)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`,
            typeof value === "string" ? value : JSON.stringify(value),
            { "content-type": "text/plain" }
          );
          return r.ok ? { ok: true, data: { put: true } } : { ok: false, error: r.errors?.[0]?.message ?? "kv-put failed" };
        }

        case "kv-get": {
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const namespaceId = String(o.namespaceId ?? "");
          const key = String(o.key ?? "");
          if (!acc) return { ok: false, error: "accountId required" };
          if (!namespaceId || !key) return { ok: false, error: "input.namespaceId + input.key required" };
          const url = `${CF_API_BASE}/accounts/${encodeURIComponent(acc)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
          const response = await this.ctx.fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${this.resolveToken()}` }
          });
          if (!response.ok) {
            return {
              ok: false,
              error: `kv-get ${response.status}: ${(await response.text()).slice(0, 200)}`
            };
          }
          return { ok: true, data: { value: await response.text() } };
        }

        case "kv-delete": {
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const namespaceId = String(o.namespaceId ?? "");
          const key = String(o.key ?? "");
          if (!acc) return { ok: false, error: "accountId required" };
          if (!namespaceId || !key) return { ok: false, error: "input.namespaceId + input.key required" };
          const r = await this.call(
            "DELETE",
            `/accounts/${encodeURIComponent(acc)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`
          );
          return r.ok ? { ok: true, data: { deleted: true } } : { ok: false, error: r.errors?.[0]?.message ?? "kv-delete failed" };
        }

        case "list-r2": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const r = await this.call<{ buckets: Array<{ name: string; creation_date: string }> }>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/r2/buckets`
          );
          return r.ok ? { ok: true, data: r.data?.buckets ?? [] } : { ok: false, error: r.errors?.[0]?.message ?? "list-r2 failed" };
        }

        case "create-r2": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const name = String(asObj(input).name ?? "");
          if (!name) return { ok: false, error: "input.name required" };
          const r = await this.call(
            "POST",
            `/accounts/${encodeURIComponent(acc)}/r2/buckets`,
            { name }
          );
          return r.ok ? { ok: true, data: { name } } : { ok: false, error: r.errors?.[0]?.message ?? "create-r2 failed" };
        }

        case "put-secret": {
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const scriptName = String(o.scriptName ?? "");
          const secretName = String(o.name ?? "");
          const text = String(o.text ?? "");
          if (!acc) return { ok: false, error: "accountId required" };
          if (!scriptName || !secretName || !text) {
            return { ok: false, error: "input.scriptName + input.name + input.text required" };
          }
          const r = await this.call(
            "PUT",
            `/accounts/${encodeURIComponent(acc)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`,
            { name: secretName, text, type: "secret_text" }
          );
          return r.ok ? { ok: true, data: { name: secretName, scriptName } } : { ok: false, error: r.errors?.[0]?.message ?? "put-secret failed" };
        }

        case "list-bindings": {
          const acc = pickAccountId(this.ctx.env, input);
          const scriptName = String(asObj(input).scriptName ?? "");
          if (!acc) return { ok: false, error: "accountId required" };
          if (!scriptName) return { ok: false, error: "input.scriptName required (e.g. \"helm\")" };
          const r = await this.call<{ bindings?: Array<Record<string, unknown>> }>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`
          );
          if (!r.ok) {
            return { ok: false, error: r.errors?.[0]?.message ?? "list-bindings failed" };
          }
          // Bindings are typed objects: r2_bucket, d1, kv_namespace, ai,
          // durable_object_namespace, plain_text, secret_text, etc. Return
          // them as-is so the agent can introspect what's already wired.
          return { ok: true, data: { bindings: r.data?.bindings ?? [] } };
        }

        case "list-secrets": {
          const acc = pickAccountId(this.ctx.env, input);
          const scriptName = String(asObj(input).scriptName ?? "");
          if (!acc) return { ok: false, error: "accountId required" };
          if (!scriptName) return { ok: false, error: "input.scriptName required" };
          // CF returns secret NAMES only — values are write-only by design.
          // This is exactly what we want: the agent can see which secrets
          // are set without us leaking the values.
          const r = await this.call<Array<{ name: string; type: string }>>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`
          );
          return r.ok
            ? { ok: true, data: { secrets: r.data ?? [] } }
            : { ok: false, error: r.errors?.[0]?.message ?? "list-secrets failed" };
        }

        case "patch-binding": {
          // Generic "add a binding to the deployed Worker" surface.
          // Fetches current settings, merges in the new binding (replacing
          // any same-name entry of the same type), PATCHes back. This is
          // what powers /setup/r2/bind and the more general "wire D1 / KV /
          // AI / Workers AI / Queue / Hyperdrive without editing
          // wrangler.toml" flow.
          //
          // Caveats surfaced in `data.warning`:
          //   - The user's local wrangler.toml STILL doesn't have this
          //     binding. Their next `wrangler deploy` will REMOVE it.
          //     Always include the TOML snippet they should paste.
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const scriptName = String(o.scriptName ?? "");
          const type = String(o.type ?? "");
          const name = String(o.name ?? "");
          const config = (o.config && typeof o.config === "object")
            ? (o.config as Record<string, unknown>)
            : {};
          if (!acc) return { ok: false, error: "accountId required" };
          if (!scriptName) return { ok: false, error: "input.scriptName required (e.g. \"helm\")" };
          if (!type || !name) {
            return {
              ok: false,
              error:
                "input.type + input.name required. type ∈ {r2_bucket, d1, kv_namespace, ai, queue, hyperdrive, plain_text, durable_object_namespace}; name = binding name (e.g. WORKSPACE)."
            };
          }
          // 1. Fetch current bindings.
          const get = await this.call<{ bindings?: Array<Record<string, unknown>> }>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`
          );
          if (!get.ok) {
            return { ok: false, error: get.errors?.[0]?.message ?? `fetch settings failed (${get.status})` };
          }
          const existing = get.data?.bindings ?? [];
          // Replace any same-name+same-type entry; otherwise append.
          const filtered = existing.filter(
            (b) => !(b.type === type && b.name === name)
          );
          filtered.push({ type, name, ...config });
          // 2. PATCH settings with the merged bindings array (multipart).
          const url = `${CF_API_BASE}/accounts/${encodeURIComponent(acc)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`;
          const body = [
            "--BOUNDARY",
            'Content-Disposition: form-data; name="settings"',
            "Content-Type: application/json",
            "",
            JSON.stringify({ bindings: filtered }),
            "--BOUNDARY--",
            ""
          ].join("\r\n");
          const patch = await this.ctx.fetch(url, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${this.resolveToken()}`,
              "content-type": "multipart/form-data; boundary=BOUNDARY"
            },
            body
          });
          if (!patch.ok) {
            const text = await patch.text();
            return {
              ok: false,
              error: `patch-binding failed (${patch.status}): ${text.slice(0, 300)}`
            };
          }
          // Suggest the matching wrangler.toml snippet so the user's
          // next local deploy doesn't drop the binding.
          let tomlSnippet = "";
          if (type === "r2_bucket") {
            tomlSnippet = `[[r2_buckets]]\nbinding = "${name}"\nbucket_name = "${config.bucket_name ?? "<bucket-name>"}"`;
          } else if (type === "d1") {
            tomlSnippet = `[[d1_databases]]\nbinding = "${name}"\ndatabase_name = "${config.database_name ?? "<db-name>"}"\ndatabase_id = "${config.database_id ?? "<uuid>"}"`;
          } else if (type === "kv_namespace") {
            tomlSnippet = `[[kv_namespaces]]\nbinding = "${name}"\nid = "${config.namespace_id ?? "<namespace-id>"}"`;
          } else if (type === "ai") {
            tomlSnippet = `[ai]\nbinding = "${name}"`;
          } else if (type === "queue") {
            tomlSnippet = `[[queues.producers]]\nbinding = "${name}"\nqueue = "${config.queue_name ?? "<queue-name>"}"`;
          }
          return {
            ok: true,
            data: {
              type,
              name,
              scriptName,
              bindingsCount: filtered.length,
              tomlSnippet,
              warning:
                "Live Worker is updated, but your local wrangler.toml is not. Next `wrangler deploy` will REMOVE this binding unless you also paste the snippet above into wrangler.toml."
            }
          };
        }

        case "list-access-apps": {
          const acc = pickAccountId(this.ctx.env, input);
          if (!acc) return { ok: false, error: "accountId required" };
          const r = await this.call<Array<Record<string, unknown>>>(
            "GET",
            `/accounts/${encodeURIComponent(acc)}/access/apps?per_page=50`
          );
          return r.ok ? { ok: true, data: r.data ?? [] } : { ok: false, error: r.errors?.[0]?.message ?? "list-access-apps failed" };
        }

        case "create-access-app": {
          const acc = pickAccountId(this.ctx.env, input);
          const o = asObj(input);
          const name = String(o.name ?? "");
          const domain = String(o.domain ?? "");
          if (!acc) return { ok: false, error: "accountId required" };
          if (!name || !domain) return { ok: false, error: "input.name + input.domain required" };
          const r = await this.call<{ aud: string; id: string }>(
            "POST",
            `/accounts/${encodeURIComponent(acc)}/access/apps`,
            {
              name,
              domain,
              type: "self_hosted",
              session_duration: o.sessionDuration ?? "24h"
            }
          );
          return r.ok && r.data
            ? { ok: true, data: r.data }
            : { ok: false, error: r.errors?.[0]?.message ?? "create-access-app failed" };
        }

        case "cf-api": {
          // Generic escape hatch. Lets the model perform any CF API call
          // when it knows what to do — useful for containers, queues,
          // hyperdrive, etc. that we haven't wrapped explicitly. The
          // model is told to prefer specific skills first.
          const o = asObj(input);
          const method = (String(o.method ?? "GET").toUpperCase() as Method);
          const path = String(o.path ?? "");
          const body = o.body;
          if (!path.startsWith("/")) {
            return { ok: false, error: "input.path must start with '/' (e.g. '/accounts/{id}/workers/scripts')" };
          }
          if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            return { ok: false, error: "input.method must be one of GET|POST|PUT|PATCH|DELETE" };
          }
          const r = await this.call(method, path, body);
          return r.ok
            ? { ok: true, data: r.data ?? r.raw ?? null }
            : { ok: false, error: r.errors?.[0]?.message ?? `cf-api ${method} ${path} failed (${r.status})` };
        }

        default:
          return { ok: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
