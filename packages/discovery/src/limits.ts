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
// IT IS NOW MEASURED, and the measurement is why it stays at 100 rather than growing. One batch of
// this size commits in 0.62 ms median / 0.73 ms p95 against a 25,000-document review set, on the
// machine-relative scale the load profile prints
// (`discovery-load.allocation-batch`, packages/fixtures/src/load-profile/discovery-measurements.ts).
// That is well inside a Worker's budget with room for the load's bookkeeping writes beside it, and
// the parameter and query walls above are what cap it rather than its cost — so a larger batch would
// buy a fraction of a millisecond per chunk and spend the headroom that keeps a schema change from
// pushing the statement past its parameter ceiling. Anything that reads this reads it from here.
export const REVIEW_DOCUMENT_INSERT_BATCH_SIZE = 100;

// How many review documents one coordinator turn allocates before checkpointing its cursor. Larger
// than the insert batch because a turn commits several batches; small enough that an eviction loses
// at most one turn's worth of progress, which the cursor then redoes idempotently.
export const LOAD_CHUNK_SIZE = 1000;

// The most items one internal-lane selection may name in a single request. A selection is a request
// body, not a corpus: a firm loading more than this loads it as several loads, each of which is its
// own recorded act with its own manifest — which is a better record anyway.
export const MAX_SELECTION_SIZE = 5000;

// How many custodians of record a load's record artifacts name in their header block. The bound
// exists because the header is read whole, and the number is generous: a production naming more than
// five thousand distinct custodians is not a header, it is a corpus of its own.
//
// It is NOT a truncation of the attribution. Every document entry in the manifest carries its own
// record-custodian identifier, and the header is a convenience index over them — so a review set
// past this bound loses a summary and never loses a fact. The artifact says so where it happens
// rather than quietly rendering a short list.
export const MANIFEST_RECORD_CUSTODIAN_CEILING = 5000;

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
// THE DEFAULT IS DERIVED FROM A MEASUREMENT AT THIS EXACT SIZE, not extrapolated from a tenth of it.
// A per-firm database holding one review set of 250,000 documents — with the File Manager rows they
// point at, their exceptions, their occurrences, and every index the review surface reads through —
// measures 633 MiB, against 66 MiB at 25,000. So a firm can hold roughly a dozen review sets at the
// ceiling before D1's 10 GB is the binding constraint rather than this number, which is the margin
// the ceiling exists to preserve: the failure it prevents is a firm discovering at 400,000 documents
// that its database is full, which is an outage with no good exit. Re-derive it by running the
// harness at its large volume rather than by reasoning about row sizes:
//   MAGNA_CARTA_DISCOVERY_VOLUME=large pnpm test packages/fixtures/src/load-profile/discovery-measurements.test.ts
// The semantic half sits at about a quarter of one Vectorize index at this size, unchanged.
export const DEFAULT_DOCUMENT_CEILING = 250_000;

export const discoveryDocumentCeilingDefinition: FirmSettingDefinition<number> = {
  key: "discovery.documentCeiling",
  // The lower bound keeps a fat-fingered write from making every review set unusable; the upper bound
  // keeps one from being indistinguishable from no ceiling at all, which is the state the ceiling
  // exists to prevent.
  schema: z.number().int().min(1_000).max(1_000_000),
  defaultValue: DEFAULT_DOCUMENT_CEILING,
};
