import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-conflicts-vocabulary",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
