import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-modal-reflow",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
