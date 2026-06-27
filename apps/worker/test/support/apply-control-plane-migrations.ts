import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { controlPlaneMigrations } from "../../src/control-plane-migrations.ts";

// Bring a Miniflare control-plane D1 to the CURRENT committed schema through the same
// journal-driven runner production uses — the control-plane twin of apply-per-firm-migrations.ts.
// The migration list itself lives in src (the scheduled handler applies it at runtime), so this
// support file only points the runner at a test-chosen database handle.
export async function applyControlPlaneMigrations(database: D1Database): Promise<void> {
  await runPendingMigrations(d1MigrationTarget(database), controlPlaneMigrations());
}
