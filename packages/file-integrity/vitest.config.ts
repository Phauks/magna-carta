import { defineConfig } from "vite-plus";

// Pure package: the default node pool. hashAll is exercised here with a node:crypto-backed sink
// (test/node-sink.ts); the real Workers crypto.DigestStream is exercised by the route tests in
// apps/api-worker/test, where the Miniflare pool is configured.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
