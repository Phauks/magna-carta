import {
  listVersionsMissingFromSearchIndex,
  type SearchIndexCandidateCursor,
} from "@magna-carta/file-manager/queries";
import type { Bindings } from "../bindings.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { enqueueVersionForIndexing } from "./enqueue-index.ts";

// One walk over one firm's files that are not in the search index and should be, enqueuing each
// through the seam an ingest commit uses.
//
// TWO CALLERS, ONE WALK. The daily repair pass (background/search/reextraction-sweep.ts) runs it for
// every reachable firm with a large budget. The firm's own settings route runs it once, with a small
// one, at the moment a firm turns file indexing on — so the first files are being read while the
// person who flipped the switch is still looking at the page, instead of a day later. Both need the
// same two properties, which is why neither carries its own copy:
//
//   - THE CURSOR MOVES ON EVERY CANDIDATE, not only the enqueued ones. A version the coordinator
//     declined (already in flight, out of attempts against this engine generation, past the
//     extraction ceiling) leaves no split row and stays a candidate forever; a walk that restarted at
//     the head would re-read those and never reach the files behind them.
//   - THE BUDGET COUNTS WORK STARTED, not candidates looked at. A declined candidate costs one
//     coordinator call and nothing else, so it must not spend the budget that exists to bound real
//     extractions. The scan ceiling is the separate bound on looking.
//
// Nothing is deleted and nothing is decided here: the firm's indexing switch is read inside
// enqueueVersionForIndexing, so a firm with indexing off produces no message from this walk for the
// same reason it produces none at commit.

// The most index jobs the daily repair pass starts for one firm. A firm's entire back catalogue can
// be missing from the index (after a firm first turns indexing on, most plainly), so this cap is
// what keeps one daily fire bounded and lets the backlog drain over several days instead of flooding
// the queue in one burst. Sized above the tiering sweep's cap because enqueuing is far cheaper per
// document than rewriting an R2 object.
//
// It lives here, beside the walk, and not with the sweep because a firm is TOLD this number: the
// status read beside the firm's search settings reports it, so a firm with a large back catalogue
// can see why the count of files not yet indexed falls by about this much a day instead of all at
// once. A route may not import the background side, and both may import this.
export const DAILY_INDEX_BACKLOG_ENQUEUE_CAP = 1000;

export interface IndexBacklogBudget {
  // The most index jobs one walk will START.
  readonly enqueueCap: number;
  // The most candidates one walk will LOOK AT, started or not.
  readonly scanCeiling: number;
  // One page of the candidate read. A firm with nothing owed costs one query of this size.
  readonly pageSize: number;
}

export interface IndexBacklogReport {
  readonly enqueued: number;
  readonly examined: number;
}

export async function enqueueFirmIndexBacklog(
  env: Bindings,
  firmId: string,
  database: ProxyBatchDatabase,
  budget: IndexBacklogBudget,
): Promise<IndexBacklogReport> {
  let cursor: SearchIndexCandidateCursor | undefined;
  let enqueued = 0;
  let examined = 0;
  while (enqueued < budget.enqueueCap && examined < budget.scanCeiling) {
    const page = await listVersionsMissingFromSearchIndex(
      database,
      Math.min(budget.pageSize, budget.scanCeiling - examined),
      cursor,
    );
    if (page.length === 0) break;
    for (const candidate of page) {
      const outcome = await enqueueVersionForIndexing(env, firmId, candidate.versionId, database);
      examined++;
      // `started`, not merely "resolved to a message": a version the coordinator declined cost
      // nothing and must not spend the walk's budget.
      if (outcome?.started === true) enqueued++;
      cursor = { committedAt: candidate.committedAt, versionId: candidate.versionId };
      if (enqueued >= budget.enqueueCap) break;
    }
    if (page.length < budget.pageSize) break;
  }
  return { enqueued, examined };
}
