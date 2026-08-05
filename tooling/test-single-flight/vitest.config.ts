import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "test-single-flight",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
