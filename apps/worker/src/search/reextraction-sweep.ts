import { listVersionsMissingFromSearchIndex } from "@magna-carta/file-manager/queries";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { listReachableActiveFirms } from "../scheduled.ts";
import { enqueueVersionForIndexing } from "./enqueue-index.ts";

// The repair pass for documents that are not in the searchable corpus and should be.
//
// WHY IT IS NEEDED AT ALL. Extraction used to be recognition-only, and recognition skips a page that
// already carries a text layer — so every born-digital document that went through the pipeline came
// back with nothing and was recorded as having no readable text. Composite extraction reads those
// documents correctly now, but nothing re-reads a document on its own: the write pipeline is triggered
// by an ingest commit, and those commits are in the past. This pass is what makes the fix retroactive.
//
// WHY A SWEEP AND NOT A MARKER. The alternative — flag the affected documents and re-extract each on
// next touch — needs somewhere to put the flag and something to notice it, and a document nobody
// touches never gets repaired, which for archived matters is most of them. The sweep needs neither:
// the per-firm catalog ALREADY answers "which documents have no live split", the coordinator Durable
// Object already treats a failed job as re-startable, and the daily reconciliation cron already walks
// every reachable firm. It is the cheaper mechanism because it is almost entirely mechanism that exists.
//
// WHY IT IS SAFE TO RE-RUN. Every step is convergent. The candidate query returns only documents with
// no live split, so a document repaired by the last pass is not a candidate for the next one. The
// coordinator single-flights per document version and refuses to restart a job that is already
// indexed. The split id is derived from document and version, so a re-index overwrites its own object
// rather than orphaning one. Nothing is deleted: this pass only ever asks for work to be redone.
//
// It also repairs everything else that leaves a document out of the corpus — an enqueue that lost its
// race after ingest commit, an engine outage that dead-lettered, a firm that enabled indexing after
// loading its documents. The catalog cannot tell those apart from an extraction failure, and does not
// need to: the repair is identical.

// One pass's per-firm cap. A firm's entire back catalogue can be missing from the index — that is
// exactly the case after this fix, and after a firm first turns indexing on — so the cap is what keeps
// one daily fire bounded and lets the backlog drain over several days instead of flooding the queue in
// one burst. Sized above the tiering sweep's cap because enqueuing is far cheaper per document than
// rewriting an R2 object.
const REEXTRACTION_SWEEP_PER_FIRM_CAP = 1000;

export interface ReextractionReport {
  readonly firmsProcessed: number;
  readonly enqueued: number;
}

export interface ReextractionOptions {
  readonly perFirmCap?: number;
}

export async function runReextractionSweep(
  env: Bindings,
  options: ReextractionOptions = {},
): Promise<ReextractionReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const perFirmCap = options.perFirmCap ?? REEXTRACTION_SWEEP_PER_FIRM_CAP;

  const firms = await listReachableActiveFirms(env);
  let firmsProcessed = 0;
  let enqueued = 0;
  for (const firm of firms) {
    try {
      const versions = await listVersionsMissingFromSearchIndex(firm.database, perFirmCap);
      for (const versionId of versions) {
        // Through the same seam an ingest commit uses, not a hand-rolled enqueue: it is the one place
        // that reads the firm's indexing switch, resolves the version's facts, and starts the
        // coordinator. A firm with indexing off produces no message here for the same reason it
        // produces none at commit.
        const message = await enqueueVersionForIndexing(env, firm.firmId, versionId, firm.database);
        if (message !== undefined) enqueued++;
      }
      firmsProcessed++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(logger, `cron:reextraction-sweep:${firm.firmId}`, caught, correlationId);
    }
  }
  return { firmsProcessed, enqueued };
}
