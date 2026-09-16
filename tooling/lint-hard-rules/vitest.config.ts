import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-hard-rules",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
