import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MeetingAttendanceId,
  MeetingId,
  MeetingPollAnswerId,
  MeetingPollId,
  MeetingPollOptionId,
  MeetingPollRespondentId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MEETING_ATTENDANCE_TABLE } from "./meeting-statements.ts";
import type {
  MeetingPollAttributedAnswer,
  MeetingPollOptionTally,
  MeetingPollRow,
  MeetingPollTally,
} from "./poll-types.ts";
import type { MeetingContributorKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_POLL_TABLE = "meeting_poll";
export const MEETING_POLL_OPTION_TABLE = "meeting_poll_option";
export const MEETING_POLL_RESPONDENT_TABLE = "meeting_poll_respondent";
export const MEETING_POLL_ANSWER_TABLE = "meeting_poll_answer";

// THE GATE IS THE MEETING'S, AND IT IS ASKED ONE LEVEL UP — the chat statements' rule, for the chat's
// reason. Every read here is addressed to a meeting the caller has ALREADY been resolved to through
// `readMeeting`, which is where the visible-matter predicate is composed; a poll has no visibility
// rule of its own, and a statement that took a predicate would invite a caller to reach a poll
// without first reaching its meeting.

const POLL_COLUMNS = [
  "id",
  "meeting_id",
  "asked_by_user_id",
  "question",
  "anonymous",
  "max_choices",
  "opened_at",
  "closed_at",
  "closed_by_user_id",
  "breakout_id",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_POLL_TABLE}.${column}`)
  .join(", ");

// One positional binding per value, for an `IN (…)` over a page of handles. The values themselves
// are always bound — only the count of `?` is spliced.
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * One poll, addressed by its own handle AND by the meeting it belongs to — so a poll in a room the
 * caller was never resolved to is as absent as one that names nothing.
 */
export async function readMeetingPoll(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
): Promise<MeetingPollRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${POLL_COLUMNS} FROM ${MEETING_POLL_TABLE} ` +
        `WHERE ${MEETING_POLL_TABLE}.id = ? AND ${MEETING_POLL_TABLE}.meeting_id = ?`,
    )
    .bind(pollId, meetingId)
    .all<MeetingPollRow>();
  return results[0];
}

/** Every option of one poll in `position` order — what an answer is checked against. */
export async function readPollOptionIds(
  database: SqlDatabase,
  pollId: MeetingPollId,
): Promise<readonly MeetingPollOptionId[]> {
  const { results } = await database
    .prepare(
      `SELECT id FROM ${MEETING_POLL_OPTION_TABLE} WHERE poll_id = ? ORDER BY position ASC, id ASC`,
    )
    .bind(pollId)
    .all<{ readonly id: MeetingPollOptionId }>();
  return results.map((row) => row.id);
}

/**
 * One meeting's polls, NEWEST FIRST — the panel shows the most recent question on top, and a host
 * stacking two at the end of a briefing wants the second one where they are looking.
 *
 * Keyed on `(opened_at, id)`, the poll's own stable instant: nothing about a poll moves once it is
 * open, so a walk cannot skip or repeat. Asks for one row past `limit`, which is the answer to "is
 * there another page".
 */
export async function listMeetingPolls(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: { readonly cursor?: SortCursor; readonly limit: number },
): Promise<readonly MeetingPollRow[]> {
  const bindings: unknown[] = [meetingId];
  const keyset = keysetClause(
    bindings,
    options.cursor,
    `${MEETING_POLL_TABLE}.opened_at`,
    `${MEETING_POLL_TABLE}.id`,
    false,
  );
  const { results } = await database
    .prepare(
      `SELECT ${POLL_COLUMNS} FROM ${MEETING_POLL_TABLE} ` +
        `WHERE ${MEETING_POLL_TABLE}.meeting_id = ? ${keyset}` +
        `ORDER BY ${MEETING_POLL_TABLE}.opened_at DESC, ${MEETING_POLL_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MeetingPollRow>();
  return results;
}

/**
 * WHERE EACH OF THESE POLLS STANDS — every option in `position` order with how many chose it, and how
 * many took part.
 *
 * The count per option is a correlated count over the answer table's `(poll_id, option_id)` index,
 * so an option nobody chose is a row with a zero rather than a row that is missing: a reader that
 * had to put the zeroes back itself would one day show a poll with three bars instead of five.
 * Respondents are a second grouped read over the participation table, counted over PEOPLE rather
 * than answers.
 *
 * Two reads for a page of polls rather than two per poll.
 */
export async function readPollTallies(
  database: SqlDatabase,
  pollIds: readonly MeetingPollId[],
): Promise<ReadonlyMap<MeetingPollId, MeetingPollTally>> {
  const tallies = new Map<MeetingPollId, MeetingPollTally>();
  if (pollIds.length === 0) return tallies;
  const { results: optionRows } = await database
    .prepare(
      `SELECT ${MEETING_POLL_OPTION_TABLE}.poll_id, ${MEETING_POLL_OPTION_TABLE}.id, ` +
        `${MEETING_POLL_OPTION_TABLE}.position, ${MEETING_POLL_OPTION_TABLE}.label, ` +
        `(SELECT COUNT(*) FROM ${MEETING_POLL_ANSWER_TABLE} ` +
        `WHERE ${MEETING_POLL_ANSWER_TABLE}.poll_id = ${MEETING_POLL_OPTION_TABLE}.poll_id ` +
        `AND ${MEETING_POLL_ANSWER_TABLE}.option_id = ${MEETING_POLL_OPTION_TABLE}.id) AS count ` +
        `FROM ${MEETING_POLL_OPTION_TABLE} ` +
        `WHERE ${MEETING_POLL_OPTION_TABLE}.poll_id IN (${placeholders(pollIds.length)}) ` +
        `ORDER BY ${MEETING_POLL_OPTION_TABLE}.poll_id ASC, ${MEETING_POLL_OPTION_TABLE}.position ASC`,
    )
    .bind(...pollIds)
    .all<{
      readonly poll_id: MeetingPollId;
      readonly id: MeetingPollOptionId;
      readonly position: number;
      readonly label: string;
      readonly count: number;
    }>();
  const { results: respondentRows } = await database
    .prepare(
      `SELECT poll_id, COUNT(*) AS respondents FROM ${MEETING_POLL_RESPONDENT_TABLE} ` +
        `WHERE poll_id IN (${placeholders(pollIds.length)}) GROUP BY poll_id`,
    )
    .bind(...pollIds)
    .all<{ readonly poll_id: MeetingPollId; readonly respondents: number }>();

  const optionsByPoll = new Map<MeetingPollId, MeetingPollOptionTally[]>();
  for (const row of optionRows) {
    const list = optionsByPoll.get(row.poll_id) ?? [];
    list.push({ optionId: row.id, position: row.position, label: row.label, count: row.count });
    optionsByPoll.set(row.poll_id, list);
  }
  const respondentsByPoll = new Map(respondentRows.map((row) => [row.poll_id, row.respondents]));
  for (const pollId of pollIds) {
    tallies.set(pollId, {
      pollId,
      options: optionsByPoll.get(pollId) ?? [],
      respondents: respondentsByPoll.get(pollId) ?? 0,
    });
  }
  return tallies;
}

/**
 * WHICH OF THESE POLLS THE MEMBER HAS ANSWERED, from ANY of their stays in this meeting.
 *
 * Asked of the member rather than of one stay, because the guard on answering is too (see
 * `insertMemberRespondentStatement`): somebody who dropped off and dialled back in answered from the
 * earlier stay, and their card must still say so.
 */
export async function readPollsAnsweredByMember(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
  pollIds: readonly MeetingPollId[],
): Promise<ReadonlySet<MeetingPollId>> {
  if (pollIds.length === 0) return new Set();
  const { results } = await database
    .prepare(
      `SELECT DISTINCT ${MEETING_POLL_RESPONDENT_TABLE}.poll_id FROM ${MEETING_POLL_RESPONDENT_TABLE} ` +
        `WHERE ${MEETING_POLL_RESPONDENT_TABLE}.poll_id IN (${placeholders(pollIds.length)}) ` +
        `AND ${MEETING_POLL_RESPONDENT_TABLE}.participant_kind = 'member' ` +
        `AND ${MEETING_POLL_RESPONDENT_TABLE}.participant_id IN (` +
        `SELECT id FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ? AND user_id = ?)`,
    )
    .bind(...pollIds, meetingId, userId)
    .all<{ readonly poll_id: MeetingPollId }>();
  return new Set(results.map((row) => row.poll_id));
}

/**
 * WHO ANSWERED WHAT, on a poll that shows names — one page of participations, oldest first, each with
 * the options it chose in `position` order.
 *
 * The caller asks this only of a poll that shows names; on one that does not, the answer rows carry
 * no participant and the second read below would find nothing to attach, which is the promise kept
 * by the rows rather than by this function. Keyed on `(answered_at, id)` of the participation, which
 * is where "when" lives.
 */
export async function listAttributedPollAnswers(
  database: SqlDatabase,
  pollId: MeetingPollId,
  options: { readonly cursor?: SortCursor; readonly limit: number },
): Promise<readonly (MeetingPollAttributedAnswer & { readonly respondentId: string })[]> {
  const bindings: unknown[] = [pollId];
  const keyset = keysetClause(
    bindings,
    options.cursor,
    `${MEETING_POLL_RESPONDENT_TABLE}.answered_at`,
    `${MEETING_POLL_RESPONDENT_TABLE}.id`,
    true,
  );
  const { results: respondents } = await database
    .prepare(
      `SELECT ${MEETING_POLL_RESPONDENT_TABLE}.id, ${MEETING_POLL_RESPONDENT_TABLE}.participant_kind, ` +
        `${MEETING_POLL_RESPONDENT_TABLE}.participant_id, ${MEETING_POLL_RESPONDENT_TABLE}.answered_at, ` +
        `${MEETING_ATTENDANCE_TABLE}.user_id AS user_id ` +
        `FROM ${MEETING_POLL_RESPONDENT_TABLE} ` +
        // Matched on the KIND as well as the handle, on the chat transcript's reasoning: a guest's
        // stay has no member behind it, and a join that ignored the kind could match a guest handle
        // that collided with an attendance id.
        `LEFT JOIN ${MEETING_ATTENDANCE_TABLE} ` +
        `ON ${MEETING_POLL_RESPONDENT_TABLE}.participant_kind = 'member' ` +
        `AND ${MEETING_ATTENDANCE_TABLE}.id = ${MEETING_POLL_RESPONDENT_TABLE}.participant_id ` +
        `WHERE ${MEETING_POLL_RESPONDENT_TABLE}.poll_id = ? ${keyset}` +
        `ORDER BY ${MEETING_POLL_RESPONDENT_TABLE}.answered_at ASC, ` +
        `${MEETING_POLL_RESPONDENT_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<{
      readonly id: MeetingPollRespondentId;
      readonly participant_kind: MeetingContributorKind;
      readonly participant_id: string;
      readonly answered_at: string;
      readonly user_id: UserId | null;
    }>();
  if (respondents.length === 0) return [];

  const participantIds = respondents.map((row) => row.participant_id);
  const { results: answers } = await database
    .prepare(
      `SELECT ${MEETING_POLL_ANSWER_TABLE}.participant_kind, ${MEETING_POLL_ANSWER_TABLE}.participant_id, ` +
        `${MEETING_POLL_ANSWER_TABLE}.option_id FROM ${MEETING_POLL_ANSWER_TABLE} ` +
        `JOIN ${MEETING_POLL_OPTION_TABLE} ` +
        `ON ${MEETING_POLL_OPTION_TABLE}.poll_id = ${MEETING_POLL_ANSWER_TABLE}.poll_id ` +
        `AND ${MEETING_POLL_OPTION_TABLE}.id = ${MEETING_POLL_ANSWER_TABLE}.option_id ` +
        `WHERE ${MEETING_POLL_ANSWER_TABLE}.poll_id = ? ` +
        `AND ${MEETING_POLL_ANSWER_TABLE}.participant_id IN (${placeholders(participantIds.length)}) ` +
        `ORDER BY ${MEETING_POLL_OPTION_TABLE}.position ASC`,
    )
    .bind(pollId, ...participantIds)
    .all<{
      readonly participant_kind: MeetingContributorKind;
      readonly participant_id: string;
      readonly option_id: MeetingPollOptionId;
    }>();
  const chosen = new Map<string, MeetingPollOptionId[]>();
  for (const answer of answers) {
    const key = `${answer.participant_kind}:${answer.participant_id}`;
    const list = chosen.get(key) ?? [];
    list.push(answer.option_id);
    chosen.set(key, list);
  }
  return respondents.map((row) => ({
    respondentId: row.id,
    participantKind: row.participant_kind,
    participantId: row.participant_id,
    userId: row.user_id,
    optionIds: chosen.get(`${row.participant_kind}:${row.participant_id}`) ?? [],
    answeredAt: row.answered_at,
  }));
}

/** One stay answered this poll twice at the same instant, and the second met the unique index. */
export function isPollParticipationConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_POLL_RESPONDENT_TABLE}.poll_id`)
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertMeetingPollInput {
  readonly id: MeetingPollId;
  readonly meetingId: MeetingId;
  readonly askedByUserId: UserId;
  readonly question: string;
  readonly anonymous: boolean;
  readonly maxChoices: number;
  readonly now: string;
}

// ASKING THE ROOM. An insert and nothing else: there is no update path for the question, and the
// only later write to this row is the close. `opened_at` is the insert's own instant because there is
// no draft — the row exists because somebody was asked. `breakout_id` is null: every poll today is
// asked of the main room.
export function insertMeetingPollStatement(
  database: SqlDatabase,
  input: InsertMeetingPollInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_POLL_TABLE} (id, meeting_id, asked_by_user_id, question, anonymous, ` +
        `max_choices, opened_at, closed_at, closed_by_user_id, breakout_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, NULL, ?7, ?7)`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.askedByUserId,
      input.question,
      input.anonymous ? 1 : 0,
      input.maxChoices,
      input.now,
    );
}

/** One choice the poll offers, at its place in the order the room sees. */
export function insertMeetingPollOptionStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPollOptionId;
    readonly pollId: MeetingPollId;
    readonly position: number;
    readonly label: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_POLL_OPTION_TABLE} (id, poll_id, position, label) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(input.id, input.pollId, input.position, input.label);
}

// CLOSING IT. `closed_at IS NULL` in the WHERE is the precondition the caller read, so a second close
// is a no-op rather than a rewrite of the instant and the actor a record already carries. The caller
// guards it, so a close that lost a race to another host's close rolls back whole rather than writing
// an audit row for a close that did not happen.
export function closeMeetingPollStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingPollId; readonly closedByUserId: UserId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_POLL_TABLE} SET closed_at = ?1, closed_by_user_id = ?2, updated_at = ?1 ` +
        `WHERE id = ?3 AND closed_at IS NULL`,
    )
    .bind(input.now, input.closedByUserId, input.id);
}

export interface InsertMemberRespondentInput {
  readonly id: MeetingPollRespondentId;
  readonly pollId: MeetingPollId;
  readonly meetingId: MeetingId;
  readonly attendanceId: MeetingAttendanceId;
  readonly userId: UserId;
  readonly now: string;
}

// THAT A MEMBER'S STAY ANSWERED — the participation row, and the one write in this module that
// carries its own conditions, because both are exactly the instant a read-then-write cannot span.
//
// THE POLL IS STILL OPEN, in the insert's own WHERE: a close racing an answer must not leave an
// answer recorded after the instant the poll says it stopped taking them.
//
// AND THIS MEMBER HAS NOT ANSWERED IT FROM ANY STAY. The unique index holds one participation per
// STAY, which is the design's own guard — and on its own it lets somebody leave, rejoin as a new stay
// and answer again. A tally that can be moved by walking out and back in is a tally nobody can read,
// so the member's other stays in this meeting are asked here too. The index still stands behind it
// for the case this cannot see: two answers from one stay committing at once.
//
// `participant_kind` is the LITERAL 'member', on the chat's reasoning: the table a handle belongs to
// is decided by the statement that writes it, never by an argument a caller could get wrong. The
// caller guards it; a batch that matches nothing is refused and the caller re-reads to say which of
// the two conditions it was.
export function insertMemberRespondentStatement(
  database: SqlDatabase,
  input: InsertMemberRespondentInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_POLL_RESPONDENT_TABLE} (id, poll_id, participant_kind, participant_id, ` +
        `answered_at) SELECT ?1, ?2, 'member', ?3, ?4 ` +
        `WHERE EXISTS (SELECT 1 FROM ${MEETING_POLL_TABLE} ` +
        `WHERE ${MEETING_POLL_TABLE}.id = ?2 AND ${MEETING_POLL_TABLE}.closed_at IS NULL) ` +
        `AND NOT EXISTS (SELECT 1 FROM ${MEETING_POLL_RESPONDENT_TABLE} AS earlier ` +
        `JOIN ${MEETING_ATTENDANCE_TABLE} ON earlier.participant_kind = 'member' ` +
        `AND ${MEETING_ATTENDANCE_TABLE}.id = earlier.participant_id ` +
        `WHERE earlier.poll_id = ?2 AND ${MEETING_ATTENDANCE_TABLE}.meeting_id = ?5 ` +
        `AND ${MEETING_ATTENDANCE_TABLE}.user_id = ?6)`,
    )
    .bind(input.id, input.pollId, input.attendanceId, input.now, input.meetingId, input.userId);
}

// WHAT A MEMBER CHOSE, on a poll that shows names: the option, and the stay that chose it. No
// instant — the respondent row is the one home of when, on both kinds of poll.
export function insertAttributedMemberAnswerStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPollAnswerId;
    readonly pollId: MeetingPollId;
    readonly optionId: MeetingPollOptionId;
    readonly attendanceId: MeetingAttendanceId;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_POLL_ANSWER_TABLE} (id, poll_id, option_id, participant_kind, ` +
        `participant_id) VALUES (?1, ?2, ?3, 'member', ?4)`,
    )
    .bind(input.id, input.pollId, input.optionId, input.attendanceId);
}

// WHAT SOMEBODY CHOSE, on a poll that does not show names: the option and NOTHING ELSE. Both halves
// of the participant pair are literal NULLs rather than bound values, so no caller can hand this
// statement a stay by mistake — the anonymity is in the statement's text, not in an argument.
export function insertAnonymousAnswerStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPollAnswerId;
    readonly pollId: MeetingPollId;
    readonly optionId: MeetingPollOptionId;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_POLL_ANSWER_TABLE} (id, poll_id, option_id, participant_kind, ` +
        `participant_id) VALUES (?1, ?2, ?3, NULL, NULL)`,
    )
    .bind(input.id, input.pollId, input.optionId);
}
