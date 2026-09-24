import { describe, expect, it } from "vitest";
import {
  MAX_MEETING_FRAME_BYTES,
  MEETING_CLIENT_FRAME_TYPES,
  MEETING_PROTOCOL_VERSION,
  MEETING_ROOM_FRAME_TYPES,
  parseMeetingClientFrame,
  pollClosedFrame,
  pollOpenedFrame,
  pollTallyFrame,
  questionAskedFrame,
  questionTallyFrame,
  questionUpdatedFrame,
  type MeetingPollSnapshot,
  type MeetingQuestionSnapshot,
} from "../src/frames.ts";

/*
 * THE SIX ROOM FRAMES THE POLL AND THE QUESTION QUEUE ADDED, and the one thing they deliberately did
 * not add: a client frame. Every poll and question act is a route, so the browser sends nothing new
 * on the socket — a `poll-answer` arriving here is a browser from another protocol, and it has to be
 * told so rather than acted on.
 *
 * What is measured beyond the shapes is the frame ceiling: a poll and a question travel WHOLE, which
 * is only honest while the largest of each sits far inside what one frame may carry.
 */

const POLL: MeetingPollSnapshot = {
  id: "meetingPoll_frameTest000000",
  meetingId: "meeting_frameTest000000000",
  askedByUserId: "user_frameHost00000000",
  question: "Which date suits?",
  anonymous: true,
  maxChoices: 1,
  openedAt: "2026-09-24T12:00:00.000Z",
  closedAt: null,
  closedByUserId: null,
  options: [
    { optionId: "meetingPollOption_a00000000", position: 0, label: "Monday", count: 0 },
    { optionId: "meetingPollOption_b00000000", position: 1, label: "Tuesday", count: 0 },
  ],
  respondents: 0,
};

const QUESTION: MeetingQuestionSnapshot = {
  id: "meetingQuestion_frameTest00000",
  meetingId: "meeting_frameTest000000000",
  participantKind: "member",
  participantId: "meetingAttendance_frameTest000",
  userId: "user_frameAsker0000000",
  body: "When is the next hearing?",
  askedAt: "2026-09-24T12:00:00.000Z",
  answeredAt: null,
  answeredByUserId: null,
  redactedAt: null,
  redactedByUserId: null,
  upvotes: 0,
};

describe("the poll and question frames", () => {
  it("are declared as room frames, and none of them as a client frame", () => {
    const added = [
      "poll-opened",
      "poll-closed",
      "poll-tally",
      "question-asked",
      "question-updated",
      "question-tally",
    ];
    for (const type of added) {
      expect(MEETING_ROOM_FRAME_TYPES).toContain(type);
      expect(MEETING_CLIENT_FRAME_TYPES).not.toContain(type);
    }
    expect(parseMeetingClientFrame(JSON.stringify({ v: 1, type: "poll-answer" }))).toEqual({
      refusal: "unknown-frame",
    });
  });

  it("carry the poll and the question whole, stamped with the version", () => {
    expect(JSON.parse(pollOpenedFrame(POLL))).toEqual({
      v: MEETING_PROTOCOL_VERSION,
      type: "poll-opened",
      poll: POLL,
    });
    expect(JSON.parse(questionAskedFrame(QUESTION))).toEqual({
      v: MEETING_PROTOCOL_VERSION,
      type: "question-asked",
      question: QUESTION,
    });
    const redacted = {
      ...QUESTION,
      body: "",
      redactedAt: "2026-09-24T12:01:00.000Z",
      redactedByUserId: "user_frameHost00000000",
    };
    expect(JSON.parse(questionUpdatedFrame(redacted))).toMatchObject({
      type: "question-updated",
      question: { body: "", redactedAt: "2026-09-24T12:01:00.000Z" },
    });
  });

  it("carry a tally as counts in the poll's order and people rather than answers", () => {
    const counts = [
      { optionId: "meetingPollOption_a00000000", count: 3 },
      { optionId: "meetingPollOption_b00000000", count: 0 },
    ];
    expect(JSON.parse(pollTallyFrame(POLL.id, counts, 3, "2026-09-24T12:00:01.000Z"))).toEqual({
      v: MEETING_PROTOCOL_VERSION,
      type: "poll-tally",
      pollId: POLL.id,
      counts,
      respondents: 3,
      at: "2026-09-24T12:00:01.000Z",
    });
    expect(JSON.parse(pollClosedFrame(POLL.id, "2026-09-24T12:05:00.000Z", counts, 3))).toEqual({
      v: MEETING_PROTOCOL_VERSION,
      type: "poll-closed",
      pollId: POLL.id,
      closedAt: "2026-09-24T12:05:00.000Z",
      counts,
      respondents: 3,
    });
    expect(
      JSON.parse(
        questionTallyFrame([{ questionId: QUESTION.id, upvotes: 7 }], "2026-09-24T12:00:01.000Z"),
      ),
    ).toEqual({
      v: MEETING_PROTOCOL_VERSION,
      type: "question-tally",
      questions: [{ questionId: QUESTION.id, upvotes: 7 }],
      at: "2026-09-24T12:00:01.000Z",
    });
  });

  it("fit the largest poll and the largest question far inside one frame", () => {
    const largestPoll: MeetingPollSnapshot = {
      ...POLL,
      question: "q".repeat(500),
      options: Array.from({ length: 10 }, (_unused, position) => ({
        optionId: `meetingPollOption_${String(position).padStart(9, "0")}`,
        position,
        label: "l".repeat(200),
        count: 300,
      })),
    };
    const largestQuestion: MeetingQuestionSnapshot = { ...QUESTION, body: "b".repeat(1000) };
    const encoder = new TextEncoder();
    expect(encoder.encode(pollOpenedFrame(largestPoll)).byteLength).toBeLessThan(
      MAX_MEETING_FRAME_BYTES / 8,
    );
    expect(encoder.encode(questionAskedFrame(largestQuestion)).byteLength).toBeLessThan(
      MAX_MEETING_FRAME_BYTES / 8,
    );
  });
});
