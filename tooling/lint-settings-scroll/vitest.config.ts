import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-settings-scroll",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
