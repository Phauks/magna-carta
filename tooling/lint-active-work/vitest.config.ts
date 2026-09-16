import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-active-work",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
