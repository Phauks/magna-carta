import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import baselineSql from "@magna-carta/database/drizzle/per-firm/20260704T041516_baseline.sql";
import seedToolsFileRepairSql from "@magna-carta/database/drizzle/per-firm/20260704T041517_seed-tools-file-repair.sql";
import fileRepairProvenanceSql from "@magna-carta/database/drizzle/per-firm/20260704T041518_file-repair-provenance.sql";
import seedToolsSpeedTestSql from "@magna-carta/database/drizzle/per-firm/20260704T041519_seed-tools-speed-test.sql";

// The per-firm migration lineage bundled INTO the worker (no filesystem at runtime): the FirmDatabase
// Durable Object runs this lineage against its own SQLite storage on wake (firm-database-object.ts),
// so the SQL must ship in the bundle, not only in test support. Plain `.sql` imports — the dual
// Vite/wrangler bundling contract lives in src/sql-modules.d.ts.
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry:
// add the new import alongside its journal entry, keyed by its monotonic timestamp id. The test
// support reuses this same lineage.
export function perFirmMigrations(): Migration[] {
  return migrationsFromJournal(perFirmJournal, {
    "20260704T041516_baseline": baselineSql,
    "20260704T041517_seed-tools-file-repair": seedToolsFileRepairSql,
    "20260704T041518_file-repair-provenance": fileRepairProvenanceSql,
    "20260704T041519_seed-tools-speed-test": seedToolsSpeedTestSql,
  });
}
