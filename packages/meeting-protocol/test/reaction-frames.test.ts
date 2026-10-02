import { describe, expect, it } from "vitest";
import {
  MEETING_REACTIONS,
  MEETING_REFUSAL_REASONS,
  MEETING_ROOM_FRAME_TYPES,
  parseMeetingClientFrame,
  reactionRelayFrame,
  reactionsFrame,
  SIGNAL_INTERVAL_MILLISECONDS,
  type MeetingChatMessage,
  type RosterParticipant,
  messageFrame,
  messageRedactedFrame,
} from "../src/frames.ts";

/*
 * THE PARSE SURFACE OF THE TWO SIGNALS THAT ARE RELAYED AND NEVER STORED, and the shapes the room
 * builds for them.
 *
 * What is worth testing here is precisely what a type system cannot ask. The vocabulary is closed at
 * RUNTIME — a `reaction` naming something outside the six is a frame off the wire, not a value a
 * compiler ever sees — and the difference between "this room speaks no such frame" and "this frame's
 * fields are wrong" is a distinction a client branches on: the first is a browser from another
 * protocol and the second is a bug in this one, and a client that cannot tell them apart retries the
 * wrong one.
 *
 * The additive half is the other thing measured: a `presence` frame with no `hand` has to go on
 * parsing, because a browser left open across the deploy sends exactly that and reading its absence
 * as `false` would lower the hand of everybody who had not reloaded.
 */

function parse(frame: unknown) {
  return parseMeetingClientFrame(JSON.stringify(frame));
}

describe("a reaction off the wire", () => {
  it.each([...MEETING_REACTIONS])("parses every name the vocabulary holds: %s", (name) => {
    const parsed = parse({ v: 1, type: "reaction", name });
    expect("frame" in parsed && parsed.frame).toEqual({ v: 1, type: "reaction", name });
  });

  it("refuses a name outside the vocabulary as MALFORMED rather than unknown", () => {
    // The type is one this room speaks, so the frame is a bug in this protocol rather than a
    // browser from another one — which is the distinction the client's retry branches on. An open
    // vocabulary is what this refusal exists to prevent: a free string here would put arbitrary
    // text on a tile in a firm's meeting.
    const parsed = parse({ v: 1, type: "reaction", name: "shrug" });
    expect(parsed).toEqual({ refusal: "malformed-frame" });
  });

  it("refuses a frame whose TYPE this room does not speak as unknown", () => {
    expect(parse({ v: 1, type: "reactions", counts: {} })).toEqual({ refusal: "unknown-frame" });
  });

  it("carries nothing but the name — no sender, no instant", () => {
    // Both are taken from the room's own side: the sender from the socket's attachment, the instant
    // from the room's clock. A modified client can no more react as somebody else than it can
    // publish under their name.
    const parsed = parse({
      v: 1,
      type: "reaction",
      name: "applause",
      participantId: "meetingAttendance_somebodyElse",
      at: "1999-01-01T00:00:00.000Z",
    });
    expect("frame" in parsed && parsed.frame).toEqual({
      v: 1,
      type: "reaction",
      name: "applause",
    });
  });
});

describe("a presence frame across the deploy that added the hand", () => {
  it("parses with no hand at all, which means the stored value is left where it stands", () => {
    const parsed = parse({ v: 1, type: "presence", speaking: true, muted: false });
    expect("frame" in parsed && parsed.frame).toEqual({
      v: 1,
      type: "presence",
      speaking: true,
      muted: false,
    });
  });

  it("carries the hand when the browser has something to say about one", () => {
    const parsed = parse({ v: 1, type: "presence", speaking: false, muted: true, hand: true });
    expect("frame" in parsed && parsed.frame).toMatchObject({ hand: true });
  });
});

describe("lowering a hand that is not your own", () => {
  it("names one stay, or null for the whole room", () => {
    expect(
      "frame" in parse({ v: 1, type: "lower-hands", participantId: "meetingAttendance_one" }),
    ).toBe(true);
    expect("frame" in parse({ v: 1, type: "lower-hands", participantId: null })).toBe(true);
  });

  it("refuses a frame that names no participant field at all", () => {
    // Absent is not null. Null is the whole room and absent is a client that has not decided, and
    // reading the second as the first would clear three hundred hands on a malformed frame.
    expect(parse({ v: 1, type: "lower-hands" })).toEqual({ refusal: "malformed-frame" });
  });
});

describe("what the room builds", () => {
  it("names the reactor and the room's own instant on an individual relay", () => {
    const at = "2026-09-21T10:00:00.000Z";
    expect(JSON.parse(reactionRelayFrame("meetingAttendance_one", "heart", at))).toEqual({
      v: 1,
      type: "reaction",
      participantId: "meetingAttendance_one",
      name: "heart",
      at,
    });
  });

  it("carries counts keyed by name, and only the names that arrived", () => {
    const at = "2026-09-21T10:00:00.000Z";
    expect(JSON.parse(reactionsFrame({ applause: 11, "thumbs-up": 2 }, at))).toEqual({
      v: 1,
      type: "reactions",
      counts: { applause: 11, "thumbs-up": 2 },
      at,
    });
  });

  it("relays a message whole, in the shape the list route returns", () => {
    // The frame and the read answer with the same object, so a screen has one shape to draw and a
    // browser catching up after a missed frame applies what it already knows how to apply.
    const message: MeetingChatMessage = {
      id: "meetingMessage_one",
      meetingId: "meeting_one",
      participantKind: "member",
      participantId: "meetingAttendance_one",
      userId: "user_one",
      sentAt: "2026-09-21T10:00:00.000Z",
      body: "The exhibits are in the shared folder.",
      redactedAt: null,
      redactedByUserId: null,
    };
    expect(JSON.parse(messageFrame(message))).toEqual({ v: 1, type: "message", message });
  });

  it("says a message was taken back with the handle and the instant alone", () => {
    // No body: the record's is already blank, and a whole record would carry an empty string to say
    // what these two fields say.
    expect(
      JSON.parse(messageRedactedFrame("meetingMessage_one", "2026-09-21T10:05:00.000Z")),
    ).toEqual({
      v: 1,
      type: "message-redacted",
      messageId: "meetingMessage_one",
      redactedAt: "2026-09-21T10:05:00.000Z",
    });
  });
});

describe("the vocabulary and the numbers both ends divide by", () => {
  it("refuses a signal that arrives too fast WITHOUT closing the socket, which is a new kind", () => {
    // Every other non-fatal reason is about the shape of a frame or about what it named. This one is
    // about its timing, and it is the first the client has to treat as "try again in a moment"
    // rather than "fix the frame".
    expect(MEETING_REFUSAL_REASONS).toContain("rate-limited");
  });

  it("states the signal window, because a client that paced itself would be refused for it", () => {
    expect(SIGNAL_INTERVAL_MILLISECONDS).toBe(1000);
  });

  it("declares the four frames the two slices added to the room's side", () => {
    expect(MEETING_ROOM_FRAME_TYPES).toContain("reaction");
    expect(MEETING_ROOM_FRAME_TYPES).toContain("reactions");
    expect(MEETING_ROOM_FRAME_TYPES).toContain("message");
    expect(MEETING_ROOM_FRAME_TYPES).toContain("message-redacted");
  });

  it("carries the hand as two wire fields over what the room stores as one", () => {
    // The boolean is what every tile, roster row and badge branches on; the instant is what the
    // hands panel sorts by. A reader of the roster type has to see both, which is what this pins.
    const participant: RosterParticipant = {
      participantId: "meetingAttendance_one",
      userId: "user_one",
      displayName: "A Member",
      sfuSessionId: null,
      tracks: [],
      speaking: false,
      muted: false,
      hostRole: null,
      hand: true,
      handRaisedAt: "2026-09-21T10:00:00.000Z",
    };
    expect(participant.hand).toBe(participant.handRaisedAt !== null);
  });
});
