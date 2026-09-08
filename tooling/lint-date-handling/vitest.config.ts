import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-date-handling",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
