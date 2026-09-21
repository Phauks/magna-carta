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
  MEETING_REACTIONS,
  PING_FRAME,
  PONG_FRAME,
  ROSTER_DELTA_THRESHOLD,
  SIGNAL_INTERVAL_MILLISECONDS,
} from "@magna-carta/meeting-protocol/frames";
import {
  PING_FRAME as PROGRESS_PING_FRAME,
  PONG_FRAME as PROGRESS_PONG_FRAME,
} from "../src/progress/job-progress-protocol.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import { PRESENCE_RELAY_INTERVAL_MILLISECONDS } from "../src/meetings/room/room-presence.ts";
import { REACTION_COALESCE_INTERVAL_MILLISECONDS } from "../src/meetings/room/room-reactions.ts";
import { setRoomDiagnosticsLoggerForTests } from "../src/meetings/room/room-diagnostics.ts";
import { createMemoryLogger, type MemoryLogger } from "@magna-carta/telemetry/logger";

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
// answer a layer change has that is not a success. It is the SECOND section a subscription yields
// (the fake numbers them by position), because the room refuses a layer change on a section it did
// not subscribe for that browser — so a section nobody could have subscribed cannot reach the
// service at all any more.
const REFUSED_LAYER_MID = "1";

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
  hostRole: "host" | "co-host" | null;
  hand: boolean;
  handRaisedAt: string | null;
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
  // The caller's live grant as the socket route read it off the record. It SEEDS the stored
  // participant and is never read again — every host frame is decided from the stored record, which
  // is what lets a grant withdrawn mid-meeting take effect on the next frame.
  hostRole: "host" | "co-host" | null = null,
  // Whether the door was shut when this socket arrived, read off the meeting row by the route
  // exactly as the medium is — so an upgrade refreshes the room's own copy from the record rather
  // than trusting what it last held.
  locked = false,
  // Whether this stay is AT THE DOOR, derived by the route off the row it just authorized the
  // upgrade against. True sends the socket into the lobby state instead of into the room.
  waiting = false,
  lobby: "off" | "on" = waiting ? "on" : "off",
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
        hostRole,
        locked,
        lobby,
        waiting,
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
          presenceDirty: false,
          syncAt: null,
          layerAt: null,
          subscribedMids: [],
        };
      }
      await state.storage.put(batch);
    }
  });
}

/**
 * Opens this many more real sockets, so the room is genuinely past a size rather than seeded past it.
 *
 * `seedRoster` writes roster entries with no sockets behind them, which is right for everything
 * decided from the roster — the delta threshold, a subscription check — and wrong for anything
 * decided over the sockets a frame would actually reach. The reactions branch is the second kind.
 */
async function fillRoom(
  stub: ReturnType<typeof roomStub>,
  meetingId: string,
  prefix: string,
  count: number,
): Promise<void> {
  for (let seat = 0; seat < count; seat += 1) {
    await connect(
      stub,
      meetingId,
      `meetingAttendance_${prefix}${String(seat).padStart(3, "0")}`,
      `Seat ${String(seat)}`,
    );
  }
}

/** What the room currently holds about one participant's hand — the one stored half of it. */
async function handRaisedAtOf(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
): Promise<string | null> {
  let found: string | null = null;
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const participant = await state.storage.get<{ handRaisedAt?: string | null }>(
      `participant:${attendanceId}`,
    );
    found = participant?.handRaisedAt ?? null;
  });
  return found;
}

/** Winds a participant's signal window back, so the next hand or reaction is not refused. */
async function rewindSignal(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
  milliseconds: number,
): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const key = `participant:${attendanceId}`;
    const participant = await state.storage.get<Record<string, unknown>>(key);
    if (participant === undefined) throw new Error(`no participant at ${key}`);
    const claimed = participant["signalAt"];
    const claimedAt = Date.parse(typeof claimed === "string" ? claimed : "");
    await state.storage.put(key, {
      ...participant,
      signalAt: Number.isNaN(claimedAt) ? null : new Date(claimedAt - milliseconds).toISOString(),
    });
  });
}

/** Winds the coalescing bucket's window back, so the next frame or alarm flushes it. */
async function rewindReactionBucket(
  stub: ReturnType<typeof roomStub>,
  milliseconds: number,
): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const bucket = await state.storage.get<{ openedAt: string; counts: Record<string, number> }>(
      "reactions",
    );
    if (bucket === undefined) throw new Error("no reaction bucket to wind back");
    await state.storage.put("reactions", {
      ...bucket,
      openedAt: new Date(Date.parse(bucket.openedAt) - milliseconds).toISOString(),
    });
  });
}

/** What the room currently holds about one participant's microphone. */
async function presenceOf(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
): Promise<{
  speaking: boolean;
  muted: boolean;
  presenceAt: string | null;
  presenceDirty: boolean;
}> {
  let found = {
    speaking: false,
    muted: false,
    presenceAt: null as string | null,
    presenceDirty: false,
  };
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

/**
 * The same count, split by SHAPE — a list reads every key the room holds, a get reads one.
 *
 * Both are worth bounding and they are not the same bound: one list per frame is the rule that keeps
 * a room of three hundred affordable, and a handful of gets is what a frame is allowed to spend
 * beside it. Counting only lists would let a frame walk the roster one key at a time.
 */
async function countStorageReads(
  stub: ReturnType<typeof roomStub>,
  run: () => Promise<void>,
): Promise<{ lists: number; gets: number }> {
  const counted = { lists: 0, gets: 0 };
  await runInDurableObject(stub, (_room: MeetingRoom, state) => {
    const storage = state.storage as unknown as {
      list: (options?: unknown) => Promise<unknown>;
      get: (key: unknown, options?: unknown) => Promise<unknown>;
    };
    const underlyingList = storage.list.bind(state.storage);
    const underlyingGet = storage.get.bind(state.storage);
    storage.list = async (options?: unknown) => {
      counted.lists += 1;
      return await underlyingList(options);
    };
    storage.get = async (key: unknown, options?: unknown) => {
      counted.gets += 1;
      return await underlyingGet(key, options);
    };
  });
  await run();
  return counted;
}

/**
 * How many times the room walked its sockets while `run` was in flight.
 *
 * Every walk deserializes every socket's attachment, so this number TIMES the socket count is what a
 * pass actually costs — which is why asking "is this person connected" once per participant is a
 * quadratic answer to a linear question.
 */
async function countSocketScans(
  stub: ReturnType<typeof roomStub>,
  run: () => Promise<void>,
): Promise<number> {
  let scans = 0;
  await runInDurableObject(stub, (_room: MeetingRoom, state) => {
    const context = state as unknown as { getWebSockets: (tag?: string) => WebSocket[] };
    const underlying = context.getWebSockets.bind(state);
    context.getWebSockets = (tag?: string) => {
      scans += 1;
      return underlying(tag);
    };
  });
  await run();
  return scans;
}

/** Winds a participant's last relayed presence back, so the deferred flush is due. */
async function rewindPresence(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
  milliseconds: number,
): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const key = `participant:${attendanceId}`;
    const participant = await state.storage.get<Record<string, unknown>>(key);
    if (participant === undefined) throw new Error(`no participant at ${key}`);
    const previous = participant["presenceAt"];
    const relayedAt = Date.parse(typeof previous === "string" ? previous : "");
    await state.storage.put(key, {
      ...participant,
      presenceAt: new Date(
        (Number.isNaN(relayedAt) ? Date.now() : relayedAt) - milliseconds,
      ).toISOString(),
    });
  });
}

/** Winds a throttled frame's last claim back, so the next one is not dropped. */
async function rewindThrottle(
  stub: ReturnType<typeof roomStub>,
  attendanceId: string,
  field: "syncAt" | "layerAt",
  milliseconds: number,
): Promise<void> {
  await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
    const key = `participant:${attendanceId}`;
    const participant = await state.storage.get<Record<string, unknown>>(key);
    if (participant === undefined) throw new Error(`no participant at ${key}`);
    const claimed = participant[field];
    const claimedAt = Date.parse(typeof claimed === "string" ? claimed : "");
    await state.storage.put(key, {
      ...participant,
      [field]: Number.isNaN(claimedAt) ? null : new Date(claimedAt - milliseconds).toISOString(),
    });
  });
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
          // Whether this person is running the meeting, drawn as a badge by every browser and read
          // by the room itself for every host frame. Null for somebody who is not.
          hostRole: null,
          // TWO WIRE FIELDS OVER ONE STORED FACT. The room stores the instant alone; the boolean is
          // the comparison against null, carried because every tile and roster row branches on it
          // and only the hands panel wants the instant.
          hand: false,
          handRaisedAt: null,
        },
      ],
      // WHAT IS TRUE OF THE ROOM rather than of anybody in it, carried inline for the reason the
      // whole roster is: a socket that has just arrived holds nothing to apply a change to.
      roomState: { spotlight: null, locked: false, lobby: "off" },
      // WHO IS AT THE DOOR, and EMPTY for somebody who is not running the meeting — which is what
      // this socket is. The lobby list is the one thing in this welcome the room withholds from the
      // people inside it.
      waiting: [],
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
          hostRole: null,
          hand: false,
          handRaisedAt: null,
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

  it("holds every frame to one roster read and a handful of single-key reads", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_budgetPub";
    const other = await connect(stub, meetingId, publisher, "A Host");
    await publish(other, publisher, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(other)?.participants[0]?.sfuSessionId ?? "";
    const mover = "meetingAttendance_budgetMove";
    const browser = await connect(stub, meetingId, mover, "A Guest");

    // ONE LIST IS THE RULE THAT MAKES A ROOM OF THREE HUNDRED AFFORDABLE — a list is every key the
    // room holds, and a frame that took two doubled the cost of the busiest thing it does. The gets
    // are bounded beside it, because a frame that walked the roster one key at a time would pass a
    // list count and cost the same.
    const frames: readonly {
      readonly name: string;
      readonly frame: unknown;
      readonly answer: string;
    }[] = [
      {
        name: "publish",
        frame: {
          v: 1,
          type: "publish",
          sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
          tracks: [{ trackName: `${mover}:camera`, mid: "0", kind: "video" }],
        },
        answer: "published",
      },
      {
        name: "subscribe",
        frame: {
          v: 1,
          type: "subscribe",
          tracks: [{ sessionId: session, trackName: `${publisher}:camera` }],
        },
        answer: "subscribed",
      },
      {
        name: "layer",
        frame: {
          v: 1,
          type: "layer",
          tracks: [
            { sessionId: session, trackName: `${publisher}:camera`, mid: "0", preferredRid: "q" },
          ],
        },
        answer: "layered",
      },
      {
        name: "renegotiate",
        frame: {
          v: 1,
          type: "renegotiate",
          sessionDescription: { type: "answer", sdp: "v=0 browser-answer" },
        },
        answer: "renegotiated",
      },
      { name: "sync", frame: { v: 1, type: "sync" }, answer: "roster" },
      { name: "close", frame: { v: 1, type: "close", mids: ["0"] }, answer: "closed" },
    ];

    for (const { name, frame, answer } of frames) {
      const before = browser.frames.filter((one) => one["type"] === answer).length;
      const reads = await countStorageReads(stub, async () => {
        browser.send(JSON.stringify(frame));
        await waitFor(() => browser.frames.filter((one) => one["type"] === answer).length > before);
      });
      expect(reads.lists, `${name} reads the roster more than once`).toBeLessThanOrEqual(1);
      expect(reads.gets, `${name} spends too many single-key reads`).toBeLessThanOrEqual(5);
    }

    // Presence and leave answer nothing to the sender, so they are measured by what they change
    // rather than by a reply.
    const presenceReads = await countStorageReads(stub, async () => {
      browser.send(JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false }));
      await waitFor(() => lastFrame(other, "presence") !== undefined);
    });
    expect(presenceReads.lists).toBe(0);
    expect(presenceReads.gets).toBeLessThanOrEqual(5);

    const leaveReads = await countStorageReads(stub, async () => {
      browser.send(JSON.stringify({ v: 1, type: "leave" }));
      await waitFor(() => rosterOf(other)?.participants.length === 1);
    });
    expect(leaveReads.lists).toBeLessThanOrEqual(1);
    expect(leaveReads.gets).toBeLessThanOrEqual(5);
  });

  it("resolves who is connected once a pass, not once a participant", async () => {
    const { meetingId, stub } = freshRoom();
    await seedRoster(stub, 40);
    const dropping = "meetingAttendance_scanDrop";
    const socket = await connect(stub, meetingId, dropping, "A Guest");
    socket.close();
    await waitFor(() => socket.closeCode() !== null);
    await waitForStored(async () => (await socketLostAtOf(stub, dropping)) !== null);

    // EVERY WALK OF THE SOCKETS DESERIALIZES EVERY ATTACHMENT, so this number times the socket count
    // is what the pass actually costs. Asking "is this person connected" per participant made a
    // room of three hundred pay ninety thousand deserializations each time anybody dropped.
    const scans = await countSocketScans(stub, async () => {
      await runDurableObjectAlarm(stub);
    });
    expect(scans).toBeLessThanOrEqual(6);
  });
});

describe("a socket that has been accepted and not yet welcomed", () => {
  it("is sent nothing, so it never applies a difference to a roster it does not have", async () => {
    const { meetingId, stub } = freshRoom();
    const early = await connect(stub, meetingId, "meetingAttendance_earlySocket", "A Host");
    const quiet = early.frames.length;

    // THE WINDOW IS REAL AND THE ROOM CANNOT AVOID IT: the runtime has to own a socket before the
    // roster can be written, so between the accept and the welcome the socket is already in
    // `getWebSockets()`. Reproduced by putting this socket back into that state, which is what the
    // attachment says — a broadcast reaching it there is a difference applied against nothing, and
    // the browser's only way out is to ask for the whole list. Three hundred people arriving at the
    // top of the hour made that a storm.
    await runInDurableObject(stub, (_room: MeetingRoom, state) => {
      for (const socket of state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as Record<string, unknown> | null;
        if (attachment?.["attendanceId"] !== "meetingAttendance_earlySocket") continue;
        socket.serializeAttachment({ ...attachment, welcomed: false });
      }
    });

    const arriving = await connect(stub, meetingId, "meetingAttendance_lateSocket", "A Guest");
    // The arriving socket got its own welcome, which is the frame that carries everything the
    // broadcast would have said.
    expect(welcomeRosterOf(arriving)).toHaveLength(2);
    await settle();
    expect(early.frames).toHaveLength(quiet);
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

  it("relays the transition the window held back when the alarm comes round", async () => {
    const { meetingId, stub } = freshRoom();
    const speaker = "meetingAttendance_deferred";
    const talking = await connect(stub, meetingId, speaker, "A Host");
    const listening = await connect(stub, meetingId, "meetingAttendance_deferredWatch", "A Guest");

    // A ONE-WORD ANSWER: speaking, then not speaking, inside the same second. The second transition
    // is the one that is still TRUE, and dropping it outright left this person shown speaking on
    // every other screen until they next said something.
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false }));
    await waitFor(() => lastFrame(listening, "presence") !== undefined);
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false }));
    await waitForStored(async () => (await presenceOf(stub, speaker)).presenceDirty);

    // The stored booleans are current the instant they arrive — the window governs the frame, never
    // the record — and the flag is what says the room still owes everybody the news.
    const held = await presenceOf(stub, speaker);
    expect(held.speaking).toBe(false);
    expect(held.presenceDirty).toBe(true);
    await settle();
    expect(listening.frames.filter((frame) => frame["type"] === "presence")).toHaveLength(1);

    // The room armed its own alarm for the end of the window. Wound back rather than waited out:
    // the handler decides from the stored instant, so this is the same decision it makes a second
    // from now.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    await rewindPresence(stub, speaker, PRESENCE_RELAY_INTERVAL_MILLISECONDS + 1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await waitFor(
      () => listening.frames.filter((frame) => frame["type"] === "presence").length > 1,
    );
    const relayed = lastFrame(listening, "presence") as Record<string, unknown>;
    expect(relayed["participantId"]).toBe(speaker);
    expect(relayed["speaking"]).toBe(false);
    expect(relayed["muted"]).toBe(false);

    // Lowered, so the flush is not armed again forever — and the sender is still not told what it
    // said about its own microphone.
    expect((await presenceOf(stub, speaker)).presenceDirty).toBe(false);
    expect(lastFrame(talking, "presence")).toBeUndefined();
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

describe("the frames a browser can send faster than the room can serve them", () => {
  it("answers one whole-roster request a second and drops the burst behind it", async () => {
    const { meetingId, stub } = freshRoom();
    const asking = await connect(stub, meetingId, "meetingAttendance_syncAsk", "A Host");
    await connect(stub, meetingId, "meetingAttendance_syncOther", "A Guest");

    // Counted from a baseline, because the second arrival already announced itself with a whole
    // roster: in a room this size the room states the list rather than the difference.
    const announced = asking.frames.filter((frame) => frame["type"] === "roster").length;
    const rosters = () =>
      asking.frames.filter((frame) => frame["type"] === "roster").length - announced;
    asking.send(JSON.stringify({ v: 1, type: "sync" }));
    await waitFor(() => rosters() > 0);
    expect(rosters()).toBe(1);

    // A SYNC IS A LIST OF EVERY KEY THE ROOM HOLDS — three hundred of them in a full meeting — and
    // a browser can ask as fast as it can write. What is dropped is a REQUEST, not a fact: the
    // asker repeats it a moment later, and the room announces every roster change to it unprompted
    // in the meantime.
    for (let repeat = 0; repeat < 5; repeat += 1) {
      asking.send(JSON.stringify({ v: 1, type: "sync" }));
    }
    await settle();
    expect(rosters()).toBe(1);

    // And the window is a window, not a ban.
    await rewindThrottle(stub, "meetingAttendance_syncAsk", "syncAt", 2000);
    asking.send(JSON.stringify({ v: 1, type: "sync" }));
    await waitFor(() => rosters() > 1);
    expect(rosters()).toBe(2);
  });

  it("forwards one layer change a quarter second and drops the rest", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_layerBurstPub";
    const first = await connect(stub, meetingId, publisher, "A Host");
    await publish(first, publisher, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(first)?.participants[0]?.sfuSessionId ?? "";
    const viewer = await connect(stub, meetingId, "meetingAttendance_layerBurstSub", "A Guest");
    viewer.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [{ sessionId: session, trackName: `${publisher}:camera` }],
      }),
    );
    await waitFor(() => lastFrame(viewer, "subscribed") !== undefined);

    const layerChange = (preferredRid: string) =>
      JSON.stringify({
        v: 1,
        type: "layer",
        tracks: [{ sessionId: session, trackName: `${publisher}:camera`, mid: "0", preferredRid }],
      });
    const updates = () => upstream.filter((call) => call.path.endsWith("/tracks/update")).length;
    viewer.send(layerChange("q"));
    await waitFor(() => lastFrame(viewer, "layered") !== undefined);
    expect(updates()).toBe(1);

    // EACH ONE IS A CALL TO THE ROUTING SERVICE, and a gallery scrolled with a finger produces them
    // by the dozen. What a dropped one costs is a tile drawn at the previous size for a moment,
    // which the next change supersedes.
    for (const rid of ["h", "f", "q", "h"]) viewer.send(layerChange(rid));
    await settle();
    expect(updates()).toBe(1);
    expect(viewer.frames.filter((frame) => frame["type"] === "layered")).toHaveLength(1);

    await rewindThrottle(stub, "meetingAttendance_layerBurstSub", "layerAt", 2000);
    viewer.send(layerChange("f"));
    await waitFor(() => updates() > 1);
    expect(updates()).toBe(2);
  });

  it("refuses a layer change on a media section the room never subscribed for that browser", async () => {
    const { meetingId, stub } = freshRoom();
    const publisher = "meetingAttendance_layerUnsubPub";
    const first = await connect(stub, meetingId, publisher, "A Host");
    await publish(first, publisher, [{ name: "camera", kind: "video" }]);
    const session = rosterOf(first)?.participants[0]?.sfuSessionId ?? "";
    const viewer = await connect(stub, meetingId, "meetingAttendance_layerUnsubSub", "A Guest");

    // The pair names a track that IS on this room's roster, so the roster check passes — and that
    // check constrains nothing about what actually goes upstream, which is a media section inside
    // the asking browser's OWN session. This one subscribed to nothing, so section 0 of its session
    // is whatever else it holds.
    viewer.send(
      JSON.stringify({
        v: 1,
        type: "layer",
        tracks: [
          { sessionId: session, trackName: `${publisher}:camera`, mid: "0", preferredRid: "q" },
        ],
      }),
    );

    await waitFor(() => lastFrame(viewer, "refused") !== undefined);
    expect(lastFrame(viewer, "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "unknown-track",
    });
    expect(upstream.filter((call) => call.path.endsWith("/tracks/update"))).toHaveLength(0);
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
    await publish(first, publisher, [
      { name: "camera", kind: "video" },
      { name: "screen", kind: "video" },
    ]);
    const session = rosterOf(first)?.participants[0]?.sfuSessionId ?? "";
    const viewer = await connect(stub, meetingId, "meetingAttendance_layerRefusedSub", "A Guest");

    // Subscribed first, because a layer change may only name a section the room opened for THIS
    // browser — the second of the two is the one the fake will not change.
    viewer.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tracks: [
          { sessionId: session, trackName: `${publisher}:camera` },
          { sessionId: session, trackName: `${publisher}:screen` },
        ],
      }),
    );
    await waitFor(() => lastFrame(viewer, "subscribed") !== undefined);

    viewer.send(
      JSON.stringify({
        v: 1,
        type: "layer",
        tracks: [
          {
            sessionId: session,
            trackName: `${publisher}:screen`,
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

// HOST CONTROLS, AS THE ROOM HOLDS THEM.
//
// The four acts here are frames rather than routes because each is about this moment and leaves
// nothing behind — and the one rule every test in this block is really asking about is where the
// room gets its answer to "may this socket do that". It is the STORED participant record, never the
// socket's attachment: the attachment is frozen at upgrade, and hosting is exactly the thing that
// changes during a meeting.
describe("running the room from inside it", () => {
  const HOST_STAY = "meetingAttendance_hostStay";
  const MEMBER_STAY = "meetingAttendance_memberStay";
  const OTHER_STAY = "meetingAttendance_otherStay";

  /** The upstream calls the room made against one session, in order. */
  function callsFor(sessionId: string): UpstreamCall[] {
    return upstream.filter((call) => call.path.includes(`/sessions/${sessionId}/`));
  }

  /** What the room currently holds about one participant, whole. */
  async function storedOf(
    stub: ReturnType<typeof roomStub>,
    attendanceId: string,
  ): Promise<Record<string, unknown> | undefined> {
    let found: Record<string, unknown> | undefined;
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      found = await state.storage.get<Record<string, unknown>>(`participant:${attendanceId}`);
    });
    return found;
  }

  /** The room's own spotlight key, which is where the fact lives between frames. */
  async function spotlightOf(
    stub: ReturnType<typeof roomStub>,
  ): Promise<Record<string, unknown> | undefined> {
    let found: Record<string, unknown> | undefined;
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      found = await state.storage.get<Record<string, unknown>>("spotlight");
    });
    return found;
  }

  function send(participant: Participant, frame: Record<string, unknown>): void {
    participant.send(JSON.stringify({ v: 1, ...frame }));
  }

  it("mutes one participant by closing their audio upstream, and tells them who did it", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    await publish(member, MEMBER_STAY, [{ name: "microphone", kind: "audio" }]);
    const session = (await storedOf(stub, MEMBER_STAY))?.["sfuSessionId"] as string;

    const before = member.frames.length;
    send(host, { type: "mute", participantId: MEMBER_STAY });
    await waitFor(() => lastFrame(member, "muted") !== undefined);

    // THE ROOM CANNOT SILENCE A MICROPHONE — the media never crosses it — so a mute is two halves,
    // and this is the half that actually stops the sound reaching anybody.
    expect(callsFor(session).some((call) => call.path.endsWith("/tracks/close"))).toBe(true);
    expect(lastFrame(member, "muted")).toMatchObject({ by: HOST_STAY });
    expect(member.frames.length).toBeGreaterThan(before);
    // The track leaves the roster the way any stopped track does, so nobody re-subscribes to
    // silence — and the flag every other tile draws moves with it.
    const stored = await storedOf(stub, MEMBER_STAY);
    expect(stored?.["tracks"]).toEqual([]);
    expect(stored?.["muted"]).toBe(true);
    // The host is not told about it as if it were their own microphone.
    expect(lastFrame(host, "muted")).toBeUndefined();
  });

  it("refuses a host frame from a socket holding no grant, and leaves the socket open", async () => {
    const { meetingId, stub } = freshRoom();
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    const other = await connect(stub, meetingId, OTHER_STAY, "Another Member");
    await publish(other, OTHER_STAY, [{ name: "microphone", kind: "audio" }]);

    send(member, { type: "mute", participantId: OTHER_STAY });
    await waitFor(() => lastFrame(member, "refused") !== undefined);

    expect(lastFrame(member, "refused")).toMatchObject({ reason: "not-host" });
    // OPEN, deliberately: the member is in the meeting and everything else they can do still works.
    expect(member.closeCode()).toBeNull();
    // And nothing happened to the person they aimed at.
    expect(lastFrame(other, "muted")).toBeUndefined();
    expect((await storedOf(stub, OTHER_STAY))?.["muted"]).toBe(false);
  });

  it("stops a withdrawn co-host on their NEXT frame, without a reconnect", async () => {
    const { meetingId, stub } = freshRoom();
    const coHost = await connect(stub, meetingId, MEMBER_STAY, "A Co-host", "video", "co-host");
    const other = await connect(stub, meetingId, OTHER_STAY, "Another Member");
    await publish(other, OTHER_STAY, [{ name: "microphone", kind: "audio" }]);

    send(coHost, { type: "mute", participantId: OTHER_STAY });
    await waitFor(() => lastFrame(other, "muted") !== undefined);

    // The route commits the withdrawal and then tells the room, which rewrites the STORED record.
    // The socket is untouched and its attachment still says co-host.
    await stub.hostingChanged([]);
    await waitFor(() => lastFrame(coHost, "roster") !== undefined);

    send(coHost, { type: "mute", participantId: OTHER_STAY });
    await waitFor(() => lastFrame(coHost, "refused") !== undefined);
    expect(lastFrame(coHost, "refused")).toMatchObject({ reason: "not-host" });
    // A socket-attachment answer would have gone on muting people for as long as this socket stayed
    // open, which is the whole reason the authority lives on the record.
    const rosterEntry = (
      lastFrame(coHost, "roster") as { participants: RosterEntry[] }
    ).participants.find((one) => one.participantId === MEMBER_STAY);
    expect(rosterEntry).toMatchObject({ hostRole: null });
  });

  it("mutes everybody else and leaves the caller, the host and every co-host publishing", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const coHost = await connect(stub, meetingId, OTHER_STAY, "A Co-host", "video", "co-host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    for (const [participant, stay] of [
      [host, HOST_STAY],
      [coHost, OTHER_STAY],
      [member, MEMBER_STAY],
    ] as const) {
      await publish(participant, stay, [{ name: "microphone", kind: "audio" }]);
    }

    send(host, { type: "mute-all" });
    await waitFor(() => lastFrame(member, "muted") !== undefined);

    // A control that silenced the person pressing it is a control that does not work, and a co-host
    // is running the meeting with the host.
    expect((await storedOf(stub, MEMBER_STAY))?.["muted"]).toBe(true);
    expect((await storedOf(stub, HOST_STAY))?.["muted"]).toBe(false);
    expect((await storedOf(stub, OTHER_STAY))?.["muted"]).toBe(false);
    expect((await storedOf(stub, HOST_STAY))?.["tracks"]).toHaveLength(1);
    expect((await storedOf(stub, OTHER_STAY))?.["tracks"]).toHaveLength(1);
    expect(lastFrame(coHost, "muted")).toBeUndefined();
  });

  it("asks somebody to unmute and changes NOTHING else", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    await publish(member, MEMBER_STAY, [{ name: "microphone", kind: "audio" }]);
    const session = (await storedOf(stub, MEMBER_STAY))?.["sfuSessionId"] as string;
    const upstreamBefore = callsFor(session).length;

    send(host, { type: "ask-to-unmute", participantId: MEMBER_STAY });
    await waitFor(() => lastFrame(member, "unmute-requested") !== undefined);

    expect(lastFrame(member, "unmute-requested")).toMatchObject({ by: HOST_STAY });
    // THE NEGATIVE ASSERTION IS THE POINT. A platform that could open a member's microphone from
    // another member's click is a listening device in a law firm: nothing is closed, nothing is
    // published, and the host is told nothing back, because they asked.
    expect(callsFor(session)).toHaveLength(upstreamBefore);
    expect((await storedOf(stub, MEMBER_STAY))?.["muted"]).toBe(false);
    expect((await storedOf(stub, MEMBER_STAY))?.["tracks"]).toHaveLength(1);
    expect(lastFrame(host, "refused")).toBeUndefined();
    await settle();
    expect(host.frames.filter((frame) => frame["type"] === "unmute-requested")).toHaveLength(0);
  });

  it("spotlights one participant for the room, carries it on a later welcome, and clears it when they leave", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");

    send(host, { type: "spotlight", participantId: MEMBER_STAY });
    await waitFor(() => lastFrame(member, "room-state") !== undefined);

    // A ROOM-LEVEL FACT, which is the whole difference from a pin: a pin is one member arranging
    // their own gallery and says nothing to anybody.
    expect(lastFrame(member, "room-state")).toMatchObject({
      spotlight: { participantId: MEMBER_STAY, by: HOST_STAY },
      locked: false,
    });
    expect(await spotlightOf(stub)).toMatchObject({ participantId: MEMBER_STAY });

    // It survives a sync — that frame answers about the roster, and the spotlight is not on it — and
    // a socket arriving afterwards is told on its welcome, because it holds nothing to apply a
    // difference to.
    send(member, { type: "sync" });
    await waitFor(() => lastFrame(member, "roster") !== undefined);
    expect(await spotlightOf(stub)).toMatchObject({ participantId: MEMBER_STAY });
    const late = await connect(stub, meetingId, OTHER_STAY, "Another Member");
    expect(late.frames[0]).toMatchObject({
      type: "welcome",
      roomState: { spotlight: { participantId: MEMBER_STAY } },
    });

    // And it dies with the person it named: a large tile drawn for somebody who has gone is a tile
    // that will never fill.
    send(member, { type: "leave" });
    await waitFor(
      () => (lastFrame(late, "room-state") as { spotlight: unknown } | undefined) !== undefined,
    );
    expect(lastFrame(late, "room-state")).toMatchObject({ spotlight: null });
    expect(await spotlightOf(stub)).toBeUndefined();
  });

  it("refuses a spotlight naming somebody who is not in the room", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");

    send(host, { type: "spotlight", participantId: "meetingAttendance_nobody" });
    await settle();

    // Every browser would draw the large tile for a tile that does not exist, and ask the routing
    // service for its full layer.
    expect(await spotlightOf(stub)).toBeUndefined();
  });

  it("puts a removed member out: the socket is refused `removed` and closed, and the media stops", async () => {
    const { meetingId, stub } = freshRoom();
    const watcher = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    await publish(member, MEMBER_STAY, [{ name: "microphone", kind: "audio" }]);
    const session = (await storedOf(stub, MEMBER_STAY))?.["sfuSessionId"] as string;

    // Called by the route AFTER its own write commits, on the participantLeft / end precedent.
    await stub.participantRemoved(MEMBER_STAY);
    await waitFor(() => member.closeCode() !== null);

    // THE REASON GOES OUT BEFORE THE CLOSE, always, so the browser learns why rather than inferring
    // it from a code — and the client's fatal set holds `removed`, so it offers no Rejoin.
    expect(lastFrame(member, "refused")).toMatchObject({ reason: "removed" });
    expect(member.closeCode()).toBe(4000);
    expect(await storedOf(stub, MEMBER_STAY)).toBeUndefined();
    expect(callsFor(session).some((call) => call.path.endsWith("/tracks/close"))).toBe(true);
    // And everybody else is told to stop drawing them.
    await waitFor(() => lastFrame(watcher, "roster") !== undefined);
    expect(
      (lastFrame(watcher, "roster") as { participants: RosterEntry[] }).participants.map(
        (one) => one.participantId,
      ),
    ).toEqual([HOST_STAY]);
  });

  it("clears a spotlight on the member a host removes", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    send(host, { type: "spotlight", participantId: MEMBER_STAY });
    await waitFor(() => lastFrame(host, "room-state") !== undefined);

    await stub.participantRemoved(MEMBER_STAY);
    await waitFor(
      () => (lastFrame(host, "room-state") as { spotlight: unknown }).spotlight === null,
    );

    expect(await spotlightOf(stub)).toBeUndefined();
  });

  it("tells the room when the door moves", async () => {
    const { meetingId, stub } = freshRoom();
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");

    await stub.roomStateChanged(true);
    await waitFor(() => lastFrame(member, "room-state") !== undefined);
    expect(lastFrame(member, "room-state")).toMatchObject({ locked: true });

    // And a socket arriving into a locked room is told so on its welcome — off the meeting row the
    // route read, which is where the truth is. Nobody already in the room is touched by the door:
    // the lock is about arrivals.
    const late = await connect(stub, meetingId, OTHER_STAY, "Another Member", "video", null, true);
    expect(late.frames[0]).toMatchObject({ roomState: { locked: true } });
    expect(member.closeCode()).toBeNull();
  });

  it("names a host on the roster, so every browser can draw the badge", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");

    const roster = welcomeRosterOf(member);
    expect(roster.find((one) => one.participantId === HOST_STAY)).toMatchObject({
      hostRole: "host",
    });
    expect(roster.find((one) => one.participantId === MEMBER_STAY)).toMatchObject({
      hostRole: null,
    });

    // And a grant the route writes mid-meeting reaches every browser as a roster change.
    await stub.hostingChanged([
      { userId: `user_${HOST_STAY}`, role: "host" },
      { userId: `user_${MEMBER_STAY}`, role: "co-host" },
    ]);
    await waitFor(() => lastFrame(member, "roster") !== undefined);
    expect(
      (lastFrame(member, "roster") as { participants: RosterEntry[] }).participants.find(
        (one) => one.participantId === MEMBER_STAY,
      ),
    ).toMatchObject({ hostRole: "co-host" });
  });
});

describe("the door, from the signaling side", () => {
  const HOST_STAY = "meetingAttendance_lobbyHost";
  const WAITER_STAY = "meetingAttendance_lobbyWaiter";
  const SECOND_WAITER = "meetingAttendance_lobbySecond";
  const MEMBER_STAY = "meetingAttendance_lobbyMember";

  /** A socket for a stay that is AT THE DOOR — what the route opens for a waiting arrival. */
  async function knock(
    stub: ReturnType<typeof roomStub>,
    meetingId: string,
    attendanceId: string,
    displayName: string,
  ): Promise<Participant> {
    return await connect(stub, meetingId, attendanceId, displayName, "video", null, false, true);
  }

  function send(participant: Participant, frame: Record<string, unknown>): void {
    participant.send(JSON.stringify({ v: 1, ...frame }));
  }

  /** What the room holds under one key, whichever keyspace it is in. */
  async function storedAt(
    stub: ReturnType<typeof roomStub>,
    key: string,
  ): Promise<Record<string, unknown> | undefined> {
    let found: Record<string, unknown> | undefined;
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      found = await state.storage.get<Record<string, unknown>>(key);
    });
    return found;
  }

  it("sends a waiting socket `lobby` and never a `welcome`", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");

    // THERE IS NOTHING IT IS WELCOME TO YET, and a welcome carrying an empty roster is a shape
    // every future reader has to remember to keep empty.
    expect(waiter.frames[0]).toMatchObject({ type: "lobby", position: 1, waiting: 1 });
    expect(lastFrame(waiter, "welcome")).toBeUndefined();

    // THE STRUCTURAL GUARANTEE IS THE PREFIX: they are not in the set the roster is made of, so no
    // filter has to remember to leave them out.
    expect(await storedAt(stub, `waiting:${WAITER_STAY}`)).toMatchObject({
      userId: `user_${WAITER_STAY}`,
      displayName: "A Late Arrival",
    });
    expect(await storedAt(stub, `participant:${WAITER_STAY}`)).toBeUndefined();
  });

  it("keeps a waiter out of every other socket's roster and out of every delta", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    await settle();

    const roster = rosterOf(member) ?? { participants: welcomeRosterOf(member) };
    expect(roster.participants.map((one) => one.participantId)).not.toContain(WAITER_STAY);
    for (const delta of deltasOf(member)) {
      expect([...delta.joined, ...delta.updated].map((one) => one.participantId)).not.toContain(
        WAITER_STAY,
      );
      expect(delta.left).not.toContain(WAITER_STAY);
    }
    // The people in the room are never told somebody is at the door; only the hosts are.
    expect(lastFrame(member, "waiting")).toBeUndefined();
    expect(lastFrame(host, "waiting")).toMatchObject({
      participants: [{ participantId: WAITER_STAY, displayName: "A Late Arrival" }],
    });
  });

  it("refuses every signaling frame from a waiting socket and leaves it open", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    await publish(host, HOST_STAY, [{ name: "camera", kind: "video" }]);
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    upstream = [];

    for (const frame of [
      { type: "sync" },
      { type: "presence", speaking: true, muted: false },
      { type: "mute", participantId: HOST_STAY },
      { type: "mute-all" },
      { type: "spotlight", participantId: HOST_STAY },
      { type: "lower-hands", participantId: null },
      { type: "reaction", name: "applause" },
      // A report is a statement rather than a request and costs the room a write and an event, so
      // it is refused here like everything else: somebody at the door is not being measured yet.
      { type: "diagnostic-report", sample: { quality: "good" } },
      {
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 browser-offer" },
        tracks: [{ trackName: `${WAITER_STAY}:camera`, mid: "0", kind: "video" }],
      },
      {
        type: "subscribe",
        tracks: [{ sessionId: "routing-session-1", trackName: `${HOST_STAY}:camera` }],
      },
    ]) {
      send(waiter, frame);
      await waitFor(() => lastFrame(waiter, "refused") !== undefined);
      expect(lastFrame(waiter, "refused")).toMatchObject({ reason: "not-admitted" });
      waiter.frames.length = 0;
    }

    // DECIDED BEFORE THE ROUTING CLIENT IS EVEN RESOLVED, so a waiter's frame never costs a session
    // at the service — which has no notion of a meeting and would honour a subscription to any
    // session in the fleet.
    expect(upstream).toEqual([]);
    // AND THE SOCKET STAYS OPEN: they are at the door, and the door may open.
    expect(waiter.closeCode()).toBeNull();
  });

  it("leaves no key behind when the member it removes was still at the DOOR", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    await waitFor(() => lastFrame(host, "waiting") !== undefined);

    // A REMOVAL REACHES A STAY WHEREVER IT IS STANDING. The route closes the stay in the firm's
    // record either way; the room's release only knows the `participant:` keyspace, and somebody at
    // the door has never had an entry in it.
    await stub.participantRemoved(WAITER_STAY);
    await waitFor(() => waiter.closeCode() !== null);

    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      const keys = [...(await state.storage.list({ prefix: "waiting:" })).keys()];
      // Left behind, this key made the host's own lobby panel go on offering to admit somebody the
      // record says is not in the meeting, and kept arming the door's grace deadline.
      expect(keys).toEqual([]);
    });
    // And the hosts are told the door moved, rather than being left with a stale list.
    await waitFor(
      () => (lastFrame(host, "waiting") as { participants: unknown[] }).participants.length === 0,
    );
  });

  it("admits on the wire: `admitted`, then `welcome`, then a roster join to the room", async () => {
    const { meetingId, stub } = freshRoom();
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");

    await stub.participantsAdmitted([WAITER_STAY]);
    await waitFor(() => lastFrame(waiter, "welcome") !== undefined);

    // TWO FRAMES WITH ONE JOB EACH, in that order, so the client's welcome handler is the same
    // handler it has always been.
    const types = waiter.frames.map((frame) => frame["type"]);
    expect(types.indexOf("admitted")).toBeGreaterThan(-1);
    expect(types.indexOf("welcome")).toBe(types.indexOf("admitted") + 1);
    expect(lastFrame(waiter, "welcome")).toMatchObject({ participantId: WAITER_STAY });

    // The record moved keyspaces, which is what puts them on the roster at all.
    expect(await storedAt(stub, `waiting:${WAITER_STAY}`)).toBeUndefined();
    expect(await storedAt(stub, `participant:${WAITER_STAY}`)).toMatchObject({
      displayName: "A Late Arrival",
    });
    await waitFor(() => (rosterOf(member)?.participants.length ?? 0) > 1);
    expect(rosterOf(member)?.participants.map((one) => one.participantId)).toContain(WAITER_STAY);

    // And the socket may now signal, which is the whole of what admission changed for it.
    send(waiter, { type: "sync" });
    await waitFor(() => rosterOf(waiter) !== undefined);
    expect(lastFrame(waiter, "refused")).toBeUndefined();
  });

  it("denies on the wire: `refused: denied`, then a 4000 close, and the room is told nothing", async () => {
    const { meetingId, stub } = freshRoom();
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    await settle();
    const framesBefore = member.frames.length;

    await stub.participantsDenied([WAITER_STAY]);
    await waitFor(() => waiter.closeCode() !== null);

    // The reason goes out BEFORE the close, so a browser learns why rather than inferring it from a
    // code — and `denied` is fatal, so the screen offers no way back in.
    expect(lastFrame(waiter, "refused")).toMatchObject({ reason: "denied" });
    expect(waiter.closeCode()).toBe(4000);
    expect(await storedAt(stub, `waiting:${WAITER_STAY}`)).toBeUndefined();
    // NOTHING IS ANNOUNCED TO THE ROOM: the people in it never knew somebody was at the door.
    expect(member.frames.length).toBe(framesBefore);
  });

  it("moves everybody's place in the queue when somebody in front of them goes", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const first = await knock(stub, meetingId, WAITER_STAY, "First");
    const second = await knock(stub, meetingId, SECOND_WAITER, "Second");
    await waitFor(() => lastFrame(second, "lobby") !== undefined);
    expect(lastFrame(second, "lobby")).toMatchObject({ position: 2, waiting: 2 });

    await stub.participantsAdmitted([WAITER_STAY]);
    await waitFor(() => (lastFrame(second, "lobby") as { position: number }).position === 1);
    expect(lastFrame(second, "lobby")).toMatchObject({ position: 1, waiting: 1 });
    await waitFor(() => lastFrame(first, "welcome") !== undefined);
    expect(lastFrame(first, "welcome")).toBeDefined();
  });

  it("tells a waiting socket the meeting ended, which a roster broadcast could not", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, MEMBER_STAY, "A Member");
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");

    await stub.end(ENDED_AT);
    await waitFor(() => lastFrame(waiter, "ended") !== undefined);

    // `broadcast` skips every socket that has not been welcomed, and a waiting one never is — so
    // without its own path somebody standing outside a finished meeting would just go quiet.
    expect(lastFrame(waiter, "ended")).toMatchObject({ endedAt: ENDED_AT });
  });

  it("carries the lobby setting on the room state, and moving it admits nobody", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host", false, false);
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    expect((host.frames[0] as { roomState: { lobby: string } }).roomState.lobby).toBe("off");

    await stub.lobbyChanged("on");
    await waitFor(() => lastFrame(host, "room-state") !== undefined);
    expect(lastFrame(host, "room-state")).toMatchObject({ lobby: "on" });

    await stub.lobbyChanged("off");
    await settle();
    // TURNING THE LOBBY OFF ADMITS NOBODY. A setting is not a decision about a named person, and
    // somebody may be waiting precisely because the host intends to deny them.
    expect(await storedAt(stub, `waiting:${WAITER_STAY}`)).toBeDefined();
    expect(lastFrame(waiter, "welcome")).toBeUndefined();
  });

  it("lets somebody give up at the door without touching the roster", async () => {
    const { meetingId, stub } = freshRoom();
    const host = await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    await waitFor(() => lastFrame(host, "waiting") !== undefined);

    send(waiter, { type: "leave" });
    await waitFor(() => waiter.closeCode() !== null);
    expect(await storedAt(stub, `waiting:${WAITER_STAY}`)).toBeUndefined();
    await waitFor(
      () => (lastFrame(host, "waiting") as { participants: unknown[] }).participants.length === 0,
    );
  });

  it("gives a dropped waiting socket the same grace the roster gets, then closes the stay", async () => {
    const { meetingId, stub } = freshRoom();
    const waiter = await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    waiter.close();
    await waitForStored(async () => {
      const stored = await storedAt(stub, `waiting:${WAITER_STAY}`);
      return stored?.["socketLostAt"] !== null && stored?.["socketLostAt"] !== undefined;
    });

    // Wound back past the grace, exactly as the roster's own sweep is driven: a browser closed at a
    // door must not leave an open stay in the firm's record forever.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      const stored = await state.storage.get<Record<string, unknown>>(`waiting:${WAITER_STAY}`);
      await state.storage.put(`waiting:${WAITER_STAY}`, {
        ...stored,
        socketLostAt: new Date(Date.now() - (SOCKET_LOSS_GRACE_SECONDS + 5) * 1000).toISOString(),
      });
    });
    await runDurableObjectAlarm(stub);

    expect(await storedAt(stub, `waiting:${WAITER_STAY}`)).toBeUndefined();
  });

  it("tells a member who is GIVEN a grant who is already at the door", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");
    await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    await settle();
    // Nothing yet: who is at the door is not something the room may see, and this member is not
    // running the meeting.
    expect(lastFrame(member, "waiting")).toBeUndefined();

    await stub.hostingChanged([
      { userId: `user_${HOST_STAY}`, role: "host" },
      { userId: `user_${MEMBER_STAY}`, role: "co-host" },
    ]);

    // THE AUDIENCE CHANGED, NOT THE QUEUE — nobody arrived and nobody was decided about, so no
    // ordinary lobby frame is coming. Without this the new co-host's panel would stay empty until
    // the next knock, which in the case that matters is a meeting where the person who could let
    // somebody in has just been appointed.
    await waitFor(() => lastFrame(member, "waiting") !== undefined);
    expect(
      (
        lastFrame(member, "waiting") as { participants: { participantId: string }[] }
      ).participants.map((one) => one.participantId),
    ).toEqual([WAITER_STAY]);
  });

  it("states an empty door to a new host rather than saying nothing", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member");

    await stub.hostingChanged([
      { userId: `user_${HOST_STAY}`, role: "host" },
      { userId: `user_${MEMBER_STAY}`, role: "co-host" },
    ]);

    // An empty list is a statement; silence is not. The browser holds who is waiting as something
    // the wire says, so a panel that was never told there is nobody there is showing an absence it
    // has no authority for.
    await waitFor(() => lastFrame(member, "waiting") !== undefined);
    expect(lastFrame(member, "waiting")).toMatchObject({ participants: [] });
  });

  it("says nothing new to somebody whose grant was WITHDRAWN", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, HOST_STAY, "A Host", "video", "host");
    const member = await connect(stub, meetingId, MEMBER_STAY, "A Member", "video", "co-host");
    await knock(stub, meetingId, WAITER_STAY, "A Late Arrival");
    await waitFor(() => lastFrame(member, "waiting") !== undefined);
    const before = member.frames.filter((frame) => frame["type"] === "waiting").length;

    await stub.hostingChanged([{ userId: `user_${HOST_STAY}`, role: "host" }]);
    await settle();
    // Losing a grant is not an occasion to be sent the door: the roster frame that carries the
    // withdrawal is what takes the panel away.
    expect(member.frames.filter((frame) => frame["type"] === "waiting")).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------------------------
// What the room records about itself
// ---------------------------------------------------------------------------------------------

describe("a hand put up, and the queue a host works through", () => {
  it("stamps the room's own instant, relays it on the roster, and is not held by the presence throttle", async () => {
    const { meetingId, stub } = freshRoom();
    const raising = "meetingAttendance_handOne";
    const member = await connect(stub, meetingId, raising, "A Member");
    const watcher = await connect(stub, meetingId, "meetingAttendance_handWatch", "A Guest");

    // A TRANSITION FIRST, so the presence window is already open when the hand goes up. A hand
    // relayed under that throttle would be dropped here, and a member who wants the floor would be
    // invisible to the host until they next happened to toggle their microphone.
    member.send(JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false }));
    await waitFor(() => lastFrame(watcher, "presence") !== undefined);

    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false, hand: true }),
    );

    await waitFor(
      () =>
        rosterOf(watcher)?.participants.find((one) => one.participantId === raising)?.hand === true,
    );
    const entry = rosterOf(watcher)?.participants.find((one) => one.participantId === raising);
    // TWO WIRE FIELDS OVER ONE STORED FACT: the boolean every tile branches on, and the instant the
    // hands panel sorts by. The room decides the clock — a queue ordered by what each person's own
    // machine said is not one ordering.
    expect(entry?.hand).toBe(true);
    expect(Date.parse(String(entry?.handRaisedAt))).not.toBeNaN();
    expect(await handRaisedAtOf(stub, raising)).toBe(entry?.handRaisedAt);
  });

  it("refuses a second signal inside the window, and leaves the socket open", async () => {
    const { meetingId, stub } = freshRoom();
    const raising = "meetingAttendance_handFast";
    const member = await connect(stub, meetingId, raising, "A Member");

    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: true }),
    );
    await waitForStored(async () => (await handRaisedAtOf(stub, raising)) !== null);

    // A hand DROPPED inside the window would be a member asking for the floor and never being
    // relayed, which is why this is the one throttle in the room that refuses.
    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: false }),
    );
    await waitFor(() => lastFrame(member, "refused") !== undefined);
    expect(lastFrame(member, "refused")).toEqual({ v: 1, type: "refused", reason: "rate-limited" });
    expect(member.closeCode()).toBeNull();
    // And nothing moved: the browser re-sends the settled state when the window passes.
    expect(await handRaisedAtOf(stub, raising)).not.toBeNull();

    await rewindSignal(stub, raising, SIGNAL_INTERVAL_MILLISECONDS + 1);
    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: false }),
    );
    await waitForStored(async () => (await handRaisedAtOf(stub, raising)) === null);
    expect(await handRaisedAtOf(stub, raising)).toBeNull();
  });

  it("spends no allowance on a frame that restates a hand the room already holds", async () => {
    const { meetingId, stub } = freshRoom();
    const raising = "meetingAttendance_handSame";
    const member = await connect(stub, meetingId, raising, "A Member");

    // Three frames, one change. A browser states its whole subject on every transition of any of
    // the three facts, so a hand that has not moved must not consume the window the next real
    // change needs.
    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: false }),
    );
    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false, hand: false }),
    );
    await settle();
    expect(lastFrame(member, "refused")).toBeUndefined();
  });

  it("carries the hand on a roster delta and through a sync, so a host's queue stays right", async () => {
    const { meetingId, stub } = freshRoom();
    const raising = "meetingAttendance_handDelta";
    const member = await connect(stub, meetingId, raising, "A Member");
    const watcher = await connect(stub, meetingId, "meetingAttendance_handDeltaWatch", "A Guest");
    await seedRoster(stub, ROSTER_DELTA_THRESHOLD);

    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: true }),
    );

    // ABOVE THE THRESHOLD the room states what CHANGED, and a hand is one `updated` entry rather
    // than a roster of three hundred — the same arithmetic the difference was built for.
    await waitFor(() => deltasOf(watcher).some((delta) => delta.updated.some((one) => one.hand)));
    const updated = deltasOf(watcher)
      .flatMap((delta) => delta.updated)
      .find((one) => one.participantId === raising);
    expect(updated?.hand).toBe(true);

    // And a browser that asks for the whole list gets the queue with it, which is how somebody who
    // joined after the hand went up learns about it at all.
    watcher.send(JSON.stringify({ v: 1, type: "sync" }));
    await waitFor(
      () =>
        rosterOf(watcher)?.participants.find((one) => one.participantId === raising)?.hand === true,
    );
    expect(
      rosterOf(watcher)?.participants.find((one) => one.participantId === raising)?.handRaisedAt,
    ).toBe(await handRaisedAtOf(stub, raising));
  });

  it("refuses lower-hands from a socket holding no grant, and changes nothing", async () => {
    const { meetingId, stub } = freshRoom();
    const raising = "meetingAttendance_handGuard";
    const member = await connect(stub, meetingId, raising, "A Member");
    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: true }),
    );
    await waitForStored(async () => (await handRaisedAtOf(stub, raising)) !== null);

    // Decided from the STORED participant record, never from the socket's attachment — the one
    // place this room answers the authority question.
    member.send(JSON.stringify({ v: 1, type: "lower-hands", participantId: raising }));
    await waitFor(() => lastFrame(member, "refused") !== undefined);
    expect(lastFrame(member, "refused")).toEqual({ v: 1, type: "refused", reason: "not-host" });
    expect(member.closeCode()).toBeNull();
    expect(await handRaisedAtOf(stub, raising)).not.toBeNull();
  });

  it("clears every hand in the room in ONE frame, sparing nobody including the host", async () => {
    const { meetingId, stub } = freshRoom();
    const host = "meetingAttendance_handHost";
    const first = "meetingAttendance_handA";
    const second = "meetingAttendance_handB";
    const hosting = await connect(stub, meetingId, host, "A Host", "video", "host");
    const one = await connect(stub, meetingId, first, "Member One");
    const two = await connect(stub, meetingId, second, "Member Two");

    for (const [socket, stay] of [
      [hosting, host],
      [one, first],
      [two, second],
    ] as const) {
      socket.send(
        JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: true }),
      );
      await waitForStored(async () => (await handRaisedAtOf(stub, stay)) !== null);
    }

    const before = one.frames.length;
    hosting.send(JSON.stringify({ v: 1, type: "lower-hands", participantId: null }));
    await waitForStored(async () => (await handRaisedAtOf(stub, first)) === null);

    // A HOST CLEARING THE FLOOR IS CLEARING IT. Their own hand goes down with the rest — the
    // opposite of the mute-all rule and deliberately so: mute-all exists so a host can speak, and
    // this exists so a host can start the queue again.
    expect(await handRaisedAtOf(stub, host)).toBeNull();
    expect(await handRaisedAtOf(stub, first)).toBeNull();
    expect(await handRaisedAtOf(stub, second)).toBeNull();
    await settle();
    // ONE frame, not one per hand: three hundred cleared hands travel as one roster change.
    expect(one.frames.length - before).toBe(1);
  });

  it("lowers one named hand and leaves the others up", async () => {
    const { meetingId, stub } = freshRoom();
    const host = "meetingAttendance_handHostOne";
    const target = "meetingAttendance_handTarget";
    const other = "meetingAttendance_handOther";
    const hosting = await connect(stub, meetingId, host, "A Host", "video", "host");
    const lowered = await connect(stub, meetingId, target, "Member One");
    const kept = await connect(stub, meetingId, other, "Member Two");

    for (const [socket, stay] of [
      [lowered, target],
      [kept, other],
    ] as const) {
      socket.send(
        JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: true }),
      );
      await waitForStored(async () => (await handRaisedAtOf(stub, stay)) !== null);
    }

    hosting.send(JSON.stringify({ v: 1, type: "lower-hands", participantId: target }));
    await waitForStored(async () => (await handRaisedAtOf(stub, target)) === null);
    expect(await handRaisedAtOf(stub, other)).not.toBeNull();
  });
});

describe("something thrown on a tile", () => {
  it("names the reactor in a small room, and never echoes to the sender", async () => {
    const { meetingId, stub } = freshRoom();
    const reactor = "meetingAttendance_reactOne";
    const throwing = await connect(stub, meetingId, reactor, "A Member");
    const watching = await connect(stub, meetingId, "meetingAttendance_reactWatch", "A Guest");

    throwing.send(JSON.stringify({ v: 1, type: "reaction", name: "applause" }));

    await waitFor(() => lastFrame(watching, "reaction") !== undefined);
    const relayed = lastFrame(watching, "reaction") as Record<string, unknown>;
    expect(relayed["participantId"]).toBe(reactor);
    expect(relayed["name"]).toBe("applause");
    expect(Date.parse(String(relayed["at"]))).not.toBeNaN();
    // The sender's own screen drew the bubble the moment the button was pressed, which is what
    // makes the control feel like a button rather than a request.
    expect(lastFrame(throwing, "reaction")).toBeUndefined();
    // And no coalesced frame at this size: a bubble on the right face is a promise a small room
    // can keep.
    expect(lastFrame(watching, "reactions")).toBeUndefined();
  });

  it("refuses a second reaction inside the signal window, socket open", async () => {
    const { meetingId, stub } = freshRoom();
    const reactor = "meetingAttendance_reactFast";
    const throwing = await connect(stub, meetingId, reactor, "A Member");
    const watching = await connect(stub, meetingId, "meetingAttendance_reactFastWatch", "A Guest");

    throwing.send(JSON.stringify({ v: 1, type: "reaction", name: "heart" }));
    await waitFor(() => lastFrame(watching, "reaction") !== undefined);
    throwing.send(JSON.stringify({ v: 1, type: "reaction", name: "laugh" }));

    await waitFor(() => lastFrame(throwing, "refused") !== undefined);
    expect(lastFrame(throwing, "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "rate-limited",
    });
    expect(throwing.closeCode()).toBeNull();
    await settle();
    // REFUSED RATHER THAN RELAYED: the second act did not happen for anybody, and the browser is
    // told so rather than left believing it landed.
    expect(watching.frames.filter((frame) => frame["type"] === "reaction")).toHaveLength(1);
  });

  it("shares ONE window with the hand, so a browser cannot spend its allowance twice", async () => {
    const { meetingId, stub } = freshRoom();
    const reactor = "meetingAttendance_reactShare";
    const member = await connect(stub, meetingId, reactor, "A Member");

    member.send(
      JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false, hand: true }),
    );
    await waitForStored(async () => (await handRaisedAtOf(stub, reactor)) !== null);
    member.send(JSON.stringify({ v: 1, type: "reaction", name: "celebrate" }));

    await waitFor(() => lastFrame(member, "refused") !== undefined);
    expect(lastFrame(member, "refused")).toEqual({ v: 1, type: "refused", reason: "rate-limited" });
  });

  it("coalesces a large room's reactions into ONE frame carrying the counts", async () => {
    const { meetingId, stub } = freshRoom();
    const first = "meetingAttendance_reactBigOne";
    const second = "meetingAttendance_reactBigTwo";
    const one = await connect(stub, meetingId, first, "Member One");
    const two = await connect(stub, meetingId, second, "Member Two");
    // REAL SOCKETS rather than a seeded roster, because the branch is decided over the sockets a
    // frame would actually reach — a roster read per reaction would spend three hundred keys on
    // every one of them in exactly the room the coalescing exists for, and a stay inside its grace
    // period with no socket open receives nothing either way.
    await fillRoom(stub, meetingId, "reactBig", ROSTER_DELTA_THRESHOLD - 1);

    one.send(JSON.stringify({ v: 1, type: "reaction", name: "applause" }));
    two.send(JSON.stringify({ v: 1, type: "reaction", name: "applause" }));
    await settle();

    // NOTHING individual, and nothing yet at all: the bucket is open and the window has not run.
    expect(one.frames.filter((frame) => frame["type"] === "reaction")).toHaveLength(0);
    expect(one.frames.filter((frame) => frame["type"] === "reactions")).toHaveLength(0);

    // A reaction arriving after the window has closed flushes the bucket INCLUDING ITSELF.
    await rewindReactionBucket(stub, REACTION_COALESCE_INTERVAL_MILLISECONDS + 1);
    await rewindSignal(stub, first, SIGNAL_INTERVAL_MILLISECONDS + 1);
    one.send(JSON.stringify({ v: 1, type: "reaction", name: "heart" }));

    await waitFor(() => lastFrame(one, "reactions") !== undefined);
    const counts = (lastFrame(one, "reactions") as { counts: Record<string, number> }).counts;
    expect(counts).toEqual({ applause: 2, heart: 1 });
    // Sent to EVERY socket including the reactors: a count that excluded the reader would be a
    // different number per socket, and the room would build three hundred frames to avoid one
    // double-count.
    await waitFor(() => lastFrame(two, "reactions") !== undefined);
    expect((lastFrame(two, "reactions") as { counts: Record<string, number> }).counts).toEqual(
      counts,
    );
  });

  it("flushes a bucket nothing follows on the alarm, and the alarm's other deadlines still fire", async () => {
    const { meetingId, stub } = freshRoom();
    const reactor = "meetingAttendance_reactAlarm";
    const speaker = "meetingAttendance_reactAlarmSpeaker";
    const throwing = await connect(stub, meetingId, reactor, "A Member");
    const talking = await connect(stub, meetingId, speaker, "A Guest");
    await fillRoom(stub, meetingId, "reactAlarmSeat", ROSTER_DELTA_THRESHOLD - 1);

    // A DEFERRED PRESENCE TRANSITION beside the bucket, so this asserts the two share one alarm
    // rather than one of them taking it.
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: true, muted: false }));
    await waitFor(() => lastFrame(throwing, "presence") !== undefined);
    talking.send(JSON.stringify({ v: 1, type: "presence", speaking: false, muted: false }));
    await waitForStored(async () => (await presenceOf(stub, speaker)).presenceDirty);

    throwing.send(JSON.stringify({ v: 1, type: "reaction", name: "thumbs-up" }));
    // A bucket opens and nothing follows it. Paused on rather than waited on, because the assertion
    // is a NEGATIVE — the coalesced frame must not have gone out yet — and a negative has no
    // condition to wait for.
    await settle();
    expect(lastFrame(throwing, "reactions")).toBeUndefined();

    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    await rewindReactionBucket(stub, REACTION_COALESCE_INTERVAL_MILLISECONDS + 1);
    await rewindPresence(stub, speaker, PRESENCE_RELAY_INTERVAL_MILLISECONDS + 1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await waitFor(() => lastFrame(throwing, "reactions") !== undefined);
    expect((lastFrame(throwing, "reactions") as { counts: Record<string, number> }).counts).toEqual(
      { "thumbs-up": 1 },
    );
    // And the presence flush the same wake owed happened too.
    expect((await presenceOf(stub, speaker)).presenceDirty).toBe(false);
  });

  it("stores nothing about a reaction once it has been sent", async () => {
    const { meetingId, stub } = freshRoom();
    const reactor = "meetingAttendance_reactStore";
    const throwing = await connect(stub, meetingId, reactor, "A Member");
    await connect(stub, meetingId, "meetingAttendance_reactStoreWatch", "A Guest");

    throwing.send(JSON.stringify({ v: 1, type: "reaction", name: "laugh" }));
    await settle();

    // NO TABLE, NO AUDIT ROW, AND NOT EVEN A KEY IN THE ROOM below the threshold: a reaction says
    // somebody agreed with a sentence four seconds ago, and when the meeting ends there is nothing
    // anybody would ask about.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      expect(await state.storage.get("reactions")).toBeUndefined();
    });
  });

  it("refuses a name outside the six", async () => {
    const { meetingId, stub } = freshRoom();
    const member = await connect(stub, meetingId, "meetingAttendance_reactBad", "A Member");

    member.send(JSON.stringify({ v: 1, type: "reaction", name: "shrug" }));
    await waitFor(() => lastFrame(member, "refused") !== undefined);
    // A closed vocabulary, refused at the parse: a free string here would put arbitrary text on a
    // tile in a firm's meeting.
    expect(lastFrame(member, "refused")).toEqual({
      v: 1,
      type: "refused",
      reason: "malformed-frame",
    });
    expect(MEETING_REACTIONS).not.toContain("shrug");
  });
});

describe("the chat relay, which is a copy and never the record", () => {
  const SAID = {
    id: "meetingMessage_relayOne",
    meetingId: "meeting_relayOne",
    participantKind: "member",
    participantId: "meetingAttendance_relaySpeaker",
    userId: "user_relaySpeaker",
    sentAt: "2026-09-21T10:00:00.000Z",
    body: "The exhibits are in the shared folder.",
    redactedAt: null,
    redactedByUserId: null,
  } as const;

  it("reaches every welcomed socket and nobody at the door, and stores nothing", async () => {
    const { meetingId, stub } = freshRoom();
    const inside = await connect(stub, meetingId, "meetingAttendance_relayIn", "A Member");
    const alsoInside = await connect(stub, meetingId, "meetingAttendance_relayIn2", "A Guest");
    const waiting = await connect(
      stub,
      meetingId,
      "meetingAttendance_relayDoor",
      "At The Door",
      "video",
      null,
      false,
      true,
    );
    const doorFramesBefore = waiting.frames.length;

    await stub.messageSent(SAID);

    await waitFor(() => lastFrame(inside, "message") !== undefined);
    expect(lastFrame(inside, "message")).toEqual({ v: 1, type: "message", message: SAID });
    await waitFor(() => lastFrame(alsoInside, "message") !== undefined);
    // WHAT IS SAID INSIDE A ROOM IS EXACTLY WHAT SOMEBODY AT THE DOOR MUST NOT REACH, and it is
    // structural rather than filtered here: a waiting socket is never welcomed, and the broadcast
    // skips everything that is not.
    await settle();
    expect(waiting.frames.length).toBe(doorFramesBefore);

    // The room is a relay and holds nothing: the transcript is the firm's own record.
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      const keys = [...(await state.storage.list()).keys()];
      expect(keys.some((key) => key.includes("message"))).toBe(false);
    });
  });

  it("says a message was taken back with the handle and the instant alone", async () => {
    const { meetingId, stub } = freshRoom();
    const inside = await connect(stub, meetingId, "meetingAttendance_relayRedact", "A Member");

    await stub.messageRedacted(SAID.id, "2026-09-21T10:05:00.000Z");

    await waitFor(() => lastFrame(inside, "message-redacted") !== undefined);
    expect(lastFrame(inside, "message-redacted")).toEqual({
      v: 1,
      type: "message-redacted",
      messageId: SAID.id,
      redactedAt: "2026-09-21T10:05:00.000Z",
    });
  });

  it("is a no-op for a room nobody holds a socket on", async () => {
    const { stub } = freshRoom();
    // Addressed by every commit, including for a meeting that has never been opened in a browser.
    await expect(stub.messageSent(SAID)).resolves.toBeUndefined();
    await expect(stub.messageRedacted(SAID.id, SAID.sentAt)).resolves.toBeUndefined();
  });
});

describe("what the room records about itself", () => {
  const STAY = "meetingAttendance_diagnosticsOne";
  const OTHER_STAY = "meetingAttendance_diagnosticsTwo";

  let recorder: MemoryLogger;

  beforeEach(() => {
    // Installing the logger also restarts the storage-budget sampler, which is what makes the
    // sampled frame a known one rather than whichever frame this file happened to reach.
    recorder = createMemoryLogger();
    setRoomDiagnosticsLoggerForTests(recorder);
  });

  afterAll(() => {
    // Removed rather than left installed, on the same terms the routing-service seam is: a suite
    // that left it set would send every later file's meeting telemetry into a dead array.
    setRoomDiagnosticsLoggerForTests(null);
  });

  function recorded(name: string): Record<string, unknown>[] {
    return recorder.events
      .filter((event) => event.name === name)
      .map((event) => event.fields as Record<string, unknown>);
  }

  function send(participant: Participant, frame: Record<string, unknown>): void {
    participant.send(JSON.stringify({ v: 1, ...frame }));
  }

  /** One participant's whole stored record, which is where the last sample is kept. */
  async function participantRecordOf(
    stub: ReturnType<typeof roomStub>,
    attendanceId: string,
  ): Promise<Record<string, unknown>> {
    let found: Record<string, unknown> = {};
    await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
      found =
        (await state.storage.get<Record<string, unknown>>(`participant:${attendanceId}`)) ?? {};
    });
    return found;
  }

  it("records the arrival, the welcome and the publish, correlated by firm, meeting and stay", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    await publish(participant, STAY, [{ name: "camera", kind: "video" }]);
    await waitFor(() => recorded("meetings.room.published").length > 0);

    expect(recorded("meetings.room.joined")[0]).toMatchObject({
      firmId: FIRM,
      meetingId,
      attendanceId: STAY,
      medium: "video",
      waiting: false,
      // The first socket for a stay is an arrival; the same path taken again is a rejoin, and the
      // two are the difference between somebody joining and somebody's connection failing.
      rejoined: false,
    });
    expect(recorded("meetings.room.welcomed")[0]).toMatchObject({
      meetingId,
      attendanceId: STAY,
      rosterSize: 1,
    });
    expect(recorded("meetings.room.published")[0]).toMatchObject({
      meetingId,
      attendanceId: STAY,
      trackCount: 1,
      audioCount: 0,
      videoCount: 1,
      refusedCount: 0,
    });
  });

  it("records a rejoin as a rejoin, and the socket it superseded", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, STAY, "A Member");
    await connect(stub, meetingId, STAY, "A Member");
    await waitFor(() => recorded("meetings.room.superseded").length > 0);

    expect(recorded("meetings.room.joined").at(-1)).toMatchObject({ rejoined: true });
    expect(recorded("meetings.room.superseded")[0]).toMatchObject({
      attendanceId: STAY,
      socketCount: 1,
    });
  });

  it("records a refusal with its reason, the frame that caused it, and no Error ID where none was minted", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    send(participant, {
      type: "subscribe",
      tracks: [{ sessionId: "routing-session-nobody", trackName: `${OTHER_STAY}:camera` }],
    });
    await waitFor(() => recorded("meetings.room.refused").length > 0);

    expect(recorded("meetings.room.refused")[0]).toMatchObject({
      meetingId,
      attendanceId: STAY,
      reason: "unknown-track",
      frameType: "subscribe",
      // Absent because nothing failed on this side: the frame named a pair this room is not
      // carrying, and an Error ID would send somebody looking for a trace that does not exist.
      errorId: null,
    });
  });

  it("gives the member and the record the SAME Error ID when the routing service will not answer", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    sessionsAreUnavailable = true;
    await publish(participant, STAY, [{ name: "camera", kind: "video" }]);
    await waitFor(() => recorded("meetings.room.refused").length > 0);

    const refusal = lastFrame(participant, "refused") as { reason: string; errorId?: string };
    expect(refusal.reason).toBe("sfu-unavailable");
    // One failure, one handle. A record naming an id the member does not hold is a support search
    // that finds nothing, which is the one thing the field exists for.
    expect(recorded("meetings.room.refused")[0]).toMatchObject({ errorId: refusal.errorId });
  });

  it("has no slot for a display name, a track name or a session description", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "Jane Attorney-Smith");
    await publish(participant, STAY, [{ name: "camera", kind: "video" }]);
    await waitFor(() => recorded("meetings.room.published").length > 0);

    // Read as TEXT rather than field by field, which is the only form of this assertion that keeps
    // holding when somebody adds a field: the redaction is structural (the allowlist has no slot
    // for any of these), and this is what says so from outside the catalog.
    const asText = JSON.stringify(recorder.events);
    expect(asText).not.toContain("Jane");
    expect(asText).not.toContain("Attorney-Smith");
    expect(asText).not.toContain("camera");
    expect(asText).not.toContain("v=0");
    // And the handles that ARE there, because a record nothing can be correlated by is worth
    // nothing at all.
    expect(asText).toContain(STAY);
    expect(asText).toContain(meetingId);
  });

  it("takes one connection report per participant per window and drops the rest", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    send(participant, {
      type: "diagnostic-report",
      sample: {
        quality: "poor",
        roundTripMilliseconds: 410,
        lossFraction: 0.12,
        jitterMilliseconds: 48,
        outbound: { rid: "q", width: 320, height: 180, bitrate: 90_000 },
        inboundCount: 7,
      },
    });
    await waitFor(() => recorded("meetings.room.clientReport").length > 0);

    expect(recorded("meetings.room.clientReport")[0]).toMatchObject({
      meetingId,
      attendanceId: STAY,
      quality: "poor",
      roundTripMilliseconds: 410,
      outboundRid: "q",
      outboundWidth: 320,
      inboundCount: 7,
    });
    // THE LAST SAMPLE IS ON THE RECORD, which is what the operator's inspect call reads.
    const stored = (await participantRecordOf(stub, STAY))["lastSample"] as Record<string, unknown>;
    expect(stored).toMatchObject({ quality: "poor", outboundHeight: 180 });

    // A second one inside the window is dropped in silence: a sample is a restatement, and a
    // refusal would be a vocabulary every browser has to learn to treat as non-fatal.
    send(participant, { type: "diagnostic-report", sample: { quality: "good" } });
    await settle();
    expect(recorded("meetings.room.clientReport")).toHaveLength(1);
    expect(lastFrame(participant, "refused")).toBeUndefined();
  });

  it("refuses a report that claims something no connection could measure", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    // A hundred million milliseconds of round trip is not a bad connection; it is a claim. The
    // bound is in the frame schema, so it is refused at the parse rather than aggregated.
    send(participant, {
      type: "diagnostic-report",
      sample: { roundTripMilliseconds: 100_000_000 },
    });
    await waitFor(() => lastFrame(participant, "refused") !== undefined);

    expect(lastFrame(participant, "refused")).toMatchObject({ reason: "malformed-frame" });
    expect(recorded("meetings.room.clientReport")).toHaveLength(0);
    // The stay is still in the room: a report the room could not read is a bug in one message, not
    // a reason to drop somebody out of a meeting.
    expect(participant.closeCode()).toBeNull();
  });

  it("samples what a frame costs the room in storage", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    // The first frame after the logger is installed is the sampled one, and a `sync` is the frame
    // the budget exists for: it reads every key the room holds.
    send(participant, { type: "sync" });
    await waitFor(() => recorded("meetings.room.storageReadBudget").length > 0);

    expect(recorded("meetings.room.storageReadBudget")[0]).toMatchObject({
      meetingId,
      frameType: "sync",
      // ONE list. This is the room's whole economy stated as a number: in a room of three hundred
      // a second list would double the cost of the busiest thing it does.
      listCount: 1,
    });
  });

  it("records which of the alarm's jobs were due, including when none were", async () => {
    const { meetingId, stub } = freshRoom();
    const participant = await connect(stub, meetingId, STAY, "A Member");
    // A room holding no deadline has no alarm to run, so one is armed the way the room arms one:
    // a socket goes away and this stay's own minute starts.
    participant.close();
    await waitForStored(async () => {
      let lost = false;
      await runInDurableObject(stub, async (_room: MeetingRoom, state) => {
        const stored = await state.storage.get<Record<string, unknown>>(`participant:${STAY}`);
        lost = stored?.["socketLostAt"] !== null && stored?.["socketLostAt"] !== undefined;
      });
      return lost;
    });
    expect(recorded("meetings.room.socketLost")[0]).toMatchObject({ attendanceId: STAY });

    await runDurableObjectAlarm(stub);

    // The grace has not run out, so the wake found nothing due — which is the case worth recording:
    // an alarm that runs, does none of its jobs and re-arms anyway is the one shape in which this
    // mechanism can spin, and it is invisible without the counts beside the re-arm.
    expect(recorded("meetings.room.alarmRan")[0]).toMatchObject({
      meetingId,
      sweptParticipants: 0,
      sweptWaiting: 0,
      presenceFlushed: 0,
      endedMarkerRetired: false,
      rearmed: true,
    });
  });

  it("records the end of the meeting with the size it ended at", async () => {
    const { meetingId, stub } = freshRoom();
    await connect(stub, meetingId, STAY, "A Member");
    await connect(stub, meetingId, OTHER_STAY, "Another Member");
    await stub.end(ENDED_AT);
    await waitFor(() => recorded("meetings.room.ended").length > 0);

    expect(recorded("meetings.room.ended")[0]).toMatchObject({
      meetingId,
      participantCount: 2,
      waitingCount: 0,
    });
  });
});
