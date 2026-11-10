import { assertRecordIndexSources, type RecordIndexSource } from "./record-index-sources.ts";

// Everything the record index IS in a firm's database, rendered from the declared sources: the two
// tables, the triggers that keep them current, and the statements that fill or rebuild them.
//
// The index is two tables because full-text and everything else want different storage:
//
//   record_text_entry   one ordinary row per indexed record — which source it came from, which row,
//                       which matter, and the key its place orders by. This is what a query joins to
//                       decide what a hit IS, and what a count of the index reads.
//   record_text_fts     the words, as a CONTENTLESS full-text table keyed by the entry's own row id.
//                       Contentless means the index holds terms and positions and NOT the text: a
//                       hit is a pointer, and the words a reader is shown are read from the row that
//                       owns them, behind that row's own access rules. The index cannot disagree with
//                       the record, because it cannot show anything.
//
// THE TRIGGERS ARE THE WRITE PATH, and there is no other. A trigger fires in the statement that
// changed the row, inside the same transaction, so the index is never behind and a write that rolls
// back takes its index row with it. Nothing in any domain package calls the index when it saves.
//
// Every trigger re-derives the row's entry from ONE select (rowSelect below), narrowed to the row or
// the container that changed. That select is also what fills the index for records that predate it
// and what rebuilds it, so the triggers and the rebuild cannot come to index a record differently.

export const RECORD_TEXT_ENTRY_TABLE = "record_text_entry";
export const RECORD_TEXT_FTS_TABLE = "record_text_fts";

// The full-text table. Three indexed columns:
//
//   scope   ONE token that is not a word — the record's matter, or the absence of one. A query
//           narrowed to one matter names its token here, so the narrowing is an intersection inside
//           the index rather than a filter applied to every record in the firm that contains the
//           words. Measured on a synthetic firm of 200,000 records, that is the difference between
//           visiting one matter's matches and visiting the firm's.
//   title   the short text a record is recognized by.
//   body    its words.
//
// THE SOURCE IS DELIBERATELY NOT A TOKEN HERE. It was, in the first cut, and it was the slowest thing
// in the index: a source's token is on every one of its records, so intersecting with it walks a
// list as long as the source for a question whose own words match three rows. The source is a column
// on the entry row instead, tested on the few rows the words produce.
//
// THERE ARE NO PREFIX INDEXES, also on measurement: `prefix='2 3'` took the index from about 60% of
// the size of the text it covers to about 160%, and bought a part-typed word nothing a reader could
// notice — the term list is already ordered, and reading the terms that start with a few letters
// from it is fast.
//
// `unicode61 remove_diacritics 2` folds case and accents, so "resume" finds "résumé".
// `contentless_delete` is what lets a row be removed from a contentless table by its id alone.
export const RECORD_TEXT_FTS_DEFINITION =
  `CREATE VIRTUAL TABLE \`${RECORD_TEXT_FTS_TABLE}\` USING fts5(` +
  `scope, title, body, content='', contentless_delete=1, ` +
  `tokenize="unicode61 remove_diacritics 2");`;

// The token every record on no matter carries.
export const NO_MATTER_SCOPE_TOKEN = "nomatter";

// The token a matter is narrowed by: the identifier's bytes in hexadecimal behind a letter. An
// identifier contains an underscore, which the tokenizer would split on; its hexadecimal form is
// letters and digits only and is the same in SQL and in TypeScript.
export function matterScopeToken(matterId: string): string {
  let hexadecimal = "";
  for (const byte of new TextEncoder().encode(matterId)) {
    hexadecimal += byte.toString(16).padStart(2, "0");
  }
  return `m${hexadecimal}`;
}

// The same token, computed by the database from an entry row.
function matterScopeTokenSql(matterColumn: string): string {
  return (
    `CASE WHEN ${matterColumn} IS NULL THEN '${NO_MATTER_SCOPE_TOKEN}' ` +
    `ELSE 'm' || lower(hex(${matterColumn})) END`
  );
}

// The one select a source's index rows are derived from. `narrowing` is the condition that picks the
// rows to derive — one row, one container's rows, or `1` for every row.
function rowSelect(source: RecordIndexSource, narrowing: string): string {
  const container = source.container;
  const from =
    container === null
      ? `\`${source.table}\``
      : `\`${source.table}\` JOIN \`${container.table}\` ` +
        `ON ${container.table}.id = ${source.table}.${container.foreignKey}`;
  const containerId = container === null ? "NULL" : `${source.table}.${container.foreignKey}`;
  const conditions = [narrowing];
  if (source.includeWhen !== null) conditions.push(`(${source.includeWhen})`);
  // A record with no words at all is not indexed: an entry that can match nothing is a row a count
  // would report as searchable.
  conditions.push(
    `TRIM(COALESCE(${source.titleExpression}, '') || COALESCE(${source.bodyExpression}, '')) <> ''`,
  );
  return (
    `SELECT ${source.table}.id AS record_id, ${containerId} AS container_id, ` +
    `${source.matterExpression} AS matter_id, ${source.sortExpression} AS sort_key, ` +
    `${source.titleExpression} AS title, ${source.bodyExpression} AS body ` +
    `FROM ${from} WHERE ${conditions.join(" AND ")}`
  );
}

// Removes the index rows an entry condition selects. The full-text rows go first, because they are
// found through the entries.
function removeStatements(source: RecordIndexSource, entryCondition: string): string[] {
  const entries =
    `SELECT id FROM \`${RECORD_TEXT_ENTRY_TABLE}\` ` +
    `WHERE source = '${source.key}' AND ${entryCondition}`;
  return [
    `DELETE FROM \`${RECORD_TEXT_FTS_TABLE}\` WHERE rowid IN (${entries});`,
    `DELETE FROM \`${RECORD_TEXT_ENTRY_TABLE}\` WHERE source = '${source.key}' AND ${entryCondition};`,
  ];
}

// Derives and writes the index rows for the records a narrowing selects.
function writeStatements(source: RecordIndexSource, narrowing: string): string[] {
  const derived = rowSelect(source, narrowing);
  return [
    `INSERT INTO \`${RECORD_TEXT_ENTRY_TABLE}\` (source, record_id, container_id, matter_id, sort_key) ` +
      `SELECT '${source.key}', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key ` +
      `FROM (${derived}) AS derived;`,
    `INSERT INTO \`${RECORD_TEXT_FTS_TABLE}\` (rowid, scope, title, body) ` +
      `SELECT entry.id, ${matterScopeTokenSql("entry.matter_id")}, ` +
      `derived.title, derived.body ` +
      `FROM (${derived}) AS derived JOIN \`${RECORD_TEXT_ENTRY_TABLE}\` AS entry ` +
      `ON entry.source = '${source.key}' AND entry.record_id = derived.record_id;`,
  ];
}

function trigger(name: string, event: string, table: string, body: readonly string[]): string {
  return `CREATE TRIGGER \`${name}\` ${event} ON \`${table}\` BEGIN\n  ${body.join("\n  ")}\nEND;`;
}

function triggerStem(source: RecordIndexSource): string {
  return `record_text_${source.key.replace(/-/gu, "_")}`;
}

// The names of the triggers one source owns, in the order they are created.
export function recordIndexTriggerNames(source: RecordIndexSource): string[] {
  const stem = triggerStem(source);
  const names = [`${stem}_insert`, `${stem}_update`, `${stem}_delete`];
  if (source.container !== null) names.push(`${stem}_container_update`, `${stem}_container_delete`);
  return names;
}

// The triggers that keep one source's index rows current.
//
// INSERT AND UPDATE DO THE SAME THING — remove whatever the index holds for the row, then derive it
// afresh — and the insert removes first on purpose. A statement that replaces a row (INSERT OR
// REPLACE) deletes the old one without firing its delete trigger, so an insert that assumed the index
// held nothing for the row would leave the replaced row's words findable under the new one.
//
// A row that no longer satisfies the source's own condition derives nothing, so removing-then-deriving
// is also what takes a record OUT of the index when it stops being searchable.
export function recordIndexTriggers(source: RecordIndexSource): string[] {
  assertRecordIndexSources([source]);
  const [insertName, updateName, deleteName, containerUpdateName, containerDeleteName] =
    recordIndexTriggerNames(source);
  const reindexRow = [
    ...removeStatements(source, "record_id = new.id"),
    ...writeStatements(source, `${source.table}.id = new.id`),
  ];
  const triggers = [
    trigger(insertName!, "AFTER INSERT", source.table, reindexRow),
    trigger(
      updateName!,
      `AFTER UPDATE OF ${source.reindexOn.map((column) => `\`${column}\``).join(", ")}`,
      source.table,
      reindexRow,
    ),
    trigger(
      deleteName!,
      "AFTER DELETE",
      source.table,
      removeStatements(source, "record_id = old.id"),
    ),
  ];
  const container = source.container;
  if (container !== null) {
    triggers.push(
      trigger(
        containerUpdateName!,
        `AFTER UPDATE OF ${container.reindexOn.map((column) => `\`${column}\``).join(", ")}`,
        container.table,
        [
          ...removeStatements(source, "container_id = new.id"),
          ...writeStatements(source, `${source.table}.${container.foreignKey} = new.id`),
        ],
      ),
      trigger(
        containerDeleteName!,
        "AFTER DELETE",
        container.table,
        removeStatements(source, "container_id = old.id"),
      ),
    );
  }
  return triggers;
}

// Fills one source's index rows from the records the firm already holds. Run once by the migration
// that introduces the source, and again by a rebuild.
export function recordIndexFillStatements(source: RecordIndexSource): string[] {
  assertRecordIndexSources([source]);
  return writeStatements(source, "1");
}

// How many of a source's records belong in the index today: the same select its rows are derived
// from, counted. Compared with how many index rows the source has, it says whether the copy has
// fallen behind the records, which a trigger-written index should never do and a status screen
// should be able to show it has not.
//
// It reads every row of the source's table, words included, so it is for a screen a person opened
// and never for a loop.
export function recordIndexExpectedCountSelect(source: RecordIndexSource): string {
  assertRecordIndexSources([source]);
  return `SELECT COUNT(*) FROM (${rowSelect(source, "1")})`;
}

// Empties one source's index rows and derives them again. The index is a copy, so this is always
// safe: nothing is lost that the records themselves do not still hold.
export function recordIndexRebuildStatements(source: RecordIndexSource): string[] {
  assertRecordIndexSources([source]);
  return [...removeStatements(source, "1"), ...writeStatements(source, "1")];
}

// The statements a migration introducing these sources carries, in apply order: each source's
// triggers, then its fill. Both belong to ONE migration, which a database applies as one
// transaction: no record can be written between the triggers arriving and the fill running, so the
// fill never meets a row a trigger already indexed and nothing written before the migration is left
// out.
export function recordIndexMigrationStatements(sources: readonly RecordIndexSource[]): string[] {
  assertRecordIndexSources(sources);
  const statements: string[] = [];
  for (const source of sources) {
    statements.push(...recordIndexTriggers(source), ...recordIndexFillStatements(source));
  }
  return statements;
}
