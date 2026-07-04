import { defineConfig } from "vite-plus";

// The recovery worker's unit tests run in the default node pool, not the cloudflare pool. The engine
// Container cannot run under the local test pool, so forwardRecovery is exercised against a fake
// container — no Miniflare, no Docker required for the test suite.
export default defineConfig({
  root: import.meta.dirname,
});
