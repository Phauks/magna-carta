import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { MAX_MEETING_PARTICIPANTS } from "@magna-carta/meetings/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { MeetingRoom } from "../src/meetings/meeting-room.ts";
import {
  meetingSocketRequestUrl,
  SOCKET_LOSS_GRACE_SECONDS,
} from "../src/meetings/meeting-room.ts";
import {
  MAX_MEETING_FRAME_BYTES,
  PING_FRAME,
  PONG_FRAME,
  ROSTER_DELTA_THRESHOLD,
} from "@magna-carta/meeting-protocol/frames";
import {
  PING_FRAME as PROGRESS_PING_FRAME,
  PONG_FRAME as PROGRESS_PONG_FRAME,
} from "../src/progress/job-progress-protocol.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";

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
// the room directly has no way to hand it one of its own. Every call the room makes is RECORDED, so
// a test can assert not only what the room said but what it did not ask for — which is the whole of
// the subscription check, since the service would honour a request for any session in the fleet.

const LOCAL_ANSWER = { type: "answer", sdp: "v=0 local-answer" };
const REMOTE_OFFER = { type: "offer", sdp: "v=0 remote-offer" };

// A track name the fake refuses, so the room can be driven through the answer it must not record.
const REFUSED_TRACK_SUFFIX = ":refused";

// A media section the fake will not change the layer of, so the room can be driven through the one
// answer a layer change has that is not a success.
const REFUSED_LAYER_MID = "99";

interface TrackRequest {
  location: "local" | "remote";
  trackName?: string;
  mid?: string;
  sessionId?: string;
}

interface UpstreamCall {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

let sessionCounter = 0;
let upstream: UpstreamCall[] = [];
let sessionsAreUnavailable = false;

// Answers exactly what the Realtime selective forwarding unit answers, in the shapes the client
// parses: a session handle, an answer for what a browser publishes, an offer for what it subscribes
// to, and an acknowledgement for the rest.
const fakeRoutingService: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input as Request).url);
  const body =
    typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  upstream.push({ path: url.pathname, body });
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  if (url.pathname.endsWith("/sessions/new")) {
    if (sessionsAreUnavailable) return new Response("no", { status: 503 });
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
      tracks: tracks.map((track, index) =>
        Object.assign(
          {
            location: track.location,
            mid: String(index),
            trackName: track.trackName,
            sessionId: track.sessionId,
          },
          track.trackName?.endsWith(REFUSED_TRACK_SUFFIX) === true
            ? { errorCode: "track_rejected" }
            : {},
        ),
      ),
    });
  }
  // A layer change: the service answers per media section, naming only the ones it refused.
  if (url.pathname.endsWith("/tracks/update")) {
    const tracks = (body["tracks"] ?? []) as { mid: string }[];
    return json({
      tracks: tracks.map((track) =>
        Object.assign(
          { mid: track.mid },
          track.mid === REFUSED_LAYER_MID ? { errorCode: "layer_unavailable" } : {},
        ),
      ),
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
  // The session read `closeSession` makes when the room holds no media sections of its own.
  if (/\/sessions\/[^/]+$/.test(url.pathname)) return json({ tracks: [] });
  return new Response("unexpected", { status: 404 });
};

// WHEN A TEST'S MEETING ENDS, read off the clock rather than written down. The room keeps the ended
// marker for a day and then retires it, so a fixed instant makes every assertion about that marker
// correct only until the day the instant ages out — after which the room is behaving exactly as it
// should and three tests say otherwise.
const ENDED_AT = new Date().toISOString();

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
  // The same frames before they were parsed, which is the only place a frame's SIZE on the wire can
  // be measured — the whole argument for sending differences is a number of bytes.
  readonly raw: string[];
  send(data: string | ArrayBuffer): void;
  close(): void;
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

/** The same wait, for a condition only a read inside the object can answer. */
async function waitForStored(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The most recent roster this participant was sent, which is the one that is current. */
function rosterOf(participant: Participant): RosterFrame | undefined {
  const frames = participant.frames.filter((frame) => frame["type"] === "roster");
  return frames.at(-1) as RosterFrame | undefined;
}

interface RosterEntry {
  participantId: string;
  userId: string;
  displayName: string;
  sfuSessionId: string | null;
  tracks: { trackName: string; kind: string }[];
  speaking: boolean;
  muted: boolean;
}
interface RosterFrame {
  participants: RosterEntry[];
}

interface RosterDeltaFrame {
  joined: RosterEntry[];
  left: string[];
  updated: RosterEntry[];
}

/** The differences this participant has been sent, oldest first. */
function deltasOf(participant: Participant): RosterDeltaFrame[] {
  return participant.frames.filter(
    (frame) => frame["type"] === "roster-delta",
  ) as unknown as RosterDeltaFrame[];
}

// A short pause, used ONLY to assert that something did not arrive. Everything positive waits on its
// own condition; a negative has no condition to wait on, so the choice is a bounded pause or no
// assertion at all.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function welcomeRosterOf(participant: Participant): RosterEntry[] {
  return (participant.frames[0] as { roster: RosterEntry[] }).roster;
}

async function waitForFrames(participant: Participant, count: number): Promise<void> {
  await waitFor(() => participant.frames.length >= count);
  expect(participant.frames.length).toBeGreaterThanOrEqual(count);
}

/** The frame of this type this participant most recently received. */
function lastFrame(participant: Participant, type: string): Record<string, unknown> | undefined {
  return participant.frames.filter((frame) => frame["type"] === type).at(-1);
}

async function connect(
  stub: ReturnType<typeof roomStub>,
  meetingId: string,
  attendanceId: string,
  displayName: string,
  medium: "video" | "audio" = "video",
): Promise<Participant> {
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId: FIRM,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        displayName,
        medium,
      }),
      { headers: { Upgrade: "websocket" } },
    ),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no WebSocket on the 101");

  const frames: Record<string, unknown>[] = [];
  const raw: string[] = [];
  let closeCode: number | null = null;
  socket.accept();
  socket.addEventListener("message", (event) => {
    const text = String(event.data);
    raw.push(text);
    frames.push(JSON.parse(text) as Record<string, unknown>);
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  // The welcome is sent before the room returns its 101, but it still has to cross the pair and
  // reach this listener. Every caller asserts on it, so wait for it here rather than in each.
  await waitFor(() => frames.length > 0);
  return {
    frames,
    raw,
    send: (data) => {
      socket.send(data as string);
    },
    close: () => {
      socket.close(1000, "test closed");
    },
    closeCode: () => closeCode,
  };
}

/** Publishes one track and waits for the answer, returning the routing session it landed in. */
async function publish(
  participant: Participant,
  attendanceId: string,
  tracks: readonly { readonly name: string; readonly kind: string }[],
): Promise<void> {
  const before = participant.frames.length;
  participant.send(
    JSON.stringify({
      v: 1,
      type: "publish",
      sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
      tracks: tracks.map((track, index) => ({
        trackName: `${attendanceId}:${track.name}`,
        mid: String(index),
        kind: track.kind,
      })),
    }),
  );
  await waitForFrames(participant, before + 1);
}

/** How a seeded roster entry names itself, so a test can subscribe to one of them. */
function seatHandle(seat: number): string {
  return `meetingAttendance_seat${String(seat).padStart(4, "0")}`;
}
function seatSession(seat: number): string {
  return `routing-session-seat-${String(seat)}`;
}

/**
 * Stands a large room up by writing roster entries straight into the object's storage.
 *
 * Three hundred real sockets is not what these tests are about — the room's own behaviour at that
 * size is — and opening them would make the suite a load test. The entries are exactly the shape the
 * room writes, so everything that reads the roster reads the same thing it always does.
 */
async function seedRoster(stub: ReturnType<typeof roomStub>, count: number): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    for (let start = 0; start < count; start += 100) {
      const batch: Record<string, unknown> = {};
      for (let seat = start; seat < Math.min(start + 100, count); seat += 1) {
        batch[`participant:${seatHandle(seat)}`] = {
          userId: `user_${seatHandle(seat)}`,
          displayName: `Attendee ${String(seat)}`,
          sfuSessionId: seatSession(seat),
          tracks: [{ trackName: `${seatHandle(seat)}:camera`, kind: "video", mid: "0" }],
          socketLostAt: null,
          speaking: false,
          muted: false,
          presenceAt: null,
        };
      }
      await state.storage.put(batch);
    }
  });
}

/** What the room currently holds about one participant's microphone. */
async function presenceOf(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
): Promise<{ speaking: boolean; muted: boolean; presenceAt: string | null }> {
  let found = { speaking: false, muted: false, presenceAt: null as string | null };
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const participant = await state.storage.get<typeof found>(`participant:${attendanceId}`);
    if (participant !== undefined) found = participant;
  });
  return found;
}

/**
 * How many times the room listed its roster keys while `run` was in flight.
 *
 * The instance's own storage is wrapped, which is the only way to count from outside: the room
 * deliberately holds nothing on the instance that survives hibernation, so there is no counter on it
 * to read. A room of three hundred pays three hundred keys per list, so the number this returns is
 * the difference between a frame the room can serve at that size and one it cannot.
 */
async function countStorageLists(
  stub: ReturnType<typeof roomStub>,
  run: () => Promise<void>,
): Promise<number> {
  let lists = 0;
  await runInDurableObject(stub, (_room: MeetingRoom, state) => {
    const storage = state.storage as unknown as {
      list: (options?: unknown) => Promise<unknown>;
    };
    const underlying = storage.list.bind(state.storage);
    storage.list = async (options?: unknown) => {
      lists += 1;
      return await underlying(options);
    };
  });
  await run();
  return lists;
}

beforeAll(() => {
  setSfuFetchForTests(fakeRoutingService);
});

afterAll(() => {
  // Removed rather than left installed: this seam stands in for the deployment's own selection, and
  // a suite that left it set would make every later file in this worker look configured.
  setSfuFetchForTests(null);
});

beforeEach(() => {
  upstream = [];
  sessionsAreUnavailable = false;
});

describe("the seam this whole file drives the room through", () => {
  it("is honoured because a test runner is running, and names which reading says so", () => {
    // The override is inert unless one of these two says a runner is present, which is what keeps a
    // module-level variable from being a way to redirect the fleet's meetings at a chosen endpoint.
    // Pinned here because the answer is measured rather than obvious: under the Workers pool it is
    // Vite's MODE, and `process.env.VITEST` is undefined even with the node compatibility flag on.
    const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE;
    expect(mode).toBe("test");
    // And the whole file is the proof of the other half: every frame below came back from the fake.
  });
});

describe("the keepalive pair, which is declared twice and must stay one string", () => {
  it("matches the progress protocol's byte for byte", () => {
    // The two live apart because a browser bundle cannot import from a Worker: the meeting
    // protocol package restates what apps/api-worker/src/progress/job-progress-protocol.ts
    // declares. Both are registered with the runtime's WebSocket auto-response, which matches the
    // request frame BYTE-FOR-BYTE — so one of them edited by a character silently costs every idle
    // participant a full wake of a hibernating room, with nothing failing.
    //
    // THIS FILE IS THE ONLY PLACE BOTH ARE REACHABLE AT ONCE. The package's own tests run in the
    // node pool, where the Worker module is not importable; this suite runs inside the Worker pool
    // and imports the package as the room does.
    expect(PING_FRAME).toBe(PROGRESS_PING_FRAME);
    expect(PONG_FRAME).toBe(PROGRESS_PONG_FRAME);
  });
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
          // Both facts ride on the roster rather than only on their own delta, so a browser arriving
          // in a room already in progress draws who is talking and who is muted at once.
          speaking: false,
          muted: false,
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

  it("supersedes the first socket when a second arrives for the same stay", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_rejoin";
    const observer = await connect(stub, meetingId, "meetingAttendance_watcher", "A Guest");
    const first = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(first, attendanceId, [{ name: "video", kind: "video" }]);
    const session = rosterOf(first)?.participants.find(
      (one) => one.participantId === attendanceId,
    )?.sfuSessionId;
    expect(session).toMatch(/^routing-session-/);
    upstream = [];

    // A RECONNECT IS A NEW PEER CONNECTION, always: new ICE credentials and a new DTLS fingerprint,
    // so it cannot resume the session the first one opened. Carrying the session forward left the
    // returning member publishing into a session nobody was subscribed to, while everybody else went
    // on subscribing to one that would never send again — a black tile that never resolves.
    const second = await connect(stub, meetingId, attendanceId, "A Host");

    // The displaced browser is told why rather than watching a socket go quiet.
    await waitFor(() => lastFrame(first, "refused") !== undefined);
    expect(lastFrame(first, "refused")).toEqual({ v: 1, type: "refused", reason: "superseded" });
    await waitFor(() => first.closeCode() !== null);
    expect(first.closeCode()).toBe(4000);

    // The stay is still theirs, and it starts again from no session and no tracks.
    const entry = welcomeRosterOf(second).find((one) => one.participantId === attendanceId);
    expect(entry?.sfuSessionId).toBeNull();
    expect(entry?.tracks).toEqual([]);

    // And everybody else is told, which is what makes them drop the subscription they were holding.
    await waitFor(
      () =>
        rosterOf(observer)?.participants.find((one) => one.participantId === attendanceId)?.tracks
          .length === 0,
    );
    expect(
      rosterOf(observer)?.participants.find((one) => one.participantId === attendanceId)
        ?.sfuSessionId,
    ).toBeNull();

    // The old session is nobody's now, and the service goes on forwarding it until told otherwise.
    await waitFor(() => upstream.some((call) => call.path.endsWith("/tracks/close")));
    const close = upstream.find((call) => call.path.endsWith("/tracks/close"));
    expect(close?.path).toContain(encodeURIComponent(session ?? ""));
    expect(close?.body).toEqual({ tracks: [{ mid: "0" }], force: true });
  });

  it("times no grace for the superseded socket, and removes nobody", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_takeover";
    const first = await connect(stub, meetingId, attendanceId, "A Host");
    const second = await connect(stub, meetingId, attendanceId, "A Host");

    await waitFor(() => first.closeCode() !== null);
    // The member is sitting in the meeting on the newer socket, so nothing was lost and there is
    // nothing to time. A grace armed here would close the record of somebody who is present.
    expect(second.closeCode()).toBeNull();
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      const participant = await state.storage.get<{ socketLostAt: string | null }>(
        `participant:${attendanceId}`,
      );
      expect(participant).toBeDefined();
      expect(participant?.socketLostAt).toBeNull();
    });
  });
});

describe("the signaling exchange", () => {
  it("answers a publish with the routing service's answer and where each track landed", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_pub";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");

    await publish(participant, attendanceId, [
      { name: "camera", kind: "video" },
      { name: "microphone", kind: "audio" },
    ]);

    expect(participant.frames[1]).toEqual({
      v: 1,
      type: "published",
      sessionDescription: LOCAL_ANSWER,
      tracks: [
        { trackName: `${attendanceId}:camera`, mid: "0" },
        { trackName: `${attendanceId}:microphone`, mid: "1" },
      ],
    });

    // The roster is what tells everybody else there is something new to ask for, so a publish is
    // followed by one.
    await waitForFrames(participant, 3);
    const roster = rosterOf(participant);
    expect(roster?.participants[0]?.sfuSessionId).toMatch(/^routing-session-/);
    expect(roster?.participants[0]?.tracks.map((track) => track.trackName)).toEqual([
      `${attendanceId}:camera`,
      `${attendanceId}:microphone`,
    ]);
  });

  it("answers a subscribe to a track ON THE ROSTER with the routing service's OWN offer", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_pubOne";
    const first = await connect(stub, meetingId, publisher, "A Host");
    await publish(first, publisher, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(first)?.participants[0]?.sfuSessionId ?? "";

    const second = await connect(stub, meetingId, "meetingAttendance_subOne", "A Guest");
    second.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: session, trackName: `${publisher}:camera` }],
      }),
    );

    await waitFor(() => lastFrame(second, "subscribed") !== undefined);
    expect(lastFrame(second, "subscribed")).toEqual({
      v: 1,
      type: "subscribed",
      // The browser is asking to RECEIVE, so the routing service is the side with something to
      // describe and the browser answers it.
      sessionDescription: REMOTE_OFFER,
      tracks: [{ sessionId: session, trackName: `${publisher}:camera`, mid: "0" }],
      // Forwarded rather than decided here: only the browser's own connection knows what it has
      // applied, and this is what makes a null description readable rather than ambiguous.
      requiresImmediateRenegotiation: true,
    });

    // NO LAYER PREFERENCE WAS NAMED, so none is invented. A microphone and a screen share publish
    // one layer each, and a preference between layers that do not exist is an instruction the
    // service has to reconcile for nothing.
    const asked = upstream.filter((call) => call.path.endsWith("/tracks/new")).at(-1);
    expect((asked?.body["tracks"] as Record<string, unknown>[])[0]).toEqual({
      location: "remote",
      sessionId: session,
      trackName: `${publisher}:camera`,
    });
  });

  it("refuses a subscribe to a session NO ROSTER HERE NAMES, and asks the service nothing", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_subTwo", "A Guest");
    upstream = [];

    // The fleet's meetings all run inside one routing application, so this handle is perfectly
    // valid THERE — it is another meeting's, possibly another firm's. The room is the only thing
    // that knows the difference, which is why it refuses rather than forwards.
    participant.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: "routing-session-of-another-meeting", trackName: "camera" }],
      }),
    );

    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({ v: 1, type: "refused", reason: "unknown-track" });
    // Nothing was asked of the service at all — not even a session of this participant's own, which
    // the refusal must not cost.
    expect(upstream).toEqual([]);
    expect(participant.closeCode()).toBeNull();
  });

  it("refuses a subscribe to the asker's OWN session", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_selfSub";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(participant, attendanceId, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(participant)?.participants[0]?.sfuSessionId ?? "";

    participant.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: session, trackName: `${attendanceId}:camera` }],
      }),
    );

    await waitFor(() => lastFrame(participant, "refused") !== undefined);
    expect(lastFrame(participant, "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "unknown-track",
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

  it("drops a closed track from the roster and tells the room", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_share";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(participant, attendanceId, [
      { name: "camera", kind: "video" },
      { name: "screen", kind: "video" },
    ]);
    expect(rosterOf(participant)?.participants[0]?.tracks).toHaveLength(2);

    // Stopping the share. Before this, the screen stayed on the roster forever and every browser
    // that joined afterwards subscribed to a track the service was no longer forwarding.
    participant.send(JSON.stringify({ v: 1, type: "close", mids: ["1"] }));

    await waitFor(() => rosterOf(participant)?.participants[0]?.tracks.length === 1);
    expect(rosterOf(participant)?.participants[0]?.tracks.map((track) => track.trackName)).toEqual([
      `${attendanceId}:camera`,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// A room of three hundred — what the room sends, how often, and what it costs to send it.
// ---------------------------------------------------------------------------------------------

describe("telling a large room what changed", () => {
  it("sends the whole list at or below the threshold and a difference above it", async () => {
    const { meetingId, stub } = freshRoom();
    const watcher = await connect(stub, meetingId, "meetingAttendance_watch", "A Guest");

    // Below the threshold the whole list is smaller than the bookkeeping a difference costs, and a
    // browser holding the whole list cannot be wrong about it.
    await connect(stub, meetingId, "meetingAttendance_small", "A Guest");
    await waitFor(() => rosterOf(watcher) !== undefined);
    expect(rosterOf(watcher)?.participants).toHaveLength(2);
    expect(deltasOf(watcher)).toHaveLength(0);

    // Past it, a full roster to every socket on every arrival is quadratic in the room: three
    // hundred people each telling three hundred sockets the whole list, for three hundred facts.
    await seedRoster(stub, ROSTER_DELTA_THRESHOLD);
    const before = watcher.frames.length;
    await connect(stub, meetingId, "meetingAttendance_large", "A Guest");
    await waitForFrames(watcher, before + 1);

    expect(deltasOf(watcher)).toHaveLength(1);
    expect(lastFrame(watcher, "roster-delta")).toEqual({
      v: 1,
      type: "roster-delta",
      joined: [
        {
          participantId: "meetingAttendance_large",
          userId: "user_meetingAttendance_large",
          displayName: "A Guest",
          sfuSessionId: null,
          tracks: [],
          speaking: false,
          muted: false,
        },
      ],
      // Always present and empty rather than absent, so a client reads three arrays rather than
      // branching on which keys arrived.
      left: [],
      updated: [],
    });
    // And no full roster followed it — the difference is the whole of what was sent.
    expect(rosterOf(watcher)?.participants).toHaveLength(2);
  });

  it("tells the room a departure by handle alone", async () => {
    const { meetingId, stub } = freshRoom();
    const watcher = await connect(stub, meetingId, "meetingAttendance_leftWatch", "A Guest");
    const leaving = await connect(stub, meetingId, "meetingAttendance_leaver", "A Host");
    await seedRoster(stub, ROSTER_DELTA_THRESHOLD);

    leaving.send(JSON.stringify({ v: 1, type: "leave" }));

    // The receiver already holds everything it knows about them; the only fact being sent is that
    // it should stop.
    await waitFor(() => lastFrame(watcher, "roster-delta") !== undefined);
    expect(lastFrame(watcher, "roster-delta")).toEqual({
      v: 1,
      type: "roster-delta",
      joined: [],
      left: ["meetingAttendance_leaver"],
      updated: [],
    });
  });

  it("answers a sync with the whole list, on the asking socket alone", async () => {
    const { meetingId, stub } = freshRoom();
    const asker = await connect(stub, meetingId, "meetingAttendance_sync", "A Host");
    const other = await connect(stub, meetingId, "meetingAttendance_quiet", "A Guest");
    await seedRoster(stub, ROSTER_DELTA_THRESHOLD);
    const otherFrames = other.frames.length;

    // THE WAY BACK TO THE TRUTH for a client that has been applying differences. Without it, a
    // browser that suspects a gap could only reconnect, which costs it every track it holds.
    asker.send(JSON.stringify({ v: 1, type: "sync" }));

    await waitFor(() => rosterOf(asker)?.participants.length === ROSTER_DELTA_THRESHOLD + 2);
    expect(rosterOf(asker)?.participants).toHaveLength(ROSTER_DELTA_THRESHOLD + 2);
    // Nobody else was sent anything: one browser's bookkeeping is not news to the other two hundred
    // and ninety-nine.
    await settle();
    expect(other.frames).toHaveLength(otherFrames);
  });

  it("carries three hundred people at one storage read per frame, and an arrival in under two kibibytes", async () => {
    const { meetingId, stub } = freshRoom();
    const watcher = await connect(stub, meetingId, "meetingAttendance_bigWatch", "A Guest");
    // The watcher plus the seats is two hundred and ninety-nine; the arrival below is the room's
    // three hundredth person.
    await seedRoster(stub, MAX_MEETING_PARTICIPANTS - 2);

    const joinLists = await countStorageLists(stub, async () => {
      await connect(stub, meetingId, "meetingAttendance_bigJoin", "A Guest");
      await waitFor(() => lastFrame(watcher, "roster-delta") !== undefined);
    });
    // ONE READ OF THREE HUNDRED KEYS, not two. The welcome's full roster and the difference
    // everybody else gets are built from the same read.
    expect(joinLists).toBe(1);

    const delta = watcher.raw.filter((text) => text.includes(`"roster-delta"`)).at(-1) ?? "";
    // The whole argument for sending differences is a number of bytes: the full roster this
    // replaces is the three hundred entries the welcome above carried.
    expect(new TextEncoder().encode(delta).byteLength).toBeLessThan(2048);
    expect((JSON.parse(delta) as RosterDeltaFrame).joined).toHaveLength(1);

    // And the busiest frame in the room reads the roster once as well — the check that a pair is
    // one THIS room is carrying, and nothing else.
    const subscribeLists = await countStorageLists(stub, async () => {
      watcher.send(
        JSON.stringify({
          v: 1,
          type: "subscribe",
          tracks: [{ sessionId: seatSession(0), trackName: `${seatHandle(0)}:camera` }],
        }),
      );
      await waitFor(() => lastFrame(watcher, "subscribed") !== undefined);
    });
    expect(subscribeLists).toBe(1);
  });
});

describe("who is talking", () => {
  it("relays a transition to everybody else, and coalesces a second inside the same second", async () => {
    const { meetingId, stub } = freshRoom();
    const speaker = "meetingAttendance_speaker";
    const talking = await connect(stub, meetingId, speaker, "A Host");
    const listening = await connect(stub, meetingId, "meetingAttendance_listener", "A Guest");

    // A browser measures its OWN microphone — nothing else can, once it stops pulling everybody's
    // audio — and the room is what carries the answer to the rest of the room.
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false }));

    await waitFor(() => lastFrame(listening, "presence") !== undefined);
    const relayed = lastFrame(listening, "presence") as Record<string, unknown>;
    expect(relayed["participantId"]).toBe(speaker);
    expect(relayed["speaking"]).toBe(true);
    expect(relayed["muted"]).toBe(false);
    expect(Date.parse(String(relayed["at"]))).not.toBeNaN();
    // The sender is not told what it just said.
    expect(lastFrame(talking, "presence")).toBeUndefined();

    // A SECOND TRANSITION INSIDE THE WINDOW. Somebody tapping their microphone can transition
    // several times a second, and every one of them would be a frame to two hundred and
    // ninety-nine other people.
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: false, muted: true }));
    await waitForStored(async () => (await presenceOf(stub, speaker)).muted);
    await settle();
    expect(listening.frames.filter((frame) => frame["type"] === "presence")).toHaveLength(1);

    // What is held back is the FRAME, never the fact: the participant record is current, so the
    // next full roster this browser asks for carries the truth.
    listening.send(JSON.stringify({ v: 1, type: "sync" }));
    await waitFor(
      () =>
        rosterOf(listening)?.participants.find((one) => one.participantId === speaker)?.muted ===
        true,
    );
    const entry = rosterOf(listening)?.participants.find((one) => one.participantId === speaker);
    expect(entry?.muted).toBe(true);
    expect(entry?.speaking).toBe(false);
  });

  it("says nothing about a frame that restates what the room already holds", async () => {
    const { meetingId, stub } = freshRoom();
    const talking = await connect(stub, meetingId, "meetingAttendance_same", "A Host");
    const listening = await connect(stub, meetingId, "meetingAttendance_sameWatch", "A Guest");

    // Neither boolean has moved, whatever the browser believes, and relaying it would spend a frame
    // on every other socket to say nothing.
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false }));

    await settle();
    expect(lastFrame(listening, "presence")).toBeUndefined();
  });
});

describe("choosing which layer to receive", () => {
  it("forwards a named layer on a subscribe, and changes it later without a second subscription", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_layerPub";
    const first = await connect(stub, meetingId, publisher, "A Host");
    await publish(first, publisher, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(first)?.participants[0]?.sfuSessionId ?? "";

    const viewer = await connect(stub, meetingId, "meetingAttendance_layerSub", "A Guest");
    viewer.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: session, trackName: `${publisher}:camera`, preferredRid: "f" }],
      }),
    );

    await waitFor(() => lastFrame(viewer, "subscribed") !== undefined);
    const subscription = upstream.filter((call) => call.path.endsWith("/tracks/new")).at(-1);
    expect((subscription?.body["tracks"] as Record<string, unknown>[])[0]).toEqual({
      location: "remote",
      sessionId: session,
      trackName: `${publisher}:camera`,
      // Both fallbacks are alphabetical because the layer names sort in size order, so "the next
      // one along" means "the next size down" without the service being told what they mean.
      simulcast: {
        preferredRid: "f",
        priorityOrdering: "asciibetical",
        ridNotAvailable: "asciibetical",
      },
    });

    // THE GALLERY PAGE TURNS and the tile gets smaller. This is deliberately not a second
    // subscribe: the media is already arriving, and asking for it again would build a second media
    // section and renegotiate the connection for a stream the browser already has.
    viewer.send(
      JSON.stringify({
        v: 1,
        type: "layer",
        tracks: [
          { sessionId: session, trackName: `${publisher}:camera`, mid: "0", preferredRid: "q" },
        ],
      }),
    );

    await waitFor(() => lastFrame(viewer, "layered") !== undefined);
    expect(lastFrame(viewer, "layered")).toEqual({
      v: 1,
      type: "layered",
      tracks: [{ mid: "0", preferredRid: "q" }],
    });
    // ASKED ON THE ASKER'S OWN SESSION, not the publisher's: what changes is the media section this
    // browser is RECEIVING on, and the publisher is sending all three layers either way. A layer
    // change addressed to the publisher would be one viewer deciding the picture for everybody.
    const viewerSession = subscription?.path.split("/sessions/")[1]?.split("/")[0] ?? "";
    expect(viewerSession).not.toBe(session);
    const update = upstream.find((call) => call.path.endsWith("/tracks/update"));
    expect(update?.path).toContain(encodeURIComponent(viewerSession));
    expect(update?.body).toEqual({
      tracks: [
        {
          mid: "0",
          simulcast: {
            preferredRid: "q",
            priorityOrdering: "asciibetical",
            ridNotAvailable: "asciibetical",
          },
        },
      ],
    });
  });

  it("carries the service's refusal of one section back on that section alone", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_layerRefusedPub";
    const first = await connect(stub, meetingId, publisher, "A Host");
    await publish(first, publisher, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(first)?.participants[0]?.sfuSessionId ?? "";
    const viewer = await connect(stub, meetingId, "meetingAttendance_layerRefusedSub", "A Guest");

    viewer.send(
      JSON.stringify({
        v: 1,
        type: "layer",
        tracks: [
          {
            sessionId: session,
            trackName: `${publisher}:camera`,
            mid: REFUSED_LAYER_MID,
            preferredRid: "h",
          },
        ],
      }),
    );

    // One reply entry per request, in request order, so a client pairs the answer with what it
    // asked without matching on anything. The service names only what it refused.
    await waitFor(() => lastFrame(viewer, "layered") !== undefined);
    expect(lastFrame(viewer, "layered")).toEqual({
      v: 1,
      type: "layered",
      tracks: [{ mid: REFUSED_LAYER_MID, preferredRid: "h", errorCode: "layer_unavailable" }],
    });
  });

  it("refuses a layer naming a session NO ROSTER HERE NAMES, and asks the service nothing", async () => {
    const { meetingId, stub } = freshRoom();
    const viewer = await connect(stub, meetingId, "meetingAttendance_layerStranger", "A Guest");
    upstream = [];

    // The same check a subscribe answers to, and for the same reason: the fleet's meetings share
    // one routing application, so this handle is perfectly valid THERE — it is another meeting's.
    viewer.send(
      JSON.stringify({
        v: 1,
        type: "layer",
        tracks: [
          {
            sessionId: "routing-session-of-another-meeting",
            trackName: "camera",
            mid: "0",
            preferredRid: "f",
          },
        ],
      }),
    );

    await waitFor(() => lastFrame(viewer, "refused") !== undefined);
    expect(lastFrame(viewer, "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "unknown-track",
    });
    expect(upstream).toEqual([]);
    expect(viewer.closeCode()).toBeNull();
  });
});

describe("what a participant may claim to be publishing", () => {
  it("refuses a track name carrying somebody else's handle", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_impostor", "A Guest");
    upstream = [];

    // The name is how every other browser resolves a track to a tile, so this would put this
    // participant's camera under another member's face — an impersonation needing no credential.
    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [{ trackName: "meetingAttendance_victim:camera", mid: "0", kind: "video" }],
      }),
    );

    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({
      v: 1,
      type: "refused",
      reason: "foreign-track-name",
    });
    expect(upstream).toEqual([]);
  });

  it("records only the tracks the service CONFIRMED", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_partial";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(participant, attendanceId, [
      { name: "camera", kind: "video" },
      // The fake refuses this one, answering with an error code and no usable media section.
      { name: "refused", kind: "video" },
    ]);

    // A refused track on the roster is a tile on every other screen for media that is not being
    // forwarded, and a subscription each of them makes to something that never arrives.
    expect((participant.frames[1] as { tracks: { trackName: string }[] }).tracks).toEqual([
      { trackName: `${attendanceId}:camera`, mid: "0" },
    ]);
    await waitForFrames(participant, 3);
    expect(rosterOf(participant)?.participants[0]?.tracks.map((track) => track.trackName)).toEqual([
      `${attendanceId}:camera`,
    ]);
  });

  it("refuses a ninth track", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_many";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(
      participant,
      attendanceId,
      Array.from({ length: 8 }, (_unused, index) => ({
        name: `track${String(index)}`,
        kind: "video",
      })),
    );
    await waitFor(() => rosterOf(participant)?.participants[0]?.tracks.length === 8);

    // Every track is a forwarding cost billed here and a subscription everybody else is invited to
    // make, so a browser opening them in a loop is refused rather than served.
    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [{ trackName: `${attendanceId}:oneMore`, mid: "8", kind: "video" }],
      }),
    );

    await waitFor(() => lastFrame(participant, "refused") !== undefined);
    expect(lastFrame(participant, "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "track-limit-reached",
    });
    // Republishing one it already has is not a ninth track and is still served.
    await publish(participant, attendanceId, [{ name: "track0", kind: "video" }]);
    expect(lastFrame(participant, "published")).toBeDefined();
  });
});

describe("a call is sound, and the room is where that holds", () => {
  it("refuses a picture published into a call, and asks the service nothing", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_caller";
    const participant = await connect(stub, meetingId, attendanceId, "A Host", "audio");
    upstream = [];

    // The people who joined a call agreed to sound. A modified client publishing a camera would
    // turn it into a video meeting for every one of them, on one person's decision.
    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [{ trackName: `${attendanceId}:camera`, mid: "0", kind: "video" }],
      }),
    );

    await waitForFrames(participant, 2);
    expect(participant.frames[1]).toEqual({
      v: 1,
      type: "refused",
      reason: "track-kind-refused",
    });
    expect(upstream).toEqual([]);
    // The socket is fine — one frame the room will not act on is not a reason to drop somebody out
    // of a call they are otherwise in.
    expect(participant.closeCode()).toBeNull();

    // A screen share is a picture by another name, and is refused on the same terms.
    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [{ trackName: `${attendanceId}:screen`, mid: "0", kind: "screen" }],
      }),
    );
    await waitForFrames(participant, 3);
    expect(participant.frames[2]).toEqual({
      v: 1,
      type: "refused",
      reason: "track-kind-refused",
    });
    expect(upstream).toEqual([]);
  });

  it("serves the microphone in a call, which is the whole of what a call is", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_heard";
    const participant = await connect(stub, meetingId, attendanceId, "A Host", "audio");

    await publish(participant, attendanceId, [{ name: "microphone", kind: "audio" }]);

    expect(participant.frames[1]).toEqual({
      v: 1,
      type: "published",
      sessionDescription: LOCAL_ANSWER,
      tracks: [{ trackName: `${attendanceId}:microphone`, mid: "0" }],
    });
    await waitForFrames(participant, 3);
    expect(rosterOf(participant)?.participants[0]?.tracks.map((track) => track.kind)).toEqual([
      "audio",
    ]);
  });
});

describe("a routing service that will not answer", () => {
  it("refuses the frame on the asking socket and leaves everybody else's open", async () => {
    const { meetingId, stub } = freshRoom();
    const bystander = await connect(stub, meetingId, "meetingAttendance_bystander", "A Guest");
    const attendanceId = "meetingAttendance_unlucky";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    sessionsAreUnavailable = true;

    participant.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [{ trackName: `${attendanceId}:camera`, mid: "0", kind: "video" }],
      }),
    );

    await waitFor(() => lastFrame(participant, "refused") !== undefined);
    const refused = lastFrame(participant, "refused") as {
      reason: string;
      errorId?: string;
      [key: string]: unknown;
    };
    expect(refused["reason"]).toBe("sfu-unavailable");
    // The handle that joins what this member saw to the redacted server trace. Nothing of what the
    // service said travels with it — that text can name the application the whole fleet runs on.
    expect(refused["errorId"]).toMatch(/^error_/);
    expect(JSON.stringify(refused)).not.toContain("test-realtime-application");

    // THE MEETING SURVIVES ONE PARTICIPANT'S BAD LUCK. The session is opened inside
    // blockConcurrencyWhile, and a throw out of that callback resets the object and drops every
    // socket in it — so one publish would end the meeting for everybody.
    expect(bystander.closeCode()).toBeNull();
    expect(participant.closeCode()).toBeNull();
    bystander.send(PING_FRAME);
    await waitFor(() => lastFrame(bystander, "pong") !== undefined);
    expect(lastFrame(bystander, "pong")).toEqual({ type: "pong" });
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

    await stub.end(ENDED_AT);

    for (const participant of [first, second]) {
      await waitFor(() => participant.frames.some((frame) => frame["type"] === "ended"));
      expect(participant.frames.find((frame) => frame["type"] === "ended")).toEqual({
        v: 1,
        type: "ended",
        endedAt: ENDED_AT,
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

  it("stops the media every participant was publishing", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_endPub";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(participant, attendanceId, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(participant)?.participants[0]?.sfuSessionId ?? "";
    upstream = [];

    await stub.end(ENDED_AT);

    // The routing service goes on forwarding — and billing — a session nothing names, unless the
    // room says stop. `force`, because there is nobody left to answer a renegotiation.
    await waitFor(() => upstream.some((call) => call.path.endsWith("/tracks/close")));
    const close = upstream.find((call) => call.path.endsWith("/tracks/close"));
    expect(close?.path).toContain(encodeURIComponent(session));
    expect(close?.body).toEqual({ tracks: [{ mid: "0" }], force: true });
  });

  it("tells a socket that signals after the meeting closed why, rather than that it is a stranger", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, "meetingAttendance_late", "A Host");
    await stub.end(ENDED_AT);
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

  it("retires the ended marker a day later, so a finished room holds nothing", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, "meetingAttendance_retire", "A Host");
    await stub.end(ENDED_AT);

    // The marker is dated, so the alarm decides from the instant rather than from a second key. An
    // end a day and more ago is past its keep.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      await state.storage.put("ended", "2026-09-01T00:00:00.000Z");
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect([...(await state.storage.list()).keys()]).toEqual([]);
    });
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

  it("stops the media of a participant the leave route let go of", async () => {
    const { meetingId, stub } = freshRoom();
    const attendanceId = "meetingAttendance_leftPub";
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(participant, attendanceId, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(participant)?.participants[0]?.sfuSessionId ?? "";
    upstream = [];

    await stub.participantLeft(attendanceId);

    await waitFor(() => upstream.some((call) => call.path.endsWith("/tracks/close")));
    const close = upstream.find((call) => call.path.endsWith("/tracks/close"));
    expect(close?.path).toContain(encodeURIComponent(session));
    expect(close?.body).toEqual({ tracks: [{ mid: "0" }], force: true });
  });
});

// ---------------------------------------------------------------------------------------------
// The grace sweep — the only thing that ever closes a stay nobody pressed anything to close.
// ---------------------------------------------------------------------------------------------

const EVENT_COLUMNS =
  "id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, audience, " +
  "recorded_at, recorded_by, created_at, updated_at";

const SEED_INSTANT = "2026-09-18T12:00:00.000Z";

/** One member of the room test's own firm, so a stay has somebody to belong to. */
async function seedMember(): Promise<string> {
  const userId = newIdentifier("user");
  await firmDatabaseFor(env.FIRM_DATABASE, FIRM)
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'A Host', 'active', ?2)`,
    )
    .bind(userId, SEED_INSTANT)
    .run();
  return userId;
}

/** A live meeting on a firm event, so the sweep has a record to close stays in. */
async function seedMeeting(meetingId: string): Promise<void> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, FIRM);
  const userId = await seedMember();
  const firmEventId = newIdentifier("firmEvent");
  await database
    .prepare(
      `INSERT INTO firm_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, 'Monday staff meeting', 'scheduled', '2026-09-21', '08:00', '08:30', ` +
        `'America/Los_Angeles', 'all_members', ?2, ?3, ?2, ?2)`,
    )
    .bind(firmEventId, SEED_INSTANT, userId)
    .run();
  await database
    .prepare(
      `INSERT INTO meeting (id, event_kind, matter_event_id, firm_event_id, status, ` +
        `created_by_user_id, started_at, ended_at, ended_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, 'firm', NULL, ?2, 'live', ?3, ?4, NULL, NULL, ?4, ?4)`,
    )
    .bind(meetingId, firmEventId, userId, SEED_INSTANT)
    .run();
}

/** One more open stay in a meeting already seeded. */
async function seedStay(meetingId: string): Promise<string> {
  const attendanceId = newIdentifier("meetingAttendance");
  await firmDatabaseFor(env.FIRM_DATABASE, FIRM)
    .prepare(
      `INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at, created_at, ` +
        `updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?4, ?4)`,
    )
    .bind(attendanceId, meetingId, await seedMember(), SEED_INSTANT)
    .run();
  return attendanceId;
}

/** A meeting and one open stay in it, which is what most of these tests want. */
async function seedOpenStay(meetingId: string): Promise<{ attendanceId: string }> {
  await seedMeeting(meetingId);
  return { attendanceId: await seedStay(meetingId) };
}

/** When the room recorded this participant's last socket going away, or null while one is open. */
async function socketLostAtOf(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
): Promise<string | null> {
  let lostAt: string | null = null;
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const participant = await state.storage.get<{ socketLostAt: string | null }>(
      `participant:${attendanceId}`,
    );
    lostAt = participant?.socketLostAt ?? null;
  });
  return lostAt;
}

/** Winds one participant's drop back, so the alarm makes the decision it would a minute from now. */
async function rewindGrace(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
  secondsAgo: number,
): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const key = `participant:${attendanceId}`;
    const participant = await state.storage.get<Record<string, unknown>>(key);
    await state.storage.put(key, {
      ...participant,
      socketLostAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
    });
  });
}

async function readStay(attendanceId: string): Promise<{ left_at: string | null } | null> {
  return await firmDatabaseFor(env.FIRM_DATABASE, FIRM)
    .prepare(`SELECT left_at FROM meeting_attendance WHERE id = ?1`)
    .bind(attendanceId)
    .first<{ left_at: string | null }>();
}

describe("a connection that went away and did not come back", () => {
  it("closes the stay, empties the roster and stops the media — and does NOT end the meeting", async () => {
    const { meetingId, stub } = freshRoom();
    const { attendanceId } = await seedOpenStay(meetingId);
    const participant = await connect(stub, meetingId, attendanceId, "A Host");
    await publish(participant, attendanceId, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(participant)?.participants[0]?.sfuSessionId ?? "";

    participant.close();
    await waitFor(() => participant.closeCode() !== null);

    // A GRACE PERIOD, not an immediate close: the member is very likely about to reconnect, and a
    // stay closed the moment a tunnel dropped would be reopened as a second arrival they never made.
    // The instant is on the PARTICIPANT, which is what makes it one grace per person.
    await waitForStored(async () => (await socketLostAtOf(stub, attendanceId)) !== null);
    const lostAt = await socketLostAtOf(stub, attendanceId);
    expect(lostAt).not.toBeNull();
    expect(Date.parse(lostAt ?? "")).toBeGreaterThan(Date.now() - 30_000);
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    // Inside the grace the record still says they are here, which is the whole point of it.
    expect((await readStay(attendanceId))?.left_at).toBeNull();

    // Wind the drop back rather than waiting a minute: the alarm handler decides from the stored
    // instant, so this is the same decision it makes a minute from now.
    await rewindGrace(stub, attendanceId, SOCKET_LOSS_GRACE_SECONDS + 1);
    upstream = [];
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The record now says when they stopped being in the room, instead of saying they never left.
    expect((await readStay(attendanceId))?.left_at).not.toBeNull();
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect([...(await state.storage.list({ prefix: "participant:" })).keys()]).toEqual([]);
      // ENDING IS THE HOST'S ACT. A room that closed itself because the last connection dropped
      // would put an ending in the record nobody decided on.
      expect(await state.storage.get("ended")).toBeUndefined();
    });
    const close = upstream.find((call) => call.path.endsWith("/tracks/close"));
    expect(close?.path).toContain(encodeURIComponent(session));
    expect(close?.body).toEqual({ tracks: [{ mid: "0" }], force: true });
  });

  it("closes only the person whose OWN minute has run out", async () => {
    const { meetingId, stub } = freshRoom();
    await seedMeeting(meetingId);
    const earlyId = await seedStay(meetingId);
    const lateId = await seedStay(meetingId);
    const early = await connect(stub, meetingId, earlyId, "A Host");
    const late = await connect(stub, meetingId, lateId, "A Guest");

    // Two people drop forty seconds apart, inside one sixty-second grace. When the first one's
    // alarm fires the second is twenty seconds into their own minute — and a room that kept ONE
    // pending deadline closed them both, spending the first person's grace on the second's record.
    early.close();
    late.close();
    await waitFor(() => early.closeCode() !== null && late.closeCode() !== null);
    await waitForStored(async () => (await socketLostAtOf(stub, lateId)) !== null);
    await rewindGrace(stub, earlyId, SOCKET_LOSS_GRACE_SECONDS + 1);
    await rewindGrace(stub, lateId, SOCKET_LOSS_GRACE_SECONDS - 40);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect((await readStay(earlyId))?.left_at).not.toBeNull();
    expect((await readStay(lateId))?.left_at).toBeNull();
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect([...(await state.storage.list({ prefix: "participant:" })).keys()]).toEqual([
        `participant:${lateId}`,
      ]);
      // And the room comes back for them: the alarm re-arms to the deadline still running.
      expect(await state.storage.getAlarm()).not.toBeNull();
    });

    // Then their own minute runs out, and the same sweep closes them.
    await rewindGrace(stub, lateId, SOCKET_LOSS_GRACE_SECONDS + 1);
    await runDurableObjectAlarm(stub);
    expect((await readStay(lateId))?.left_at).not.toBeNull();
  });

  it("leaves alone a participant who reconnected inside the grace period", async () => {
    const { meetingId, stub } = freshRoom();
    const { attendanceId } = await seedOpenStay(meetingId);
    const first = await connect(stub, meetingId, attendanceId, "A Host");
    first.close();
    await waitFor(() => first.closeCode() !== null);
    await connect(stub, meetingId, attendanceId, "A Host");

    await rewindGrace(stub, attendanceId, SOCKET_LOSS_GRACE_SECONDS + 1);
    await runDurableObjectAlarm(stub);

    // The sweep asks who has a socket NOW, not who dropped one earlier.
    expect((await readStay(attendanceId))?.left_at).toBeNull();
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect(await state.storage.get(`participant:${attendanceId}`)).toBeDefined();
    });
  });
});
