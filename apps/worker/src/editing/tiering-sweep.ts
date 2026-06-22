import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  FILES_PREFIX,
  setVersionStorageClassStatement,
} from "@magna-carta/file-manager/file-statements";
import { meterTierChangeStatements } from "@magna-carta/file-manager/metering-statements";
import { listTierableVersions } from "@magna-carta/file-manager/queries";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// The conservative Standard -> Infrequent-Access tiering sweep (its own pass on the daily reconciliation
// cron — a per-firm scan, too heavy for the */5 sweep). For each reachable firm it finds clean,
// still-Standard versions that are SUPERSEDED (not the file's current version) and committed before the
// IA-minimum window, moves each object's storage class in place, and shifts the storage_meter from the
// Standard bucket to the IA bucket in the same batch. It NEVER tiers the live/current version and NEVER
// deletes — tiering only ever touches cold, superseded history.

// R2's Infrequent-Access class carries a 30-day minimum-duration billing floor, so tiering an object
// that might soon be deleted or re-promoted would waste money. The conservative trigger only tiers
// versions whose commit is older than this window — they are stable, cold history.
const TIER_AGE_DAYS = 30;
// One pass's per-firm cap so a large first-time backlog never makes a single daily fire unbounded; the
// next day's pass drains the next batch.
const TIER_SWEEP_PER_FIRM_CAP = 500;

export interface TieringReport {
  readonly firmsProcessed: number;
  readonly tiered: number;
}

export interface TieringOptions {
  // Injected wall clock (epoch ms) so the cutoff is deterministic in tests; defaults to now.
  readonly now?: number;
  readonly perFirmCap?: number;
  // The object-class move, injected so tests can drive the orchestration without R2 storage-class
  // fidelity. The default rewrites the object in place with the IA class.
  readonly tierObject?: (bucketName: string, key: string) => Promise<void>;
}

// The default class move: rewrite the object in place under the IA storage class, preserving its
// metadata. The R2 Workers binding has no server-side copy, so this restreams the bytes; the zero-copy
// production path is the S3-compatible CopyObject with x-amz-storage-class, slotted in through this seam
// when a server-side copy client is wired. PER-FIRM BUCKET SEAM: reads the single bound env.R2 (the dev
// pool shares one bucket); a firm's own bucket binds here in production, the same seam ingest documents.
function defaultTierObject(env: Bindings): (bucketName: string, key: string) => Promise<void> {
  return async (_bucketName, key) => {
    const object = await env.R2.get(key);
    if (object === null) return; // already gone — nothing to move; the guarded DB flip no-ops too
    await env.R2.put(key, object.body, {
      storageClass: "InfrequentAccess",
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    });
  };
}

export async function runTieringSweep(
  env: Bindings,
  options: TieringOptions = {},
): Promise<TieringReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const nowMs = options.now ?? Date.now();
  const cutoffIso = new Date(nowMs - TIER_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const perFirmCap = options.perFirmCap ?? TIER_SWEEP_PER_FIRM_CAP;
  const tierObject = options.tierObject ?? defaultTierObject(env);

  const firms = await listReachableActiveFirms(env);
  let firmsProcessed = 0;
  let tiered = 0;
  for (const firm of firms) {
    try {
      // A firm with no recorded bucket has no R2 objects to tier yet.
      if (firm.bucketName === null) {
        firmsProcessed++;
        continue;
      }
      const candidates = await listTierableVersions(firm.database, cutoffIso, perFirmCap);
      for (const version of candidates) {
        // Move the object's class FIRST; only on success flip the DB class + shift the meter, so the
        // meter never claims IA for bytes still stored as Standard. The class flip is guarded on the
        // current class and rides the meter shift in one batch; any rare double-apply (overlapping
        // passes) is corrected by the daily storage-metering reconciliation that runs the same cron.
        await tierObject(firm.bucketName, version.r2Key);
        await commitEffectBatch(
          firm.database,
          {
            statements: [
              setVersionStorageClassStatement(
                firm.database,
                version.id,
                "standard",
                "infrequent_access",
              ),
              ...meterTierChangeStatements(
                firm.database,
                {
                  storageClass: "standard",
                  artifactRole: version.artifactRole,
                  prefix: FILES_PREFIX,
                },
                {
                  storageClass: "infrequent_access",
                  artifactRole: version.artifactRole,
                  prefix: FILES_PREFIX,
                },
                version.sizeBytes,
              ),
            ],
            outboxMessages: [],
          },
          { now: () => new Date().toISOString() },
        );
        tiered++;
      }
      firmsProcessed++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(logger, `cron:tiering-sweep:${firm.firmId}`, caught, correlationId);
    }
  }
  return { firmsProcessed, tiered };
}
