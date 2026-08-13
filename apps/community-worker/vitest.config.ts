import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig, type Plugin } from "vite-plus";

// The board's tests run against the REAL committed control-plane migration rather than a
// hand-built table, so a column the board writes and the migration never created fails here. The
// migration is a `.sql` file, and workerd has no filesystem, so it is inlined as text at build
// time — the same contract the application worker uses for the migrations it bundles.
function sqlAsText(): Plugin {
  return {
    name: "magna-carta:sql-as-text",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".sql")) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    sqlAsText(),
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
    }),
  ],
});
