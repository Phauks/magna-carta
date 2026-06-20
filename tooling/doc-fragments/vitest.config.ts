import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "doc-fragments",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
