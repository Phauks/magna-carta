import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "lint-native-builds",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
