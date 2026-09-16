import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-guarded-writes",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
