import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { migrationsFromJournal } from "@magna-carta/database/migration";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import controlPlaneJournal from "@magna-carta/database/drizzle/control-plane/meta/_journal.json";
import firmRegistrySql from "@magna-carta/database/drizzle/control-plane/0000_firm-registry.sql";
import authAndProvisioningSql from "@magna-carta/database/drizzle/control-plane/0001_auth-and-provisioning.sql";
import firmKeyColumnsSql from "@magna-carta/database/drizzle/control-plane/0002_firm-key-columns.sql";
import releaseChannelSql from "@magna-carta/database/drizzle/control-plane/0003_handy_rattler.sql";

// Bring the Miniflare control-plane D1 to the CURRENT committed schema through the same
// journal-driven runner production uses. The SQL is bundled as text (plain `.sql` imports — see
// src/sql-modules.d.ts for the dual Vite/wrangler bundling contract) because workerd has no
// filesystem. migrationsFromJournal fails loud when the journal gains a migration this map does
// not carry — add the new import alongside its journal entry.
export async function applyControlPlaneMigrations(database: D1Database): Promise<void> {
  const migrations = migrationsFromJournal(controlPlaneJournal, {
    "0000_firm-registry": firmRegistrySql,
    "0001_auth-and-provisioning": authAndProvisioningSql,
    "0002_firm-key-columns": firmKeyColumnsSql,
    "0003_handy_rattler": releaseChannelSql,
  });
  await runPendingMigrations(d1MigrationTarget(database), migrations);
}
