import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "resolve-journal",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
