import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-test-collection",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
