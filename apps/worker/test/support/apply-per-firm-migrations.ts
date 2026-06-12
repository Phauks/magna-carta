import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { perFirmMigrations } from "../../src/per-firm-migrations.ts";

// Bring a Miniflare per-firm D1 (a dev-pool binding) to the CURRENT committed per-firm schema
// through the same journal-driven runner production uses — the per-firm twin of
// apply-control-plane-migrations.ts. The migration list itself lives in src (the firm provisioner
// migrates new firm databases at runtime), so this support file only points the runner at a
// test-chosen database handle.
export async function applyPerFirmMigrations(database: D1Database): Promise<void> {
  await runPendingMigrations(d1MigrationTarget(database), perFirmMigrations());
}
