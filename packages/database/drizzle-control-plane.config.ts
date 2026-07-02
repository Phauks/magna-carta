import { defineConfig } from "drizzle-kit";

// Control-plane lineage: one D1 database for the whole platform.
// Generate: pnpm --filter @magna-carta/database run generate-control-plane-migrations
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/control-plane-schema.ts",
  out: "./drizzle/control-plane",
});
