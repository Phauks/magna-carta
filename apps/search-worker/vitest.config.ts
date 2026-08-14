import { defineConfig } from "vite-plus";

// The search worker's unit tests run in the default node pool, not the cloudflare pool. The proxy,
// shard routing, and object-call forwarding all need only a fake { fetch } object — no real container
// binding, no Miniflare, no Docker. The SearchIndexContainer Durable Object cannot run under the local
// test pool anyway (it requires a live container image), so a plain vitest config is right here.
export default defineConfig({
  root: import.meta.dirname,
});
