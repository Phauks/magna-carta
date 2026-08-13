import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import controlPlaneJournal from "@magna-carta/database/drizzle/control-plane/meta/_journal.json";
import baselineSql from "@magna-carta/database/drizzle/control-plane/20260704T041516_baseline.sql";
import emailCaptureRouteSql from "@magna-carta/database/drizzle/control-plane/20260803T222618_email-capture-route.sql";
import twoFactorLockoutFieldsSql from "@magna-carta/database/drizzle/control-plane/20260803T230717_two-factor-lockout-fields.sql";
import firmBucketNameUniqueSql from "@magna-carta/database/drizzle/control-plane/20260804T065814_firm-bucket-name-unique.sql";
import selfServeRegistrationAndInvitationsSql from "@magna-carta/database/drizzle/control-plane/20260811T224252_self-serve-registration-and-invitations.sql";
import communityBoardSql from "@magna-carta/database/drizzle/control-plane/20260813T063759_community-board.sql";

// The control-plane migration lineage bundled INTO the worker (no filesystem at runtime): the
// scheduled handler is the single-flighted sole applier of these against DB_CONTROL. Mirrors
// per-firm-migrations.ts; the same plain .sql text-import bundling contract (src/sql-modules.d.ts).
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry —
// add the new import alongside its journal entry, keyed by its monotonic timestamp id.
export function controlPlaneMigrations(): Migration[] {
  return migrationsFromJournal(controlPlaneJournal, {
    "20260704T041516_baseline": baselineSql,
    "20260803T222618_email-capture-route": emailCaptureRouteSql,
    "20260803T230717_two-factor-lockout-fields": twoFactorLockoutFieldsSql,
    "20260804T065814_firm-bucket-name-unique": firmBucketNameUniqueSql,
    "20260811T224252_self-serve-registration-and-invitations":
      selfServeRegistrationAndInvitationsSql,
    "20260813T063759_community-board": communityBoardSql,
  });
}

// The lineage head (latest journal tag), ordered by the monotonic migration id.
export function controlPlaneHeadSchemaVersion(): string {
  const lastEntry = [...controlPlaneJournal.entries]
    // sort on the spread copy (non-mutating); toSorted is not in this worker's TS lib target.
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .at(-1);
  if (lastEntry === undefined) throw new Error("control-plane migration journal is empty");
  return lastEntry.tag;
}
