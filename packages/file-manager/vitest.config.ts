import { defineConfig } from "vite-plus";

// The domain logic (folders, files, versions, metering) runs in the default node pool; the
// single-read ingest pipeline that streams a hash needs the Workers runtime, so its test file
// lives in apps/worker/test/ where the Miniflare pool is already configured.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
