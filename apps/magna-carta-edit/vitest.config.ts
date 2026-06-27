import { defineConfig } from "vite-plus";

// The edit worker's unit tests run in the default node pool, not the cloudflare pool. coolwsd cannot
// run under the local test pool (no Docker), so the per-document proxy + the outbound WOPI interception
// are exercised against fakes — no Miniflare, no container required for the suite.
export default defineConfig({
  root: import.meta.dirname,
});
