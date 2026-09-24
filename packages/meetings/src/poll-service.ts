import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SortCursor } from "@magna-carta/data-access/cursor-pagination";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingId,
  MeetingPollId,
  MeetingPollOptionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { requireHostGrant } from "./hosting-service.ts";
import { readMeeting, readOpenAttendance } from "./meeting-statements.ts";
import {
  closeMeetingPollStatement,
  insertAnonymousAnswerStatement,
  insertAttributedMemberAnswerStatement,
  insertMeetingPollOptionStatement,
  insertMeetingPollStatement,
  insertMemberRespondentStatement,
  listAttributedPollAnswers,
  listMeetingPolls,
  readMeetingPoll,
  readPollOptionIds,
  readPollsAnsweredByMember,
  readPollTallies,
} from "./poll-statements.ts";
import type {
  MeetingPollAttributedAnswer,
  MeetingPollEntry,
  MeetingPollRow,
  MeetingPollTally,
} from "./poll-types.ts";
import { assertAnswerChoices, assertPollBody, refusePoll } from "./poll-validation.ts";
import type { MeetingRow } from "./types.ts";
import { refuse } from "./validation.ts";

// A host asks the room, the room answers, a host closes it.
//
// ON CHAT'S TERMS, WITH ONE DIFFERENCE IN WHO MAY ACT. Answering needs an OPEN STAY and nothing else,
// exactly as posting a chat message does — being in the room is the whole of the permission. Asking
// and closing are HOST ACTS, and a host act is the grant on this meeting rather than the permission
// key: every one composes `requireHostGrant` ahead of itself, so a member holding `meetings:host`
// who is not running this room is refused `meeting-not-host`.
//
// THE AUDIT ROWS CARRY IDENTIFIERS, INSTANTS AND SHAPE, AND NEVER THE CONTENT. Not the question, not
// an option's label, and above all not WHICH OPTION WAS CHOSEN — on a poll that does not show names
// that would be the entire thing the promise withholds, handed to a log with its own retention and
// its own readers; on one that does, it would be a copy of the record's content in a compliance
// record. What an answer's audit row carries is the poll, the stay and the instant.
//
// Nothing here reads a clock, holds a binding or calls anything external: the clock, the actor and
// the random source arrive as options, so a fixture can mint a byte-identical batch.

/** The label the answer's participation carries, exported because a caller has to match on it. */
export const ANSWER_POLL_GUARD = "meeting.poll.answer";

/** The label the close carries. */
export const CLOSE_POLL_GUARD = "meeting.poll.close";

export interface MeetingPollOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate every calendar source composes. A poll has no visibility rule of its own — it
  // inherits the meeting's, which inherits the event's — so this rides the read on the way to every
  // act, and a poll in a room a list read could not reach is as absent as the room.
  readonly visibility: VisibleMatterPredicate;
}

/** The meeting, through the gate, or the room's own one refusal for every way it is out of reach. */
async function reachMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingPollOptions,
): Promise<MeetingRow> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  return meeting;
}

async function reachPoll(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
): Promise<MeetingPollRow> {
  const poll = await readMeetingPoll(database, meetingId, pollId);
  if (poll === undefined) refusePoll("meeting-poll-not-found", "that is not a poll you can reach");
  return poll;
}

/** A stored poll and its tally, as a surface paints it. */
export function toPollEntry(
  row: MeetingPollRow,
  tally: MeetingPollTally | undefined,
  answeredByCaller: boolean,
): MeetingPollEntry {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    askedByUserId: row.asked_by_user_id,
    question: row.question,
    anonymous: row.anonymous === 1,
    maxChoices: row.max_choices,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    closedByUserId: row.closed_by_user_id,
    options: tally?.options ?? [],
    respondents: tally?.respondents ?? 0,
    answeredByCaller,
  };
}

/**
 * One poll as the caller sees it: the row, its tally and whether they have answered it — read after
 * the gate, so a poll in a room the caller may not reach is `meeting-unknown-event` like the room.
 */
export async function readMeetingPollEntry(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
  options: MeetingPollOptions,
): Promise<MeetingPollEntry> {
  await reachMeeting(database, meetingId, options);
  const poll = await reachPoll(database, meetingId, pollId);
  const tallies = await readPollTallies(database, [pollId]);
  const answered = await readPollsAnsweredByMember(database, meetingId, options.actorUserId, [
    pollId,
  ]);
  return toPollEntry(poll, tallies.get(pollId), answered.has(pollId));
}

/**
 * Asking the room a closed question.
 *
 * A HOST ACT: the grant on this meeting, composed through `requireHostGrant`. And a live one — a
 * meeting that has ended has nobody in it to answer, so opening a poll there would put a question on
 * the record that nobody could have been asked.
 *
 * THERE IS NO DRAFT. The poll is open from the instant it is written, and the options are written in
 * the same batch at their positions — so no reader can ever see a poll without its options.
 */
export async function openMeetingPoll(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: {
    readonly question: string;
    readonly options: readonly string[];
    readonly anonymous: boolean;
    readonly maxChoices: number;
  },
  options: MeetingPollOptions,
): Promise<{ poll: MeetingPollEntry; effect: EffectWrite }> {
  const meeting = await reachMeeting(database, meetingId, options);
  if (meeting.status === "ended") refuse("meeting-already-ended", "this meeting has ended");
  await requireHostGrant(database, meetingId, options.actorUserId);

  const body = assertPollBody(input);
  const now = options.clock.now();
  const pollId = newIdentifier("meetingPoll", options.randomSource);
  const optionEntries = body.options.map((label, position) => ({
    optionId: newIdentifier("meetingPollOption", options.randomSource),
    position,
    label,
    count: 0,
  }));

  const statements: EffectStatement[] = [
    insertMeetingPollStatement(database, {
      id: pollId,
      meetingId,
      askedByUserId: options.actorUserId,
      question: body.question,
      anonymous: input.anonymous,
      maxChoices: body.maxChoices,
      now,
    }),
    ...optionEntries.map((option) =>
      insertMeetingPollOptionStatement(database, {
        id: option.optionId,
        pollId,
        position: option.position,
        label: option.label,
      }),
    ),
    domainAuditStatement(database, {
      event: "meetings.poll.opened",
      subjectId: pollId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      // Identifiers, instants and the poll's SHAPE — how many options, how many may be chosen,
      // whether names are shown. Never the question and never a label: those are the record's
      // content, which the audit log must not carry a second copy of.
      metadata: {
        meetingId,
        openedAt: now,
        optionCount: optionEntries.length,
        maxChoices: body.maxChoices,
        anonymous: input.anonymous,
      },
    }),
  ];

  return {
    poll: {
      id: pollId,
      meetingId,
      askedByUserId: options.actorUserId,
      question: body.question,
      anonymous: input.anonymous,
      maxChoices: body.maxChoices,
      openedAt: now,
      closedAt: null,
      closedByUserId: null,
      options: optionEntries,
      respondents: 0,
      answeredByCaller: false,
    },
    effect: { statements, outboxMessages: [] },
  };
}

/**
 * Closing a poll, which cannot be undone — a closed poll refuses answers.
 *
 * A HOST ACT, and still available after the meeting has ended: a poll left open when the room
 * emptied is tidied by a host afterwards, and there is nobody left to answer it either way.
 *
 * A POLL ALREADY CLOSED IS NOT CLOSED TWICE, and that is a success rather than a refusal: what the
 * host asked for is true. Writing again would move the instant and the actor a record already
 * carries, so this produces no statements and says so with `closed: false`.
 */
export async function closeMeetingPoll(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
  options: MeetingPollOptions,
): Promise<{ closed: boolean; poll: MeetingPollRow; effect: EffectWrite }> {
  await reachMeeting(database, meetingId, options);
  await requireHostGrant(database, meetingId, options.actorUserId);
  const poll = await reachPoll(database, meetingId, pollId);
  if (poll.closed_at !== null) {
    return { closed: false, poll, effect: { statements: [], outboxMessages: [] } };
  }
  const now = options.clock.now();
  return {
    closed: true,
    poll: { ...poll, closed_at: now, closed_by_user_id: options.actorUserId, updated_at: now },
    effect: {
      statements: [
        guarded(
          closeMeetingPollStatement(database, {
            id: pollId,
            closedByUserId: options.actorUserId,
            now,
          }),
          CLOSE_POLL_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.poll.closed",
          subjectId: pollId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { meetingId, openedAt: poll.opened_at, closedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Answering a poll from the member's own stay.
 *
 * AN OPEN STAY IS THE WHOLE OF THE PERMISSION, as it is for a chat message: a member who has left
 * cannot answer a poll in a meeting they are no longer in, and a member who never joined has nothing
 * to answer from. The room's own `meeting-not-joined` is the refusal, so the answer for answering
 * from outside the room is the answer for speaking from outside it.
 *
 * ONE PARTICIPATION, however many options it names. The respondent row is written once and the
 * answer rows beside it — one per option chosen — in the same batch, and the respondent insert is
 * guarded on the poll still being open and on this member not having answered from any stay. A
 * second answer is refused; there is no changing an answer.
 *
 * ON A POLL THAT DOES NOT SHOW NAMES, the answer rows are written by a statement whose participant
 * columns are literal NULLs. The stay is on the respondent row, which says nothing about what was
 * chosen; the choice is on the answer rows, which say nothing about who.
 */
export async function answerMeetingPoll(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
  input: { readonly optionIds: readonly string[] },
  options: MeetingPollOptions,
): Promise<{ poll: MeetingPollRow; effect: EffectWrite }> {
  const meeting = await reachMeeting(database, meetingId, options);
  if (meeting.status === "ended") refuse("meeting-already-ended", "this meeting has ended");
  const poll = await reachPoll(database, meetingId, pollId);

  const stay = await readOpenAttendance(database, meetingId, options.actorUserId);
  if (stay === undefined) refuse("meeting-not-joined", "you are not in this meeting");

  if (poll.closed_at !== null) refusePoll("meeting-poll-closed", "this poll has closed");
  const answered = await readPollsAnsweredByMember(database, meetingId, options.actorUserId, [
    pollId,
  ]);
  if (answered.has(pollId)) {
    refusePoll("meeting-poll-already-answered", "you have already answered this poll");
  }

  const optionIds = assertAnswerChoices(input.optionIds, {
    maxChoices: poll.max_choices,
    optionIds: new Set(await readPollOptionIds(database, pollId)),
  }) as readonly MeetingPollOptionId[];

  const now = options.clock.now();
  const respondentId = newIdentifier("meetingPollRespondent", options.randomSource);
  const anonymous = poll.anonymous === 1;
  const answerStatements = optionIds.map((optionId) => {
    const id = newIdentifier("meetingPollAnswer", options.randomSource);
    return anonymous
      ? insertAnonymousAnswerStatement(database, { id, pollId, optionId })
      : insertAttributedMemberAnswerStatement(database, {
          id,
          pollId,
          optionId,
          attendanceId: stay.id,
        });
  });

  return {
    poll,
    effect: {
      statements: [
        guarded(
          insertMemberRespondentStatement(database, {
            id: respondentId,
            pollId,
            meetingId,
            attendanceId: stay.id,
            userId: options.actorUserId,
            now,
          }),
          ANSWER_POLL_GUARD,
        ),
        ...answerStatements,
        domainAuditStatement(database, {
          event: "meetings.poll.answered",
          subjectId: pollId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The poll, the stay and the instant. NOT the option, and not how many were chosen either:
          // on a poll that lets somebody choose up to three, the count alone narrows what they chose.
          metadata: { meetingId, participantId: stay.id, answeredAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Why an answer's guarded write matched nothing, read after the refusal: the poll closed under it,
 * or the member's answer from another stay landed first. The route turns the answer into the problem
 * the member reads.
 */
export async function answerRefusalReason(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
): Promise<"meeting-poll-closed" | "meeting-poll-already-answered"> {
  const poll = await readMeetingPoll(database, meetingId, pollId);
  return poll !== undefined && poll.closed_at !== null
    ? "meeting-poll-closed"
    : "meeting-poll-already-answered";
}

/**
 * One page of a meeting's polls, newest first, each with its tally and whether the caller answered.
 *
 * Reading is `meetings:join` and the event's own visibility, composed through `readMeeting` — the
 * route's permission and this gate together — and nothing about a poll narrows it further: everybody
 * in the room sees the same polls, and the tally is the room's.
 */
export async function listMeetingPollEntries(
  database: SqlDatabase,
  meetingId: MeetingId,
  page: { readonly cursor?: SortCursor; readonly limit: number },
  options: MeetingPollOptions,
): Promise<readonly MeetingPollEntry[]> {
  await reachMeeting(database, meetingId, options);
  const rows = await listMeetingPolls(database, meetingId, page);
  const pollIds = rows.map((row) => row.id);
  const tallies = await readPollTallies(database, pollIds);
  const answered = await readPollsAnsweredByMember(
    database,
    meetingId,
    options.actorUserId,
    pollIds,
  );
  return rows.map((row) => toPollEntry(row, tallies.get(row.id), answered.has(row.id)));
}

/**
 * Who answered what, on a poll that shows names — a HOST read, one page at a time.
 *
 * REFUSED ON A POLL THAT DOES NOT SHOW NAMES, as `meeting-poll-answers-not-attributed`, rather than
 * answered with an empty page: an empty page reads as "nobody answered", which is the one wrong
 * answer this read can give. There is nothing to return either way — those answer rows carry no
 * participant — but a caller must be told why rather than shown nothing.
 */
export async function readAttributedPollAnswers(
  database: SqlDatabase,
  meetingId: MeetingId,
  pollId: MeetingPollId,
  page: { readonly cursor?: SortCursor; readonly limit: number },
  options: MeetingPollOptions,
): Promise<readonly (MeetingPollAttributedAnswer & { readonly respondentId: string })[]> {
  await reachMeeting(database, meetingId, options);
  await requireHostGrant(database, meetingId, options.actorUserId);
  const poll = await reachPoll(database, meetingId, pollId);
  if (poll.anonymous === 1) {
    refusePoll("meeting-poll-answers-not-attributed", "this poll does not show names with answers");
  }
  return await listAttributedPollAnswers(database, pollId, page);
}
