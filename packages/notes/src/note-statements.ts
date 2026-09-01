import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  FileId,
  MatterId,
  MatterNoteDocumentId,
  MatterNoteId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { NoteOccurrence } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_NOTE_TABLE = "matter_note";
export const MATTER_NOTE_DOCUMENT_TABLE = "matter_note_document";

// Every read in this module composes the visible-matter predicate, and it is a REQUIRED argument on
// each one rather than an option with a default. A note is the most privileged free-text record this
// platform holds, and an id-addressed read that skipped the predicate is exactly the read an
// information-barrier overlay would later be built past.

export interface MatterNoteRow {
  readonly id: MatterNoteId;
  readonly matter_id: MatterId;
  readonly author_user_id: UserId;
  readonly body: string;
  readonly last_edited_by: UserId | null;
  readonly occurred_on: string | null;
  readonly occurred_at_time: string | null;
  readonly time_zone: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MatterNoteDocumentRow {
  readonly id: MatterNoteDocumentId;
  readonly note_id: MatterNoteId;
  readonly file_id: FileId;
  readonly linked_at: string;
  readonly linked_by: UserId | null;
  // Resolved by the read from the matter's own file record, so a surface names a document the way
  // the File Manager names it rather than keeping a second copy of the name that could drift.
  readonly file_name: string;
  readonly content_type: string | null;
}

const NOTE_COLUMNS =
  `${MATTER_NOTE_TABLE}.id, ${MATTER_NOTE_TABLE}.matter_id, ${MATTER_NOTE_TABLE}.author_user_id, ` +
  `${MATTER_NOTE_TABLE}.body, ${MATTER_NOTE_TABLE}.last_edited_by, ${MATTER_NOTE_TABLE}.occurred_on, ` +
  `${MATTER_NOTE_TABLE}.occurred_at_time, ${MATTER_NOTE_TABLE}.time_zone, ` +
  `${MATTER_NOTE_TABLE}.created_at, ${MATTER_NOTE_TABLE}.updated_at`;

export interface InsertMatterNoteInput {
  readonly id: MatterNoteId;
  readonly matterId: MatterId;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly occurrence: NoteOccurrence;
  readonly now: string;
}

export function insertMatterNoteStatement(
  database: SqlDatabase,
  input: InsertMatterNoteInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_NOTE_TABLE} (id, matter_id, author_user_id, body, last_edited_by, ` +
        `occurred_on, occurred_at_time, time_zone, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.authorUserId,
      input.body,
      input.occurrence.occurredOn,
      input.occurrence.occurredAtTime,
      input.occurrence.timeZone,
      input.now,
    );
}

// Editing a note. The words are replaced, `updated_at` moves, and `last_edited_by` records who
// changed them — which is not always the author, and is the one fact an edit-in-place model can
// still cheaply keep.
export function updateMatterNoteStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterNoteId;
    readonly body: string;
    readonly occurrence: NoteOccurrence;
    readonly editedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_NOTE_TABLE} SET body = ?1, occurred_on = ?2, occurred_at_time = ?3, ` +
        `time_zone = ?4, last_edited_by = ?5, updated_at = ?6 WHERE id = ?7`,
    )
    .bind(
      input.body,
      input.occurrence.occurredOn,
      input.occurrence.occurredAtTime,
      input.occurrence.timeZone,
      input.editedBy,
      input.now,
      input.id,
    );
}

// Deleting a note, and it really is a delete: the row goes and its words go with it.
//
// The links go first because they reference it. They are the association and never the document, so
// removing them leaves every attached file exactly where it lives in the matter's file record — a
// note's deletion has never been a way to delete a document, and this is where that is true rather
// than merely intended.
export function deleteMatterNoteDocumentsStatement(
  database: SqlDatabase,
  noteId: MatterNoteId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_NOTE_DOCUMENT_TABLE} WHERE note_id = ?1`)
    .bind(noteId);
}

export function deleteMatterNoteStatement(
  database: SqlDatabase,
  noteId: MatterNoteId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_NOTE_TABLE} WHERE id = ?1`).bind(noteId);
}

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

// Finding a note again on this matter, matched against its text.
//
// The match is a LIKE scan rather than an index, and that is a bounded cost rather than an unmeasured
// one: the matter predicate narrows to one case's notes before the scan runs. A firm-wide note search
// is a different question with a different answer, and it is not built here.
function searchConditionFor(
  search: string | undefined,
): { condition: string; bindings: readonly unknown[] } | undefined {
  const term = search?.trim();
  if (term === undefined || term.length === 0) return undefined;
  // The wildcards are the caller's text, not their instruction: a note about a 50% fee split must
  // not turn every following character into a match-anything.
  const escaped = term.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return {
    condition: `${MATTER_NOTE_TABLE}.body LIKE ? ESCAPE '\\'`,
    bindings: [`%${escaped}%`],
  };
}

// The matter's note list, newest first.
//
// ORDERED BY WHEN THE THING HAPPENED, falling back to the day the note was written. A note recording
// Tuesday's call belongs beside Tuesday's hearing, not beside the Thursday it was typed — which is
// how every other record of something that happened is ordered here, and the one source that orders
// by write time instead (the audit log) has that called out as its weakness in
// packages/calendar/src/sources/all.ts. The written instant is the tiebreaker within a day, so two
// notes about the same day read in the order they were recorded.
const ORDERING_DATE = `COALESCE(${MATTER_NOTE_TABLE}.occurred_on, substr(${MATTER_NOTE_TABLE}.created_at, 1, 10))`;

export function selectMatterNotesStatement(
  database: SqlDatabase,
  matterId: MatterId,
  options: {
    readonly cursor?: { sortKey: string; id: string };
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
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
      `(${ORDERING_DATE} < ? OR (${ORDERING_DATE} = ? AND ${MATTER_NOTE_TABLE}.id < ?))`,
    );
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }
  conditions.push(options.visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`));
  bindings.push(...options.visibility.bindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${NOTE_COLUMNS}, ${ORDERING_DATE} AS ordering_date FROM ${MATTER_NOTE_TABLE} ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${ORDERING_DATE} DESC, ${MATTER_NOTE_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

// ---- the files a note points at ----

export function insertMatterNoteDocumentStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterNoteDocumentId;
    readonly noteId: MatterNoteId;
    readonly fileId: FileId;
    readonly linkedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_NOTE_DOCUMENT_TABLE} (id, note_id, file_id, linked_at, linked_by) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.id, input.noteId, input.fileId, input.now, input.linkedBy);
}

// Detaching. The association goes; the document does not. This statement names the link's own id
// rather than the pair, so a caller cannot express "remove whatever links these two" and accidentally
// remove a row somebody else created in the same instant.
export function deleteMatterNoteDocumentStatement(
  database: SqlDatabase,
  id: MatterNoteDocumentId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_NOTE_DOCUMENT_TABLE} WHERE id = ?1`).bind(id);
}

// The files on one note, joined to the matter's file record for the name a person reads. Soft-deleted
// files are excluded: a document the firm deleted is not on the note's list either, and the link row
// staying behind is what lets it come back if the deletion is undone.
export function selectMatterNoteDocumentsStatement(
  database: SqlDatabase,
  noteIds: readonly MatterNoteId[],
  visibility: VisibleMatterPredicate,
): SqlStatement {
  const placeholders = noteIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT ${MATTER_NOTE_DOCUMENT_TABLE}.id, ${MATTER_NOTE_DOCUMENT_TABLE}.note_id, ` +
        `${MATTER_NOTE_DOCUMENT_TABLE}.file_id, ${MATTER_NOTE_DOCUMENT_TABLE}.linked_at, ` +
        `${MATTER_NOTE_DOCUMENT_TABLE}.linked_by, file.name AS file_name, ` +
        // The media type lives on the file's CURRENT version, not on the file, and the sniffed type
        // wins over the declared one: what a file says it is was typed by whoever uploaded it, and
        // what it was read to be came from the file-type verifier.
        `COALESCE(current_version.sniffed_content_type, current_version.declared_content_type) AS content_type ` +
        `FROM ${MATTER_NOTE_DOCUMENT_TABLE} ` +
        `JOIN file ON file.id = ${MATTER_NOTE_DOCUMENT_TABLE}.file_id ` +
        `LEFT JOIN file_version AS current_version ON current_version.id = file.current_version_id ` +
        `JOIN ${MATTER_NOTE_TABLE} ON ${MATTER_NOTE_TABLE}.id = ${MATTER_NOTE_DOCUMENT_TABLE}.note_id ` +
        `WHERE ${MATTER_NOTE_DOCUMENT_TABLE}.note_id IN (${placeholders}) ` +
        `AND file.deleted_at IS NULL AND ` +
        visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`) +
        ` ORDER BY ${MATTER_NOTE_DOCUMENT_TABLE}.linked_at ASC, ${MATTER_NOTE_DOCUMENT_TABLE}.id ASC`,
    )
    .bind(...noteIds, ...visibility.bindings);
}

export async function readMatterNoteDocuments(
  database: SqlDatabase,
  noteIds: readonly MatterNoteId[],
  visibility: VisibleMatterPredicate,
): Promise<readonly MatterNoteDocumentRow[]> {
  if (noteIds.length === 0) return [];
  const { results } = await selectMatterNoteDocumentsStatement(
    database,
    noteIds,
    visibility,
  ).all<MatterNoteDocumentRow>();
  return results;
}

// One link, addressed by its own id, for the detach path's precondition read.
export async function readMatterNoteDocument(
  database: SqlDatabase,
  id: MatterNoteDocumentId,
  visibility: VisibleMatterPredicate,
): Promise<{ id: MatterNoteDocumentId; note_id: MatterNoteId } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MATTER_NOTE_DOCUMENT_TABLE}.id, ${MATTER_NOTE_DOCUMENT_TABLE}.note_id ` +
        `FROM ${MATTER_NOTE_DOCUMENT_TABLE} ` +
        `JOIN ${MATTER_NOTE_TABLE} ON ${MATTER_NOTE_TABLE}.id = ${MATTER_NOTE_DOCUMENT_TABLE}.note_id ` +
        `WHERE ${MATTER_NOTE_DOCUMENT_TABLE}.id = ? AND ` +
        visibility.fragmentFor(`${MATTER_NOTE_TABLE}.matter_id`),
    )
    .bind(id, ...visibility.bindings)
    .all<{ id: MatterNoteDocumentId; note_id: MatterNoteId }>();
  return results[0];
}

// Is this file a live file on this matter? The link path's one precondition, and the reason a note
// cannot point at another matter's document: a link across matters would be a disclosure wearing an
// association, and the check is in SQL rather than in the caller's head.
export async function fileIsOnMatter(
  database: SqlDatabase,
  fileId: FileId,
  matterId: MatterId,
): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM file WHERE id = ? AND matter_id = ? AND deleted_at IS NULL`)
    .bind(fileId, matterId)
    .all<{ present: number }>();
  return results.length > 0;
}

export async function countMatterNoteDocuments(
  database: SqlDatabase,
  noteId: MatterNoteId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${MATTER_NOTE_DOCUMENT_TABLE} WHERE note_id = ?`)
    .bind(noteId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}
