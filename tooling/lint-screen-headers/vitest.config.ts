import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-screen-headers",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
