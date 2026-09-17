import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The edit worker's unit tests run in the default node pool, not the cloudflare pool. coolwsd cannot
// run under the local test pool (no Docker), so the per-document proxy + the outbound WOPI interception
// are exercised against fakes — no Miniflare, no container required for the suite.
export default defineConfig({
  root: import.meta.dirname,
  // `cloudflare:workers` exists only inside the Workers runtime, and `@cloudflare/containers` imports its
  // two base classes from it — which is why the Container class stayed out of this suite. One test needs
  // it: the check that the WOPI handler is registered where the library's proxy reads it, which only the
  // library's own dispatch can make (test/document-editor-container.test.ts). So the library is inlined —
  // its extensionless `./helpers` import and the `cloudflare:` scheme both need Vite's resolver, not
  // Node's — and the scheme is answered by a stub holding the two base classes and nothing else.
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
