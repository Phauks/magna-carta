import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-money-arithmetic",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
