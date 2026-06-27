import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
export default defineConfig({
  root: import.meta.dirname,
});
