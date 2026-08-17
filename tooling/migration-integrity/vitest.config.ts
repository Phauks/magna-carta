import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "migration-integrity",
    root: import.meta.dirname,
    include: ["**/*.test.mts"],
  },
});
