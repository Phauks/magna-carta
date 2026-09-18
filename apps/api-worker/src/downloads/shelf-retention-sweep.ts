/*
 * The download register's retention sweep — the half that releases the bytes.
 *
 * Every row carries the expiry its producer wrote, and this pass takes the ones whose window has
 * closed. It runs on the daily per-firm cron beside the other storage passes.
 *
 * IT RELEASES THE BYTES AND KEEPS THE ROW, on the owner's ruling of 2026-09-16, and the two halves
 * are worth separating because they are not the same kind of thing. The bytes are privileged client
 * content held in a SECOND place — a bundle is a frozen copy of a matter's files — so a schedule
 * that destroys them is a posture rather than a chore. The row is a title, a producer and two
 * instants; destroying it costs a member their own history and protects nobody. So this marks
 * `expired` where it used to delete, and the register answers "you took this, and the copy we were
 * holding has gone" instead of answering nothing at all.
 *
 * The ORDER is the whole correctness argument, and it is the opposite of the template-orphan sweep's.
 * There, deleting is refused because an object nothing names might still be a firm's live template.
 * Here every object under the register's own prefix is named by exactly one row that has expired, so
 * the object goes first and the row second: an object deleted whose row survives is a shelf item that
 * reports `expired` when reached, which is the truth, while a row deleted whose object survives is
 * bytes nothing will ever name again — an orphan the firm pays for forever.
 *
 * An ARTIFACT's bytes are never touched. They belong to their producer's prefix and its own lifecycle
 * rule, and a content-addressed bundle may still be named by a colleague's row; the register marks
 * its row and leaves the object to the rule that owns it.
 *
 * A REFERENCE is never reached at all. Its expiry is null — there are no bytes of the register's to
 * release, the file is the matter's — and null never satisfies the sweep's range.
 */
import {
  expireDownloadItemStatement,
  readExpiredDownloadItems,
} from "@magna-carta/data-access/download-register-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// One pass's ceiling per firm. A shelf is short-lived and small, so this is a guard against a
// pathological backlog rather than a page size: whatever is left is taken by tomorrow's pass.
const SWEEP_BATCH_LIMIT = 500;

export async function runDownloadShelfRetentionSweep(env: Bindings): Promise<number> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const firms = await listReachableActiveFirms(env);
  let itemsSwept = 0;

  for (const firm of firms) {
    try {
      const now = new Date().toISOString();
      const expired = await readExpiredDownloadItems(firm.database, now, SWEEP_BATCH_LIMIT);
      if (expired.length === 0) continue;

      // A firm with no bucket has no stored documents to take; its rows are still swept.
      const bucket =
        firm.bucketName === null ? undefined : resolveFirmBucket(env, firm.bucketName).bucket;
      for (const row of expired) {
        if (row.kind === "snapshot" && bucket !== undefined && row.objectKey !== null) {
          // Object first: see the ordering argument above. A delete of an object that is already
          // gone is a no-op, so a half-finished pass is safe to repeat.
          await bucket.delete(row.objectKey);
        }
      }

      await commitEffectBatch(
        firm.database,
        {
          statements: expired.map((row) => expireDownloadItemStatement(firm.database, row.id)),
          outboxMessages: [],
        },
        { now: () => now },
      );
      itemsSwept += expired.length;
      // A counter, not an event: which member's export aged out is not a fact a log should carry,
      // and the rate is the alertable signal.
      logger.count("downloads.shelf_swept", {}, expired.length);
    } catch (caught) {
      logOperationFailed(
        logger,
        `cron:download-shelf-retention:${firm.firmId}`,
        caught,
        correlationId,
      );
    }
  }
  return itemsSwept;
}
