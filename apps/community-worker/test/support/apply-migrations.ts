import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB_CONTROL, env.TEST_MIGRATIONS);
