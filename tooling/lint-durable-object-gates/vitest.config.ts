import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-durable-object-gates",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
