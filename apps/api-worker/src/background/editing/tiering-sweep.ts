import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  FILES_PREFIX,
  setVersionStorageClassStatement,
} from "@magna-carta/file-manager/file-statements";
import { meterTierChangeStatements } from "@magna-carta/file-manager/metering-statements";
import { readDeletedFilePolicy } from "@magna-carta/file-manager/deleted-file-settings";
import { listExpiredTrashVersions, listTierableVersions } from "@magna-carta/file-manager/queries";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// The conservative Standard -> Infrequent-Access tiering sweep (its own pass on the daily reconciliation
// cron — a per-firm scan, too heavy for the */5 sweep). For each reachable firm it finds clean,
// still-Standard versions that are SUPERSEDED (not the file's current version) and committed before the
// IA-minimum window, moves each object's storage class in place, and shifts the storage_meter from the
// Standard bucket to the IA bucket in the same batch. It NEVER tiers a live file's current version and
// NEVER deletes. The second candidate set is a deleted file whose time in Trash is over: when the
// firm's deleted-file policy says "archive", all of that file's versions move too, current one
// included (@magna-carta/file-manager/deleted-file-settings). Restoring the file later reads the same
// object from Infrequent Access; nothing is copied back.

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
  readonly tierObject?: (bucket: R2Bucket, key: string) => Promise<void>;
}

// The default class move: rewrite the object in place under the IA storage class, preserving its
// metadata. The R2 Workers binding has no server-side copy, so this restreams the bytes; the zero-copy
// production path is the S3-compatible CopyObject with x-amz-storage-class, slotted in through this seam
// when a server-side copy client is wired. The bucket is the firm's own, resolved per firm through
// files/firm-bucket.ts by the sweep below and passed in — a firm row with no bucketName has nothing to
// tier and never reaches here.
function defaultTierObject(): (bucket: R2Bucket, key: string) => Promise<void> {
  return async (bucket, key) => {
    const object = await bucket.get(key);
    if (object === null) return; // already gone — nothing to move; the guarded DB flip no-ops too
    await bucket.put(key, object.body, {
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
  const tierObject = options.tierObject ?? defaultTierObject();

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
      const { bucket } = resolveFirmBucket(env, firm.bucketName);
      const superseded = await listTierableVersions(firm.database, cutoffIso, perFirmCap);
      const policy = await readDeletedFilePolicy(firm.database);
      const trashCutoffIso = new Date(nowMs - policy.trashDays * 24 * 60 * 60 * 1000).toISOString();
      const expiredTrash =
        policy.afterTrash === "archive" && superseded.length < perFirmCap
          ? await listExpiredTrashVersions(
              firm.database,
              trashCutoffIso,
              perFirmCap - superseded.length,
            )
          : [];
      // A superseded version of a deleted file can be in both sets; it is moved once.
      const seen = new Set(superseded.map((version) => version.id));
      const candidates = [
        ...superseded,
        ...expiredTrash.filter((version) => !seen.has(version.id)),
      ];
      for (const version of candidates) {
        // Move the object's class first (idempotent at R2). Then flip the DB class on its OWN guarded
        // statement and read whether it actually changed a row: the meter shift is committed ONLY when
        // this pass is the one that flipped standard→IA. A concurrent/overlapping pass whose flip
        // no-ops (the row is already IA) skips the meter, so the meter can never double-count a single
        // move. If the worker dies between the flip and the meter, the daily storage-metering
        // reconciliation corrects the (rare) drift.
        await tierObject(bucket, version.r2Key);
        const flip = (await setVersionStorageClassStatement(
          firm.database,
          version.id,
          "standard",
          "infrequent_access",
        ).run()) as { meta?: { changes?: number } };
        if ((flip.meta?.changes ?? 0) === 0) continue; // already tiered by another pass — no meter shift
        await commitEffectBatch(
          firm.database,
          {
            statements: meterTierChangeStatements(
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
            outboxMessages: [
              // Domain event — a version was cooled to Infrequent Access (subscribers: audit, analytics).
              {
                topic: "file.tier_changed",
                payload: { versionId: version.id, storageClass: "infrequent_access" },
              },
            ],
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
