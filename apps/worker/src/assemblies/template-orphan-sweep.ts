import { listTemplateVersionR2Keys } from "@magna-carta/document-assembly/template-statements";
import {
  TEMPLATE_OBJECT_PREFIX,
  TEMPLATE_STAGING_PREFIX,
} from "@magna-carta/document-assembly/template-service";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Logger } from "@magna-carta/telemetry/logger";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { listReachableActiveFirms } from "../scheduled.ts";

// THE RETIREMENT PASS FOR TEMPLATE OBJECTS NO ROW NAMES.
//
// Registering a template writes the prepared bytes to R2 BEFORE the rows naming them commit, and
// that ordering is deliberate: the two failure directions are not symmetric. A committed row
// pointing at bytes that were never written is a template that fails at 4:55pm on a filing
// deadline; a written object with no row is only wasted storage. So the ordering stays, and the
// wasted storage is real — a registration that throws after the write (an unreachable scan engine
// is the common one) leaves a full copy behind, under a freshly minted key every attempt, that no
// row will ever name. Each retry of a refusal leaves another.
//
// Nothing else reaches those bytes. The storage reconciliation pass lists `files/` and `bulk/`, and
// its business is correcting the meter rather than deleting anything. This pass is the only thing
// that collects them, and it deletes nothing the meter counts — no write path meters the
// `templates/` prefix today — so it has no ordering relationship with reconciliation.
//
// WHY A GRACE PERIOD IS THE WHOLE SAFETY ARGUMENT. The search compaction pass beside this one never
// deletes a split in the pass that superseded it, because a query resolves split keys and then
// reads them. The same hazard here is the registration window itself: between the object write and
// the row commit the bytes are real and no row names them, so an object read out of the bucket
// during that window is indistinguishable from an orphan. Nothing may be deleted in the pass that
// first saw it, and the grace period is what enforces that — by the time an object is eligible it
// has been sitting unnamed for a day, which is six orders of magnitude longer than the window.
//
// WHY THE RETENTION SET SPANS THE FLEET RATHER THAN ONE FIRM. A template key is
// `templates/{templateId}/{versionId}` and carries no firm, and every firm resolves to the same
// bound R2 handle today (files/firm-bucket.ts explains why, and when that changes). "Not in THIS
// firm's version set" is therefore equally true of every other firm's live templates, and deleting
// on that test alone would delete another firm's letterhead. The set that makes an orphan provable
// is the union over every firm holding a bucket — built as one read per firm through that firm's
// own firm-scoped database handle, so no query crosses firms even though the answer spans them.
//
// COMPLETENESS IS THE INVARIANT THAT MAKES THE COMPLEMENT SAFE. A complement is only as trustworthy
// as the set it complements: if one firm's read fails, every key that firm would have contributed
// looks exactly like an orphan. So a failed read DISARMS the entire pass — it deletes nothing and
// says so. Skipping a night of collection costs storage, which is the harm this pass exists to
// reduce; deleting a live template is a harm it must not be able to create.

// How long an unnamed object is left alone before it can be collected. Generous on purpose: the
// race being closed is milliseconds wide, the bytes cost storage and nothing else, and a template a
// firm is mid-registration on is the one thing that must never be swept out from under it.
const TEMPLATE_ORPHAN_GRACE_PERIOD_MILLISECONDS = 24 * 60 * 60 * 1000;

// Deletions per firm per pass. A delete is a request against the firm's bucket, so one firm with a
// pathological backlog — a scan engine that was down for a week under a retrying client — must not
// be able to consume the whole cron budget and starve every other firm's pass. A firm over the cap
// drains across nights, and the cap being hit is counted rather than swallowed: a truncated pass
// that reported nothing would read as "there was nothing left".
const TEMPLATE_ORPHAN_DELETE_PER_FIRM_CAP = 200;

export interface TemplateOrphanSweepReport {
  readonly firmsSwept: number;
  readonly orphansDeleted: number;
  readonly bytesReclaimed: number;
  // Firms whose pass stopped at the per-firm cap with candidates still unexamined.
  readonly firmsCapped: number;
  // True when the fleet retention set could not be completed, so this pass deleted nothing at all.
  readonly disarmed: boolean;
}

export interface TemplateOrphanSweepOptions {
  readonly perFirmDeleteCap?: number;
  readonly gracePeriodMilliseconds?: number;
  // The pass's clock. Injectable on the same terms the search compaction sweep takes its own: the
  // eligibility test compares an R2 object's upload time against a cutoff, and a test cannot make an
  // object old, so it moves the cutoff instead.
  readonly nowMilliseconds?: number;
}

interface FleetRetentionSet {
  readonly keys: ReadonlySet<string>;
  // False when any firm's read failed, which disarms deletion for the whole pass.
  readonly complete: boolean;
}

// Every R2 key any firm's template catalogue names. Firms are read by BUCKET rather than by status:
// a firm with no bucket has written no objects and can contribute none, while a firm that is not
// active still owns whatever it wrote, and a status filter here would make its templates look
// collectable.
async function readFleetTemplateKeys(
  env: Bindings,
  logger: Logger,
  correlationId: string,
): Promise<FleetRetentionSet> {
  const { results } = await env.DB_CONTROL.prepare(
    "SELECT id FROM firm WHERE bucket_name IS NOT NULL",
  ).all<{ id: string }>();
  const keys = new Set<string>();
  let complete = true;
  for (const firm of results) {
    try {
      const database = firmDatabaseFor(env.FIRM_DATABASE, firm.id);
      for (const key of await listTemplateVersionR2Keys(database)) keys.add(key);
    } catch (caught) {
      complete = false;
      logOperationFailed(
        logger,
        `cron:template-orphan-sweep:retention:${firm.id}`,
        caught,
        correlationId,
      );
    }
  }
  return { keys, complete };
}

export async function runTemplateOrphanSweep(
  env: Bindings,
  options: TemplateOrphanSweepOptions = {},
): Promise<TemplateOrphanSweepReport> {
  // One logger + correlation id per pass — the same one-pipeline discipline every other sweep here
  // keeps.
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const deleteCap = options.perFirmDeleteCap ?? TEMPLATE_ORPHAN_DELETE_PER_FIRM_CAP;
  const gracePeriod = options.gracePeriodMilliseconds ?? TEMPLATE_ORPHAN_GRACE_PERIOD_MILLISECONDS;
  const nowMilliseconds = options.nowMilliseconds ?? Date.now();
  // An object written at or after this instant is inside the grace period and is not a candidate,
  // however certain the rest of the test looks.
  const writtenBefore = nowMilliseconds - gracePeriod;

  const retention = await readFleetTemplateKeys(env, logger, correlationId);
  if (!retention.complete) {
    // Disarmed: an incomplete retention set cannot distinguish an orphan from a live template
    // belonging to the firm whose read failed. The listing is skipped too — there is nothing this
    // pass could do with it.
    return {
      firmsSwept: 0,
      orphansDeleted: 0,
      bytesReclaimed: 0,
      firmsCapped: 0,
      disarmed: true,
    };
  }

  const firms = await listReachableActiveFirms(env);
  let firmsSwept = 0;
  let orphansDeleted = 0;
  let bytesReclaimed = 0;
  let firmsCapped = 0;

  for (const firm of firms) {
    try {
      // A firm still mid-provisioning has no bucket recorded and therefore no objects to collect;
      // resolving throws, which the per-firm catch below turns into a skip plus a logged failure.
      const { bucket } = resolveFirmBucket(env, firm.bucketName);
      let remaining = deleteCap;
      let capped = false;
      let cursor: string | undefined;
      for (;;) {
        // The first page is requested without a cursor key at all — passing an explicit
        // `cursor: undefined` makes the local object store return an empty page.
        const page = await bucket.list(
          cursor === undefined
            ? { prefix: TEMPLATE_OBJECT_PREFIX }
            : { prefix: TEMPLATE_OBJECT_PREFIX, cursor },
        );
        for (const object of page.objects) {
          // A staged upload is legitimately named by no version row — registration has not read it
          // yet, and a caller who was handed a 503 is expected to retry against the same staged
          // bytes rather than upload them again. Reaping abandoned staging is a separate concern
          // with a separate answer (an R2 lifecycle rule); it is not this pass's to guess at.
          if (object.key.startsWith(TEMPLATE_STAGING_PREFIX)) continue;
          if (retention.keys.has(object.key)) continue;
          if (object.uploaded.getTime() >= writtenBefore) continue;
          if (remaining === 0) {
            capped = true;
            break;
          }
          await bucket.delete(object.key);
          orphansDeleted++;
          bytesReclaimed += object.size;
          remaining--;
        }
        if (capped || !page.truncated) break;
        cursor = page.cursor;
      }
      if (capped) firmsCapped++;
      firmsSwept++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass
      // retries.
      logOperationFailed(
        logger,
        `cron:template-orphan-sweep:${firm.firmId}`,
        caught,
        correlationId,
      );
    }
  }

  if (orphansDeleted > 0) {
    // A count, never a key. The number is what an operator watches: a rate that stays non-zero is a
    // registration path failing repeatedly, not a sweep doing its job.
    logger.count("storage.template_orphan.collected", {}, orphansDeleted);
  }
  if (firmsCapped > 0) {
    // A capped pass swept less than the bucket held, and a silent truncation reads as "there was
    // nothing left". Persistent non-zero means the cap is too low for a real firm's backlog.
    logger.count("storage.template_orphan.cap_reached", {}, firmsCapped);
  }

  return { firmsSwept, orphansDeleted, bytesReclaimed, firmsCapped, disarmed: false };
}
