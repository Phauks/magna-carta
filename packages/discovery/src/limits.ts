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

// How many documents one bulk coding operation writes per committed batch. Each application binds
// well under twenty parameters and the access predicate adds one, so a chunk of this size sits inside
// the per-statement parameter ceiling with room to spare — the REVIEW_DOCUMENT_INSERT_BATCH_SIZE
// reasoning, applied to the other table this subsystem writes at scale.
//
// A bulk operation commits several of these, not one transaction: a ceiling-sized selection cannot be
// one atomic write anywhere. That is what the event's `running` state is for — an operation that dies
// part-way leaves its event running with exactly the rows it did write attributed to it, which is a
// recoverable and honest record rather than a silent partial.
export const BULK_CODING_CHUNK_SIZE = 100;

// The most documents one bulk coding request may name. The same wall and the same reasoning as
// MAX_SELECTION_SIZE above: a selection is a request body, not a corpus.
//
// Bulk over a whole corpus — "everything matching this search" at the ceiling — is a different shape
// of operation: it needs the criteria resolved against the corpus index, and it needs a coordinator
// walking the frozen list across turns rather than one request holding the work. Both arrive with the
// corpus index read; the materialized-selection contract here is written so the criteria source is
// opaque to the executor, which is what lets that land without changing anything below it.
export const BULK_CODING_MAX_DOCUMENTS = MAX_SELECTION_SIZE;

// A coding panel is a handful of questions and a few dozen answers. The cap exists so a read is
// bounded rather than because a firm is expected to approach it; a firm that does has a taxonomy
// problem the platform should not silently absorb.
export const MAX_TAG_GROUPS_PER_REVIEW_SET = 50;
export const MAX_TAGS_PER_REVIEW_SET = 500;

// The recorded criteria of a bulk gesture — field names and identifiers, as typed. Bounded small
// because it is a note for humans and never re-executed, and because free text is refused in it: a
// criteria blob that could carry a sentence could carry privileged content into a journal that has no
// redaction story.
export const CODING_CRITERIA_MAX_LENGTH = 2000;

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
