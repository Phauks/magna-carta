import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// The numbers a load is bounded by, in one home, each with the wall it is derived from beside it.

// D1's hard walls, restated here because every constant below is derived from one of them and a
// reader should not have to go looking: 100 bound parameters per query, 1,000 queries per Worker
// invocation, 100 KB per SQL statement, and — the one that shapes this the most — a single-threaded
// database that processes queries sequentially, so throughput is one over query duration.

// How many review documents one batched INSERT carries. A load must never be N single-row inserts and
// must never be one giant batch either; both walls are real. Each review document row binds well
// under twenty parameters, so a chunk of this size sits comfortably inside the 100-parameter ceiling
// per statement when the rows are written as separate statements in one batch, and inside the
// per-invocation query ceiling with room for the load's own bookkeeping writes.
//
// THIS IS A PLACEHOLDER FOR A MEASURED NUMBER. It is deliberately conservative rather than tuned:
// the load-profile harness that measures the real one lands with the discovery profile, and the
// number moves when that measurement exists rather than when somebody has an opinion. Anything that
// reads it reads it from here, so there is one place to change.
export const REVIEW_DOCUMENT_INSERT_BATCH_SIZE = 100;

// How many review documents one coordinator turn allocates before checkpointing its cursor. Larger
// than the insert batch because a turn commits several batches; small enough that an eviction loses
// at most one turn's worth of progress, which the cursor then redoes idempotently.
export const LOAD_CHUNK_SIZE = 1000;

// The most items one internal-lane selection may name in a single request. A selection is a request
// body, not a corpus: a firm loading more than this loads it as several loads, each of which is its
// own recorded act with its own manifest — which is a better record anyway.
export const MAX_SELECTION_SIZE = 5000;

// The per-review-set document ceiling, as a per-firm setting rather than a constant. It is refused
// above rather than degraded, and it is re-derived against the measured per-firm database size rather
// than defended by argument.
//
// The default is the point at which the arithmetic leaves the firm database comfortably inside D1's
// 10 GB with the rest of the firm's data (the review document row is a few hundred bytes plus its
// indexes, so the table is a few hundred megabytes at this size — the largest object in the database
// by an order of magnitude, and still not close to the wall), and at which the semantic half sits at
// about a quarter of one Vectorize index.
export const DEFAULT_DOCUMENT_CEILING = 250_000;

export const discoveryDocumentCeilingDefinition: FirmSettingDefinition<number> = {
  key: "discovery.documentCeiling",
  // The lower bound keeps a fat-fingered write from making every review set unusable; the upper bound
  // keeps one from being indistinguishable from no ceiling at all, which is the state the ceiling
  // exists to prevent.
  schema: z.number().int().min(1_000).max(1_000_000),
  defaultValue: DEFAULT_DOCUMENT_CEILING,
};
