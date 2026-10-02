/*
 * Every read and write a meeting screen makes, each answering with an outcome rather than throwing.
 *
 * The reads are the generated `…Options` factories and go straight into the one cache; these are
 * the writes, and they are wrapped for one reason: the generated client throws its failure
 * (api-client.ts says why), and a surface in the middle of a meeting has to RENDER a refusal rather
 * than unwind. So each call comes back as a value or as the `Failure` record every failure surface
 * in the app is built on, and nothing above here touches an exception.
 *
 * EVERY WRITE CARRIES ITS OWN IDEMPOTENCY KEY. The routes require one, and the reason is the retry:
 * a join that is sent twice must open one attendance row, not two, or the room's own cap counts a
 * member twice and the record says they were in the room twice over.
 */
import {
  meetingsAdmitToLobby,
  meetingsAnswerPoll,
  meetingsAskQuestion,
  meetingsClosePoll,
  meetingsDenyFromLobby,
  meetingsEnd,
  meetingsGrantHosting,
  meetingsHosts,
  meetingsJoin,
  meetingsLeave,
  meetingsListMessages,
  meetingsListPollAnswers,
  meetingsListPolls,
  meetingsListQuestions,
  meetingsLobby,
  meetingsOpenPoll,
  meetingsRecordingNotices,
  meetingsRedactMessage,
  meetingsRedactQuestion,
  meetingsRemoveParticipant,
  meetingsRevokeHosting,
  meetingsSendMessage,
  meetingsSetLobby,
  meetingsSetLocked,
  meetingsSetQuestionAnswered,
  meetingsStart,
  meetingsStartRecording,
  meetingsStopRecording,
  meetingsUpvoteQuestion,
  meetingsWithdrawQuestionUpvote,
  type JoinedMeeting,
  type MeetingAcknowledged,
  type MeetingHostGrant,
  type MeetingHostingAcknowledged,
  type MeetingLobbyAcknowledged,
  type MeetingLobbyDecisions,
  type MeetingLobbyEntry,
  type MeetingMessage,
  type MeetingMessagePage,
  type MeetingPoll,
  type MeetingPollAnswer,
  type MeetingQuestion,
  type MeetingRecordingNoticeEntry,
  type MeetingRecordingSummary,
  type MeetingSummary,
  type StartedMeeting,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { MeetingHostRole, MeetingLobbyMode } from "@magna-carta/meeting-protocol/types";
import type { MeetingMedium } from "./meeting-client.svelte.ts";
import type { Failure } from "$lib/api/problem.ts";
import type {
  MeetingPollAnswerPageView,
  MeetingPollAnswerView,
  MeetingPollDraft,
  MeetingPollPageView,
  MeetingPollSeams,
  MeetingPollView,
} from "./client/polls.svelte.ts";
import type {
  MeetingQuestionPageView,
  MeetingQuestionPosition,
  MeetingQuestionSeams,
  MeetingQuestionView,
} from "./client/questions.svelte.ts";
import type { MeetingRecordingRoutes } from "./client/recording.svelte.ts";

/** What a write answered: the value, or the record a failure surface renders from. */
export type MeetingWrite<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly failure: Failure };

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

async function write<T>(call: () => Promise<{ data: T }>): Promise<MeetingWrite<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return { kind: "failed", failure: failureOf(error) };
  }
}

/**
 * Create the event's meeting, or answer with the one it already has.
 *
 * The route is idempotent on the event rather than on the key alone, so two members pressing Start
 * within a second of each other land in the same room instead of opening two — which is also why
 * the SECOND of them gets the room the first opened, in the medium the first chose.
 */
export function startMeeting(
  eventKind: "matter" | "firm",
  eventId: string,
  medium: MeetingMedium = "video",
  lobby: MeetingLobbyMode = "off",
): Promise<MeetingWrite<StartedMeeting>> {
  return write(() =>
    meetingsStart({
      // What the room carries is settled HERE and never again: everybody who joins agreed to the
      // same thing, so the medium is part of opening the room rather than a setting inside it. The
      // door is the opposite and is sent here only as the standing it OPENS with: a host changes it
      // from inside the room, because who may come in has no bearing on what anybody agreed to.
      body: { eventKind, eventId, medium, lobby },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Open this member's attendance and answer with who they are in the room and how to reach it. */
export function joinMeeting(meetingId: string): Promise<MeetingWrite<JoinedMeeting>> {
  return write(() =>
    meetingsJoin({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Close this member's attendance.
 *
 * The socket closing does NOT do this, by design on the server: a dropped connection is not a
 * member leaving the room, and an attendance row that closed itself on a blip would report somebody
 * as having left a meeting they were still in. So leaving is its own act, and the screen makes it
 * on the way out as well as on the control.
 */
export function leaveMeeting(meetingId: string): Promise<MeetingWrite<MeetingAcknowledged>> {
  return write(() =>
    meetingsLeave({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** End it for everybody. The room broadcasts `ended` and closes every socket. */
export function endMeeting(meetingId: string): Promise<MeetingWrite<MeetingAcknowledged>> {
  return write(() =>
    meetingsEnd({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/*
 * RUNNING THE MEETING: the acts somebody could later ask "who did that" about.
 *
 * They are routes rather than frames for that one reason. A member was put out of a meeting that is
 * on a matter's record; arrivals were refused at a door somebody closed; the room changed hands. Each
 * of those outlives the room, and the only honest answer to who did it is a row written at the moment
 * it happened. The acts that leave nothing behind — a mute, a spotlight, a tap on the shoulder — go
 * out as frames on the socket instead (client/host-controls.ts says why at length).
 */

/** Who is running this meeting, as the record states it. Everybody in the room may ask. */
export function readMeetingHosts(
  meetingId: string,
): Promise<MeetingWrite<readonly MeetingHostGrant[]>> {
  return write(async () => {
    const { data } = await meetingsHosts({ path: { meetingId }, throwOnError: true });
    return { data: data.data };
  });
}

/**
 * Write a grant: hand the meeting over, name a co-host, or CLAIM a room nobody is running.
 *
 * One route, because they are one act with different arguments — writing a grant — and four would be
 * four places for the same invariants to drift. Naming yourself with the host's role is the claim,
 * and it is refused while anybody hosting the room still has an open stay.
 */
export function grantMeetingHosting(
  meetingId: string,
  userId: string,
  role: MeetingHostRole,
): Promise<MeetingWrite<readonly MeetingHostGrant[]>> {
  return write(async () => {
    const { data } = await meetingsGrantHosting({
      path: { meetingId },
      body: { userId, role },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: data.data };
  });
}

/** Withdraw a co-host's grant. The host's own is handed over rather than withdrawn. */
export function revokeMeetingHosting(
  meetingId: string,
  userId: string,
): Promise<MeetingWrite<readonly MeetingHostGrant[]>> {
  return write(async () => {
    const { data } = await meetingsRevokeHosting({
      path: { meetingId, userId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: data.data };
  });
}

/**
 * Put somebody out of the room.
 *
 * Addressed by the STAY rather than by the member: that is what the roster carries and what every
 * frame on the wire names, and a member handle would not distinguish two stays. They are barred from
 * this meeting while it runs, and from nothing else.
 */
export function removeMeetingParticipant(
  meetingId: string,
  participantId: string,
): Promise<MeetingWrite<MeetingHostingAcknowledged>> {
  return write(() =>
    meetingsRemoveParticipant({
      path: { meetingId, participantId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/** Shut the door, or open it again. A locked room refuses arrivals and touches nobody in it. */
export function setMeetingLocked(
  meetingId: string,
  locked: boolean,
): Promise<MeetingWrite<MeetingHostingAcknowledged>> {
  return write(() =>
    meetingsSetLocked({
      path: { meetingId },
      body: { locked },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/*
 * THE DOOR. Four writes, all of them the host's, and every one of them a route rather than a frame
 * for the reason the acts above are: arrivals refused at a door somebody shut, and a member let into
 * a meeting on a matter's record, are both facts that outlive the room.
 */

/** Open the door or shut it. A host's standing decision, changed from inside the meeting. */
export function setMeetingLobby(
  meetingId: string,
  lobby: MeetingLobbyMode,
): Promise<MeetingWrite<MeetingLobbyAcknowledged>> {
  return write(() =>
    meetingsSetLobby({
      path: { meetingId },
      body: { lobby },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Who is at the door.
 *
 * The one read in this family the people INSIDE the room may not make: who is running the meeting is
 * something everybody it governs needs to know, and who is outside it is a list of people a host has
 * not yet decided about.
 */
export function readMeetingLobby(
  meetingId: string,
): Promise<MeetingWrite<readonly MeetingLobbyEntry[]>> {
  return write(async () => {
    const { data } = await meetingsLobby({ path: { meetingId }, throwOnError: true });
    return { data: data.data };
  });
}

/**
 * Let the named arrivals in.
 *
 * THERE IS NO "ADMIT EVERYONE" ON THE SERVER, and its absence is the design: a server-side "all"
 * would admit whoever arrived in the millisecond after the host looked at the list, which in a lobby
 * that exists because somebody might arrive who should not is precisely the person the host did not
 * decide about. So Admit all sends the identifiers the panel was showing.
 *
 * The answer reports one outcome per identifier, so a batch that half-lands is legible: a host
 * admitting five people into two free seats learns which three did not get in.
 */
export function admitToMeetingLobby(
  meetingId: string,
  participantIds: readonly string[],
): Promise<MeetingWrite<MeetingLobbyDecisions>> {
  return write(() =>
    meetingsAdmitToLobby({
      path: { meetingId },
      body: { participantIds: [...participantIds] },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Turn the named arrivals away.
 *
 * Denial BARS them from this meeting while it runs, on the same rule a removal keeps: a denial that
 * did not bar would be a control that does nothing, because the member presses Join again and is
 * back at the front of the queue.
 */
export function denyFromMeetingLobby(
  meetingId: string,
  participantIds: readonly string[],
): Promise<MeetingWrite<MeetingLobbyDecisions>> {
  return write(() =>
    meetingsDenyFromLobby({
      path: { meetingId },
      body: { participantIds: [...participantIds] },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * What a batch at the door did NOT do, in the words a host reads. Null where it did all of it.
 *
 * The answer reports one outcome per identifier because a batch can half-land, and a half-landed
 * batch that says nothing is the silent failure this whole family is built to avoid: the rows that
 * did not move stay on screen looking exactly like rows nobody pressed. A room that filled is
 * separated from a stay that closed while the host was reading, because only the first is a reason
 * to wait and try again.
 */
export function doorDecisionStatement(
  decisions: MeetingLobbyDecisions,
  wanted: "admitted" | "denied",
): string | null {
  const missed = decisions.data.filter((decision) => decision.outcome !== wanted);
  if (missed.length === 0) return null;
  const full = missed.filter((decision) => decision.outcome === "room-full").length;
  if (full > 0) {
    return full === 1
      ? "1 person did not get in: the room is full."
      : `${full} people did not get in: the room is full.`;
  }
  return missed.length === 1
    ? "1 person was no longer waiting, so nothing changed for them."
    : `${missed.length} people were no longer waiting, so nothing changed for them.`;
}

/*
 * WHAT IS SAID IN THE ROOM, which is the meeting's first stored content.
 *
 * Everything else this subsystem holds is identifiers and instants, and the audio and video never
 * reach this platform at all — so chat is the one thing here that is kept on the record, and it is
 * a record with the shape a filed message has: append-only, taken back rather than deleted, and
 * read back oldest first.
 *
 * THE WRITE NEVER GOES THROUGH THE SOCKET. A record that existed only where a Durable Object's
 * transient storage holds it would be a record that empties when the room does, so a message is a
 * route and the room's later relay frame will be a copy of a row that is already committed.
 */

/**
 * The most characters one message carries.
 *
 * The browser's mirror of the number the write is actually checked against — the server's own copy
 * is in `packages/meetings/src/chat-types.ts`, and is a SQLite CHECK on the row besides, so a body
 * that gets past this is refused rather than stored. It is here because the composer has to say how
 * much room is left before the reader presses anything, and a browser bundle cannot import from a
 * Worker's own package.
 */
export const MAX_MEETING_MESSAGE_LENGTH = 4000;

/**
 * One page of what has been said, oldest first.
 *
 * A POLLER CONTINUES FROM THE CURSOR AND NEVER FROM A TIMESTAMP. The cursor is the `(sent_at, id)`
 * key of the last row of the page it came with, so continuing from it cannot skip a message written
 * in the same millisecond as the last one read, and cannot re-read one either. An instant can do
 * both, and `since` exists for the caller who is starting from a time rather than continuing from a
 * place.
 */
export function readMeetingMessages(
  meetingId: string,
  cursor: string | null = null,
): Promise<MeetingWrite<MeetingMessagePage>> {
  return write(() =>
    meetingsListMessages({
      path: { meetingId },
      query: cursor === null ? undefined : { cursor },
      throwOnError: true,
    }),
  );
}

/** Say something in the room. Refused for a member with no open stay in it. */
export function sendMeetingMessage(
  meetingId: string,
  body: string,
): Promise<MeetingWrite<MeetingMessage>> {
  return write(() =>
    meetingsSendMessage({
      path: { meetingId },
      body: { body },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Take a message back.
 *
 * It is NOT a delete, and the answer says so: the row comes back with its body blanked and its
 * redaction stamped, so the file keeps that a message existed, when, from which stay, and that
 * somebody removed it. A member may take back their own; somebody hosting may take back any.
 */
export function redactMeetingMessage(
  meetingId: string,
  messageId: string,
): Promise<MeetingWrite<MeetingMessage>> {
  return write(() =>
    meetingsRedactMessage({
      path: { meetingId, messageId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/*
 * WHAT A HOST ASKS THE ROOM, AND WHAT THE ROOM ASKS A HOST: the meeting's second and third stored
 * content, on chat's own terms.
 *
 * Every act is a route and never a frame. The room relays a copy of each committed row so three
 * hundred browsers learn of it at once, but a write that went through the socket would put a firm's
 * record in a Durable Object's transient storage, which empties when the room does. The pages are
 * turned into the shapes the panels draw here, beside the calls, so the panels never learn the
 * contract's field names and a rename there is one edit here.
 */

/** A poll as the contract states it, in the shape the polls panel draws. */
function pollView(poll: MeetingPoll): MeetingPollView {
  return {
    pollId: poll.id,
    askedByUserId: poll.askedByUserId,
    question: poll.question,
    anonymous: poll.anonymous,
    maxChoices: poll.maxChoices,
    openedAt: poll.openedAt,
    closedAt: poll.closedAt,
    options: poll.options
      .map((option) => ({
        optionId: option.optionId,
        position: option.position,
        label: option.label,
        count: option.count,
      }))
      .toSorted((first, second) => first.position - second.position),
    respondents: poll.respondents,
    answered: poll.answeredByCaller,
  };
}

function pollAnswerView(answer: MeetingPollAnswer): MeetingPollAnswerView {
  return {
    participantId: answer.participantId,
    participantKind: answer.participantKind,
    userId: answer.userId,
    answeredAt: answer.answeredAt,
    optionIds: answer.optionIds,
  };
}

/** A question as the contract states it, in the shape the queue draws. */
function questionView(question: MeetingQuestion): MeetingQuestionView {
  return {
    questionId: question.id,
    participantId: question.participantId,
    participantKind: question.participantKind,
    userId: question.userId,
    body: question.body,
    askedAt: question.askedAt,
    answeredAt: question.answeredAt,
    redactedAt: question.redactedAt,
    upvotes: question.upvotes,
    upvotedByMe: question.upvotedByCaller,
  };
}

/**
 * Ask the room a closed question. A host act: the key to host meetings AND a grant on this one.
 *
 * The poll is open from the instant it is written — there is no draft, because a poll row exists
 * only where somebody was actually asked.
 */
export function openMeetingPoll(
  meetingId: string,
  draft: MeetingPollDraft,
): Promise<MeetingWrite<MeetingPollView>> {
  return write(async () => {
    const { data } = await meetingsOpenPoll({
      path: { meetingId },
      body: {
        question: draft.question,
        options: [...draft.options],
        anonymous: draft.anonymous,
        maxChoices: draft.maxChoices,
      },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: pollView(data) };
  });
}

/** One page of this meeting's polls, newest first, each with its tally and the caller's standing. */
export function readMeetingPolls(
  meetingId: string,
  cursor: string | null = null,
): Promise<MeetingWrite<MeetingPollPageView>> {
  return write(async () => {
    const { data } = await meetingsListPolls({
      path: { meetingId },
      query: cursor === null ? undefined : { cursor },
      throwOnError: true,
    });
    return { data: { polls: data.data.map(pollView), nextCursor: data.nextCursor } };
  });
}

/** Close a poll. It cannot be undone, and a closed poll refuses answers. A host act. */
export function closeMeetingPoll(
  meetingId: string,
  pollId: string,
): Promise<MeetingWrite<MeetingPollView>> {
  return write(async () => {
    const { data } = await meetingsClosePoll({
      path: { meetingId, pollId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: pollView(data) };
  });
}

/**
 * Answer a poll from this member's open stay. Being in the room is the whole of the permission, and
 * an answer cannot be changed: a second is refused rather than replacing the first.
 */
export function answerMeetingPoll(
  meetingId: string,
  pollId: string,
  optionIds: readonly string[],
): Promise<MeetingWrite<MeetingPollView>> {
  return write(async () => {
    const { data } = await meetingsAnswerPoll({
      path: { meetingId, pollId },
      body: { optionIds: [...optionIds] },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: pollView(data) };
  });
}

/**
 * Who answered what, on a poll that shows names. A host read, refused on a poll that does not —
 * rather than answered with an empty page, which would read as nobody having answered.
 */
export function readMeetingPollAnswers(
  meetingId: string,
  pollId: string,
  cursor: string | null = null,
): Promise<MeetingWrite<MeetingPollAnswerPageView>> {
  return write(async () => {
    const { data } = await meetingsListPollAnswers({
      path: { meetingId, pollId },
      query: cursor === null ? undefined : { cursor },
      throwOnError: true,
    });
    return { data: { answers: data.data.map(pollAnswerView), nextCursor: data.nextCursor } };
  });
}

/** Put a question to the room from this member's open stay. */
export function askMeetingQuestion(
  meetingId: string,
  body: string,
): Promise<MeetingWrite<MeetingQuestionView>> {
  return write(async () => {
    const { data } = await meetingsAskQuestion({
      path: { meetingId },
      body: { body },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: questionView(data) };
  });
}

/**
 * One page of the queue, oldest first on the record's own stable key. The panel sorts what it holds;
 * a cursor walking a count that changes while it pages would repeat rows and skip rows. `after` is
 * a place on that same key — what a panel following the queue holds — and narrows the walk to what
 * was asked from there on.
 */
export function readMeetingQuestions(
  meetingId: string,
  cursor: string | null = null,
  after: MeetingQuestionPosition | null = null,
): Promise<MeetingWrite<MeetingQuestionPageView>> {
  return write(async () => {
    const query = {
      ...(cursor === null ? {} : { cursor }),
      ...(after === null ? {} : { since: after.askedAt, sinceId: after.questionId }),
    };
    const { data } = await meetingsListQuestions({
      path: { meetingId },
      query: Object.keys(query).length === 0 ? undefined : query,
      throwOnError: true,
    });
    return { data: { questions: data.data.map(questionView), nextCursor: data.nextCursor } };
  });
}

/** Upvote a question: one per stay, and asking twice is the same upvote. */
export function upvoteMeetingQuestion(
  meetingId: string,
  questionId: string,
): Promise<MeetingWrite<MeetingQuestionView>> {
  return write(async () => {
    const { data } = await meetingsUpvoteQuestion({
      path: { meetingId, questionId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: questionView(data) };
  });
}

/** Take an upvote back. An upvote that could not be taken back would be a vote, not a signal. */
export function withdrawMeetingQuestionUpvote(
  meetingId: string,
  questionId: string,
): Promise<MeetingWrite<MeetingQuestionView>> {
  return write(async () => {
    const { data } = await meetingsWithdrawQuestionUpvote({
      path: { meetingId, questionId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: questionView(data) };
  });
}

/**
 * Mark a question answered, or take the mark back. A boolean rather than a one-way act, because a
 * host working a queue fast marks the wrong row, and the record must not keep saying a question was
 * answered when it was not.
 */
export function markMeetingQuestionAnswered(
  meetingId: string,
  questionId: string,
  answered: boolean,
): Promise<MeetingWrite<MeetingQuestionView>> {
  return write(async () => {
    const { data } = await meetingsSetQuestionAnswered({
      path: { meetingId, questionId },
      body: { answered },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: questionView(data) };
  });
}

/**
 * Take a question back: the body is blanked and the row stays. The author may take back their own,
 * and somebody hosting may take back any, on chat's own rule.
 */
export function redactMeetingQuestion(
  meetingId: string,
  questionId: string,
): Promise<MeetingWrite<MeetingQuestionView>> {
  return write(async () => {
    const { data } = await meetingsRedactQuestion({
      path: { meetingId, questionId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    });
    return { data: questionView(data) };
  });
}

/*
 * RECORDING THE MEETING: starting and stopping it, the list of what has been recorded, and the
 * record of who was told.
 *
 * Both acts are routes for the reason every act with an author is: the permission check, the audit
 * row and the recording's own row belong at the server's chokepoint, and the room is then told by
 * the route. What the room broadcasts is what lights the mark on every screen — this browser's
 * included — so nothing here answers with anything a screen draws the mark from.
 *
 * The calls are the generated operations and the view types are the contract's own, so a change to
 * a recording's shape on the server is a type error here rather than a screen that quietly reads a
 * field that is no longer sent. The list itself is read through the generated query options, into
 * the one cache, by `screen/recording-list.svelte`.
 */

/** Somebody named on a recording: who started it, or who stopped it. */
export type MeetingRecordingActorView = MeetingRecordingSummary["startedBy"];

/** Where one recording is in its life, in the server's own vocabulary. */
export type MeetingRecordingStateView = MeetingRecordingSummary["state"];

/**
 * One recording, as the list reads it: identifiers, instants, a count and a state. No audio.
 *
 * Two fields are stated here rather than taken as generated. `stoppedBy` is null on the wire while a
 * recording runs and when nobody stopped it — the route's schema says so — but the generated type
 * intersects the actor with its nullable arm and loses the null, so a screen reading it as never null
 * would be wrong about every recording that stopped on its own. `failureErrorId` is the Error ID a
 * failed recording was recorded under (the record's `failure_error_id`); it is optional because the
 * list states it only where the summary carries one, and a summary that does not send it reads as a
 * failure with no Error ID.
 */
export type MeetingRecordingView = MeetingRecordingSummary;

/** Why somebody was told: the start, an arrival while it ran, or the stop. */
export type MeetingRecordingNoticeReasonView = MeetingRecordingNoticeEntry["reason"];

/** One occasion on which the room told somebody, which is the consent record. */
export type MeetingRecordingNoticeView = MeetingRecordingNoticeEntry;

/** One page of who was told, and where the next page starts. */
export interface MeetingRecordingNoticePageView {
  readonly notices: readonly MeetingRecordingNoticeView[];
  readonly nextCursor: string | null;
}

/**
 * Start recording this meeting. Answers with the recording; the mark lights on the room's frame.
 *
 * Refused `meeting-recording-not-configured` where the firm has not switched recording on, and with
 * the recording problem types for a room already being recorded, a firm event, or a room too full.
 */
export function startMeetingRecording(
  meetingId: string,
): Promise<MeetingWrite<MeetingRecordingView>> {
  return write(() =>
    meetingsStartRecording({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Stop the recording running in this meeting. The key that starts one stops it, and so does a grant
 * on this meeting: somebody running the room can already end it, and ending it stops the recording.
 */
export function stopMeetingRecording(
  meetingId: string,
): Promise<MeetingWrite<MeetingRecordingView>> {
  return write(() =>
    meetingsStopRecording({
      path: { meetingId },
      headers: { "idempotency-key": newWriteKey() },
      throwOnError: true,
    }),
  );
}

/**
 * Whether the firm can record this meeting at all, as the meeting's summary states it: the
 * deployment can carry a recording AND the firm has switched recording on. The screen reads it to
 * say so in place of the control, rather than offering an act the route would refuse.
 */
export function recordingIsConfigured(
  summary: Pick<MeetingSummary, "recordingConfigured">,
): boolean {
  return summary.recordingConfigured;
}

/**
 * Who was told about one recording, and when: the consent record. A host's read — the key to host
 * meetings — because it is a list of everybody who was in the room, guests included.
 */
export function readMeetingRecordingNotices(
  meetingId: string,
  recordingId: string,
  cursor: string | null = null,
): Promise<MeetingWrite<MeetingRecordingNoticePageView>> {
  return write(async () => {
    const { data } = await meetingsRecordingNotices({
      path: { meetingId, recordingId },
      query: cursor === null ? undefined : { cursor },
      throwOnError: true,
    });
    return { data: { notices: data.data, nextCursor: data.nextCursor } };
  });
}

/** Start ticking, and answer with the way to stop. The one timer the two records share. */
function every(milliseconds: number, tick: () => void): () => void {
  const ticking = setInterval(tick, milliseconds);
  return () => clearInterval(ticking);
}

/**
 * The polls' seams as the app supplies them.
 *
 * The meeting arrives as an accessor rather than a value because the room screen is reused across
 * an address change, and a meeting captured when the module was built would read the last room's.
 */
export function meetingPollSeams(meetingId: () => string): MeetingPollSeams {
  return {
    list: (cursor) => readMeetingPolls(meetingId(), cursor),
    open: (draft) => openMeetingPoll(meetingId(), draft),
    answer: (pollId, optionIds) => answerMeetingPoll(meetingId(), pollId, optionIds),
    close: (pollId) => closeMeetingPoll(meetingId(), pollId),
    answers: (pollId, cursor) => readMeetingPollAnswers(meetingId(), pollId, cursor),
    every,
  };
}

/** The question queue's seams as the app supplies them, on the same terms. */
export function meetingQuestionSeams(meetingId: () => string): MeetingQuestionSeams {
  return {
    list: (cursor, after) => readMeetingQuestions(meetingId(), cursor, after ?? null),
    ask: (body) => askMeetingQuestion(meetingId(), body),
    upvote: (questionId) => upvoteMeetingQuestion(meetingId(), questionId),
    withdrawUpvote: (questionId) => withdrawMeetingQuestionUpvote(meetingId(), questionId),
    markAnswered: (questionId, answered) =>
      markMeetingQuestionAnswered(meetingId(), questionId, answered),
    redact: (questionId) => redactMeetingQuestion(meetingId(), questionId),
    every,
  };
}

/** The two recording acts as the room client takes them, on the same terms as the records'. */
export function meetingRecordingRoutes(meetingId: () => string): MeetingRecordingRoutes {
  return {
    start: () => startMeetingRecording(meetingId()),
    stop: () => stopMeetingRecording(meetingId()),
  };
}

/**
 * The problem-type URI a slug names, which is how a screen branches on WHICH refusal it got.
 *
 * The server emits the registered URI rather than the bare slug, and a screen comparing the two
 * silently never matches — so the one place the prefix is written down is here, beside the calls
 * whose refusals are read.
 */
export function meetingProblemType(slug: string): string {
  return `https://api.magnacarta.esq/problems/${slug}`;
}

/** Whether a failure is the named refusal, rather than some other way the same call can fail. */
export function refusedAs(failure: Failure | null, slug: string): boolean {
  return failure?.problem?.type === meetingProblemType(slug);
}

/** Where the event this meeting hangs on is read: the calendar, with the entry's window open. */
export function eventAddress(
  eventKind: "matter" | "firm",
  eventId: string,
  matterId: string | null,
): string {
  const entry = `entry=${encodeURIComponent(eventId)}`;
  if (eventKind === "matter" && matterId !== null) {
    return `/matters/${encodeURIComponent(matterId)}/calendar?${entry}`;
  }
  return `/calendar?${entry}`;
}
