import { defineConfig } from "vite-plus";

// The email worker's unit tests run in the default node pool: the email() binding cannot run in the
// local pool, so routing is resolved purely against an injected fake resolver (never a real binding).
export default defineConfig({
  root: import.meta.dirname,
});
