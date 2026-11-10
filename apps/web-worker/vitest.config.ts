import { defineConfig } from "vite-plus";

// Plain Node, no Workers pool: the Worker's whole behaviour is one function of a request and the
// asset server's answer, and the tests hand it both.
export default defineConfig({
  root: import.meta.dirname,
  test: { name: "@magna-carta/web-worker", include: ["test/**/*.test.ts"] },
});
