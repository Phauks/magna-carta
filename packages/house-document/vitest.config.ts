import { defineConfig } from "vite-plus";

// Pure package: the default node pool (node 22 provides the WebCrypto the CMS layer uses). The
// same modules also run under workerd — a runtime-compatibility check lives in apps/api-worker/test.
export default defineConfig({
  root: import.meta.dirname,
});
