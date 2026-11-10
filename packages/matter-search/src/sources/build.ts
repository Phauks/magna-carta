import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  RECORD_INDEX_MATCH_CONDITION,
  recordIdsMatchingSubquery,
  recordIndexLeadingFrom,
  recordMatchExpression,
} from "@magna-carta/search/record-index-query";
import type { SourceSearchRequest } from "./registry.ts";

// The one place a source's SELECT is assembled, so the four properties every source must have are
// STRUCTURAL rather than remembered:
//
//   1. The matter binding is composed HERE. A source hands in the expression naming its matter and
//      cannot decline to, so a source physically cannot search across matters. This is the single
//      most important property this surface has, and making it a property of the builder rather
//      than of anyone's diligence is the whole reason this file exists.
//   2. The visible-matter predicate is composed into the WHERE clause, BEFORE the LIMIT. Applying it
//      after the rows come back would under-fill the answer and turn the limit into an existence
//      oracle for the rows it removed.
//   3. Every statement carries a LIMIT, and it is always the caller's limit plus one. That extra row
//      is never returned — it is how "there is more" is MEASURED, so a group can say more exists
//      without ever claiming a total nobody counted.
//   4. The query text arrives as a BINDING and is never an instruction. Where a source matches a
//      name or a number by substring it is escaped for LIKE, so the wildcards are the reader's
//      text; where a source matches words through the record index it is rebuilt from the reader's
//      own tokens (recordIndexLeadingMatch below), so the index's operators are the reader's text
//      too.
//
// Table and column names are code-supplied literals throughout — constants in the source modules,
// never request input. Everything a caller supplies arrives as a binding.

// The escape the whole package shares.
//
// A query about a "50% contingency" must not turn every following character into a match-anything,
// and a search for "matter_2026" must not match "matter-2026". Both are ordinary things to type into
// a legal matter's search box, and both are silently wrong without this. SQLite's LIKE takes no
// escape character unless one is named, so every statement built here names `\` and every pattern is
// escaped against it — including the backslash itself, which must be escaped first or it would go on
// to escape the character after it.
export function likeContainsTerm(query: string): string {
  const escaped = query.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return `%${escaped}%`;
}

// THE MATCH FOR A SOURCE WHOSE WORDS ARE IN THE FIRM'S RECORD INDEX — a note's text, a narrative, an
// event's description — in the two forms a source can use it.
//
// In both, the statement around the match is unchanged: it still reads the source's own table, still
// binds the matter there, still composes the visibility predicate and still carries the limit, so the
// index decides nothing about what a reader may see. It proposes candidates and the source's own
// statement reads them.
//
// The matter is named to the index as well as bound by the builder. That is not a second access
// check — the builder's binding is the check — it is what keeps the index's own work proportional to
// one matter's matches instead of to every record in the firm that happens to contain the word.
//
// WHAT THE READER GETS IS A WORD MATCH: every word typed must be in the record, the last word may be
// the start of one, quoted words match as that exact run, and case and accents do not matter. It is
// not a substring match — "sement" does not find "easement". Names and numbers, where a person does
// mean the characters, stay on `likeContainsTerm`.

// THE USUAL FORM. The index leads and the source's table is reached by key from each match, so the
// read is proportional to the records that match and not to the rows the matter holds. Hand `from`,
// `condition` and `binding` to `boundedSearchSelect`.
//
// Null when the text holds no letter or digit: there is nothing to ask the index, and the source
// builds no statement.
export interface RecordIndexLeadingMatch {
  readonly from: string;
  readonly condition: string;
  readonly binding: string;
}

export function recordIndexLeadingMatch(
  request: SourceSearchRequest,
  recordIndexSourceKey: string,
  table: string,
): RecordIndexLeadingMatch | null {
  const expression = recordMatchExpression(request.query, {
    sourceKeys: [recordIndexSourceKey],
    matter: request.matterId,
  });
  if (expression === null) return null;
  return {
    from: recordIndexLeadingFrom(recordIndexSourceKey, table),
    condition: RECORD_INDEX_MATCH_CONDITION,
    binding: expression,
  };
}

// THE OTHER FORM, for a source that matches its words OR something else on its own table. A
// condition narrowing the source's table to the rows the index proposes, with its one binding, for
// the source to put beside its other condition. The source's table leads here, so the statement
// reads every row of the matter; that is the right trade only where a matter holds few of them.
//
// Null when the text holds no letter or digit, leaving the source its other half.
export interface RecordIndexMatch {
  readonly condition: string;
  readonly binding: string;
}

export function recordIndexMatch(
  request: SourceSearchRequest,
  recordIndexSourceKey: string,
  idColumn: string,
): RecordIndexMatch | null {
  const expression = recordMatchExpression(request.query, {
    sourceKeys: [recordIndexSourceKey],
    matter: request.matterId,
  });
  if (expression === null) return null;
  return {
    condition: `${idColumn} IN (${recordIdsMatchingSubquery(recordIndexSourceKey)})`,
    binding: expression,
  };
}

export interface BoundedSearchSelectSpec {
  readonly request: SourceSearchRequest;
  // The table (or join) the search walks, e.g. "custody_packet" or
  // "matter_party JOIN directory_person ON directory_person.id = matter_party.entity_id".
  readonly from: string;
  // The row's own identifier column, qualified where the FROM clause joins.
  readonly idColumn: string;
  // What a reader opens, where that differs from the row itself. Defaults to the row: only a source
  // whose screen is organised by something other than its rows needs this.
  readonly linkIdExpression?: string;
  // The expression naming this row's matter — bound to the searched matter, and handed to the
  // visibility predicate.
  readonly matterExpression: string;
  // The stable order key. A canonical instant for a recency-ordered source, a case-folded name for
  // an alphabetical one; compared as TEXT either way.
  readonly sortExpression: string;
  // What the reader recognizes the row by. Never NULL.
  readonly titleExpression: string;
  // The DECLARED excerpt expression, or the literal NULL where the source declares it has none.
  readonly snippetExpression: string;
  // A short second line, or the literal NULL.
  readonly secondaryExpression: string;
  // The acting member, or the literal NULL where the source records none.
  readonly actorExpression: string;
  // Source-specific narrowing — the match itself, a state filter, a soft-delete exclusion — already
  // expressed with `?` placeholders in binding order.
  readonly conditions: readonly string[];
  readonly bindings: readonly unknown[];
  // Descending order (newest first) for a recency source, ascending for an alphabetical one.
  readonly ascending?: boolean;
}

// Builds one bounded, matter-bound, predicate-composed statement.
export function boundedSearchSelect(
  database: SqlDatabase,
  spec: BoundedSearchSelectSpec,
): SqlStatement {
  const { request } = spec;
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  // THE matter binding, composed here rather than by the source. A source that wanted to search two
  // matters would have to stop using this builder to do it, which is a change no review misses.
  conditions.push(`${spec.matterExpression} = ?`);
  bindings.push(request.matterId);

  conditions.push(...spec.conditions);
  bindings.push(...spec.bindings);

  // THE visibility predicate, composed into the WHERE clause and never applied after the rows come
  // back. Today it excludes the platform-owned holding matter the custody register creates; when an
  // information-barrier overlay is built it is one more clause in that one predicate, and every
  // registered source inherits it without being touched.
  conditions.push(request.visibility.fragmentFor(spec.matterExpression));
  bindings.push(...request.visibility.bindings);

  const order = spec.ascending === true ? "ASC" : "DESC";
  const sql =
    `SELECT ${spec.idColumn} AS row_id, ${spec.linkIdExpression ?? "NULL"} AS link_id, ` +
    `${spec.matterExpression} AS matter_id, ` +
    `${spec.sortExpression} AS sort_key, ${spec.titleExpression} AS title, ` +
    `${spec.snippetExpression} AS snippet, ${spec.secondaryExpression} AS secondary, ` +
    `${spec.actorExpression} AS actor_user_id ` +
    `FROM ${spec.from} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `ORDER BY ${spec.sortExpression} ${order}, ${spec.idColumn} ${order} ` +
    `LIMIT ?`;
  // The has-more probe. Reading one past the limit is what lets a group report "there is more"
  // without a second COUNT query per source per keystroke — which on a fourteen-source fan-out
  // would double the reads to answer a question the extra row already answers.
  bindings.push(request.limit + 1);
  return database.prepare(sql).bind(...bindings);
}

// The deep link a person follows to see the row itself, in the section that owns it and behind that
// section's own access gate. This is what lets a hit stay a reference: the record is read by the
// subsystem that owns it, on the screen built to show it, rather than being re-rendered here.
export function matterSectionLink(matterId: string, section: string, rowId: string): string {
  return `/matters/${matterId}/${section}?entry=${encodeURIComponent(rowId)}`;
}
