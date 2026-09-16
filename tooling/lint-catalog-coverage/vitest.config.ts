import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-catalog-coverage",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
