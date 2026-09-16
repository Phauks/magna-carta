import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-area-notes",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
