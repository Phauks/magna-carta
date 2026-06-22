import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned so the repo-root `vp test` resolves this project's tests from here.
// fileParallelism is off: the libvips/wasm-vips tests each allocate a large WebAssembly heap, and
// running the wasm-heavy files in parallel exhausts memory (WebAssembly.Memory allocation failure).
// Serializing test files keeps only one wasm context live at a time.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    fileParallelism: false,
  },
});
