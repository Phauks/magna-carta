import { env, runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MeetingRoom } from "../src/meetings/meeting-room.ts";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { MAX_MEETING_FRAME_BYTES, PING_FRAME } from "../src/meetings/meeting-room-protocol.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu-client.ts";

// The meeting's signaling protocol, against a fake media routing service.
//
// The scope note the other hibernation surfaces carry applies here too: the local test pool cannot
// evict a Durable Object, so the hibernate/wake cycle itself is not exercised. What IS exercised is
// that every fact a woken room would need lives where it would survive — the per-socket attachment
// and the room's own storage — and that the frames a browser receives are the ones the protocol
// says.
//
// The routing service is faked at the module seam rather than through the environment, because a
// Durable Object is constructed by the runtime with the deployment's own environment: a test driving
// the room directly has no way to hand it one of its own.

const LOCAL_ANSWER = { type: "answer", sdp: "v=0 local-answer" };
const REMOTE_OFFER = { type: "offer", sdp: "v=0 remote-offer" };

interface TrackRequest {
  location: "local" | "remote";
  trackName?: string;
  mid?: string;
  sessionId?: string;
}

let sessionCounter = 0;

// Answers exactly what the Realtime selective forwarding unit answers, in the shapes the client
// parses: a session handle, an answer for what a browser publishes, an offer for what it subscribes
// to, and an acknowledgement for the rest.
const fakeRoutingService: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input as Request).url);
  const body =
    typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  if (url.pathname.endsWith("/sessions/new")) {
    sessionCounter += 1;
    return json({ sessionId: `routing-session-${String(sessionCounter)}` });
  }
  if (url.pathname.endsWith("/tracks/new")) {
    const tracks = (body["tracks"] ?? []) as TrackRequest[];
    const local = tracks.every((track) => track.location === "local");
    return json({
      requiresImmediateRenegotiation: !local,
      sessionDescription: local ? LOCAL_ANSWER : REMOTE_OFFER,
      // `sessionId` is echoed only on a remote subscription; on a local publish it is undefined, and
      // JSON.stringify drops the key — which is exactly the shape the real service answers with.
      tracks: tracks.map((track, index) => ({
        location: track.location,
        mid: String(index),
        trackName: track.trackName,
        sessionId: track.sessionId,
      })),
    });
  }
  if (url.pathname.endsWith("/renegotiate")) return json({});
  if (url.pathname.endsWith("/tracks/close")) {
    const tracks = (body["tracks"] ?? []) as { mid: string }[];
    return json({
      requiresImmediateRenegotiation: false,
      sessionDescription: LOCAL_ANSWER,
      tracks: tracks.map((track) => ({ mid: track.mid })),
    });
  }
  return new Response("unexpected", { status: 404 });
};

const FIRM = "firm_meetingRoomTestFirm0";
let meetingCounter = 0;

function roomStub(meetingId: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${FIRM}:${meetingId}`));
}

/** A room of this test's own, so one test's roster is never another's. */
function freshRoom(): { meetingId: string; stub: ReturnType<typeof roomStub> } {
  meetingCounter += 1;
  const meetingId = `meeting_roomTest${String(meetingCounter).padStart(10, "0")}`;
  return { meetingId, stub: roomStub(meetingId) };
}

interface Participant {
  readonly frames: Record<string, unknown>[];
  send(data: string | ArrayBuffer): void;
  closeCode(): number | null;
}

// A push crosses a socket pair and this suite shares the box with other Workers runtimes, so a fixed
// number of macrotasks is not a wait — it is a guess that gets worse under load. Wait on elapsed
// time for the condition instead.
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The most recent roster this participant was sent, which is the one that is current. */
function rosterOf(
  participant: Participant,
): { participants: { userId: string; displayName: string }[] } | undefined {
  const frames = participant.frames.filter((frame) => frame["type"] === "roster");
  return frames.at(-1) as { participants: { userId: string; displayName: string }[] } | undefined;
}

async function waitForFrames(participant: Participant, count: number): Promise<void> {
  await waitFor(() => participant.frames.length >= count);
  expect(participant.frames.length).toBeGreaterThanOrEqual(count);
}

async function connect(
  stub: ReturnType<typeof roomStub>,
  meetingId: string,
  attendanceId: string,
  displayName: string,
): Promise<Participant> {
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId: FIRM,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        displayName,
      }),
      { headers: { Upgrade: "websocket" } },
    ),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no WebSocket on the 101");

  const frames: Record<string, unknown>[] = [];
  let closeCode: number | null = null;
  socket.accept();
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  // The welcome is sent before the room returns its 101, but it still has to cross the pair and
  // reach this listener. Every caller asserts on it, so wait for it here rather than in each.
  await waitFor(() => frames.length > 0);
  return {
    frames,
    send: (data) => {
      socket.send(data as string);
    },
    closeCode: () => closeCode,
  };
}

beforeAll(() => {
  setSfuFetchForTests(fakeRoutingService);
});

afterAll(() => {
  // Removed rather than left installed: this seam stands in for the deployment's own selection, and
  // a suite that left it set would make every later file in this worker look configured.
  setSfuFetchForTests(null);
});

describe("joining the room", () => {
  it("welcomes a participant with their own handle and the roster", async () => {
    const { meetingId, stub } = freshRoom();
    const first = await connect(stub, meetingId, "meetingAttendance_one", "A Host");

    expect(first.frames[0]).toEqual({
      v: 1,
      type: "welcome",
      participantId: "meetingAttendance_one",
      roster: [
        {
          participantId: "meetingAttendance_one",
          userId: "user_meetingAttendance_one",
          displayName: "A Host",
          sfuSessionId: null,
          tracks: [],
        },
      ],
    });
  });

  it("tells everybody already in the room that somebody arrived", async () => {
    const { meetingId, stub } = freshRoom();
    const first = await connect(stub, meetingId, "meetingAttendance_one", "A Host");
    await connect(stub, meetingId, "meetingAttendance_two", "A Guest");

    await waitForFrames(first, 2);
    const roster = first.frames[1] as { type: string; participants: { displayName: string }[] };
    expect(roster.type).toBe("roster");
    expect(roster.participants.map((one) => one.displayName).toSorted()).toEqual([
      "A Guest",
      "A Host",
    ]);
  });
});

describe("the signaling exchange", () => {
  it("answers a publish with the routing service's answer and where each track landed", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_pub", "A Host");

    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [
          { trackName: "camera", mid: "0", kind: "video" },
          { trackName: "microphone", mid: "1", kind: "audio" },
        ],
      }),
    );

    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({
      v: 1,
      type: "published",
      sessionDescription: LOCAL_ANSWER,
      tracks: [
        { trackName: "camera", mid: "0" },
        { trackName: "microphone", mid: "1" },
      ],
    });

    // The roster is what tells everybody else there is something new to ask for, so a publish is
    // followed by one.
    await waitForFrames(participant, 3);
    const roster = participant.frames[2] as {
      type: string;
      participants: { sfuSessionId: string | null; tracks: { trackName: string }[] }[];
    };
    expect(roster.type).toBe("roster");
    expect(roster.participants[0]?.sfuSessionId).toMatch(/^routing-session-/);
    expect(roster.participants[0]?.tracks.map((track) => track.trackName)).toEqual([
      "camera",
      "microphone",
    ]);
  });

  it("answers a subscribe with the routing service's OWN offer", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_sub", "A Guest");

    participant.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: "routing-session-of-somebody-else", trackName: "camera" }],
      }),
    );

    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({
      v: 1,
      type: "subscribed",
      // The browser is asking to RECEIVE, so the routing service is the side with something to
      // describe and the browser answers it.
      sessionDescription: REMOTE_OFFER,
      tracks: [{ sessionId: "routing-session-of-somebody-else", trackName: "camera", mid: "0" }],
    });
  });

  it("acknowledges a renegotiation and a close", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_neg", "A Host");

    participant.send(
      JSON.stringify({
        v: 1,
        type: "renegotiate",
        sessionDescription: { type: "answer", sdp: "v=0 browser-answer" },
      }),
    );
    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({ v: 1, type: "renegotiated" });

    participant.send(JSON.stringify({ v: 1, type: "close", mids: ["0"] }));
    await waitForFrames(participant, 3);
    expect(participant.frames[2]).toEqual({
      v: 1,
      type: "closed",
      sessionDescription: LOCAL_ANSWER,
    });
  });
});

describe("frames the room will not serve", () => {
  it("refuses a malformed or unknown frame and keeps the socket", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_bad", "A Host");

    participant.send("{not json");
    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({ v: 1, type: "refused", reason: "malformed-frame" });

    // The right type with the wrong fields is told apart from a browser speaking another protocol:
    // the first is a bug in this one, the second is not, and a client retries them differently.
    participant.send(JSON.stringify({ v: 1, type: "publish" }));
    await waitForFrames(participant, 3);
    expect(participant.frames[2]).toEqual({ v: 1, type: "refused", reason: "malformed-frame" });

    participant.send(JSON.stringify({ v: 1, type: "somethingElse" }));
    await waitForFrames(participant, 4);
    expect(participant.frames[3]).toEqual({ v: 1, type: "refused", reason: "unknown-frame" });

    participant.send(new ArrayBuffer(8));
    await waitForFrames(participant, 5);
    expect(participant.frames[4]).toEqual({ v: 1, type: "refused", reason: "binary-unsupported" });

    // A bad frame is not a reason to drop somebody out of a meeting they are otherwise in: a
    // reconnecting browser has to renegotiate every track from nothing.
    expect(participant.closeCode()).toBeNull();

    participant.send(PING_FRAME);
    await waitForFrames(participant, 6);
    expect(participant.frames[5]).toEqual({ type: "pong" });
  });

  it("refuses a frame larger than the ceiling before parsing it", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_big", "A Host");

    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "x".repeat(MAX_MEETING_FRAME_BYTES) },
        tracks: [{ trackName: "camera", mid: "0", kind: "video" }],
      }),
    );

    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({ v: 1, type: "refused", reason: "frame-too-large" });
    expect(participant.closeCode()).toBeNull();
  });
});

describe("the end of the meeting", () => {
  it("tells everybody still connected and closes every socket", async () => {
    const { meetingId, stub } = freshRoom();
    const first = await connect(stub, meetingId, "meetingAttendance_endOne", "A Host");
    const second = await connect(stub, meetingId, "meetingAttendance_endTwo", "A Guest");
    await waitForFrames(first, 2);

    await stub.end("2026-09-18T12:30:00.000Z");

    for (const participant of [first, second]) {
      await waitFor(() => participant.frames.some((frame) => frame["type"] === "ended"));
      expect(participant.frames.find((frame) => frame["type"] === "ended")).toEqual({
        v: 1,
        type: "ended",
        endedAt: "2026-09-18T12:30:00.000Z",
      });
      await waitFor(() => participant.closeCode() !== null);
      expect(participant.closeCode()).toBe(1000);
    }

    // The roster is signaling state and goes with the meeting; what stays is the instant it ended,
    // which is what lets a socket that had not yet noticed be told the truth. Nothing anybody said
    // was ever here to delete — the media is routed between browsers and never reaches this object.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect([...(await state.storage.list()).keys()]).toEqual(["ended"]);
    });
  });

  it("tells a socket that signals after the meeting closed why, rather than that it is a stranger", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_late", "A Host");
    await stub.end("2026-09-18T12:30:00.000Z");
    await waitFor(() => participant.frames.some((frame) => frame["type"] === "ended"));

    // The socket the room closed is gone, so this drives the case the room has to answer: a frame
    // arriving from a browser that had not yet noticed. A reconnect is what a browser does about
    // "the room does not know you"; there is nothing to reconnect to here.
    const stale = await connect(stub, meetingId, "meetingAttendance_stale", "A Guest");
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      await state.storage.delete("participant:meetingAttendance_stale");
    });
    stale.send(JSON.stringify({ v: 1, type: "close", mids: ["0"] }));

    await waitFor(() => stale.frames.some((frame) => frame["type"] === "refused"));
    expect(stale.frames.find((frame) => frame["type"] === "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "meeting-ended",
    });
    await waitFor(() => stale.closeCode() !== null);
    expect(stale.closeCode()).toBe(4000);
  });

  it("removes one person's roster entry when the leave route says their stay closed", async () => {
    const { meetingId, stub } = freshRoom();
    const first = await connect(stub, meetingId, "meetingAttendance_stayOne", "A Host");
    const second = await connect(stub, meetingId, "meetingAttendance_stayTwo", "A Guest");
    await waitForFrames(first, 2);

    await stub.participantLeft("meetingAttendance_stayTwo");

    await waitFor(() => rosterOf(first)?.participants.length === 1);
    expect(rosterOf(first)?.participants).toHaveLength(1);
    await waitFor(() => second.closeCode() !== null);
    expect(second.closeCode()).toBe(1000);
  });
});
