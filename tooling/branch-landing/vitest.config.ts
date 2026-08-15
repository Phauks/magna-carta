import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "branch-landing",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
