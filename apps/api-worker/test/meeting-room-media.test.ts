import { env, runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MeetingRoom } from "../src/meetings/meeting-room.ts";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";

// OPENING A ROUTING SESSION, WITH THE SERVICE SLOW.
//
// A participant's first publish or subscription opens their session at the media routing service. The
// room used to hold `blockConcurrencyWhile` across that call, which kept one participant's two frames
// from both opening a session and also held every other frame in the room behind it — three hundred
// arrivals at the top of the hour opened their sessions one at a time. These tests hold the service's
// answer open on purpose, which is the only way to see which of those two things the room is doing.
//
// The service is faked at the module seam, as in meeting-room.test.ts. Its hold is a flag the fake
// polls rather than a promise the test resolves: the fake runs inside the room's own request, and a
// promise settled from the test's request is one workerd is entitled not to wake the room for.

const FIRM = "firm_meetingRoomMediaFirm0";
let meetingCounter = 0;

interface Participant {
  readonly frames: Record<string, unknown>[];
  send(data: string): void;
  closeCode(): number | null;
}

interface UpstreamCall {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

let upstream: UpstreamCall[] = [];
let sessionCounter = 0;
// How many session openings the service has been asked for, and how many it has answered.
let creationsStarted = 0;
let creationsAnswered = 0;
// While raised, every request to open a session waits — the slow service at the top of the hour.
let holdingCreations = false;
// How many of the next requests to open a session fail, as a service that did not answer.
let creationsToFail = 0;

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Polled rather than awaited, for the reason given at the top of this file. The flag is set and
// cleared by the test, which is what the loop is waiting for.
async function waitWhileCreationsAreHeld(): Promise<void> {
  for (;;) {
    if (!holdingCreations) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const fakeRoutingService: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input as Request).url);
  const body =
    typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  upstream.push({ path: url.pathname, body });

  if (url.pathname.endsWith("/sessions/new")) {
    creationsStarted += 1;
    await waitWhileCreationsAreHeld();
    creationsAnswered += 1;
    if (creationsToFail > 0) {
      creationsToFail -= 1;
      return new Response("no", { status: 503 });
    }
    sessionCounter += 1;
    return json({ sessionId: `media-session-${String(sessionCounter)}` });
  }
  if (url.pathname.endsWith("/tracks/new")) {
    const tracks = (body["tracks"] ?? []) as {
      location: string;
      trackName?: string;
      sessionId?: string;
    }[];
    const local = tracks.every((track) => track.location === "local");
    return json({
      requiresImmediateRenegotiation: !local,
      sessionDescription: local
        ? { type: "answer", sdp: "v=0 local-answer" }
        : { type: "offer", sdp: "v=0 remote-offer" },
      tracks: tracks.map((track, index) => ({
        location: track.location,
        mid: String(index),
        trackName: track.trackName,
        sessionId: track.sessionId,
      })),
    });
  }
  if (url.pathname.endsWith("/tracks/close")) {
    const tracks = (body["tracks"] ?? []) as { mid: string }[];
    return json({
      requiresImmediateRenegotiation: false,
      sessionDescription: { type: "answer", sdp: "v=0 local-answer" },
      tracks: tracks.map((track) => ({ mid: track.mid })),
    });
  }
  if (url.pathname.endsWith("/renegotiate")) return json({});
  if (/\/sessions\/[^/]+$/.test(url.pathname)) return json({ tracks: [] });
  return new Response("unexpected", { status: 404 });
};

function freshRoom(): {
  meetingId: string;
  stub: ReturnType<typeof env.MEETING_ROOM.get>;
} {
  meetingCounter += 1;
  const meetingId = `meeting_mediaTest${String(meetingCounter).padStart(10, "0")}`;
  return {
    meetingId,
    stub: env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${FIRM}:${meetingId}`)),
  };
}

// Waited on elapsed time rather than a number of ticks: this suite shares the box with other Workers
// runtimes, and a count of macrotasks is a guess that gets worse under load.
async function waitFor(condition: () => boolean, budgetMilliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + budgetMilliseconds;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// A short pause, used ONLY to assert that something did not happen — a negative has no condition to
// wait on.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function connect(
  stub: ReturnType<typeof env.MEETING_ROOM.get>,
  meetingId: string,
  attendanceId: string,
): Promise<Participant> {
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId: FIRM,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        displayName: `seat ${attendanceId}`,
        medium: "video",
        hostRole: null,
        locked: false,
        lobby: "off",
        waiting: false,
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
  await waitFor(() => frames.length > 0);
  return {
    frames,
    send: (data) => {
      socket.send(data);
    },
    closeCode: () => closeCode,
  };
}

function framesOf(participant: Participant, type: string): Record<string, unknown>[] {
  return participant.frames.filter((frame) => frame["type"] === type);
}

function publishFrame(attendanceId: string, sdp = "v=0 browser-offer"): string {
  return JSON.stringify({
    v: 1,
    type: "publish",
    sessionDescription: { type: "offer", sdp },
    tracks: [{ trackName: `${attendanceId}:camera`, mid: "0", kind: "video" }],
  });
}

interface StoredRecord {
  readonly sfuSessionId: string | null;
  readonly tracks: readonly { readonly trackName: string }[];
  readonly subscribedMids: readonly string[];
}

async function storedRecord(
  stub: ReturnType<typeof env.MEETING_ROOM.get>,
  attendanceId: string,
): Promise<StoredRecord | undefined> {
  let found: StoredRecord | undefined;
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    found = await state.storage.get<StoredRecord>(`participant:${attendanceId}`);
  });
  return found;
}

/** Winds a participant's publish window back, so a second publish is not refused as too soon. */
async function rewindPublishWindow(
  stub: ReturnType<typeof env.MEETING_ROOM.get>,
  attendanceId: string,
): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const key = `participant:${attendanceId}`;
    const participant = await state.storage.get<Record<string, unknown>>(key);
    if (participant === undefined) throw new Error(`no participant at ${key}`);
    await state.storage.put(key, { ...participant, publishAt: null });
  });
}

/** The session each publish or subscription was sent into, read off the path the room called. */
function trackCallsInto(sessionId: string): UpstreamCall[] {
  return upstream.filter((call) => call.path.endsWith(`/sessions/${sessionId}/tracks/new`));
}

beforeAll(() => {
  setSfuFetchForTests(fakeRoutingService);
});

afterAll(() => {
  // Removed rather than left installed: the seam stands in for the deployment's own selection, and a
  // suite that left it set would make every later file in this worker look configured.
  setSfuFetchForTests(null);
});

beforeEach(() => {
  upstream = [];
  creationsStarted = 0;
  creationsAnswered = 0;
  holdingCreations = false;
  creationsToFail = 0;
});

describe("opening routing sessions while the service is slow", () => {
  it("opens two participants' sessions at once and serves the rest of the room meanwhile", async () => {
    const { meetingId, stub } = freshRoom();
    const first = "meetingAttendance_mediaFirst";
    const second = "meetingAttendance_mediaSecond";
    const onlooker = "meetingAttendance_mediaOnlooker";
    const firstSocket = await connect(stub, meetingId, first);
    const secondSocket = await connect(stub, meetingId, second);
    const onlookerSocket = await connect(stub, meetingId, onlooker);

    holdingCreations = true;
    firstSocket.send(publishFrame(first));
    secondSocket.send(publishFrame(second));

    // THE SECOND OPENING STARTS WHILE THE FIRST IS STILL UNANSWERED. With the room locked across the
    // call, the second participant's frame would not even be delivered until the first answer came
    // back, and this would stay at one for as long as the service took.
    await waitFor(() => creationsStarted === 2, 5_000);
    expect(creationsStarted).toBe(2);
    expect(creationsAnswered).toBe(0);

    // AND EVERYBODY ELSE IS STILL BEING SERVED. A sync is a frame that needs nothing of the service,
    // and it is answered with both openings still held.
    const rostersBefore = framesOf(onlookerSocket, "roster").length;
    onlookerSocket.send(JSON.stringify({ v: 1, type: "sync" }));
    await waitFor(() => framesOf(onlookerSocket, "roster").length > rostersBefore, 5_000);
    expect(framesOf(onlookerSocket, "roster").length).toBeGreaterThan(rostersBefore);
    expect(creationsAnswered).toBe(0);

    holdingCreations = false;
    await waitFor(
      () =>
        framesOf(firstSocket, "published").length === 1 &&
        framesOf(secondSocket, "published").length === 1,
    );
    expect(framesOf(firstSocket, "published")).toHaveLength(1);
    expect(framesOf(secondSocket, "published")).toHaveLength(1);

    // Each landed in a session of its own, and each record names the session its tracks are in.
    const firstRecord = await storedRecord(stub, first);
    const secondRecord = await storedRecord(stub, second);
    expect(firstRecord?.sfuSessionId).toMatch(/^media-session-/);
    expect(secondRecord?.sfuSessionId).toMatch(/^media-session-/);
    expect(firstRecord?.sfuSessionId).not.toBe(secondRecord?.sfuSessionId);
    expect(firstRecord?.tracks.map((track) => track.trackName)).toEqual([`${first}:camera`]);
    expect(trackCallsInto(firstRecord?.sfuSessionId ?? "")).toHaveLength(1);
    expect(trackCallsInto(secondRecord?.sfuSessionId ?? "")).toHaveLength(1);
  });

  it("opens exactly one session for two of one participant's frames racing each other", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_mediaPublisher";
    const racer = "meetingAttendance_mediaRacer";
    const publisherSocket = await connect(stub, meetingId, publisher);
    const racerSocket = await connect(stub, meetingId, racer);
    publisherSocket.send(publishFrame(publisher));
    await waitFor(() => framesOf(publisherSocket, "published").length === 1);
    const publisherSession = (await storedRecord(stub, publisher))?.sfuSessionId ?? "";
    expect(publisherSession).not.toBe("");
    const openedBefore = creationsStarted;

    // A publish and a subscription sent back to back, as a browser joining a meeting does: each
    // answers to its own window, so both reach the point of asking for a session while the first
    // ask is still out.
    holdingCreations = true;
    racerSocket.send(publishFrame(racer));
    racerSocket.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: publisherSession, trackName: `${publisher}:camera` }],
      }),
    );
    await waitFor(() => creationsStarted > openedBefore, 5_000);
    // Given time to ask a second time, which is the thing it must not do.
    await settle();
    expect(creationsStarted - openedBefore).toBe(1);

    holdingCreations = false;
    await waitFor(
      () =>
        framesOf(racerSocket, "published").length === 1 &&
        framesOf(racerSocket, "subscribed").length === 1,
    );
    expect(framesOf(racerSocket, "published")).toHaveLength(1);
    expect(framesOf(racerSocket, "subscribed")).toHaveLength(1);
    expect(creationsStarted - openedBefore).toBe(1);

    // Both acts went into the ONE session, and the record names it — with what each act learned.
    const record = await storedRecord(stub, racer);
    const racerSession = record?.sfuSessionId ?? "";
    expect(racerSession).toMatch(/^media-session-/);
    expect(trackCallsInto(racerSession)).toHaveLength(2);
    expect(record?.tracks.map((track) => track.trackName)).toEqual([`${racer}:camera`]);
    expect(record?.subscribedMids.length).toBeGreaterThan(0);
  });

  it("asks again on the next frame after a failed opening, and tells the socket with an Error ID", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_mediaUnlucky";
    const participant = await connect(stub, meetingId, attendanceId);

    creationsToFail = 1;
    participant.send(publishFrame(attendanceId));
    await waitFor(() => framesOf(participant, "refused").length === 1);
    const refusal = framesOf(participant, "refused")[0] as { reason: string; errorId?: string };
    expect(refusal.reason).toBe("sfu-unavailable");
    expect(refusal.errorId).toMatch(/^error_/);
    // Kept open: a service that did not answer once is not a reason to drop somebody out of a meeting.
    expect(participant.closeCode()).toBeNull();
    expect((await storedRecord(stub, attendanceId))?.sfuSessionId).toBeNull();

    // THE FAILURE IS NOT REMEMBERED. The next frame asks the service again rather than inheriting
    // the answer the last one got.
    await rewindPublishWindow(stub, attendanceId);
    participant.send(publishFrame(attendanceId));
    await waitFor(() => framesOf(participant, "published").length === 1);
    expect(framesOf(participant, "published")).toHaveLength(1);
    expect(creationsStarted).toBe(2);
    const record = await storedRecord(stub, attendanceId);
    expect(record?.sfuSessionId).toMatch(/^media-session-/);
    expect(record?.tracks.map((track) => track.trackName)).toEqual([`${attendanceId}:camera`]);
  });

  it("gives a browser that reconnected mid-opening the session, and nothing of the connection it replaced", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_mediaReloader";
    const before = await connect(stub, meetingId, attendanceId);

    holdingCreations = true;
    before.send(publishFrame(attendanceId, "v=0 offer-before-reload"));
    await waitFor(() => creationsStarted === 1, 5_000);

    // Reloaded at the spinner: the same stay, a new socket, and the old one hung up on.
    const after = await connect(stub, meetingId, attendanceId);
    await waitFor(() => before.closeCode() !== null);
    expect(before.closeCode()).not.toBeNull();
    after.send(publishFrame(attendanceId, "v=0 offer-after-reload"));
    await settle();

    holdingCreations = false;
    await waitFor(() => framesOf(after, "published").length === 1);
    expect(framesOf(after, "published")).toHaveLength(1);
    await settle();

    // One session, and only the live browser's offer went into it: the connection that has gone
    // offered nothing, so the session is bound to the peer connection that will actually use it.
    expect(creationsStarted).toBe(1);
    const record = await storedRecord(stub, attendanceId);
    const sessionId = record?.sfuSessionId ?? "";
    expect(sessionId).toMatch(/^media-session-/);
    const offers = trackCallsInto(sessionId).map(
      (call) => (call.body["sessionDescription"] as { sdp: string }).sdp,
    );
    expect(offers).toEqual(["v=0 offer-after-reload"]);
    expect(record?.tracks.map((track) => track.trackName)).toEqual([`${attendanceId}:camera`]);
  });
});
