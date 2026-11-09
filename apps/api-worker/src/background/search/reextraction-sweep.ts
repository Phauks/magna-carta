import {
  listVersionsMissingFromSearchIndex,
  type SearchIndexCandidateCursor,
} from "@magna-carta/file-manager/queries";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { listReachableActiveFirms } from "../scheduled.ts";
import { enqueueVersionForIndexing } from "../../search/enqueue-index.ts";

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
// WHY IT IS SAFE TO RE-RUN, AND WHY IT REACHES THE END. Convergence needs two things, and the success
// path only supplies the first.
//
// The candidate query returns documents with no live split, so a document repaired by the last pass is
// not a candidate for the next one. But two terminal outcomes leave no split row either: `failed` (bytes
// nothing can read) and `deferred` (no extraction engine bound — the ordinary state wherever OCR_SERVICE
// is absent, which defers every scanned page). Those documents stay candidates forever. Ordered by
// committed_at from the top on every pass, a firm whose oldest thousand documents are scans would
// re-enqueue exactly those thousand every day and never reach the thousand-and-first — the pass that
// exists to drain a back catalogue unable to drain past its own head.
//
// So the walk carries a CURSOR that advances past every candidate it examines, not only the ones it
// repaired, and the per-firm budget counts messages actually produced rather than candidates looked at.
// A head full of permanent failures is skipped over instead of consuming the whole budget.
//
// The second half is in the coordinator: it bounds re-attempts per document per engine generation, so a
// document that cannot be read stops costing anything after a few passes, and a deploy that binds a new
// engine resets that bound so the backlog drains rather than being written off. Together those mean one
// pass costs at most `scanCeiling` cheap coordinator calls and `perFirmCap` real extractions, and every
// document in the catalogue is reached.
//
// The coordinator also single-flights per document version and refuses to restart a job that is already
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

// How many candidates one pass will LOOK AT per firm, as distinct from how many it will enqueue. A
// candidate the coordinator declines costs one Durable Object call and no extraction, no queue message,
// no R2 GET and no parse — cheap enough to walk past in bulk, which is what lets the cursor get through
// a large head of permanently-failing documents and reach the ones behind it. Ten times the enqueue cap
// so an entire pass's budget is never spent on skipping.
const REEXTRACTION_SWEEP_PER_FIRM_SCAN_CEILING = REEXTRACTION_SWEEP_PER_FIRM_CAP * 10;

// One page of the candidate walk. Sized so a firm with nothing to repair costs one query.
const CANDIDATE_PAGE_SIZE = 200;

export interface ReextractionReport {
  readonly firmsProcessed: number;
  readonly enqueued: number;
  // Candidates examined across every firm, whether or not they produced work. Reported beside
  // `enqueued` because the gap between the two IS the backlog of documents this pipeline cannot
  // currently read — a number worth watching rather than inferring.
  readonly examined: number;
}

export interface ReextractionOptions {
  readonly perFirmCap?: number;
  readonly scanCeiling?: number;
  readonly pageSize?: number;
}

export async function runReextractionSweep(
  env: Bindings,
  options: ReextractionOptions = {},
): Promise<ReextractionReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const perFirmCap = options.perFirmCap ?? REEXTRACTION_SWEEP_PER_FIRM_CAP;

  const scanCeiling = options.scanCeiling ?? REEXTRACTION_SWEEP_PER_FIRM_SCAN_CEILING;
  const pageSize = options.pageSize ?? CANDIDATE_PAGE_SIZE;

  const firms = await listReachableActiveFirms(env);
  let firmsProcessed = 0;
  let enqueued = 0;
  let examined = 0;
  for (const firm of firms) {
    try {
      let cursor: SearchIndexCandidateCursor | undefined;
      let enqueuedForFirm = 0;
      let examinedForFirm = 0;
      while (enqueuedForFirm < perFirmCap && examinedForFirm < scanCeiling) {
        const page = await listVersionsMissingFromSearchIndex(
          firm.database,
          Math.min(pageSize, scanCeiling - examinedForFirm),
          cursor,
        );
        if (page.length === 0) break;
        for (const candidate of page) {
          // Through the same seam an ingest commit uses, not a hand-rolled enqueue: it is the one place
          // that reads the firm's indexing switch, resolves the version's facts, and starts the
          // coordinator. A firm with indexing off produces no message here for the same reason it
          // produces none at commit.
          const outcome = await enqueueVersionForIndexing(
            env,
            firm.firmId,
            candidate.versionId,
            firm.database,
          );
          examinedForFirm++;
          // `started`, not merely "resolved to a message": a version the coordinator declined — already
          // in flight, or out of attempts against this engine generation — cost nothing and must not
          // spend the pass's budget.
          if (outcome?.started === true) enqueuedForFirm++;
          // THE CURSOR MOVES ON EVERY CANDIDATE, not only the enqueued ones. That is the whole
          // difference between a pass that drains a catalogue and one that re-reads its head forever.
          cursor = { committedAt: candidate.committedAt, versionId: candidate.versionId };
          if (enqueuedForFirm >= perFirmCap) break;
        }
        if (page.length < pageSize) break;
      }
      enqueued += enqueuedForFirm;
      examined += examinedForFirm;
      firmsProcessed++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(logger, `cron:reextraction-sweep:${firm.firmId}`, caught, correlationId);
    }
  }
  return { firmsProcessed, enqueued, examined };
}
