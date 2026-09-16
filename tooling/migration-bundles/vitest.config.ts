import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "migration-bundles",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
