import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import baselineSql from "@magna-carta/database/drizzle/per-firm/20260908T000000_baseline.sql";
import feeEntryWorkInProgressStoreSql from "@magna-carta/database/drizzle/per-firm/20260908T010000_fee-entry-work-in-progress-store.sql";
import invoiceWipClaimAdmitsAFeeSql from "@magna-carta/database/drizzle/per-firm/20260908T020000_invoice-wip-claim-admits-a-fee.sql";

// migrationsFromJournal fails loud when the journal gains a migration this map does not carry:
// add the new import alongside its journal entry, keyed by its monotonic timestamp id. The test
// support reuses this same lineage.
export function perFirmMigrations(): Migration[] {
  return migrationsFromJournal(perFirmJournal, {
    "20260908T000000_baseline": baselineSql,
    "20260908T010000_fee-entry-work-in-progress-store": feeEntryWorkInProgressStoreSql,
    "20260908T020000_invoice-wip-claim-admits-a-fee": invoiceWipClaimAdmitsAFeeSql,
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
