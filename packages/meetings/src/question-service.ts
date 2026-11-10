import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SortCursor } from "@magna-carta/data-access/cursor-pagination";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MeetingId, MeetingQuestionId, UserId } from "@magna-carta/identifiers/types";
import { requireHostGrant } from "./hosting-service.ts";
import { readLiveHostGrant } from "./hosting-statements.ts";
import { readMeeting, readOpenAttendance } from "./meeting-statements.ts";
import {
  countMeetingQuestions,
  deleteMemberUpvoteStatement,
  insertMemberQuestionStatement,
  insertMemberUpvoteStatement,
  listMeetingQuestions,
  markQuestionAnsweredStatement,
  readMeetingQuestion,
  readMemberUpvoteStay,
  readQuestionsUpvotedByMember,
  redactMeetingQuestionStatement,
  unmarkQuestionAnsweredStatement,
  type MeetingQuestionRecord,
} from "./question-statements.ts";
import { MAX_MEETING_QUESTIONS, type MeetingQuestionEntry } from "./question-types.ts";
import { assertQuestionBody, refuseQuestion } from "./question-validation.ts";
import type { MeetingAttendanceRow, MeetingRow } from "./types.ts";
import { refuse } from "./validation.ts";

// The room asks the host: ask a question, upvote one, take an upvote back, mark one answered, take
// one back.
//
// ON CHAT'S TERMS. Asking and upvoting need an OPEN STAY and nothing else; marking answered is a HOST
// act, composed through `requireHostGrant`; taking a question back is the author's or a host's, and
// the comparison that decides it is the chat's. Nothing here reads a clock, holds a binding or calls
// anything external.
//
// THE AUDIT ROWS CARRY IDENTIFIERS AND INSTANTS — never the body, on the asking or on the removal,
// and never anything a body could be reconstructed from beyond its length.

/** The label the queue's ceiling carries, exported because a caller has to match on it. */
export const ASK_QUESTION_GUARD = "meeting.question.ask";

/** The labels the upvote's two halves carry. A zero on either is the member's own earlier act. */
export const UPVOTE_QUESTION_GUARD = "meeting.question.upvote";
export const WITHDRAW_UPVOTE_GUARD = "meeting.question.withdrawUpvote";

/** The label marking and unmarking carry. A zero is the state the host asked for, already true. */
export const MARK_ANSWERED_GUARD = "meeting.question.answered";

/** The label the redaction carries. */
export const REDACT_QUESTION_GUARD = "meeting.question.redact";

export interface MeetingQuestionOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate every calendar source composes: a question has no visibility rule of its
  // own, and one in a room a list read could not reach is as absent as the room.
  readonly visibility: VisibleMatterPredicate;
}

const NOTHING: EffectWrite = { statements: [], outboxMessages: [] };

async function reachMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingQuestionOptions,
): Promise<MeetingRow> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  return meeting;
}

async function reachQuestion(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
): Promise<MeetingQuestionRecord> {
  const question = await readMeetingQuestion(database, meetingId, questionId);
  if (question === undefined) {
    refuseQuestion("meeting-question-not-found", "that is not a question you can reach");
  }
  return question;
}

/** The caller's open stay in a meeting that is still running — what asking and upvoting stand on. */
async function requireOpenStay(
  database: SqlDatabase,
  meeting: MeetingRow,
  options: MeetingQuestionOptions,
): Promise<MeetingAttendanceRow> {
  if (meeting.status === "ended") refuse("meeting-already-ended", "this meeting has ended");
  const stay = await readOpenAttendance(database, meeting.id, options.actorUserId);
  // The room's code rather than one of the queue's, so the answer for asking from outside the room
  // is the answer for speaking from outside it.
  if (stay === undefined) refuse("meeting-not-joined", "you are not in this meeting");
  return stay;
}

/**
 * One question as the caller sees it, including whether they have upvoted it — the read every write
 * here answers with after its commit, so a member is told what the record now holds.
 */
export async function readMeetingQuestionEntry(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
  userId: UserId,
): Promise<MeetingQuestionEntry | undefined> {
  const question = await readMeetingQuestion(database, meetingId, questionId);
  if (question === undefined) return undefined;
  const upvoted = await readQuestionsUpvotedByMember(database, meetingId, userId, [questionId]);
  return { ...question, upvotedByCaller: upvoted.has(questionId) };
}

/** One page of the queue, oldest first, each question with its count and the caller's own upvote. */
export async function listMeetingQuestionEntries(
  database: SqlDatabase,
  meetingId: MeetingId,
  page: {
    readonly cursor?: SortCursor;
    readonly limit: number;
    readonly since?: string;
    readonly sinceId?: string;
  },
  options: MeetingQuestionOptions,
): Promise<readonly MeetingQuestionEntry[]> {
  await reachMeeting(database, meetingId, options);
  const records = await listMeetingQuestions(database, meetingId, page);
  const upvoted = await readQuestionsUpvotedByMember(
    database,
    meetingId,
    options.actorUserId,
    records.map((record) => record.id),
  );
  return records.map((record) => ({ ...record, upvotedByCaller: upvoted.has(record.id) }));
}

/**
 * Asking the room something, from the member's own open stay.
 *
 * THE QUEUE'S CEILING IS HELD TWICE, and only one of them is the limit. The count read here produces
 * the REASON a member reads; the insert's own WHERE is what holds the ceiling against two questions
 * arriving together, and the route maps its guard onto the same refusal.
 */
export async function askMeetingQuestion(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: { readonly body: string },
  options: MeetingQuestionOptions,
): Promise<{ question: MeetingQuestionEntry; effect: EffectWrite }> {
  const meeting = await reachMeeting(database, meetingId, options);
  const stay = await requireOpenStay(database, meeting, options);
  const body = assertQuestionBody(input.body);

  if ((await countMeetingQuestions(database, meetingId)) >= MAX_MEETING_QUESTIONS) {
    refuseQuestion(
      "meeting-question-limit-reached",
      `a meeting's queue holds ${String(MAX_MEETING_QUESTIONS)} questions at most`,
    );
  }

  const now = options.clock.now();
  const questionId = newIdentifier("meetingQuestion", options.randomSource);
  return {
    question: {
      id: questionId,
      meetingId,
      participantKind: "member",
      participantId: stay.id,
      userId: options.actorUserId,
      body,
      askedAt: now,
      answeredAt: null,
      answeredByUserId: null,
      redactedAt: null,
      redactedByUserId: null,
      upvotes: 0,
      upvotedByCaller: false,
    },
    effect: {
      statements: [
        guarded(
          insertMemberQuestionStatement(database, {
            id: questionId,
            meetingId,
            attendanceId: stay.id,
            body,
            now,
          }),
          ASK_QUESTION_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.question.asked",
          subjectId: questionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The length of what was asked rather than any part of it — the chat message's line.
          metadata: { meetingId, participantId: stay.id, askedAt: now, bodyLength: body.length },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Upvoting a question, from the member's own open stay. ONE PER MEMBER, and idempotent: a member who
 * has already upvoted it produces no statements, because what they asked for is already true.
 */
export async function upvoteMeetingQuestion(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
  options: MeetingQuestionOptions,
): Promise<{ upvoted: boolean; effect: EffectWrite }> {
  const meeting = await reachMeeting(database, meetingId, options);
  const question = await reachQuestion(database, meetingId, questionId);
  const stay = await requireOpenStay(database, meeting, options);
  const already = await readQuestionsUpvotedByMember(database, meetingId, options.actorUserId, [
    questionId,
  ]);
  // Already true is answered as success first, so a member who upvoted before the question was
  // taken back is told what holds rather than refused for a state they did not cause.
  if (already.has(questionId)) return { upvoted: false, effect: NOTHING };
  if (question.redactedAt !== null) {
    refuseQuestion("meeting-question-redacted", "that question has been taken back");
  }

  const now = options.clock.now();
  return {
    upvoted: true,
    effect: {
      statements: [
        guarded(
          insertMemberUpvoteStatement(database, {
            id: newIdentifier("meetingQuestionUpvote", options.randomSource),
            questionId,
            meetingId,
            attendanceId: stay.id,
            userId: options.actorUserId,
            now,
          }),
          UPVOTE_QUESTION_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.question.upvoted",
          subjectId: questionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { meetingId, participantId: stay.id, upvotedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Taking an upvote back. Removes exactly the member's one upvote, from whichever of their stays it
 * was cast; a member with none to take back produces no statements. Needs an open stay like the
 * upvote itself — somebody who has left the room is no longer voting in it. Allowed on a question
 * that has been taken back: clearing a signal one gave is never refused.
 *
 * THE AUDIT ROW NAMES THE STAY THE UPVOTE WAS CAST FROM, not the one withdrawing it. The two differ
 * whenever the member left and rejoined in between, and the withdrawal is about the upvote row it
 * removes — the `meetings.question.upvoted` row beside it names that same stay, so the pair reads as
 * one signal given and taken back.
 */
export async function withdrawMeetingQuestionUpvote(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
  options: MeetingQuestionOptions,
): Promise<{ withdrawn: boolean; effect: EffectWrite }> {
  const meeting = await reachMeeting(database, meetingId, options);
  await reachQuestion(database, meetingId, questionId);
  await requireOpenStay(database, meeting, options);
  const castFrom = await readMemberUpvoteStay(database, meetingId, options.actorUserId, questionId);
  if (castFrom === undefined) return { withdrawn: false, effect: NOTHING };

  const now = options.clock.now();
  return {
    withdrawn: true,
    effect: {
      statements: [
        guarded(
          deleteMemberUpvoteStatement(database, {
            questionId,
            meetingId,
            userId: options.actorUserId,
          }),
          WITHDRAW_UPVOTE_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.question.upvoteWithdrawn",
          subjectId: questionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { meetingId, participantId: castFrom, withdrawnAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Marking a question answered, or unmarking it — ONE ACT WITH A BOOLEAN, because a host works a queue
 * fast and marks the wrong row, and an act that could not be undone would leave the record saying a
 * question was answered when it was not.
 *
 * A HOST ACT, composed through `requireHostGrant`. A question already in the state asked for produces
 * no statements rather than moving the instant and the actor already on the row.
 */
export async function setMeetingQuestionAnswered(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
  answered: boolean,
  options: MeetingQuestionOptions,
): Promise<{ changed: boolean; effect: EffectWrite }> {
  await reachMeeting(database, meetingId, options);
  await requireHostGrant(database, meetingId, options.actorUserId);
  const question = await reachQuestion(database, meetingId, questionId);
  if ((question.answeredAt !== null) === answered) return { changed: false, effect: NOTHING };

  const now = options.clock.now();
  return {
    changed: true,
    effect: {
      statements: [
        answered
          ? guarded(
              markQuestionAnsweredStatement(database, {
                id: questionId,
                answeredByUserId: options.actorUserId,
                now,
              }),
              MARK_ANSWERED_GUARD,
            )
          : guarded(
              unmarkQuestionAnsweredStatement(database, { id: questionId }),
              MARK_ANSWERED_GUARD,
            ),
        domainAuditStatement(database, {
          event: "meetings.question.answered",
          subjectId: questionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // One event with the direction as a label rather than two event names: "was this question
          // answered, and when did that change" is one read.
          metadata: { meetingId, answered, at: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Taking a question back — the body blanked and the row kept, word for word the chat's redaction.
 *
 * WHO MAY: a host of this meeting, or the author. A host is somebody holding a live GRANT on this
 * room, the same authority every other host act asks for; the author is the member behind the
 * question's stay, which is null for a guest's question — so a guest's words are the host's to
 * moderate and nobody else's, which falls out of the comparison rather than needing a branch.
 *
 * STILL AVAILABLE AFTER THE MEETING HAS ENDED, on the chat's reasoning: the words outlive the
 * gathering. A question already taken back produces no statements.
 */
export async function redactMeetingQuestion(
  database: SqlDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
  options: MeetingQuestionOptions,
): Promise<{ redacted: boolean; effect: EffectWrite }> {
  await reachMeeting(database, meetingId, options);
  const question = await reachQuestion(database, meetingId, questionId);
  if (question.userId !== options.actorUserId) {
    const grant = await readLiveHostGrant(database, meetingId, options.actorUserId);
    if (grant === undefined) {
      refuseQuestion("meeting-question-not-redactable", "that is not your question to take back");
    }
  }
  if (question.redactedAt !== null) return { redacted: false, effect: NOTHING };

  const now = options.clock.now();
  return {
    redacted: true,
    effect: {
      statements: [
        guarded(
          redactMeetingQuestionStatement(database, {
            id: questionId,
            redactedByUserId: options.actorUserId,
            now,
          }),
          REDACT_QUESTION_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.question.redacted",
          subjectId: questionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and instants. Not the body — least of all here, where the audit row would be
          // the one place the removed words survived.
          metadata: {
            meetingId,
            participantId: question.participantId,
            askedAt: question.askedAt,
            redactedAt: now,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}
