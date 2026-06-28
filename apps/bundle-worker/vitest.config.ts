import { defineConfig } from "vite-plus";

// The bundle worker's unit tests run in the default node pool, not the cloudflare pool.
// The forwardBuild proxy test and the outbound R2 handler test only need fake { fetch } / R2
// objects — no real container binding, no Miniflare, no Docker. The BundleContainer DO cannot
// run under the local test pool (it requires a live container image), so a plain vitest config
// is the right choice here.
export default defineConfig({
  root: import.meta.dirname,
});
