import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Bindings } from "./app.ts";
import {
  DEV_FIRM_DATABASE_POOL_BINDING_NAMES,
  resolveFirmDatabase,
} from "./firm-binding-resolver.ts";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  type FirmResourceProvider,
} from "./firm-resource-provider.ts";
import { perFirmMigrations } from "./per-firm-migrations.ts";

// The env → FirmProvisionerDependencies factories: how the worker wires the provisioner's ports
// to real bindings. Lives beside the provisioner so routes/firms.ts stays at route altitude.

// How the provisioner's migrate step reaches a firm database: the binding resolver supplies the
// handle, the fleet migration runner applies the bundled per-firm lineage. A database this
// deployment cannot reach fails LOUD here (unlike the request-path 404): for production
// firms created through the REST adapter, the new database's binding lands by config commit +
// deploy — the documented manual step — and re-invoking afterwards resumes from this exact step.
export function migrateFirmDatabaseToHeadForEnv(env: Bindings) {
  return async (databaseIdentifier: string): Promise<{ latestTag: string }> => {
    const firmDatabase = resolveFirmDatabase(env, databaseIdentifier);
    if (firmDatabase === null) {
      throw new Error(
        `firm database "${databaseIdentifier}" is not bound to this deployment — add its binding ` +
          "(config commit + deploy), then re-invoke provisioning to resume",
      );
    }
    const migrations = perFirmMigrations();
    await runPendingMigrations(d1MigrationTarget(firmDatabase), migrations);
    const latestTag = migrations.at(-1)?.tag;
    if (latestTag === undefined) throw new Error("per-firm migration lineage is empty");
    return { latestTag };
  };
}

// Adapter selection: deploy-time credentials present → real Cloudflare REST creation; otherwise
// the dev pool-claimer (local dev and tests — CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID are
// deploy-time secrets, deliberately absent from .dev.vars).
export function resourceProviderForEnv(env: Bindings): FirmResourceProvider {
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (apiToken !== undefined && apiToken !== "" && accountId !== undefined && accountId !== "") {
    return createCloudflareRestFirmResourceProvider({
      accountId,
      apiToken,
      eventNotificationQueueId: env.FILES_INGEST_QUEUE_ID,
    });
  }
  return createDevFirmResourceProvider({
    poolBindingNames: DEV_FIRM_DATABASE_POOL_BINDING_NAMES,
    claimedDatabaseIdentifiers: async () => {
      const { results } = await env.DB_CONTROL.prepare(
        "SELECT database_identifier FROM firm WHERE database_identifier IS NOT NULL",
      ).all<{ database_identifier: string }>();
      return results.map((row) => row.database_identifier);
    },
  });
}
