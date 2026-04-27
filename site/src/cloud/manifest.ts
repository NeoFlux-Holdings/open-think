/**
 * Bundle manifest fetcher.
 *
 * The marketing-site Worker can't run esbuild, so we don't build the Helm
 * bundle on the fly. Instead, we publish a manifest JSON at a stable URL
 * (defaults to a GitHub Pages or R2 URL configured via `HELM_BUNDLE_MANIFEST_URL`)
 * pointing at the most recent built bundle.
 *
 * Manifest shape:
 *   {
 *     "sha":      "abc123",                 // git sha of the source
 *     "version":  "v0.4.0",                 // optional human tag
 *     "metadata": { ... },                  // bindings + migrations + flags
 *     "moduleUrl":"https://.../helm-abc123.mjs",
 *     "moduleSize": 812345
 *   }
 *
 * The pushUpdates cron fetches the manifest, then fetches the moduleUrl,
 * then forwards both as a multipart upload to each subscriber's Worker.
 *
 * For local dev / testing we ship a sample manifest at `EXAMPLE_MANIFEST`.
 */

export interface BundleMetadata {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: string[];
  /** Workers bindings. CF API accepts the same shape as wrangler.toml. */
  bindings: Array<Record<string, unknown>>;
  /** Migrations for new DO classes / sqlite classes. */
  migrations?: Array<Record<string, unknown>>;
}

export interface BundleManifest {
  sha: string;
  version?: string;
  metadata: BundleMetadata;
  moduleUrl: string;
  moduleSize?: number;
}

export async function fetchManifest(
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<BundleManifest> {
  const resp = await fetchImpl(manifestUrl, { headers: { accept: "application/json" } });
  if (!resp.ok) {
    throw new Error(`manifest fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const json = (await resp.json()) as BundleManifest;
  if (!json.sha || !json.moduleUrl || !json.metadata) {
    throw new Error("manifest missing required fields (sha, moduleUrl, metadata)");
  }
  return json;
}

export async function fetchModuleBytes(
  moduleUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<ArrayBuffer> {
  const resp = await fetchImpl(moduleUrl, {
    headers: { accept: "application/javascript+module" }
  });
  if (!resp.ok) {
    throw new Error(`module fetch failed: ${resp.status} ${resp.statusText}`);
  }
  return await resp.arrayBuffer();
}

/**
 * Sample manifest used by the dev path when `HELM_BUNDLE_MANIFEST_URL` is
 * unset. Tests use this to avoid network. The metadata mirrors the v0.3
 * shape — when a real CI pipeline lands it owns this content.
 */
export const EXAMPLE_MANIFEST: BundleManifest = {
  sha: "0000000000000000000000000000000000000000",
  version: "v0.0.0-stub",
  moduleUrl: "https://example.invalid/helm.mjs",
  metadata: {
    main_module: "index.mjs",
    compatibility_date: "2026-04-16",
    compatibility_flags: ["nodejs_compat_v2"],
    bindings: [
      { type: "ai", name: "AI" },
      {
        type: "durable_object_namespace",
        name: "AGENT_SESSIONS",
        class_name: "AgentSessionDO"
      },
      {
        type: "durable_object_namespace",
        name: "STREAM_HUBS",
        class_name: "StreamHubDO"
      }
    ],
    migrations: [
      { tag: "v1", new_sqlite_classes: ["AgentSessionDO"] },
      { tag: "v2", new_classes: ["StreamHubDO"] }
    ]
  }
};
