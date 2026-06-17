import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import foundationalTablesSql from "@magna-carta/database/drizzle/per-firm/0000_foundational-tables.sql";
import ledgerCoreSql from "@magna-carta/database/drizzle/per-firm/0001_ledger-core.sql";
import memberRbacSql from "@magna-carta/database/drizzle/per-firm/0002_member-rbac.sql";
import incidentIntakeSql from "@magna-carta/database/drizzle/per-firm/0003_incident-intake.sql";
import mattersLocationsFileManagerSql from "@magna-carta/database/drizzle/per-firm/0004_matters-locations-file-manager.sql";
import listKeysetIndexesSql from "@magna-carta/database/drizzle/per-firm/0005_list-keyset-indexes.sql";
import integrationConnectionSql from "@magna-carta/database/drizzle/per-firm/0006_giant_groot.sql";
import shipmentTablesSql from "@magna-carta/database/drizzle/per-firm/0007_tiny_green_goblin.sql";

// The per-firm migration lineage bundled INTO the worker (no filesystem at runtime): the firm
// provisioner migrates a freshly created firm database to head at provisioning time, so the SQL
// must ship in the bundle, not only in test support. Plain `.sql` imports — the dual
// Vite/wrangler bundling contract lives in src/sql-modules.d.ts.
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry:
// add the new import alongside its journal entry (apply-per-firm-migrations.ts reuses this module).
export function perFirmMigrations(): Migration[] {
  return migrationsFromJournal(perFirmJournal, {
    "0000_foundational-tables": foundationalTablesSql,
    "0001_ledger-core": ledgerCoreSql,
    "0002_member-rbac": memberRbacSql,
    "0003_incident-intake": incidentIntakeSql,
    "0004_matters-locations-file-manager": mattersLocationsFileManagerSql,
    "0005_list-keyset-indexes": listKeysetIndexesSql,
    "0006_giant_groot": integrationConnectionSql,
    "0007_tiny_green_goblin": shipmentTablesSql,
  });
}

// The lineage head (latest journal tag) — the provisioner's migrate-step guard compares the firm
// row's mirrored per_firm_schema_version against this without touching the firm database.
export function perFirmHeadSchemaVersion(): string {
  const lastEntry = [...perFirmJournal.entries].sort((a, b) => a.idx - b.idx).at(-1);
  if (lastEntry === undefined) throw new Error("per-firm migration journal is empty");
  return lastEntry.tag;
}
