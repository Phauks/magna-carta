import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-ungranted-permissions",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
