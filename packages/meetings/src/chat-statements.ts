import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FileId,
  MeetingAttendanceId,
  MeetingGuestStayId,
  MeetingId,
  MeetingMessageId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MEETING_ATTENDANCE_TABLE } from "./meeting-statements.ts";
import type { MeetingMessageEntry, MeetingParticipantKind } from "./chat-types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_MESSAGE_TABLE = "meeting_message";

// THE GATE IS THE MEETING'S, AND IT IS ASKED ONE LEVEL UP. Every read here is addressed to a meeting
// the caller has ALREADY been resolved to through `readMeeting` or `readMeetingSummary`, which is
// where the visible-matter predicate is composed — a chat has no visibility rule of its own any more
// than a room does, and a second expression of the walled-matter question is a second place for it
// to be wrong. That is the shape `listAttendance` already has for the same reason, and it is why
// nothing in this module takes a predicate: a statement that took one would invite a caller to reach
// a transcript without first reaching its meeting.

// The member behind the stay, resolved through the join rather than stored beside the message. A
// second copy of who spoke would be a second answer, and the two disagree the first time one of them
// is corrected.
const MESSAGE_COLUMNS =
  `${MEETING_MESSAGE_TABLE}.id, ${MEETING_MESSAGE_TABLE}.meeting_id, ` +
  `${MEETING_MESSAGE_TABLE}.participant_kind, ${MEETING_MESSAGE_TABLE}.participant_id, ` +
  `${MEETING_MESSAGE_TABLE}.sent_at, ` +
  `${MEETING_MESSAGE_TABLE}.body, ${MEETING_MESSAGE_TABLE}.redacted_at, ` +
  `${MEETING_MESSAGE_TABLE}.redacted_by_user_id, ${MEETING_ATTENDANCE_TABLE}.user_id AS user_id, ` +
  // The shared file, by its handle and its name now. Withheld once the message is taken back or
  // the file is deleted: a removed line shows nothing it carried.
  `CASE WHEN ${MEETING_MESSAGE_TABLE}.redacted_at IS NULL AND attached_file.deleted_at IS NULL ` +
  `THEN attached_file.id END AS attached_file_id, ` +
  `CASE WHEN ${MEETING_MESSAGE_TABLE}.redacted_at IS NULL AND attached_file.deleted_at IS NULL ` +
  `THEN attached_file.name END AS attached_file_name`;

// A LEFT join, and matched on the KIND as well as the handle. The stay a message was said from is a
// member's attendance row or a guest's own row, and the member table can only answer for the first:
// an inner join would silently drop every guest's message from the transcript, and a join that
// ignored the kind would match a guest handle that happened to collide with an attendance id. A
// guest row therefore contributes a null `user_id`, which is the truth — there is no firm member
// behind it.
const ATTENDANCE_JOIN =
  `LEFT JOIN ${MEETING_ATTENDANCE_TABLE} ` +
  `ON ${MEETING_MESSAGE_TABLE}.participant_kind = 'member' ` +
  `AND ${MEETING_ATTENDANCE_TABLE}.id = ${MEETING_MESSAGE_TABLE}.participant_id ` +
  `LEFT JOIN file AS attached_file ON attached_file.id = ${MEETING_MESSAGE_TABLE}.attached_file_id`;

interface MessageColumns {
  readonly id: MeetingMessageId;
  readonly meeting_id: MeetingId;
  readonly participant_kind: MeetingParticipantKind;
  readonly participant_id: string;
  readonly user_id: UserId | null;
  readonly sent_at: string;
  readonly body: string;
  readonly redacted_at: string | null;
  readonly redacted_by_user_id: UserId | null;
  readonly attached_file_id: FileId | null;
  readonly attached_file_name: string | null;
}

function toEntry(row: MessageColumns): MeetingMessageEntry {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    participantKind: row.participant_kind,
    participantId: row.participant_id,
    userId: row.user_id,
    sentAt: row.sent_at,
    body: row.body,
    redactedAt: row.redacted_at,
    redactedByUserId: row.redacted_by_user_id,
    attachedFile:
      row.attached_file_id === null || row.attached_file_name === null
        ? null
        : { id: row.attached_file_id, name: row.attached_file_name },
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

// One binding and the clause that reads it, pushed together — so the clause a caller composes and
// the binding it consumes cannot end up in different branches of the same expression. `keysetClause`
// has exactly this shape for its three, and the two are read side by side below.
function pushed(bindings: unknown[], binding: unknown, clause: string): string {
  bindings.push(binding);
  return clause;
}

/**
 * One meeting's transcript, OLDEST FIRST — because a conversation is read forwards. The first page
 * is the beginning of the meeting rather than the end of it, which is the same choice the attendance
 * record makes and for the same reason.
 *
 * `since` is what a POLLER holds, and it is a KEYSET rather than a watermark: the instant it last
 * read to AND the handle of the row it read there. An instant alone is not a position in this list —
 * two messages can carry the same millisecond, and a strict `sent_at > ?` then drops the second of
 * them for that poller FOREVER, because the next tick asks from a later instant still. So `sinceId`
 * rides beside `since` and the pair becomes the same `(sent_at, id)` comparison `cursor` makes; a
 * `since` with no `sinceId` keeps the old strict-instant shape, which is what a caller minted
 * against an older build still sends. `cursor` is what WALKS a long transcript, and both ride the
 * same key, so a poll and a walk cannot end up disagreeing about where they are.
 *
 * `limit` is what the caller will SHOW; this asks for one row more, and the extra row is the answer
 * to "is there another page" without a second count.
 *
 * A REDACTED MESSAGE IS STILL RETURNED, with an empty body and the pair that says who removed it and
 * when. Dropping the row would make the transcript read as though nothing had ever been there, which
 * is precisely the fact the record is keeping.
 */
export async function listMeetingMessages(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: {
    readonly cursor?: SortCursor;
    readonly limit: number;
    /** An instant: where the poller read to. What it sends on its next tick, with `sinceId`. */
    readonly since?: string;
    /** The handle of the row at that instant, which is what makes the continuation exact. */
    readonly sinceId?: string;
  },
): Promise<readonly MeetingMessageEntry[]> {
  const bindings: unknown[] = [meetingId];
  // The same keyset comparison the cursor makes, so a poller that carries both halves of its
  // position cannot lose a message to a tie. Without the handle there is nothing to break the tie
  // with, and the strict instant is the honest fallback — it can only re-read, never skip, once the
  // caller starts sending the pair.
  const sinceClause =
    options.since === undefined
      ? ""
      : options.sinceId === undefined
        ? pushed(bindings, options.since, `AND ${MEETING_MESSAGE_TABLE}.sent_at > ? `)
        : keysetClause(
            bindings,
            { createdAt: options.since, id: options.sinceId },
            `${MEETING_MESSAGE_TABLE}.sent_at`,
            `${MEETING_MESSAGE_TABLE}.id`,
            true,
          );
  const keyset = keysetClause(
    bindings,
    options.cursor,
    `${MEETING_MESSAGE_TABLE}.sent_at`,
    `${MEETING_MESSAGE_TABLE}.id`,
    true,
  );
  const { results } = await database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM ${MEETING_MESSAGE_TABLE} ${ATTENDANCE_JOIN} ` +
        `WHERE ${MEETING_MESSAGE_TABLE}.meeting_id = ? ${sinceClause}${keyset}` +
        `ORDER BY ${MEETING_MESSAGE_TABLE}.sent_at ASC, ${MEETING_MESSAGE_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MessageColumns>();
  return results.map(toEntry);
}

/**
 * THE MESSAGES TAKEN BACK SINCE A READER GOT HERE — the half a forward-only walk cannot see.
 *
 * A transcript is read forwards and a poller continues from the last `(sent_at, id)` it saw, which
 * is right for what is SAID and blind to what is UNSAID: a redaction moves no row's position in that
 * ordering, so a message already handed to a browser is taken back where nothing the poller asks for
 * will ever mention it again. The relay frame closes that for a browser with a socket open; this
 * closes it for the one that reconnected, was asleep, or missed the frame — which is the case the
 * relay explicitly does not cover, because the read is what a browser is caught up by.
 *
 * Keyed on `redacted_at` rather than on the message's own position, which is the whole point: the
 * rows this returns are BEHIND the caller's cursor by construction. It is bounded like any other
 * read — a meeting whose whole transcript was redacted at once is a real shape — and the bound is
 * safe to truncate against, because the next poll asks the same question and a reader that already
 * blanked a row blanks it again to no effect.
 *
 * Only the handle and the instant come back. The body is already empty on the row, and sending a
 * whole record to say a body is gone would carry an empty string to say what two fields say.
 */
export async function listMeetingMessagesRedactedSince(
  database: SqlDatabase,
  meetingId: MeetingId,
  since: string,
  limit: number,
): Promise<readonly { readonly id: MeetingMessageId; readonly redactedAt: string }[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_MESSAGE_TABLE}.id, ${MEETING_MESSAGE_TABLE}.redacted_at ` +
        `FROM ${MEETING_MESSAGE_TABLE} ` +
        `WHERE ${MEETING_MESSAGE_TABLE}.meeting_id = ? ` +
        `AND ${MEETING_MESSAGE_TABLE}.redacted_at IS NOT NULL ` +
        `AND ${MEETING_MESSAGE_TABLE}.redacted_at > ? ` +
        `ORDER BY ${MEETING_MESSAGE_TABLE}.redacted_at ASC, ${MEETING_MESSAGE_TABLE}.id ASC ` +
        `LIMIT ?`,
    )
    .bind(meetingId, since, limit)
    .all<{ readonly id: MeetingMessageId; readonly redacted_at: string }>();
  return results.map((row) => ({ id: row.id, redactedAt: row.redacted_at }));
}

/**
 * One message, addressed by its own handle AND by the meeting it belongs to.
 *
 * Both, deliberately: the caller was authorized against a meeting, so a message handle from another
 * meeting must be as absent as one that names nothing. Without the second column a member could
 * redact a message in a room they were never resolved to by guessing its id.
 */
export async function readMeetingMessage(
  database: SqlDatabase,
  meetingId: MeetingId,
  messageId: MeetingMessageId,
): Promise<MeetingMessageEntry | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM ${MEETING_MESSAGE_TABLE} ${ATTENDANCE_JOIN} ` +
        `WHERE ${MEETING_MESSAGE_TABLE}.id = ? AND ${MEETING_MESSAGE_TABLE}.meeting_id = ?`,
    )
    .bind(messageId, meetingId)
    .all<MessageColumns>();
  const row = results[0];
  return row === undefined ? undefined : toEntry(row);
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertMeetingMessageInput {
  readonly id: MeetingMessageId;
  readonly meetingId: MeetingId;
  /** The member's stay. A guest's line is written by its own statement — see below. */
  readonly attendanceId: MeetingAttendanceId;
  readonly body: string;
  readonly now: string;
  /** One of the meeting's matter's files, shared with the line. */
  readonly attachedFileId?: FileId | null;
}

// SAYING SOMETHING. An insert and nothing else: there is no update path for a body anywhere in this
// package, because a message that could be rewritten afterwards is not a record of what was said.
//
// `participant_kind` is the LITERAL 'member' rather than a parameter, on the call and text log's
// reasoning for writing its own producer as a literal: a shared insert that took the kind as an
// argument is how a row eventually claims to be a guest's when it is a member's. The guest path
// writes its own statement against the same table and the same columns — see
// `insertGuestMeetingMessageStatement` below.
//
// `sent_at` and `created_at` are the same instant and are both stored, which looks redundant and is
// not: `sent_at` is the fact the transcript is ordered by and the thing a reader is told, while
// `created_at` is the row's own provenance. They can only ever coincide here — the server stamps one
// instant — but a later path that backfills a message from somewhere else would have a place to put
// each, and a column added then would be a column every old row is null for.
export function insertMeetingMessageStatement(
  database: SqlDatabase,
  input: InsertMeetingMessageInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_MESSAGE_TABLE} (id, meeting_id, participant_kind, participant_id, ` +
        `sent_at, body, redacted_at, redacted_by_user_id, created_at, attached_file_id) ` +
        `VALUES (?1, ?2, 'member', ?3, ?4, ?5, NULL, NULL, ?4, ?6)`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.attendanceId,
      input.now,
      input.body,
      input.attachedFileId ?? null,
    );
}

// SAID FROM A GUEST'S STAY. The member statement's twin, with the kind a literal for the same reason
// that one's is: the table a handle belongs to is decided by the statement that writes it, never by an
// argument a caller could get wrong. The line hangs from the stay exactly as a member's does, and the
// Directory entity behind it is reached through the stay's invitation rather than copied here.
export function insertGuestMeetingMessageStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingMessageId;
    readonly meetingId: MeetingId;
    readonly stayId: MeetingGuestStayId;
    readonly body: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_MESSAGE_TABLE} (id, meeting_id, participant_kind, participant_id, ` +
        `sent_at, body, redacted_at, redacted_by_user_id, created_at) ` +
        `VALUES (?1, ?2, 'guest', ?3, ?4, ?5, NULL, NULL, ?4)`,
    )
    .bind(input.id, input.meetingId, input.stayId, input.now, input.body);
}

// TAKING IT BACK, which is not a delete. The body is blanked and the row stays, so the file keeps
// that a message existed, when, from which stay, and that somebody removed it — a transcript with a
// silent hole in it is a transcript nobody can rely on.
//
// `redacted_at IS NULL` in the WHERE is the precondition the caller read, and it is what makes a
// second redaction a no-op rather than a rewrite: the instant and the actor already on the row are
// in somebody's record of what happened. The caller guards this statement, so a batch that matches
// nothing rolls back whole rather than writing an audit row for a redaction that did not happen.
export function redactMeetingMessageStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingMessageId;
    readonly redactedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_MESSAGE_TABLE} SET body = '', redacted_at = ?1, ` +
        `redacted_by_user_id = ?2 WHERE id = ?3 AND redacted_at IS NULL`,
    )
    .bind(input.now, input.redactedByUserId, input.id);
}

/**
 * A file this meeting may share in its chat: one of the files of the matter the meeting's event is on,
 * not deleted. Undefined for a meeting on a firm event, which has no matter and so no files to share,
 * and for any file that is not the matter's.
 */
export async function readShareableMeetingFile(
  database: SqlDatabase,
  meetingId: MeetingId,
  fileId: FileId,
): Promise<{ readonly id: FileId; readonly name: string } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT file.id AS id, file.name AS name FROM meeting ` +
        `JOIN matter_event ON matter_event.id = meeting.matter_event_id ` +
        `JOIN file ON file.matter_id = matter_event.matter_id ` +
        `WHERE meeting.id = ?1 AND meeting.event_kind = 'matter' AND file.id = ?2 ` +
        `AND file.deleted_at IS NULL`,
    )
    .bind(meetingId, fileId)
    .all<{ id: FileId; name: string }>();
  return results[0];
}
