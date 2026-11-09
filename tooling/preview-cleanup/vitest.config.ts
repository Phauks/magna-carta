import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "preview-cleanup",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
