import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "clean",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
