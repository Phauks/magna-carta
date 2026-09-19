import {
  listSupersededSplitsReadyForCollection,
  retireSupersededSplitStatements,
} from "@magna-carta/data-access/index-split-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { listCorporaWithLiveSplits } from "@magna-carta/data-access/index-split-statements";
import { readSearchCompactionPolicy } from "@magna-carta/search/settings";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { listReachableActiveFirms } from "../scheduled.ts";
import { corpusNeedsCompaction } from "./compaction-consumer.ts";
import { searchCompactionJobName } from "./compaction-types.ts";

// Two daily passes that keep the search index maintained, both on the existing reconciliation cron.
//
// THE BACKSTOP is not the primary trigger — the write path is, because it already reads the catalog and
// can notice a threshold crossing for the price of one indexed count. This pass exists for the two cases
// the write path structurally cannot see: a corpus that crossed the threshold through DELETION rather
// than writing (nothing published, so nothing counted), and a corpus that crossed it and then stopped
// being written to before its message was consumed.
//
// THE RETIREMENT is the other half of compaction's correctness. The pass that supersedes a split
// deliberately does not delete its R2 object, because a query resolves its split keys and then reads them
// — deleting an object in the same pass that superseded it could hand a live query a key to bytes that no
// longer exist. Retirement happens here instead, once a split has been superseded for longer than any
// query can possibly live, which is what the `superseded_at` timestamp is for.

// How long a superseded split's object is left in place before it is collected. A Worker request cannot
// outlive its own invocation limit, so a query holding keys resolved before a swap is finished within
// seconds; an hour is orders of magnitude beyond that, and the bytes are a derived cache of documents
// that durably live in R2, so the only cost of being generous is storage nobody is reading.
const RETIREMENT_GRACE_PERIOD_MS = 60 * 60 * 1000;

// Per-firm caps for one pass, so one firm with an enormous backlog cannot starve the rest of a cron fire.
// Enqueuing is cheap (one Durable Object call), collecting is not (an R2 delete plus two row deletes), so
// they are sized differently.
const COMPACTION_BACKSTOP_PER_FIRM_CAP = 50;
const RETIREMENT_PER_FIRM_CAP = 500;

export interface SearchCompactionSweepReport {
  readonly firmsProcessed: number;
  // Corpora this pass actually put a compaction message on the queue for. A corpus already in flight is
  // examined and not counted, which is the normal case for a firm whose write path is keeping up.
  readonly compactionsEnqueued: number;
  readonly splitsRetired: number;
  readonly bytesReclaimed: number;
}

export interface SearchCompactionSweepOptions {
  readonly perFirmCompactionCap?: number;
  readonly perFirmRetirementCap?: number;
  readonly gracePeriodMs?: number;
  readonly nowMs?: number;
}

export async function runSearchCompactionSweep(
  env: Bindings,
  options: SearchCompactionSweepOptions = {},
): Promise<SearchCompactionSweepReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const compactionCap = options.perFirmCompactionCap ?? COMPACTION_BACKSTOP_PER_FIRM_CAP;
  const retirementCap = options.perFirmRetirementCap ?? RETIREMENT_PER_FIRM_CAP;
  const gracePeriodMs = options.gracePeriodMs ?? RETIREMENT_GRACE_PERIOD_MS;
  const nowMs = options.nowMs ?? Date.now();

  const firms = await listReachableActiveFirms(env);
  let firmsProcessed = 0;
  let compactionsEnqueued = 0;
  let splitsRetired = 0;
  let bytesReclaimed = 0;

  for (const firm of firms) {
    try {
      const policy = await readSearchCompactionPolicy(firm.database);

      // The backstop. Every CORPUS holding live splits is a candidate — a matter's own documents and a
      // review set's, which are separate indexes and separate merges; the threshold read decides.
      const corpora = await listCorporaWithLiveSplits(firm.database, compactionCap);
      for (const corpus of corpora) {
        if (!(await corpusNeedsCompaction(firm.database, corpus.corpusId, policy))) continue;
        const coordinator = env.SEARCH_COMPACTION_JOB.get(
          env.SEARCH_COMPACTION_JOB.idFromName(
            searchCompactionJobName(firm.firmId, corpus.corpusId),
          ),
        );
        const outcome = await coordinator.start({
          firmId: firm.firmId,
          matterId: corpus.matterId,
          corpusKind: corpus.corpusKind === "reviewSet" ? "reviewSet" : "matter",
          corpusId: corpus.corpusId,
        });
        // `started`, not merely "asked": a corpus already in flight cost one Durable Object call and must
        // not be reported as work this pass caused.
        if (outcome.started) compactionsEnqueued++;
      }

      // The retirement. Objects before rows, always: a crash between them leaves a row pointing at bytes
      // that are gone, which the next pass simply retires again, where the other order leaves bytes in
      // the firm's bucket that no row names and no sweep can ever recognize as garbage.
      const collectable = await listSupersededSplitsReadyForCollection(
        firm.database,
        new Date(nowMs - gracePeriodMs).toISOString(),
        retirementCap,
      );
      // A retired split is this firm's object, so it is deleted from this firm's bucket.
      const { bucket } = resolveFirmBucket(env, firm.bucketName);
      for (const split of collectable) {
        await bucket.delete(split.objectKey);
        await commitEffectBatch(
          firm.database,
          {
            statements: retireSupersededSplitStatements(firm.database, split.id),
            outboxMessages: [],
          },
          { now: () => new Date(nowMs).toISOString() },
        );
        splitsRetired++;
        bytesReclaimed += split.sizeBytes;
      }

      firmsProcessed++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(
        logger,
        `cron:search-compaction-sweep:${firm.firmId}`,
        caught,
        correlationId,
      );
    }
  }

  return { firmsProcessed, compactionsEnqueued, splitsRetired, bytesReclaimed };
}
