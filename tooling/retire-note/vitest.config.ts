import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "retire-note",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
