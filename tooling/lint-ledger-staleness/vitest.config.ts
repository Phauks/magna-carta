import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-ledger-staleness",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
