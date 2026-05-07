import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Main-repo vitest config. We only test the runtime (test/**) here. Companion
 * projects under companion/* have their own package.json + vitest config
 * (they use `@cloudflare/vitest-pool-workers` which isn't a main-repo dep).
 *
 * The aliases below let unit tests import modules that, in production, pull
 * in Workers-only modules (`cloudflare:email`, `cloudflare:workers`). Both
 * are stubbed in `test/stubs/` so the plugin-registry loads without a
 * Workers runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:email": fileURLToPath(new URL("./test/stubs/cloudflare-email.ts", import.meta.url)),
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
      // @cloudflare/sandbox transitively imports @cloudflare/containers
      // whose extension-less ESM exports don't resolve in plain Node. We
      // stub it for tests; the real package only matters in the Worker
      // runtime where wrangler injects its own resolver.
      "@cloudflare/sandbox": fileURLToPath(new URL("./test/stubs/cloudflare-sandbox.ts", import.meta.url))
    }
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "companion/**", "site/**", "test/stubs/**"]
  }
});
