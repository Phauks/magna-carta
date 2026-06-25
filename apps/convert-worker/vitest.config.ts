import { defineConfig } from "vite-plus";

// The convert worker's unit tests run in the default node pool, not the cloudflare pool.
// No Container bindings exist yet (the engine Container is wired later), so a plain vitest config is right
// choice here — no Miniflare, no Docker required for the test suite.
export default defineConfig({
  root: import.meta.dirname,
});
