import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import controlPlaneJournal from "@magna-carta/database/drizzle/control-plane/meta/_journal.json";
import firmRegistrySql from "@magna-carta/database/drizzle/control-plane/0000_firm-registry.sql";
import authAndProvisioningSql from "@magna-carta/database/drizzle/control-plane/0001_auth-and-provisioning.sql";
import firmKeyColumnsSql from "@magna-carta/database/drizzle/control-plane/0002_firm-key-columns.sql";
import releaseChannelSql from "@magna-carta/database/drizzle/control-plane/0003_handy_rattler.sql";
import supportAccessSql from "@magna-carta/database/drizzle/control-plane/0004_support-access.sql";
import platformOperatorSql from "@magna-carta/database/drizzle/control-plane/0005_platform-operator.sql";

// The control-plane migration lineage bundled INTO the worker (no filesystem at runtime): the
// scheduled handler is the single-flighted sole applier of these against DB_CONTROL. Mirrors
// per-firm-migrations.ts; the same plain .sql text-import bundling contract (src/sql-modules.d.ts).
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry —
// add the new import alongside its journal entry.
export function controlPlaneMigrations(): Migration[] {
  return migrationsFromJournal(controlPlaneJournal, {
    "0000_firm-registry": firmRegistrySql,
    "0001_auth-and-provisioning": authAndProvisioningSql,
    "0002_firm-key-columns": firmKeyColumnsSql,
    "0003_handy_rattler": releaseChannelSql,
    "0004_support-access": supportAccessSql,
    "0005_platform-operator": platformOperatorSql,
  });
}

// The lineage head (latest journal tag).
export function controlPlaneHeadSchemaVersion(): string {
  const lastEntry = [...controlPlaneJournal.entries].sort((a, b) => a.idx - b.idx).at(-1);
  if (lastEntry === undefined) throw new Error("control-plane migration journal is empty");
  return lastEntry.tag;
}
