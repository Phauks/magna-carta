import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MeetingAttendanceId,
  MeetingId,
  MeetingQuestionId,
  MeetingQuestionUpvoteId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MEETING_ATTENDANCE_TABLE } from "./meeting-statements.ts";
import { MAX_MEETING_QUESTIONS, type MeetingQuestionEntry } from "./question-types.ts";
import type { MeetingContributorKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_QUESTION_TABLE = "meeting_question";
export const MEETING_QUESTION_UPVOTE_TABLE = "meeting_question_upvote";

// THE GATE IS THE MEETING'S, AND IT IS ASKED ONE LEVEL UP, as it is for the chat transcript: every
// read here is addressed to a meeting the caller has already been resolved to through `readMeeting`.

// The upvotes are COUNTED on every read, over the upvote table's unique index — whose leading column
// is the question — so the count is an index range rather than a scan, and there is no stored number
// to disagree with the rows once somebody withdraws.
const UPVOTE_COUNT =
  `(SELECT COUNT(*) FROM ${MEETING_QUESTION_UPVOTE_TABLE} ` +
  `WHERE ${MEETING_QUESTION_UPVOTE_TABLE}.question_id = ${MEETING_QUESTION_TABLE}.id) AS upvotes`;

const QUESTION_COLUMNS =
  `${MEETING_QUESTION_TABLE}.id, ${MEETING_QUESTION_TABLE}.meeting_id, ` +
  `${MEETING_QUESTION_TABLE}.participant_kind, ${MEETING_QUESTION_TABLE}.participant_id, ` +
  `${MEETING_QUESTION_TABLE}.body, ${MEETING_QUESTION_TABLE}.asked_at, ` +
  `${MEETING_QUESTION_TABLE}.answered_at, ${MEETING_QUESTION_TABLE}.answered_by_user_id, ` +
  `${MEETING_QUESTION_TABLE}.redacted_at, ${MEETING_QUESTION_TABLE}.redacted_by_user_id, ` +
  `${MEETING_ATTENDANCE_TABLE}.user_id AS user_id, ${UPVOTE_COUNT}`;

// A LEFT join matched on the KIND as well as the handle — the chat transcript's join, for its
// reasons: a guest's stay has no member behind it, and an inner join would drop every guest's
// question from the queue.
const ATTENDANCE_JOIN =
  `LEFT JOIN ${MEETING_ATTENDANCE_TABLE} ` +
  `ON ${MEETING_QUESTION_TABLE}.participant_kind = 'member' ` +
  `AND ${MEETING_ATTENDANCE_TABLE}.id = ${MEETING_QUESTION_TABLE}.participant_id`;

interface QuestionColumns {
  readonly id: MeetingQuestionId;
  readonly meeting_id: MeetingId;
  readonly participant_kind: MeetingContributorKind;
  readonly participant_id: string;
  readonly body: string;
  readonly asked_at: string;
  readonly answered_at: string | null;
  readonly answered_by_user_id: UserId | null;
  readonly redacted_at: string | null;
  readonly redacted_by_user_id: UserId | null;
  readonly user_id: UserId | null;
  readonly upvotes: number;
}

/** A question read from the record, before the caller's own upvote is known. */
export type MeetingQuestionRecord = Omit<MeetingQuestionEntry, "upvotedByCaller">;

function toRecord(row: QuestionColumns): MeetingQuestionRecord {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    participantKind: row.participant_kind,
    participantId: row.participant_id,
    userId: row.user_id,
    body: row.body,
    askedAt: row.asked_at,
    answeredAt: row.answered_at,
    answeredByUserId: row.answered_by_user_id,
    redactedAt: row.redacted_at,
    redactedByUserId: row.redacted_by_user_id,
    upvotes: row.upvotes,
  };
}

// One positional binding per value, for an `IN (…)` over a page of handles.
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// One binding and the clause that reads it, pushed together — the chat transcript's helper.
function pushed(bindings: unknown[], binding: unknown, clause: string): string {
  bindings.push(binding);
  return clause;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * One meeting's questions, OLDEST FIRST, keyed on `(asked_at, id)`.
 *
 * THE ONE SHAPE HERE THAT LOOKS WRONG AND IS NOT. The panel shows the most upvoted first, so the
 * obvious read orders by count — but a cursor walking a value that changes while the reader pages
 * repeats rows and skips rows, and an upvote count in a live meeting changes constantly. So the
 * keyset is the record's own stable key, and the browser holds the page and sorts it; the ceiling
 * on a queue is what makes that honest.
 *
 * `since` with `sinceId` is what a poller holds, on the chat transcript's own terms: a position in
 * the same `(asked_at, id)` ordering the cursor walks, so a poll and a walk cannot disagree about
 * where they are. `since` alone keeps the strict-instant comparison, which can re-read but never skip.
 */
export async function listMeetingQuestions(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: {
    readonly cursor?: SortCursor;
    readonly limit: number;
    readonly since?: string;
    readonly sinceId?: string;
  },
): Promise<readonly MeetingQuestionRecord[]> {
  const bindings: unknown[] = [meetingId];
  const sinceClause =
    options.since === undefined
      ? ""
      : options.sinceId === undefined
        ? pushed(bindings, options.since, `AND ${MEETING_QUESTION_TABLE}.asked_at > ? `)
        : keysetClause(
            bindings,
            { createdAt: options.since, id: options.sinceId },
            `${MEETING_QUESTION_TABLE}.asked_at`,
            `${MEETING_QUESTION_TABLE}.id`,
            true,
          );
  const keyset = keysetClause(
    bindings,
    options.cursor,
    `${MEETING_QUESTION_TABLE}.asked_at`,
    `${MEETING_QUESTION_TABLE}.id`,
    true,
  );
  const { results } = await database
    .prepare(
      `SELECT ${QUESTION_COLUMNS} FROM ${MEETING_QUESTION_TABLE} ${ATTENDANCE_JOIN} ` +
        `WHERE ${MEETING_QUESTION_TABLE}.meeting_id = ? ${sinceClause}${keyset}` +
        `ORDER BY ${MEETING_QUESTION_TABLE}.asked_at ASC, ${MEETING_QUESTION_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<QuestionColumns>();
  return results.map(toRecord);
}

/**
 * One question, addressed by its own handle AND by its meeting — so a question in a room the caller
 * was never resolved to is as absent as one that names nothing.
 */
export async function readMeetingQuestion(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
): Promise<MeetingQuestionRecord | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${QUESTION_COLUMNS} FROM ${MEETING_QUESTION_TABLE} ${ATTENDANCE_JOIN} ` +
        `WHERE ${MEETING_QUESTION_TABLE}.id = ? AND ${MEETING_QUESTION_TABLE}.meeting_id = ?`,
    )
    .bind(questionId, meetingId)
    .all<QuestionColumns>();
  const row = results[0];
  return row === undefined ? undefined : toRecord(row);
}

/**
 * WHICH OF THESE QUESTIONS THE MEMBER HAS UPVOTED, from any of their stays in this meeting — asked of
 * the member rather than of one stay, because the guard on upvoting is too.
 */
export async function readQuestionsUpvotedByMember(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
  questionIds: readonly MeetingQuestionId[],
): Promise<ReadonlySet<MeetingQuestionId>> {
  if (questionIds.length === 0) return new Set();
  const { results } = await database
    .prepare(
      `SELECT DISTINCT ${MEETING_QUESTION_UPVOTE_TABLE}.question_id ` +
        `FROM ${MEETING_QUESTION_UPVOTE_TABLE} ` +
        `WHERE ${MEETING_QUESTION_UPVOTE_TABLE}.question_id IN (${placeholders(questionIds.length)}) ` +
        `AND ${MEETING_QUESTION_UPVOTE_TABLE}.participant_kind = 'member' ` +
        `AND ${MEETING_QUESTION_UPVOTE_TABLE}.participant_id IN (` +
        `SELECT id FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ? AND user_id = ?)`,
    )
    .bind(...questionIds, meetingId, userId)
    .all<{ readonly question_id: MeetingQuestionId }>();
  return new Set(results.map((row) => row.question_id));
}

/**
 * How many questions a meeting's queue holds, redacted ones included — a taken-back question is still
 * a row, and the ceiling bounds rows. This read produces the REASON a member is given; the insert's
 * own WHERE is what holds the limit.
 */
export async function countMeetingQuestions(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${MEETING_QUESTION_TABLE} WHERE meeting_id = ?`)
    .bind(meetingId)
    .all<{ readonly count: number }>();
  return results[0]?.count ?? 0;
}

/** One stay upvoted one question twice at the same instant, and the second met the unique index. */
export function isQuestionUpvoteConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_QUESTION_UPVOTE_TABLE}.question_id`)
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

// ASKING THE ROOM, from a member's stay. An insert and nothing else — there is no update path for a
// body — and it carries the queue's ceiling in its own WHERE, because two questions arriving together
// at four hundred and ninety-nine would each read a count below it. The caller guards it, so a batch
// past the ceiling rolls back whole rather than writing an audit row for a question that is not
// there. `participant_kind` is the literal 'member', on the chat's reasoning; `breakout_id` is null,
// because every question today is asked of the main room.
export function insertMemberQuestionStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingQuestionId;
    readonly meetingId: MeetingId;
    readonly attendanceId: MeetingAttendanceId;
    readonly body: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_QUESTION_TABLE} (id, meeting_id, participant_kind, participant_id, body, ` +
        `asked_at, answered_at, answered_by_user_id, redacted_at, redacted_by_user_id, breakout_id, ` +
        `created_at) SELECT ?1, ?2, 'member', ?3, ?4, ?5, NULL, NULL, NULL, NULL, NULL, ?5 ` +
        `WHERE (SELECT COUNT(*) FROM ${MEETING_QUESTION_TABLE} WHERE meeting_id = ?2) < ?6`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.attendanceId,
      input.body,
      input.now,
      MAX_MEETING_QUESTIONS,
    );
}

// ONE STAY'S VOTE, from a member's stay — carrying, in its own WHERE, that this member has not
// upvoted the question from ANY stay. The unique index holds one per stay; this holds one per member,
// so leaving and rejoining is not a second vote. A zero here means the member's own earlier upvote
// landed first, which is exactly the state they asked for — the caller guards it and reads that
// refusal as a success.
export function insertMemberUpvoteStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingQuestionUpvoteId;
    readonly questionId: MeetingQuestionId;
    readonly meetingId: MeetingId;
    readonly attendanceId: MeetingAttendanceId;
    readonly userId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_QUESTION_UPVOTE_TABLE} (id, question_id, participant_kind, ` +
        `participant_id, upvoted_at) SELECT ?1, ?2, 'member', ?3, ?4 ` +
        `WHERE NOT EXISTS (SELECT 1 FROM ${MEETING_QUESTION_UPVOTE_TABLE} AS earlier ` +
        `JOIN ${MEETING_ATTENDANCE_TABLE} ON earlier.participant_kind = 'member' ` +
        `AND ${MEETING_ATTENDANCE_TABLE}.id = earlier.participant_id ` +
        `WHERE earlier.question_id = ?2 AND ${MEETING_ATTENDANCE_TABLE}.meeting_id = ?5 ` +
        `AND ${MEETING_ATTENDANCE_TABLE}.user_id = ?6)`,
    )
    .bind(input.id, input.questionId, input.attendanceId, input.now, input.meetingId, input.userId);
}

// TAKING AN UPVOTE BACK — the member's, from whichever of their stays it was cast. A delete, because
// an upvote is a signal and not a record of something said: the count is computed over the rows, and
// the audit row is what keeps that the member withdrew it. The caller guards it; a zero is the
// member's own earlier withdrawal landing first, which the caller reads as the success it is.
export function deleteMemberUpvoteStatement(
  database: SqlDatabase,
  input: {
    readonly questionId: MeetingQuestionId;
    readonly meetingId: MeetingId;
    readonly userId: UserId;
  },
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${MEETING_QUESTION_UPVOTE_TABLE} WHERE question_id = ?1 ` +
        `AND participant_kind = 'member' AND participant_id IN (` +
        `SELECT id FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ?2 AND user_id = ?3)`,
    )
    .bind(input.questionId, input.meetingId, input.userId);
}

// MARKED ANSWERED. `answered_at IS NULL` in the WHERE is the precondition the caller read, so a second
// mark does not move the instant and the actor already on the row. The caller guards it.
export function markQuestionAnsweredStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingQuestionId;
    readonly answeredByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_QUESTION_TABLE} SET answered_at = ?1, answered_by_user_id = ?2 ` +
        `WHERE id = ?3 AND answered_at IS NULL`,
    )
    .bind(input.now, input.answeredByUserId, input.id);
}

// UNMARKED — both halves of the pair cleared together, which is what the pair's CHECK demands and
// what makes a question marked by mistake read exactly as it did before. The audit row keeps that it
// happened. The caller guards it.
export function unmarkQuestionAnsweredStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingQuestionId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_QUESTION_TABLE} SET answered_at = NULL, answered_by_user_id = NULL ` +
        `WHERE id = ?1 AND answered_at IS NOT NULL`,
    )
    .bind(input.id);
}

// TAKING A QUESTION BACK, which is not a delete — word for word the chat message's redaction. The
// body is blanked and the row stays; `redacted_at IS NULL` makes a second redaction a no-op rather
// than a rewrite. The caller guards it.
export function redactMeetingQuestionStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingQuestionId;
    readonly redactedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_QUESTION_TABLE} SET body = '', redacted_at = ?1, ` +
        `redacted_by_user_id = ?2 WHERE id = ?3 AND redacted_at IS NULL`,
    )
    .bind(input.now, input.redactedByUserId, input.id);
}
