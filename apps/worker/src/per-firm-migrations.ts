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
import indexSplitCatalogSql from "@magna-carta/database/drizzle/per-firm/20260717T224037_index-split-catalog.sql";
import seedEsignSealSql from "@magna-carta/database/drizzle/per-firm/20260803T120000_seed-esign-seal.sql";
import matterNumberAllocationSql from "@magna-carta/database/drizzle/per-firm/20260804T072255_matter-number-allocation.sql";
import indexSplitDocumentVersionSql from "@magna-carta/database/drizzle/per-firm/20260804T082351_index-split-document-version.sql";
import shipmentPurchaseClaimSql from "@magna-carta/database/drizzle/per-firm/20260804T120000_shipment-purchase-claim.sql";
import documentAutomationSql from "@magna-carta/database/drizzle/per-firm/20260804T150000_document-automation.sql";
import seedDocumentAutomationPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260804T150001_seed-document-automation-permissions.sql";
import custodianRegisterSql from "@magna-carta/database/drizzle/per-firm/20260804T160000_custodian-register.sql";
import seedCustodyCatalogSql from "@magna-carta/database/drizzle/per-firm/20260804T160001_seed-custody-catalog.sql";
import documentAutomationFieldMappingsSql from "@magna-carta/database/drizzle/per-firm/20260804T170000_document-automation-field-mappings.sql";
import custodyReviewScheduleSql from "@magna-carta/database/drizzle/per-firm/20260804T170001_custody-review-schedule.sql";

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
    "20260717T224037_index-split-catalog": indexSplitCatalogSql,
    "20260803T120000_seed-esign-seal": seedEsignSealSql,
    "20260804T072255_matter-number-allocation": matterNumberAllocationSql,
    "20260804T082351_index-split-document-version": indexSplitDocumentVersionSql,
    "20260804T120000_shipment-purchase-claim": shipmentPurchaseClaimSql,
    "20260804T150000_document-automation": documentAutomationSql,
    "20260804T150001_seed-document-automation-permissions": seedDocumentAutomationPermissionsSql,
    "20260804T160000_custodian-register": custodianRegisterSql,
    "20260804T160001_seed-custody-catalog": seedCustodyCatalogSql,
    "20260804T170000_document-automation-field-mappings": documentAutomationFieldMappingsSql,
    "20260804T170001_custody-review-schedule": custodyReviewScheduleSql,
  });
}

// The lineage head (latest journal tag), ordered by the monotonic migration id — the same shape
// control-plane-migrations.ts exposes. Tests assert against this instead of a literal tag, so
// adding a migration does not break an unrelated provisioning assertion.
export function perFirmHeadSchemaVersion(): string {
  // A single pass for the greatest tag rather than a sort: the journal is already in order, only the
  // maximum is wanted, and neither `sort` (which mutates, so it needs a defensive copy) nor
  // `toSorted` (absent from this worker's TypeScript lib target) survives a formatter pass intact.
  let headTag: string | undefined;
  for (const entry of perFirmJournal.entries) {
    if (headTag === undefined || entry.tag > headTag) headTag = entry.tag;
  }
  if (headTag === undefined) throw new Error("per-firm migration journal is empty");
  return headTag;
}
