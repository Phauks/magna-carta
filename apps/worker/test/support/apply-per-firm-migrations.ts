import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { migrationsFromJournal } from "@magna-carta/database/migration";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import foundationalTablesSql from "@magna-carta/database/drizzle/per-firm/0000_foundational-tables.sql?raw";
import ledgerCoreSql from "@magna-carta/database/drizzle/per-firm/0001_ledger-core.sql?raw";
import memberRbacSql from "@magna-carta/database/drizzle/per-firm/0002_member-rbac.sql?raw";

// Bring a Miniflare per-firm D1 (a dev-pool binding) to the CURRENT committed per-firm schema
// through the same journal-driven runner production uses — the per-firm twin of
// apply-control-plane-migrations.ts. The SQL is bundled as raw text (Vite `?raw`) because workerd
// has no filesystem. migrationsFromJournal fails loud when the journal gains a migration this map
// does not carry — add the new `?raw` import alongside its journal entry.
export async function applyPerFirmMigrations(database: D1Database): Promise<void> {
  const migrations = migrationsFromJournal(perFirmJournal, {
    "0000_foundational-tables": foundationalTablesSql,
    "0001_ledger-core": ledgerCoreSql,
    "0002_member-rbac": memberRbacSql,
  });
  await runPendingMigrations(d1MigrationTarget(database), migrations);
}
