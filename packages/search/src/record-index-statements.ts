import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  recordMatchExpression,
  recordSourceCondition,
  type RecordQueryScope,
} from "./record-index-query.ts";
import {
  RECORD_TEXT_ENTRY_TABLE,
  RECORD_TEXT_FTS_TABLE,
  recordIndexExpectedCountSelect,
  recordIndexRebuildStatements,
} from "./record-index-schema.ts";
import {
  recordIndexSource,
  recordIndexSources,
  type RecordIndexReader,
} from "./record-index-sources.ts";

// The reads and the one maintenance write the record index offers directly. A consumer that owns a
// table of its own composes `recordIdsMatchingSubquery` into its own statement instead
// (record-index-query.ts); these are for a caller asking about the index itself, or reading across
// several sources at once.

// One match, as a pointer. It carries no text: the index holds none, and the words a reader is shown
// are read from the record by whoever owns it.
export interface RecordIndexPointerRow {
  readonly source: string;
  readonly record_id: string;
  // What a reader opens where that is not the record itself — the conversation a turn belongs to.
  readonly container_id: string | null;
  readonly matter_id: string | null;
  readonly sort_key: string;
}

export interface RecordIndexPointerRequest {
  readonly database: SqlDatabase;
  readonly text: string;
  readonly scope: RecordQueryScope;
  // A condition over `record_text_entry.matter_id` the caller composes into the WHERE clause, with
  // its bindings — the visible-matter predicate for a person's own search. It is applied BEFORE the
  // limit, in the statement, so a row the reader may not see cannot use up a place in the answer or
  // reveal by its absence that it exists. Absent only for a read the firm makes of itself.
  readonly matterCondition?: { readonly fragment: string; readonly bindings: readonly unknown[] };
  // How many pointers the caller wants. One more is read, so "there is more" is measured.
  readonly limit: number;
}

// The pointers matching a reader's text, best match first. Null when the text holds nothing to
// match, so the caller issues nothing.
//
// Ordered by the index's own relevance and then by recency. This is a RANKED answer: it is in the
// index's order and is not a listing a caller may re-sort or walk to the end of.
//
// WHAT IT COSTS: ranking scores every record that matches before the best are known, so the work is
// proportional to how many records contain the words. For a name or a phrase that is a handful and
// the read is far below a millisecond; for a word that is in nearly every record a firm holds it is
// the whole index. A caller that takes unselective text from a person — a search box — should say so
// in what it asks for, with a minimum length or a recency order, instead of assuming every question
// is a selective one.
export function selectRecordIndexPointersStatement(
  request: RecordIndexPointerRequest,
): SqlStatement | null {
  const match = recordMatchExpression(request.text, request.scope);
  if (match === null) return null;
  const conditions = [
    `${RECORD_TEXT_FTS_TABLE} MATCH ?`,
    recordSourceCondition(request.scope.sourceKeys),
  ];
  const bindings: unknown[] = [match];
  if (request.matterCondition !== undefined) {
    conditions.push(request.matterCondition.fragment);
    bindings.push(...request.matterCondition.bindings);
  }
  bindings.push(request.limit + 1);
  return request.database
    .prepare(
      `SELECT ${RECORD_TEXT_ENTRY_TABLE}.source AS source, ` +
        `${RECORD_TEXT_ENTRY_TABLE}.record_id AS record_id, ` +
        `${RECORD_TEXT_ENTRY_TABLE}.container_id AS container_id, ` +
        `${RECORD_TEXT_ENTRY_TABLE}.matter_id AS matter_id, ` +
        `${RECORD_TEXT_ENTRY_TABLE}.sort_key AS sort_key ` +
        `FROM ${RECORD_TEXT_FTS_TABLE} ` +
        `JOIN ${RECORD_TEXT_ENTRY_TABLE} ON ${RECORD_TEXT_ENTRY_TABLE}.id = ${RECORD_TEXT_FTS_TABLE}.rowid ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${RECORD_TEXT_FTS_TABLE}.rank, ${RECORD_TEXT_ENTRY_TABLE}.sort_key DESC, ` +
        `${RECORD_TEXT_ENTRY_TABLE}.id DESC ` +
        `LIMIT ?`,
    )
    .bind(...bindings);
}

// Whether a reader's text matches more of the index than `cap` entries, counted no further than one
// past it: the answer is a number from zero to `cap + 1`, and `cap + 1` means "more than the cap".
// Null when the text holds nothing to match.
//
// It goes with `recordIndexNewestMatchesFrom` (record-index-query.ts), which answers a question
// with no one matter in it from the newest `cap` matches. This is how the caller of that form learns
// whether those were all of them, so it can tell a reader that a broad question was answered from
// the most recent records instead of presenting a part as the whole.
//
// It counts matches in every source and on every matter, visible to the asker or not, and that is
// deliberate: the newest-matches form caps the same set, before any source or matter is known. The
// one fact it yields is whether the cap was reached. Never show the number to a reader, because
// below the cap it is a count of records they may not all be allowed to see.
//
// `matters` is the list the newest-matches form was given, where it was given one, so the two cap
// the same set: the count is then of those matters' matches and no others.
export function countRecordIndexMatchesUpToStatement(
  database: SqlDatabase,
  text: string,
  cap: number,
  matters?: RecordQueryScope["matters"],
): SqlStatement | null {
  const match = recordMatchExpression(text, {
    sourceKeys: recordIndexSources.map((source) => source.key),
    ...(matters === undefined ? {} : { matters }),
  });
  if (match === null) return null;
  return database
    .prepare(
      `SELECT COUNT(*) AS matched FROM (SELECT ${RECORD_TEXT_FTS_TABLE}.rowid ` +
        `FROM ${RECORD_TEXT_FTS_TABLE} WHERE ${RECORD_TEXT_FTS_TABLE} MATCH ? LIMIT ?)`,
    )
    .bind(match, cap + 1);
}

// How many records each declared source has in the index. A source with no rows is absent from the
// result rather than reported as zero; `readRecordIndexCounts` fills those in.
export function countRecordIndexEntriesStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT source, COUNT(*) AS indexed FROM ${RECORD_TEXT_ENTRY_TABLE} GROUP BY source`,
  );
}

export interface RecordIndexCount {
  readonly sourceKey: string;
  readonly label: string;
  readonly matchedFields: readonly string[];
  readonly indexed: number;
}

// Every declared source with how many of its records are indexed, in declaration order. Read for a
// screen that shows a firm what is searchable.
export async function readRecordIndexCounts(database: SqlDatabase): Promise<RecordIndexCount[]> {
  const { results } = await countRecordIndexEntriesStatement(database).all<{
    source: string;
    indexed: number;
  }>();
  const indexedBySource = new Map(results.map((row) => [row.source, row.indexed]));
  return recordIndexSources.map((source) => ({
    sourceKey: source.key,
    label: source.label,
    matchedFields: source.matchedFields,
    indexed: indexedBySource.get(source.key) ?? 0,
  }));
}

export interface RecordIndexPlace extends RecordIndexCount {
  readonly readBy: readonly RecordIndexReader[];
  // How many of the source's records belong in the index today, counted from the records. Equal to
  // `indexed` unless the copy has fallen behind them.
  readonly expected: number;
}

// How many records each declared source should have in the index, counted from its own table: one
// statement answering one row, with a column per source in declaration order (`expected_0`,
// `expected_1`, and so on).
//
// A column per source and not a row per source, because a row per source is a compound SELECT with
// one term each, and the database a firm's records live in refuses a compound of more than five
// terms. There are more sources than that today.
export function countRecordIndexExpectedStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT ${recordIndexSources
      .map((source, index) => `(${recordIndexExpectedCountSelect(source)}) AS expected_${index}`)
      .join(", ")}`,
  );
}

// Every declared source with how many of its records are indexed and how many should be, in
// declaration order: the list a firm is shown of what is searchable, and the check that the index
// still agrees with the records it was derived from.
//
// The second count reads every row of every source table, so this is for a screen a person opened.
export async function readRecordIndexPlaces(database: SqlDatabase): Promise<RecordIndexPlace[]> {
  const [counts, expected] = await Promise.all([
    readRecordIndexCounts(database),
    countRecordIndexExpectedStatement(database).all<Record<string, number>>(),
  ]);
  const expectedRow = expected.results[0] ?? {};
  // `counts` is in declaration order, the order the statement's columns are in.
  return counts.map((count, index) => ({
    sourceKey: count.sourceKey,
    label: count.label,
    matchedFields: count.matchedFields,
    indexed: count.indexed,
    readBy: recordIndexSource(count.sourceKey).readBy,
    expected: expectedRow[`expected_${index}`] ?? 0,
  }));
}

// Whether a place's index has fallen behind its records: the two counts differ. One definition, for
// the screen that shows a place as behind and for the rebuild that puts it right, so a place the
// screen names is exactly a place the rebuild takes.
//
// "Differ" and not "is short": an index holding a row its records no longer do is as wrong as one
// missing a row, and a rebuild repairs both.
export function recordIndexPlaceIsBehind(
  place: Pick<RecordIndexPlace, "indexed" | "expected">,
): boolean {
  return place.indexed !== place.expected;
}

// Empties one source's index rows and derives them again from its records. Returned as statements
// for the caller to run in ONE batch, so a reader never sees the source half-rebuilt.
export function rebuildRecordIndexSourceStatements(
  database: SqlDatabase,
  sourceKey: string,
): SqlStatement[] {
  return recordIndexRebuildStatements(recordIndexSource(sourceKey)).map((sql) =>
    database.prepare(sql),
  );
}

// Rewrites the full-text table into one compact structure, dropping everything a deletion left
// behind.
//
// A row deleted from the index stops being findable in the statement that deletes it. What remains
// until the index next reorganizes itself is a marker beside the old terms on the storage pages —
// the same way a deleted row of any table lingers on its page until the page is reused. For ordinary
// editing that is invisible and correct. For an ERASURE, where the point is that the words are gone
// and not merely unreachable, this is the statement that finishes the job; it is also worth running
// after a rebuild of a large source. It reads and rewrites the whole index, so it belongs in a
// background pass and never in a request.
export function optimizeRecordIndexStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `INSERT INTO ${RECORD_TEXT_FTS_TABLE} (${RECORD_TEXT_FTS_TABLE}) VALUES ('optimize')`,
  );
}
