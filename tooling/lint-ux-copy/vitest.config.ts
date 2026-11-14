import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-ux-copy",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
