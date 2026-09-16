import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "migration-immutability",
    root: import.meta.dirname,
    include: ["**/*.test.mts"],
  },
});
