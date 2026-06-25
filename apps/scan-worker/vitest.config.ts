import { defineConfig } from "vite-plus";

// The scan worker's unit tests run in the default node pool, not the cloudflare pool.
// The forwardScan proxy test only needs a fake { fetch } object — no real container binding,
// no Miniflare, no Docker. The ScanContainer DO cannot run under the local test pool anyway
// (it requires a live container image), so a plain vitest config is the right choice here.
export default defineConfig({
  root: import.meta.dirname,
});
