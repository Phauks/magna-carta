import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The address worker's unit tests run in the default node pool, not the cloudflare pool. The address
// engine cannot run under the local test pool (it needs a live container image), and nothing here needs
// it to: the object host runs against an in-memory bucket, the source host against an injected fetch,
// and the forwarding against a fake container — no Miniflare, no Docker.
export default defineConfig({
  root: import.meta.dirname,
  // `cloudflare:workers` exists only inside the Workers runtime, and `@cloudflare/containers` imports its
  // two base classes from it. Two suites need the library itself: the check that each container's
  // intercepted hosts are registered where the library's proxy reads them (only the library's own
  // dispatch can tell the two registrations apart), and the entrypoint's routing, which imports the
  // container classes it re-exports. So the library is inlined — its extensionless `./helpers` import and
  // the `cloudflare:` scheme both need Vite's resolver, not Node's — and the scheme is answered by a
  // stub holding the two base classes and nothing else.
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/stubs/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    server: { deps: { inline: ["@cloudflare/containers"] } },
  },
});
