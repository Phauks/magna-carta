import type {
  FileId,
  IndexSplitId,
  MatterId,
  ReviewDocumentId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The discovery search-index catalog: one row per immutable Tantivy split in the firm's R2. This
// table exists only in the per-firm database — the caller supplies that handle.
export const INDEX_SPLIT_TABLE = "index_split";

// What a split indexes, which depends on which corpus it belongs to: a File Manager file in a matter
// corpus, a review document in a discovery review-set corpus. Kept as a union of the two branded
// handles rather than widened to `string`, so a caller cannot hand one corpus the other's documents.
export type IndexedDocumentId = FileId | ReviewDocumentId;

// THE SCOPE KEY, and the only one. Every read below that answers "what is in this corpus" matches on
// `corpus_id` alone.
//
// The kind is stored and never matched on, for the same reason the split's R2 key needs only the id:
// an identifier is a self-describing handle (`matter_…`, `reviewSet_…`), so two kinds cannot collide
// on one id, and a scope read that had to match a pair would be a scope read somebody could get half
// right. The kind is what lets a report say what a split is without resolving it.
export interface IndexSplitCorpusColumns {
  readonly corpusKind: string;
  readonly corpusId: string;
}

export interface InsertIndexSplitRow extends IndexSplitCorpusColumns {
  readonly id: IndexSplitId;
  // Provenance, not scope: which matter the index work was done under. A review-set split carries the
  // review set's matter. Nothing enumerates a corpus by it — see the schema comment beside the column.
  readonly matterId: MatterId;
  // The one document version this split indexes — null for a split that spans many documents, the shape
  // a later compaction pass publishes when it merges the per-document splits.
  readonly documentId: IndexedDocumentId | null;
  readonly version: number | null;
  readonly objectKey: string;
  readonly documentCount: number;
  readonly sizeBytes: number;
  readonly schemaGeneration: number;
  readonly createdAt: string; // ISO-8601 instant
}

// Record a newly published split. A split is immutable, so this is the only INSERT; a split leaves the
// live set through `markSplitSupersededStatement`, never an in-place update of its content.
export function insertIndexSplitStatement(
  database: SqlDatabase,
  row: InsertIndexSplitRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INDEX_SPLIT_TABLE} (id, matter_id, corpus_kind, corpus_id, document_id, version, object_key, document_count, size_bytes, schema_generation, created_at, superseded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.corpusKind,
      row.corpusId,
      row.documentId,
      row.version,
      row.objectKey,
      row.documentCount,
      row.sizeBytes,
      row.schemaGeneration,
      row.createdAt,
    );
}

export interface IndexSplitRow extends IndexSplitCorpusColumns {
  readonly id: IndexSplitId;
  readonly matterId: MatterId;
  readonly documentId: IndexedDocumentId | null;
  readonly version: number | null;
  readonly objectKey: string;
  readonly documentCount: number;
  readonly sizeBytes: number;
  readonly schemaGeneration: number;
  readonly createdAt: string;
  // Null while the split is live; the instant compaction replaced it otherwise. Projected on every read
  // because callers outside the compaction pass need it: the write pipeline must not delete a superseded
  // split's object, which belongs to the retirement sweep and its grace period.
  readonly supersededAt: string | null;
}

// One home for the projection and its row mapping, so every read of this table returns the same shape
// and a new column cannot be added to one query and forgotten in another.
const SELECT_SPLIT_COLUMNS = `SELECT id, matter_id, corpus_kind, corpus_id, document_id, version, object_key, document_count, size_bytes, schema_generation, created_at, superseded_at FROM ${INDEX_SPLIT_TABLE}`;

interface IndexSplitColumns {
  id: string;
  matter_id: string;
  corpus_kind: string;
  corpus_id: string | null;
  document_id: string | null;
  version: number | null;
  object_key: string;
  document_count: number;
  size_bytes: number;
  schema_generation: number;
  created_at: string;
  superseded_at: string | null;
}

function toIndexSplitRow(row: IndexSplitColumns): IndexSplitRow {
  return {
    id: row.id as IndexSplitId,
    matterId: row.matter_id as MatterId,
    corpusKind: row.corpus_kind,
    // A row written before the widening has no corpus, and the backfill in the migration gave every
    // one of them their matter. Falling back to the matter here would re-implement that backfill in
    // the reader and hide a row the migration missed; an empty corpus id matches no scope read, which
    // is how such a row makes itself visible instead.
    corpusId: row.corpus_id ?? "",
    documentId: row.document_id as IndexedDocumentId | null,
    version: row.version,
    objectKey: row.object_key,
    documentCount: row.document_count,
    sizeBytes: row.size_bytes,
    schemaGeneration: row.schema_generation,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
  };
}

// The live splits for a CORPUS — the set a query enumerates and range-reads. Excludes splits a
// compaction has superseded, so a query never double-counts a document that a merged split also carries.
// Ordered oldest-first for a stable, deterministic scan.
//
// This is the read that makes one corpus structurally unable to name another's splits: a query resolves
// its keys from here and nowhere else, so a review set's splits cannot enter a matter's result set
// however the query is worded.
export async function listLiveSplitsForCorpus(
  database: SqlDatabase,
  corpusId: string,
): Promise<IndexSplitRow[]> {
  const { results } = await database
    .prepare(
      `${SELECT_SPLIT_COLUMNS} WHERE corpus_id = ?1 AND superseded_at IS NULL ORDER BY created_at`,
    )
    .bind(corpusId)
    .all<IndexSplitColumns>();
  return results.map(toIndexSplitRow);
}

// Every split row this catalog has recorded for one document, across all its versions and whether or not
// a compaction has superseded them. The write pipeline reads this immediately before publishing: the
// rows name the R2 objects a re-index has to delete, and deleting the objects before the rows is what
// keeps a retry from leaking orphaned bytes into the firm's bucket.
export async function listSplitsForDocument(
  database: SqlDatabase,
  documentId: IndexedDocumentId,
): Promise<IndexSplitRow[]> {
  const { results } = await database
    .prepare(`${SELECT_SPLIT_COLUMNS} WHERE document_id = ?1 ORDER BY created_at`)
    .bind(documentId)
    .all<IndexSplitColumns>();
  return results.map(toIndexSplitRow);
}

// Drop the LIVE catalog rows for a document. Paired with insertIndexSplitStatement in ONE batch, this is
// the convergence rule the whole write pipeline rests on: publishing a document's split is a delete-then-
// insert, not an upsert, so re-indexing a document at any version leaves exactly one live row no matter
// how many times the job ran or how far a previous attempt got. Delete (not supersede) is right here
// because a LIVE per-document split has no reader to protect — the replacement covers the same document,
// so a query that resolves the new split sees everything the old one held.
//
// A SUPERSEDED ROW IS LEFT ALONE. It is the retirement sweep's record that an object compaction merged
// away still has to be collected once its grace period expires, and deleting the row here would strand
// the bytes it names in the firm's bucket with nothing able to recognize them as garbage. It also cannot
// collide with the insert: the one-live-split-per-document-version unique index is partial on
// `superseded_at IS NULL`, so a superseded row of the same version is simply outside it.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function deleteSplitsForDocumentStatement(
  database: SqlDatabase,
  documentId: IndexedDocumentId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${INDEX_SPLIT_TABLE} WHERE document_id = ?1 AND superseded_at IS NULL`)
    .bind(documentId);
}

// The publish batch: replace a document's catalog rows with the one row for the version just built.
// Returned as an ordered pair for a single atomic batch — split across two batches, a crash between them
// would leave the document uncataloged and therefore invisible to search, which is exactly the silent
// drop the pipeline must never produce.
export function replaceDocumentSplitStatements(
  database: SqlDatabase,
  row: InsertIndexSplitRow & { readonly documentId: IndexedDocumentId },
): SqlStatement[] {
  return [
    deleteSplitsForDocumentStatement(database, row.documentId),
    insertIndexSplitStatement(database, row),
  ];
}

// Mark a split superseded by compaction, dropping it from the live set. The row is kept (not deleted)
// until its R2 object is garbage-collected, so a query mid-flight against the old split still resolves;
// `deleteIndexSplitStatement` removes the row after the object is gone.
// fitness:unguarded-write — a concurrent compaction pass claiming the split first is ordinary — passes overlap by design
export function markSplitSupersededStatement(
  database: SqlDatabase,
  id: IndexSplitId,
  supersededAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INDEX_SPLIT_TABLE} SET superseded_at = ?2 WHERE id = ?1 AND superseded_at IS NULL`,
    )
    .bind(id, supersededAt);
}

// Remove a superseded split's catalog row after its R2 object has been garbage-collected.
export function deleteIndexSplitStatement(database: SqlDatabase, id: IndexSplitId): SqlStatement {
  return database.prepare(`DELETE FROM ${INDEX_SPLIT_TABLE} WHERE id = ?1`).bind(id);
}

// ── Compaction ──────────────────────────────────────────────────────────────
//
// Compaction merges many small splits into one, and everything below exists to let it do that without a
// query ever seeing a partial corpus. The rule the whole set is written to: the catalog moves in ONE
// atomic step from naming the sources to naming the merged split, and the sources' R2 objects outlive
// that step by a grace period. A query that resolved its keys before the swap holds source keys whose
// objects still exist; one that resolved after holds the merged key and none of the sources. There is no
// interleaving that yields both and none that yields neither.

// Table name tracked against @magna-carta's per-firm schema by the schema-name-sync fitness test. What
// is inside a MERGED split — a per-document split needs no membership, because its own document_id and
// version columns are its membership.
export const INDEX_SPLIT_MEMBER_TABLE = "index_split_member";

// How many splits a corpus currently holds live. The count the write path makes after publishing, to
// notice that a corpus has crossed the compaction threshold — one indexed count against a table it is
// already writing, never a scan and never a merge.
export async function countLiveSplitsForCorpus(
  database: SqlDatabase,
  corpusId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS live FROM ${INDEX_SPLIT_TABLE} WHERE corpus_id = ?1 AND superseded_at IS NULL`,
    )
    .bind(corpusId)
    .first<{ live: number }>();
  return row?.live ?? 0;
}

// Every corpus holding at least one live split — the candidate set the daily compaction backstop walks.
//
// Distinct corpora rather than splits, because the question is "which corpora might need compacting",
// and a corpus with four thousand splits should cost one row here rather than four thousand. The
// threshold read that follows is what decides; this only bounds who is asked.
//
// The kind comes back with the id because the sweep has to rebuild a corpus scope to act on it, and
// deriving the kind from the id's prefix would be a second, weaker copy of what the column already says.
export async function listCorporaWithLiveSplits(
  database: SqlDatabase,
  limit: number,
): Promise<(IndexSplitCorpusColumns & { readonly matterId: MatterId })[]> {
  const { results } = await database
    .prepare(
      // MIN over the matter rather than a group key: every split in one corpus was published under the
      // same matter (a corpus belongs to one matter, whether it is the matter itself or a review set
      // on it), so aggregating it keeps the grouping on the scope alone. Grouping by the matter as
      // well would silently split one corpus into two candidates the day that stopped being true,
      // which is the failure this read must not have.
      `SELECT corpus_kind, corpus_id, MIN(matter_id) AS matter_id FROM ${INDEX_SPLIT_TABLE} WHERE superseded_at IS NULL AND corpus_id IS NOT NULL GROUP BY corpus_kind, corpus_id ORDER BY COUNT(*) DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<{ corpus_kind: string; corpus_id: string; matter_id: string }>();
  return results.map((row) => ({
    corpusKind: row.corpus_kind,
    corpusId: row.corpus_id,
    matterId: row.matter_id as MatterId,
  }));
}

// Which of these matters hold anything in their file contents index: the matters, among the ones
// named, whose own corpus has a live split.
//
// For a question asked of several matters one at a time. Most of a client's matters may hold no
// indexed file, and a matter with nothing indexed has nothing to ask, so this one read is what keeps
// the questions to the matters that can answer.
//
// The corpus kind is fixed here and is not a caller's to choose. A review set on one of these matters
// has a corpus of its own under its own identifier, and naming a matter never names it.
export async function listMattersWithLiveSplits(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<MatterId[]> {
  if (matterIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT DISTINCT corpus_id FROM ${INDEX_SPLIT_TABLE} WHERE corpus_kind = 'matter' AND superseded_at IS NULL AND corpus_id IN (${matterIds.map(() => "?").join(", ")})`,
    )
    .bind(...matterIds)
    .all<{ corpus_id: string }>();
  return results.map((row) => row.corpus_id as MatterId);
}

// The splits one compaction pass will merge: the corpus's live splits, oldest first, cut off at whichever
// bound is reached first.
//
// BOTH BOUNDS ARE NECESSARY and they guard different failures. The count bound keeps the merge's
// bookkeeping — readers, catalog rows, membership — inside what one pass can hold. The byte bound keeps
// the merge itself inside a Container's memory and wall clock, which the count cannot do because splits
// are not the same size: a thousand-page production and a one-line memo are both one split. A corpus over
// the bound converges over several passes rather than attempting one merge that cannot finish.
//
// Oldest first, because the oldest splits are the ones a later re-index is most likely to have superseded
// and therefore the ones a merge reclaims the most from — and because it is a stable order, so a retried
// pass selects the same set and derives the same merged split id.
export async function listCompactionInputSplits(
  database: SqlDatabase,
  corpusId: string,
  maximumSplits: number,
  maximumTotalBytes: number,
): Promise<IndexSplitRow[]> {
  const { results } = await database
    .prepare(
      `${SELECT_SPLIT_COLUMNS} WHERE corpus_id = ?1 AND superseded_at IS NULL ORDER BY created_at, id LIMIT ?2`,
    )
    .bind(corpusId, maximumSplits)
    .all<IndexSplitColumns>();

  const selected: IndexSplitRow[] = [];
  let totalBytes = 0;
  for (const row of results) {
    const split = toIndexSplitRow(row);
    // The first split is always taken even if it alone exceeds the byte bound. A corpus whose oldest
    // split is enormous would otherwise select nothing and re-enqueue forever, and merging one split by
    // itself is still useful work — it repacks whatever a re-index has superseded inside it.
    if (selected.length > 0 && totalBytes + split.sizeBytes > maximumTotalBytes) break;
    selected.push(split);
    totalBytes += split.sizeBytes;
  }
  return selected;
}

export interface IndexSplitMemberRow {
  readonly splitId: IndexSplitId;
  readonly documentId: IndexedDocumentId;
  readonly version: number;
}

// Record which document versions a merged split covers. Inserted in the same batch that publishes the
// split, never afterwards: a merged split whose membership landed separately would, between the two
// writes, be a split nothing could name the contents of — so a re-index in that window could not mark its
// stale version and the old passages would go on matching.
export function insertIndexSplitMemberStatement(
  database: SqlDatabase,
  row: IndexSplitMemberRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR REPLACE INTO ${INDEX_SPLIT_MEMBER_TABLE} (split_id, document_id, version, superseded_at) VALUES (?1, ?2, ?3, NULL)`,
    )
    .bind(row.splitId, row.documentId, row.version);
}

// Mark every live merged split's membership of this document stale, whatever version it holds. Composed
// into the same batch that publishes the document's replacement split, so a re-index marks and publishes
// together or does neither — the window in which a document has a new split AND an unmarked old one
// inside a merged split is the window in which a query returns both, and this closes it to zero.
//
// Deliberately not scoped to a version: every version of this document that a merged split still carries
// is superseded by the one being published, and naming them individually would need a read the write path
// does not otherwise make.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function markMembersStaleForDocumentStatement(
  database: SqlDatabase,
  documentId: IndexedDocumentId,
  supersededAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INDEX_SPLIT_MEMBER_TABLE} SET superseded_at = ?2 WHERE document_id = ?1 AND superseded_at IS NULL`,
    )
    .bind(documentId, supersededAt);
}

export interface StaleSplitMember {
  readonly splitId: IndexSplitId;
  readonly documentId: IndexedDocumentId;
}

// The per-split exclusion lists for a corpus, in one read.
//
// This is the query path's second catalog read and it is what keeps a re-indexed document from matching
// its own stale passages: the merged split still holds them until the next compaction repacks it, so the
// engine is told, per split, which document ids may not contribute a hit. Per split rather than per
// query, because the same document is legitimately live at a newer version in a different split —
// excluding it globally would hide the current text along with the stale text.
export async function listStaleMembersForCorpus(
  database: SqlDatabase,
  corpusId: string,
): Promise<StaleSplitMember[]> {
  const { results } = await database
    .prepare(
      `SELECT member.split_id AS split_id, member.document_id AS document_id
         FROM ${INDEX_SPLIT_MEMBER_TABLE} AS member
         JOIN ${INDEX_SPLIT_TABLE} AS split ON split.id = member.split_id
        WHERE split.corpus_id = ?1
          AND split.superseded_at IS NULL
          AND member.superseded_at IS NOT NULL
        ORDER BY member.split_id, member.document_id`,
    )
    .bind(corpusId)
    .all<{ split_id: string; document_id: string }>();
  return results.map((row) => ({
    splitId: row.split_id as IndexSplitId,
    documentId: row.document_id as IndexedDocumentId,
  }));
}

// The live membership of one merged split — the document versions still current inside it.
//
// Read when that split is itself a source for a further compaction: the result has to inherit what its
// inputs carried, or a chain of compactions would lose track of what is inside the split it produced and
// no later re-index could mark its versions stale.
export async function listLiveMembersForSplit(
  database: SqlDatabase,
  splitId: IndexSplitId,
): Promise<IndexSplitMemberRow[]> {
  const { results } = await database
    .prepare(
      `SELECT split_id, document_id, version FROM ${INDEX_SPLIT_MEMBER_TABLE} WHERE split_id = ?1 AND superseded_at IS NULL`,
    )
    .bind(splitId)
    .all<{ split_id: string; document_id: string; version: number }>();
  return results.map((row) => ({
    splitId: row.split_id as IndexSplitId,
    documentId: row.document_id as IndexedDocumentId,
    version: row.version,
  }));
}

// How many stale members a corpus's live splits are carrying. A corpus can need compacting without
// gaining a single split: a re-indexed document leaves its old passages inside a merged split, costing
// bytes to store and an exclusion clause on every query until a merge repacks them out. The compaction
// trigger reads this beside the live-split count so churn is a reason to compact, not only growth.
export async function countStaleMembersForCorpus(
  database: SqlDatabase,
  corpusId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS stale
         FROM ${INDEX_SPLIT_MEMBER_TABLE} AS member
         JOIN ${INDEX_SPLIT_TABLE} AS split ON split.id = member.split_id
        WHERE split.corpus_id = ?1
          AND split.superseded_at IS NULL
          AND member.superseded_at IS NOT NULL`,
    )
    .bind(corpusId)
    .first<{ stale: number }>();
  return row?.stale ?? 0;
}

export interface PublishCompactedSplitInput {
  readonly split: InsertIndexSplitRow;
  readonly members: readonly IndexSplitMemberRow[];
  readonly supersededSplitIds: readonly IndexSplitId[];
  readonly supersededAt: string;
}

// THE COMPACTION SWAP, as one ordered batch. Insert the merged split's row, insert its membership, then
// mark every source superseded — and never as more than one batch.
//
// The order inside the batch matters as much as its atomicity. The merged row and its membership land
// before the sources leave the live set, so there is no committed state in which a corpus has lost the
// sources and not yet gained the merge. Split across two batches, a crash between them would either
// double-count every merged document (sources still live beside the merge) or lose the whole merge set
// from search (sources superseded, merge absent) — the second of which is a defensibility failure, not a
// cache miss.
//
// What is deliberately NOT here: deleting the source splits' R2 objects or their rows. A query resolves
// its split keys and then reads them, so a pass that deleted an object it had just superseded could hand
// a live query a key to bytes that no longer exist. Retirement is a later sweep with a grace period
// (`listSupersededSplitsReadyForCollection`), which is the whole reason `superseded_at` is a timestamp
// rather than a flag.
export function publishCompactedSplitStatements(
  database: SqlDatabase,
  input: PublishCompactedSplitInput,
): SqlStatement[] {
  return [
    insertIndexSplitStatement(database, input.split),
    ...input.members.map((member) => insertIndexSplitMemberStatement(database, member)),
    ...input.supersededSplitIds.map((id) =>
      markSplitSupersededStatement(database, id, input.supersededAt),
    ),
  ];
}

// Splits superseded longer ago than the grace period, and therefore safe to retire: no query can still
// be holding a key resolved before the swap that superseded them. The bound is a wall-clock instant the
// caller computes, so the grace period lives with the sweep that owns it rather than in this statement.
export async function listSupersededSplitsReadyForCollection(
  database: SqlDatabase,
  supersededBefore: string,
  limit: number,
): Promise<IndexSplitRow[]> {
  const { results } = await database
    .prepare(
      `${SELECT_SPLIT_COLUMNS} WHERE superseded_at IS NOT NULL AND superseded_at < ?1 ORDER BY superseded_at LIMIT ?2`,
    )
    .bind(supersededBefore, limit)
    .all<IndexSplitColumns>();
  return results.map(toIndexSplitRow);
}

// Retire a split's catalog rows once its R2 object is gone. Membership first, then the split row: the
// membership is meaningless without the split it describes, and leaving it behind would make a document
// look as though it were still inside something.
export function retireSupersededSplitStatements(
  database: SqlDatabase,
  id: IndexSplitId,
): SqlStatement[] {
  return [
    database.prepare(`DELETE FROM ${INDEX_SPLIT_MEMBER_TABLE} WHERE split_id = ?1`).bind(id),
    deleteIndexSplitStatement(database, id),
  ];
}
