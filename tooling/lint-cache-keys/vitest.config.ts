import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-cache-keys",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
