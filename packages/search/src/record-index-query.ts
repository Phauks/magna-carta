import type { MatterId } from "@magna-carta/identifiers/types";
import {
  NO_MATTER_SCOPE_TOKEN,
  RECORD_TEXT_ENTRY_TABLE,
  RECORD_TEXT_FTS_TABLE,
  matterScopeToken,
} from "./record-index-schema.ts";
import { recordIndexSource } from "./record-index-sources.ts";

// How a reader's text becomes a question the record index can answer, and how a consumer composes
// that question into its own statement.
//
// THE READER'S TEXT IS NEVER QUERY SYNTAX. The index's match language has operators — AND, OR, NOT,
// NEAR, a column filter, a prefix star — and a search box that passed text through would let a
// question about "trust AND estate" mean something its author did not type, and would let a stray
// quotation mark turn a search into an error. So the text is taken apart into the same tokens the
// index itself would cut it into, and the match expression is rebuilt from those tokens alone. Every
// token reaches the expression inside double quotes, where the match language reads it as a literal.
//
// WHAT A QUERY MEANS, in the reader's terms:
//
//   - every word typed must appear in the record;
//   - the LAST word matches as the start of a word, because a search box is usually read mid-word
//     ("ease" finds "easement");
//   - words typed inside quotation marks match as that exact run of words;
//   - a word with punctuation inside it — "O'Brien", "2026-0142" — matches as the run of pieces the
//     index cut it into, in order and adjacent, so it cannot match an O and a Brien at opposite ends
//     of a note;
//   - case and accents do not matter.
//
// It is a word match and not a substring match. "sement" does not find "easement". That is the trade
// an index makes for not reading every row, and it is why names and numbers — where a person does
// mean the characters — stay on their own columns and out of this index.

// A letter or a digit in any script, with any accent mark that follows one. Everything else separates
// tokens, which is how the index's own tokenizer reads text. The mark is here because an accented
// letter can arrive as two characters — the letter, then its accent — and the tokenizer reads that
// pair as one letter; cutting between them would turn one word into two.
const TOKEN = /[\p{L}\p{N}\p{M}]+/gu;

// One run of adjacent tokens: a single word, a word the tokenizer splits, or a quoted phrase.
export interface RecordQueryTerm {
  readonly tokens: readonly string[];
  // Whether the last token of the run matches as a prefix.
  readonly prefix: boolean;
}

function tokensOf(text: string): string[] {
  // Composed first, so a letter and its accent are one character wherever a composed form exists.
  return text.normalize("NFC").match(TOKEN) ?? [];
}

// Every word of a text as the index cuts it, and where each starts, for finding a reader's words
// again in a record a search is about to show (matched-text.ts). The text is taken as given: an
// accent written as a character of its own stays inside its word here, as it does in the index.
export function recordWordsOf(text: string): { readonly word: string; readonly start: number }[] {
  return Array.from(text.matchAll(TOKEN), (match) => ({ word: match[0], start: match.index }));
}

const ACCENT_MARKS = /\p{M}+/gu;

// A word as the index holds it, near enough to find it again: its accents taken off and its
// capitals lowered, which is what the index's tokenizer does to a word of Latin letters.
//
// This is for MARKING a word in a result, never for deciding one. The index made the match; a
// letter this folds differently from the tokenizer (a script the tokenizer leaves its accents on)
// costs a mark on a result that is still there.
export function asRecordIndexed(word: string): string {
  return word.normalize("NFD").replace(ACCENT_MARKS, "").toLowerCase();
}

// Takes a reader's text apart into terms. Returns an empty list for text holding no letter or digit —
// the caller issues no statement for that, rather than a match that cannot hit.
export function parseRecordQuery(text: string): RecordQueryTerm[] {
  // An unpaired quotation mark is one the reader has not finished typing. It is dropped, so the words
  // after it are read as ordinary words until the closing mark arrives.
  const marks = text.split('"').length - 1;
  const readable =
    marks % 2 === 0
      ? text
      : `${text.slice(0, text.lastIndexOf('"'))} ${text.slice(text.lastIndexOf('"') + 1)}`;
  const terms: RecordQueryTerm[] = [];
  readable.split('"').forEach((segment, index) => {
    // With the marks paired, every odd segment is the inside of a quotation.
    if (index % 2 === 1) {
      const tokens = tokensOf(segment);
      if (tokens.length > 0) terms.push({ tokens, prefix: false });
      return;
    }
    for (const word of segment.split(/\s+/u)) {
      const tokens = tokensOf(word);
      if (tokens.length > 0) terms.push({ tokens, prefix: false });
    }
  });
  // The last term is the one still being typed — unless the text ends in a space, which says the word
  // is complete, or in a closing quotation mark, which the reader finished on purpose.
  const last = terms.at(-1);
  if (last !== undefined && !/[\s"]$/u.test(readable)) {
    terms[terms.length - 1] = { tokens: last.tokens, prefix: true };
  }
  return terms;
}

function termExpression(term: RecordQueryTerm): string {
  // Tokens hold letters and digits only, so none can contain a quotation mark; the quotes here are
  // what make each one a literal to the match language.
  const phrase = `"${term.tokens.join(" ")}"`;
  return term.prefix ? `${phrase}*` : phrase;
}

// What a question is narrowed to before it is asked.
export interface RecordQueryScope {
  // The declared sources to read. A consumer names its own; a firm-wide read names several.
  readonly sourceKeys: readonly string[];
  // One matter, records on no matter at all, or `undefined` for every record the sources hold. A
  // read that passes `undefined` is a read of the FIRM, and the caller owns the reason it may make
  // one: a conflicts check may, because a conflict is imputed across the firm; a person's own search
  // may not, and composes the visible-matter predicate over the entry's matter instead.
  readonly matter?: MatterId | "none";
}

// The match expression for a reader's text within a scope, or null when the text holds nothing to
// match or the scope names nowhere to look. The result is a BINDING for a `MATCH ?` — never text to
// splice into a statement.
//
// It carries the WORDS and the MATTER. The sources are not in it: they are a condition on the entry
// row (`recordSourceCondition`), because a source's records are too many for narrowing by source
// inside the index to be anything but the slowest step of a selective question. The keys are still
// resolved here, so a typo fails as a programming mistake instead of as an answer that reads like
// "nothing matched".
export function recordMatchExpression(text: string, scope: RecordQueryScope): string | null {
  const terms = parseRecordQuery(text);
  if (terms.length === 0 || scope.sourceKeys.length === 0) return null;
  for (const key of scope.sourceKeys) recordIndexSource(key);
  const clauses: string[] = [];
  if (scope.matter === "none") {
    clauses.push(`scope:"${NO_MATTER_SCOPE_TOKEN}"`);
  } else if (scope.matter !== undefined) {
    clauses.push(`scope:"${matterScopeToken(scope.matter)}"`);
  }
  // The column filter is what keeps a reader's words out of the scope column: without it, typing a
  // matter's token would be a way to ask which records are on that matter.
  clauses.push(`{title body}:(${terms.map(termExpression).join(" AND ")})`);
  return clauses.join(" AND ");
}

// The condition that narrows the entry rows to the named sources, as literal text. Every key is
// resolved against the declarations first — which is also what makes it safe to write as a literal:
// a declared key is lowercase letters and hyphens and nothing else.
export function recordSourceCondition(sourceKeys: readonly string[]): string {
  if (sourceKeys.length === 0) throw new Error("a record index read must name at least one source");
  const literals = sourceKeys.map((key) => `'${recordIndexSource(key).key}'`);
  return literals.length === 1
    ? `${RECORD_TEXT_ENTRY_TABLE}.source = ${literals[0]!}`
    : `${RECORD_TEXT_ENTRY_TABLE}.source IN (${literals.join(", ")})`;
}

// HOW A CONSUMER COMPOSES THE INDEX INTO ITS OWN STATEMENT OVER ITS OWN TABLE. Two forms, and in
// both the consumer's statement is still the one that reads the row, binds the matter and composes
// the visibility predicate — the index only ever proposes candidates. A record the reader may not
// see is refused by the statement that reads it, exactly as it was before there was an index. That
// is the second of the two checks every result passes.

// THE USUAL FORM: a FROM clause in which the index leads and the consumer's table is reached by
// primary key from each match.
//
//   FROM <this> WHERE record_text_fts MATCH ? AND matter_note.matter_id = ? AND ...
//
// Takes one binding, the match expression above, for the `MATCH ?` the consumer writes with
// `RECORD_INDEX_MATCH_CONDITION`. The work is then proportional to the records that MATCH, where a
// statement that led with the consumer's table would read every row of the matter to test each one.
//
// The joins are written CROSS JOIN on purpose. To SQLite that is an instruction as well as a join:
// it fixes the order the tables are visited in, so the planner cannot decide — on a small table, or
// before it has statistics — to walk the consumer's table first and probe the index once per row.
export function recordIndexLeadingFrom(sourceKey: string, table: string): string {
  const source = recordIndexSource(sourceKey);
  if (source.table !== table) {
    throw new Error(
      `record index source "${source.key}" indexes ${source.table}, not ${table}: ` +
        `its matches are not that table's rows`,
    );
  }
  return (
    `${RECORD_TEXT_FTS_TABLE} ` +
    `CROSS JOIN ${RECORD_TEXT_ENTRY_TABLE} ON ${RECORD_TEXT_ENTRY_TABLE}.id = ${RECORD_TEXT_FTS_TABLE}.rowid ` +
    `AND ${RECORD_TEXT_ENTRY_TABLE}.source = '${source.key}' ` +
    `CROSS JOIN ${table} ON ${table}.id = ${RECORD_TEXT_ENTRY_TABLE}.record_id`
  );
}

// The condition that goes with `recordIndexLeadingFrom`, taking the match expression as its binding.
export const RECORD_INDEX_MATCH_CONDITION = `${RECORD_TEXT_FTS_TABLE} MATCH ?`;

// THE OTHER FORM, for a statement that matches the index OR something else — a call found by its
// words or by its number. A subquery returning the identifiers of one source's matching records:
//
//   WHERE (communication.id IN (<this>) OR communication.counterparty_number LIKE ?)
//
// One binding, the match expression. The consumer's table leads here, so this form reads every row
// its other conditions select; use it where those conditions already bound that to something small.
export function recordIdsMatchingSubquery(sourceKey: string): string {
  const source = recordIndexSource(sourceKey);
  return (
    `SELECT ${RECORD_TEXT_ENTRY_TABLE}.record_id FROM ${RECORD_TEXT_FTS_TABLE} ` +
    `JOIN ${RECORD_TEXT_ENTRY_TABLE} ON ${RECORD_TEXT_ENTRY_TABLE}.id = ${RECORD_TEXT_FTS_TABLE}.rowid ` +
    `WHERE ${RECORD_TEXT_FTS_TABLE} MATCH ? AND ${RECORD_TEXT_ENTRY_TABLE}.source = '${source.key}'`
  );
}

// THE THIRD FORM, for a person's search with no one matter to narrow by: every matter they may see.
//
//   FROM <this> WHERE matter_note.deleted_at IS NULL AND <the visible-matter predicate> ...
//
// Inside one matter the matter's own token keeps the index's work to that matter's matches. Across
// matters nothing does, and a word a firm writes in most of its records matches most of the index.
// So this form does not read every match: it takes the NEWEST matches, up to a cap the caller binds,
// and the consumer's table is reached from those alone. The index answers in the order its entries
// were written and stops at the cap, so the read costs the same whether the words are in forty
// records or in four hundred thousand.
//
// What that means for an answer: a question matched by no more records than the cap is answered in
// full, exactly as the leading form would. A question matched by more is answered from the most
// recently written of them, and the caller is told which it was by
// `countRecordIndexMatchesUpToStatement` (record-index-statements.ts) so a reader is never shown a
// part as the whole.
//
// The cap is over every source's matches together, because the source is a column on the entry row
// and not a term the index can narrow by. One source's share of the newest matches is what its
// statement goes on to read.
//
// Two bindings, in this order and before any the consumer's own conditions take: the match
// expression, built with no matter in its scope, and the cap. As in the leading form the consumer's
// statement still reads its own row and composes the visible-matter predicate; this only proposes.
export function recordIndexNewestMatchesFrom(sourceKey: string, table: string): string {
  const source = recordIndexSource(sourceKey);
  if (source.table !== table) {
    throw new Error(
      `record index source "${source.key}" indexes ${source.table}, not ${table}: ` +
        `its matches are not that table's rows`,
    );
  }
  return (
    `(SELECT ${RECORD_TEXT_FTS_TABLE}.rowid AS entry_id FROM ${RECORD_TEXT_FTS_TABLE} ` +
    `WHERE ${RECORD_TEXT_FTS_TABLE} MATCH ? ` +
    `ORDER BY ${RECORD_TEXT_FTS_TABLE}.rowid DESC LIMIT ?) AS newest_match ` +
    `CROSS JOIN ${RECORD_TEXT_ENTRY_TABLE} ON ${RECORD_TEXT_ENTRY_TABLE}.id = newest_match.entry_id ` +
    `AND ${RECORD_TEXT_ENTRY_TABLE}.source = '${source.key}' ` +
    `CROSS JOIN ${table} ON ${table}.id = ${RECORD_TEXT_ENTRY_TABLE}.record_id`
  );
}
