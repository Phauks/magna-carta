import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

// The sign worker runs in workerd, so its tests run in the Cloudflare pool (Miniflare) — this is
// also where the pure-Rust PDF WASM is exercised in the real Worker runtime (its top-level `.wasm`
// import only resolves under wrangler/workerd). The worker has no bindings, so the config is just
// the wrangler pointer; the platform-key secrets are injected per-test via a constructed env.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
    }),
  ],
});
