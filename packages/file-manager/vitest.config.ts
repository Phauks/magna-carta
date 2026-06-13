import { defineConfig } from "vite-plus";

// The domain logic (folders, files, versions, metering) runs in the default node pool; the
// single-read ingest pipeline that streams a hash needs the Workers runtime, so its test file
// opts into the Workers pool when that module lands.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
  // The service modules and their tests land next; until then this project is intentionally empty
  // (the package is scaffolded ahead of its first module).
  test: { passWithNoTests: true },
});
