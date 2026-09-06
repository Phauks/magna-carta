import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-back-navigation",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
