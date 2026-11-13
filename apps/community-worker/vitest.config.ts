import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

// The control-plane lineage, read here in Node and applied inside the Workers pool by
// test/support/apply-migrations.ts, so the tests run against the same tables production has.
const migrations = await readD1Migrations(
  `${import.meta.dirname}/../../packages/database/drizzle/control-plane`,
);

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
      miniflare: {
        bindings: {
          COMMUNITY_HANDOFF_SECRET: "a-test-secret-for-the-board-worker",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/support/apply-migrations.ts"] },
});
