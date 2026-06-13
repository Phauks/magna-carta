import type { FirmId } from "@magna-carta/identifiers/types";
import type { Migration } from "./migration.ts";
import { runPendingMigrations, type MigrationTarget } from "./migration-runner.ts";

// One firm's row from the control-plane registry: its id and the mirrored schema version
// (latest applied per-firm migration tag; null = unprovisioned).
export interface FirmMigrationState {
  readonly firmId: FirmId;
  readonly schemaVersion: string | null;
}

export interface FleetRolloutOptions {
  readonly firms: readonly FirmMigrationState[];
  readonly migrations: readonly Migration[];
  // How SQL reaches one firm's database — in production a d1MigrationTarget over the firm's binding.
  targetForFirm(firmId: FirmId): MigrationTarget;
  // Mirror the new version onto the control-plane registry row (fleet visibility).
  recordFirmSchemaVersion(firmId: FirmId, latestTag: string): Promise<void>;
  // Bounded fan-out. Default 1 — a fleet of one needs no parallelism yet.
  readonly concurrency?: number;
}

export interface FleetRolloutReport {
  readonly migratedFirms: { firmId: FirmId; appliedTags: string[] }[];
  readonly currentFirms: FirmId[];
  readonly failedFirms: { firmId: FirmId; error: Error }[];
}

// The fleet rollout: skip current firms, migrate the rest with bounded concurrency,
// quarantine failures (the fleet continues), and report. Idempotent — re-running skips firms already
// at the target version, so a partially-failed rollout resumes by re-running.
//
// The skip-check uses the MIRRORED version (cheap, no firm-database roundtrip); the runner then
// re-checks against the firm database's _migrations (the truth) — a stale mirror only costs a no-op
// run, never a wrong migration.
export async function rolloutMigrationsAcrossFleet(
  options: FleetRolloutOptions,
): Promise<FleetRolloutReport> {
  const { firms, migrations, concurrency = 1 } = options;
  const latestTag = migrations.at(-1)?.tag;
  const report: FleetRolloutReport = { migratedFirms: [], currentFirms: [], failedFirms: [] };

  const pendingFirms = firms.filter((firm) => {
    const current = latestTag !== undefined && firm.schemaVersion === latestTag;
    if (current) report.currentFirms.push(firm.firmId);
    return !current;
  });

  // Bounded worker pool over the pending list: `concurrency` workers each pull the next firm.
  let nextIndex = 0;
  async function migrateNextFirm(): Promise<void> {
    while (nextIndex < pendingFirms.length) {
      const firm = pendingFirms[nextIndex++] as FirmMigrationState;
      try {
        const run = await runPendingMigrations(options.targetForFirm(firm.firmId), migrations);
        if (latestTag !== undefined) {
          await options.recordFirmSchemaVersion(firm.firmId, latestTag);
        }
        report.migratedFirms.push({ firmId: firm.firmId, appliedTags: run.appliedTags });
      } catch (caught) {
        // Failure isolation: quarantine this firm, keep the fleet moving.
        const error = caught instanceof Error ? caught : new Error(String(caught));
        report.failedFirms.push({ firmId: firm.firmId, error });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, pendingFirms.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => migrateNextFirm()));
  return report;
}
