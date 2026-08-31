import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  MatterId,
  MatterNoteId,
  MatterNoteRevisionId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterNoteState } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_NOTE_TABLE = "matter_note";
export const MATTER_NOTE_REVISION_TABLE = "matter_note_revision";

// Every read in this module composes the visible-matter predicate, and it is a REQUIRED argument on
// each one rather than an option with a default. A note is the most privileged free-text record this
// platform holds, and an id-addressed read that skipped the predicate is exactly the read an
// information-barrier overlay would later be built past. The same discipline the calendar's own
// direct reads carry, for the same reason.

export interface MatterNoteRow {
  readonly id: MatterNoteId;
  readonly matter_id: MatterId;
  readonly author_user_id: UserId;
  readonly head_ordinal: number;
  readonly state: MatterNoteState;
  readonly retracted_at: string | null;
  readonly retracted_by: UserId | null;
  readonly retraction_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// A note as a surface renders it: the identity row, plus the body of whichever revision is currently
// the head and who wrote that body. One join on the unique (note_id, ordinal) index, never a
// correlated max() per row.
export interface MatterNoteDisplayRow extends MatterNoteRow {
  readonly body: string | null;
  readonly revision_id: MatterNoteRevisionId | null;
  readonly revision_author_user_id: UserId | null;
  readonly revision_created_at: string | null;
}

export interface MatterNoteRevisionRow {
  readonly id: MatterNoteRevisionId;
  readonly note_id: MatterNoteId;
  readonly body: string;
  readonly author_user_id: UserId;
  readonly ordinal: number;
  readonly created_at: string;
}

const NOTE_COLUMNS =
  `${MATTER_NOTE_TABLE}.id, ${MATTER_NOTE_TABLE}.matter_id, ${MATTER_NOTE_TABLE}.author_user_id, ` +
  `${MATTER_NOTE_TABLE}.head_ordinal, ${MATTER_NOTE_TABLE}.state, ${MATTER_NOTE_TABLE}.retracted_at, ` +
  `${MATTER_NOTE_TABLE}.retracted_by, ${MATTER_NOTE_TABLE}.retraction_reason, ` +
  `${MATTER_NOTE_TABLE}.created_at, ${MATTER_NOTE_TABLE}.updated_at`;

// The head join, and the reason the body column is CASE-guarded rather than merely joined.
//
// A retracted note's body stops rendering EVERYWHERE, and "everywhere" has to include the read that
// every surface is built on, not just the surfaces that remember to check the state. Leaving the
// body on the row and trusting each caller to hide it makes the tombstone a rendering convention —
// one careless template, one export, one debug log, and the withdrawn words are back. So the read
// itself returns NULL for a retracted note's body: a caller that forgets the state column gets
// nothing to display rather than something it should not have.
const HEAD_REVISION_JOIN =
  `LEFT JOIN ${MATTER_NOTE_REVISION_TABLE} ON ${MATTER_NOTE_REVISION_TABLE}.note_id = ${MATTER_NOTE_TABLE}.id ` +
  `AND ${MATTER_NOTE_REVISION_TABLE}.ordinal = ${MATTER_NOTE_TABLE}.head_ordinal`;

const NOTE_DISPLAY_COLUMNS =
  `${NOTE_COLUMNS}, ` +
  `CASE WHEN ${MATTER_NOTE_TABLE}.state = 'retracted' THEN NULL ELSE ${MATTER_NOTE_REVISION_TABLE}.body END AS body, ` +
  `${MATTER_NOTE_REVISION_TABLE}.id AS revision_id, ` +
  `${MATTER_NOTE_REVISION_TABLE}.author_user_id AS revision_author_user_id, ` +
  `${MATTER_NOTE_REVISION_TABLE}.created_at AS revision_created_at`;

export interface InsertMatterNoteInput {
  readonly id: MatterNoteId;
  readonly matterId: MatterId;
  readonly authorUserId: UserId;
  readonly now: string;
}

export function insertMatterNoteStatement(
  database: SqlDatabase,
  input: InsertMatterNoteInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_NOTE_TABLE} (id, matter_id, author_user_id, head_ordinal, state, ` +
        `retracted_at, retracted_by, retraction_reason, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, 1, 'active', NULL, NULL, NULL, ?4, ?4)`,
    )
    .bind(input.id, input.matterId, input.authorUserId, input.now);
}

export interface InsertMatterNoteRevisionInput {
  readonly id: MatterNoteRevisionId;
  readonly noteId: MatterNoteId;
  readonly body: string;
  readonly authorUserId: UserId;
  readonly ordinal: number;
  readonly now: string;
}

// The only write this table has. There is no update statement and no delete statement in this
// module, and three database triggers make that structural rather than a habit of this file.
export function insertMatterNoteRevisionStatement(
  database: SqlDatabase,
  input: InsertMatterNoteRevisionInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_NOTE_REVISION_TABLE} (id, note_id, body, author_user_id, ordinal, created_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(input.id, input.noteId, input.body, input.authorUserId, input.ordinal, input.now);
}

// Moves the head onto the revision just appended, guarded on the ordinal the caller observed.
//
// D1 has no interactive transaction, so the check rides the write. Unguarded, two members revising
// at once would both compute the same next ordinal — and while the unique index on
// (note_id, ordinal) already aborts the losing batch at its revision insert, this guard is what
// makes the head move mean what it says even if that index were ever relaxed. Cheap, and the failure
// it prevents is a note rendering a body that is not its latest.
export function advanceMatterNoteHeadStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterNoteId;
    readonly fromOrdinal: number;
    readonly toOrdinal: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_NOTE_TABLE} SET head_ordinal = ?1, updated_at = ?2 ` +
        `WHERE id = ?3 AND head_ordinal = ?4 AND state = 'active'`,
    )
    .bind(input.toOrdinal, input.now, input.id, input.fromOrdinal);
}

// Withdrawal. Guarded on the state the caller observed so a second retraction cannot overwrite the
// first one's actor, instant and reason — the record of WHO withdrew the note is the point of
// retraction being visible, and a racing second call must not rewrite it.
export function retractMatterNoteStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterNoteId;
    readonly retractedBy: UserId;
    readonly reason: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_NOTE_TABLE} SET state = 'retracted', retracted_at = ?1, retracted_by = ?2, ` +
        `retraction_reason = ?3, updated_at = ?1 WHERE id = ?4 AND state = 'active'`,
    )
    .bind(input.now, input.retractedBy, input.reason, input.id);
}

// The lean identity read the write paths make to decide whether a change is allowed. No body, no
// join: revising a note does not need the words it is replacing.
export function selectMatterNoteStatement(
  database: SqlDatabase,
  id: MatterNoteId,
  visibility: VisibleMatterPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM ${MATTER_NOTE_TABLE} WHERE ${MATTER_NOTE_TABLE}.id = ? AND ` +
        visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`),
    )
    .bind(id, ...visibility.bindings);
}

export async function readMatterNote(
  database: SqlDatabase,
  id: MatterNoteId,
  visibility: VisibleMatterPredicate,
): Promise<MatterNoteRow | undefined> {
  const { results } = await selectMatterNoteStatement(
    database,
    id,
    visibility,
  ).all<MatterNoteRow>();
  return results[0];
}

// The single-note DISPLAY read: the identity plus its head body. Beside the lean read above rather
// than replacing it, on the calendar's precedent — carrying the join through the lifecycle paths
// would widen three reads to serve one.
export function selectMatterNoteDetailStatement(
  database: SqlDatabase,
  id: MatterNoteId,
  visibility: VisibleMatterPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${NOTE_DISPLAY_COLUMNS} FROM ${MATTER_NOTE_TABLE} ${HEAD_REVISION_JOIN} ` +
        `WHERE ${MATTER_NOTE_TABLE}.id = ? AND ` +
        visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`),
    )
    .bind(id, ...visibility.bindings);
}

export async function readMatterNoteDetail(
  database: SqlDatabase,
  id: MatterNoteId,
  visibility: VisibleMatterPredicate,
): Promise<MatterNoteDisplayRow | undefined> {
  const { results } = await selectMatterNoteDetailStatement(
    database,
    id,
    visibility,
  ).all<MatterNoteDisplayRow>();
  return results[0];
}

// Finding a note again, which is the second-most-common thing anybody does with one.
//
// THREE THINGS THIS DELIBERATELY DOES NOT MATCH, each for its own reason.
//
// A RETRACTED NOTE'S BODY. Withdrawal stops the words rendering everywhere, and a search that still
// found them would be the clearest possible way around the tombstone. The head join already nulls
// the body on a retracted row, so this matches against the join's own output rather than the
// revision table, and the exclusion follows from that rather than from a second rule.
//
// A SUPERSEDED BODY. Only the current text is searched, and this is the substantive choice. A note
// corrected to take out the wrong client's name must stop being findable BY that name — otherwise
// the correction fixed what the note says and not what it discloses, which is most of why somebody
// corrects one. The earlier bodies stay readable from the note's own history, where a person has
// already chosen to look at that note.
//
// ANYTHING OUTSIDE THIS MATTER. The caller supplies one matter and the predicate composes over it,
// so this is a search WITHIN a case rather than across the firm. That boundary is the reason no
// snippet question arises here: every row this can return is a note whose body the same reader is
// already being shown on the same screen.
//
// The match is a LIKE scan rather than an index, and that is a bounded cost rather than an
// unmeasured one: the matter predicate narrows to one case's notes before the scan runs, and one
// matter's notes are counted in tens. A firm-wide note search is a different question with a
// different answer, and it is not built here.
function searchConditionFor(
  search: string | undefined,
): { condition: string; bindings: readonly unknown[] } | undefined {
  const term = search?.trim();
  if (term === undefined || term.length === 0) return undefined;
  // The wildcards are the caller's text, not their instruction: a note about a 50% fee split must
  // not turn every following character into a match-anything.
  const escaped = term.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return {
    condition:
      `${MATTER_NOTE_TABLE}.state = 'active' AND EXISTS (SELECT 1 FROM ${MATTER_NOTE_REVISION_TABLE} AS matching_revision ` +
      `WHERE matching_revision.note_id = ${MATTER_NOTE_TABLE}.id ` +
      `AND matching_revision.ordinal = ${MATTER_NOTE_TABLE}.head_ordinal ` +
      `AND matching_revision.body LIKE ? ESCAPE '\\')`,
    bindings: [`%${escaped}%`],
  };
}

// The matter's own note list, newest first. Keyset over (created_at, id) so it shares the timeline's
// cursor shape and the (matter_id, created_at, id) index serves the filter, the sort and the walk.
//
// Retracted notes are RETURNED here and excluded from the federated timeline. That asymmetry is
// deliberate and it is the whole design of retraction: the matter's own notes surface is where the
// firm sees that a note was withdrawn, by whom and why — a tombstone somebody can act on — while the
// timeline is a read spanning every matter, where an entry for a withdrawn note would be an
// unexplained gap at best and a pointer at the withdrawal at worst. The body is already NULL on a
// retracted row by the projection above, so what this returns is the tombstone and never the words.
export function selectMatterNotesStatement(
  database: SqlDatabase,
  matterId: MatterId,
  options: {
    readonly cursor?: { sortKey: string; id: string };
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
    // Free text to match against the notes' CURRENT bodies. See searchConditionFor below.
    readonly search?: string;
  },
): SqlStatement {
  const conditions = [`${MATTER_NOTE_TABLE}.matter_id = ?`];
  const bindings: unknown[] = [matterId];
  const search = searchConditionFor(options.search);
  if (search !== undefined) {
    conditions.push(search.condition);
    bindings.push(...search.bindings);
  }
  if (options.cursor !== undefined) {
    conditions.push(
      `(${MATTER_NOTE_TABLE}.created_at < ? OR (${MATTER_NOTE_TABLE}.created_at = ? AND ${MATTER_NOTE_TABLE}.id < ?))`,
    );
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }
  conditions.push(options.visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`));
  bindings.push(...options.visibility.bindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${NOTE_DISPLAY_COLUMNS} FROM ${MATTER_NOTE_TABLE} ${HEAD_REVISION_JOIN} ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${MATTER_NOTE_TABLE}.created_at DESC, ${MATTER_NOTE_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

// One note's whole chain, oldest first — every body the note has ever had, each with its own author
// and instant. This is what makes an edit a correction rather than an overwrite: the prior words are
// not merely retained, they are reachable.
//
// A retracted note's chain is NOT readable through this statement. The route refuses it before
// reaching here, and the refusal is the point: retraction stops the body rendering everywhere, and a
// history read that still served every superseded body would be a way around the tombstone rather
// than an exception to it.
export function selectMatterNoteRevisionsStatement(
  database: SqlDatabase,
  noteId: MatterNoteId,
  options: { readonly limit: number; readonly visibility: VisibleMatterPredicate },
): SqlStatement {
  return database
    .prepare(
      `SELECT ${MATTER_NOTE_REVISION_TABLE}.id, ${MATTER_NOTE_REVISION_TABLE}.note_id, ` +
        `${MATTER_NOTE_REVISION_TABLE}.body, ${MATTER_NOTE_REVISION_TABLE}.author_user_id, ` +
        `${MATTER_NOTE_REVISION_TABLE}.ordinal, ${MATTER_NOTE_REVISION_TABLE}.created_at ` +
        `FROM ${MATTER_NOTE_REVISION_TABLE} ` +
        `JOIN ${MATTER_NOTE_TABLE} ON ${MATTER_NOTE_TABLE}.id = ${MATTER_NOTE_REVISION_TABLE}.note_id ` +
        `WHERE ${MATTER_NOTE_REVISION_TABLE}.note_id = ? ` +
        `AND ${MATTER_NOTE_TABLE}.state = 'active' AND ` +
        options.visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`) +
        ` ORDER BY ${MATTER_NOTE_REVISION_TABLE}.ordinal ASC LIMIT ?`,
    )
    .bind(noteId, ...options.visibility.bindings, options.limit);
}

// Over-reads by ONE to learn whether the chain continues past the cap, and reports that as a
// boolean rather than a count. A read that returned a bare array would be indistinguishable from a
// complete history, and "we stopped at a hundred" and "there are a hundred" are different facts
// about a record somebody may be relying on. Over-reading by one learns the bound BIT and never by
// how much, and a magnitude invented here would be the same dishonesty one level down — the shape
// readOpenDeadlineTimeZones already uses in packages/calendar.
export async function readMatterNoteRevisions(
  database: SqlDatabase,
  noteId: MatterNoteId,
  options: { readonly limit: number; readonly visibility: VisibleMatterPredicate },
): Promise<{ revisions: readonly MatterNoteRevisionRow[]; capped: boolean }> {
  const { results } = await selectMatterNoteRevisionsStatement(database, noteId, {
    ...options,
    limit: options.limit + 1,
  }).all<MatterNoteRevisionRow>();
  const capped = results.length > options.limit;
  return { revisions: capped ? results.slice(0, options.limit) : results, capped };
}
