import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "license-policy",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
