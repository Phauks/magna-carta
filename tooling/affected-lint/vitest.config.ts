import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "affected-lint",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
