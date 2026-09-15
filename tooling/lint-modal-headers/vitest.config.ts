import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-modal-headers",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
