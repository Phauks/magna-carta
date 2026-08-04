import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import baselineSql from "@magna-carta/database/drizzle/per-firm/20260704T041516_baseline.sql";
import seedToolsFileRepairSql from "@magna-carta/database/drizzle/per-firm/20260704T041517_seed-tools-file-repair.sql";
import fileRepairProvenanceSql from "@magna-carta/database/drizzle/per-firm/20260704T041518_file-repair-provenance.sql";
import seedToolsSpeedTestSql from "@magna-carta/database/drizzle/per-firm/20260704T041519_seed-tools-speed-test.sql";
import seedToolsOcrSql from "@magna-carta/database/drizzle/per-firm/20260709T000001_seed-tools-ocr.sql";
import conflictsSql from "@magna-carta/database/drizzle/per-firm/20260709T120000_conflicts.sql";
import seedConflictsPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260709T120001_seed-conflicts-permissions.sql";
import seedToolsEmailInspectorSql from "@magna-carta/database/drizzle/per-firm/20260710T120000_seed-tools-email-inspector.sql";
import directoryEmailNormalizedAddressSql from "@magna-carta/database/drizzle/per-firm/20260714T210000_directory-email-normalized-address.sql";
import emailFilingRecordsSql from "@magna-carta/database/drizzle/per-firm/20260717T120000_email-filing-records.sql";
import seedEmailsPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260717T120001_seed-emails-permissions.sql";
import conflictsHitCoPartySql from "@magna-carta/database/drizzle/per-firm/20260717T181411_conflicts-hit-co-party.sql";
import shipmentPurchaseClaimSql from "@magna-carta/database/drizzle/per-firm/20260804T120000_shipment-purchase-claim.sql";

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
    "20260709T000001_seed-tools-ocr": seedToolsOcrSql,
    "20260709T120000_conflicts": conflictsSql,
    "20260709T120001_seed-conflicts-permissions": seedConflictsPermissionsSql,
    "20260710T120000_seed-tools-email-inspector": seedToolsEmailInspectorSql,
    "20260714T210000_directory-email-normalized-address": directoryEmailNormalizedAddressSql,
    "20260717T120000_email-filing-records": emailFilingRecordsSql,
    "20260717T120001_seed-emails-permissions": seedEmailsPermissionsSql,
    "20260717T181411_conflicts-hit-co-party": conflictsHitCoPartySql,
    "20260804T120000_shipment-purchase-claim": shipmentPurchaseClaimSql,
  });
}
