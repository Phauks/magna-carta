import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "worktrees",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
