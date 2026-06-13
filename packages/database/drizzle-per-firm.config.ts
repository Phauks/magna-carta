import { defineConfig } from "drizzle-kit";

// Per-firm lineage: every tenant firm's D1 follows this one, versioned independently of
// the control plane. Generate: pnpm --filter @magna-carta/database run generate-per-firm-migrations
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/per-firm-schema.ts",
  out: "./drizzle/per-firm",
});
