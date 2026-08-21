import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-list-pagination",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
