import { env, runInDurableObject } from "cloudflare:test";
import { ROSTER_DELTA_THRESHOLD } from "@magna-carta/meeting-protocol/frames";
import type { MeetingRoom } from "../../src/meetings/meeting-room.ts";
import { meetingSocketRequestUrl } from "../../src/meetings/meeting-room.ts";

// A ROOM OF THREE HUNDRED, DRIVEN — so the fan-out cost is a number rather than an argument.
//
// Every rule the room is built around is a claim about what happens at scale: the roster is read at
// most once per frame, a join above the delta threshold costs each other socket ONE frame, presence
// is coalesced rather than relayed per transition, and a supersede hangs up on one socket rather
// than disturbing the room. Each of those was reasoned about and none of them was measured, and the
// first three-hundred-person meeting that goes wrong is the wrong moment to find out which one is
// false.
//
// WHAT THIS IS NOT. It is not a benchmark of Cloudflare's runtime and the wall time it reports is
// not a service level: this runs against Miniflare on whatever machine is free, sharing a box with
// other Workers runtimes. What it measures is the room's OWN cost — frames per socket, storage
// operations per frame, alarms per pass — and those are counts rather than durations, so they are
// stable where the clock is not. The wall time is reported anyway because a change that makes the
// counts identical and the run four times longer is worth seeing.
//
// The fast variant runs in the ordinary suite as an assertion on the bound; the full one is run by
// hand. Both go through the same driver, because a harness that is not the thing the suite runs is
// a harness that stops working without anybody noticing.

/** How many fake clients the fast variant drives — enough to be past the delta threshold twice. */
export const FAST_PARTICIPANTS = 40;

/** How many the full pass drives: the room's own ceiling. */
export const FULL_PARTICIPANTS = 300;

/** What one pass of the harness answers. */
export interface MeetingRoomLoadReport {
  readonly participants: number;
  /** Frames delivered across every socket, over the whole pass. */
  readonly framesDelivered: number;
  /** The busiest single socket, which is the one a browser has to keep up with. */
  readonly framesOnBusiestSocket: number;
  /**
   * WHAT ONE JOIN COSTS EVERY OTHER SOCKET, measured only above `ROSTER_DELTA_THRESHOLD` — below it
   * the room states the whole roster on purpose, because the list is cheaper than the difference.
   * The number the room's design claims is one.
   */
  readonly framesPerJoinPerSocket: number;
  /** Client frames sent into the room during the signaling phase. */
  readonly framesSent: number;
  /** Storage list operations the room spent across that phase — the read that is the whole roster. */
  readonly storageLists: number;
  /** The rule the room is built around, as a number. */
  readonly storageListsPerFrame: number;
  /** Storage get operations across the same phase. */
  readonly storageGets: number;
  /** Alarms armed across the whole pass. */
  readonly alarmsArmed: number;
  /**
   * Alarms armed by the presence bursts alone — the number the coalescing claims. Everybody in the
   * room toggling three times is meant to cost a wake per burst, not one per transition.
   */
  readonly presenceAlarms: number;
  readonly wallMilliseconds: number;
}

interface LoadClient {
  readonly attendanceId: string;
  frames: number;
  send(text: string): void;
  close(): void;
}

/**
 * A routing service that answers instantly and remembers nothing.
 *
 * The real one is faked in every meeting test; this is the same shape pared to what a load pass
 * needs, because three hundred participants publishing two tracks each is six hundred round trips
 * and the harness is measuring the ROOM rather than the service.
 */
export function loadRoutingService(): typeof fetch {
  let session = 0;
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const json = (payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname.endsWith("/sessions/new")) {
      session += 1;
      return json({ sessionId: `load-session-${String(session)}` });
    }
    if (url.pathname.endsWith("/tracks/new")) {
      const tracks = (body["tracks"] ?? []) as { location: string; trackName?: string }[];
      const local = tracks.every((track) => track.location === "local");
      return json({
        requiresImmediateRenegotiation: !local,
        sessionDescription: { type: local ? "answer" : "offer", sdp: "v=0 load" },
        tracks: tracks.map((track, index) => ({ ...track, mid: String(index) })),
      });
    }
    if (url.pathname.endsWith("/tracks/update")) {
      const tracks = (body["tracks"] ?? []) as { mid: string }[];
      return json({ tracks: tracks.map((track) => ({ mid: track.mid })) });
    }
    if (url.pathname.endsWith("/tracks/close")) {
      const tracks = (body["tracks"] ?? []) as { mid: string }[];
      return json({
        requiresImmediateRenegotiation: false,
        sessionDescription: { type: "answer", sdp: "v=0 load" },
        tracks: tracks.map((track) => ({ mid: track.mid })),
      });
    }
    if (url.pathname.endsWith("/renegotiate")) return json({});
    if (/\/sessions\/[^/]+$/.test(url.pathname)) return json({ tracks: [] });
    return new Response("unexpected", { status: 404 });
  };
}

function seatHandle(seat: number): string {
  return `meetingAttendance_load${String(seat).padStart(5, "0")}`;
}

/** Waits for a condition, or gives up — a fixed number of ticks is a guess that gets worse here. */
async function waitFor(condition: () => boolean, budgetMilliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + budgetMilliseconds;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A short pause, for measuring that nothing FURTHER arrived. */
async function settle(milliseconds = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function framesAcross(clients: readonly LoadClient[]): number {
  return clients.reduce((total, client) => total + client.frames, 0);
}

/**
 * Waits until the room has stopped sending — nothing new across every socket for a whole window.
 *
 * A MEASUREMENT WINDOW THAT CLOSES ON A PAUSE MEASURES THE PAUSE. A phase is not over when each
 * client has been answered once: one publish is answered on the asking socket AND broadcast to every
 * other, so "each client gained a frame" is satisfied by somebody else's work while half of this
 * phase is still queued — and the storage the room had not spent yet is storage the harness reports
 * as never spent. Quiescence is the only signal that means the room is actually through, and it is
 * what the counts are then taken against.
 */
async function waitUntilQuiet(
  clients: readonly LoadClient[],
  quietMilliseconds = 250,
  budgetMilliseconds = 120_000,
): Promise<void> {
  const deadline = Date.now() + budgetMilliseconds;
  let last = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const now = framesAcross(clients);
    if (now !== last) {
      last = now;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMilliseconds) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Drives one pass and answers what it cost.
 *
 * The phases are the ones a real meeting has, in the order it has them: everybody arrives, everybody
 * publishes, everybody talks at once, the gallery turns a page, a tenth of the room's connections
 * drop and come back, and the host ends it.
 */
export async function runMeetingRoomLoad(
  firmId: string,
  meetingId: string,
  participants: number,
): Promise<MeetingRoomLoadReport> {
  const startedAt = Date.now();
  const stub = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`));

  // Counted by wrapping the instance's own storage and alarm, which is the only way from outside:
  // the room deliberately keeps nothing on the instance that would survive hibernation, so there is
  // no counter on it to read.
  const counted = { lists: 0, gets: 0, alarms: 0 };
  await runInDurableObject(stub, (_room: MeetingRoom, state) => {
    const storage = state.storage as unknown as {
      list: (options?: unknown) => Promise<unknown>;
      get: (key: unknown, options?: unknown) => Promise<unknown>;
      setAlarm: (at: unknown, options?: unknown) => Promise<unknown>;
    };
    const underlyingList = storage.list.bind(state.storage);
    const underlyingGet = storage.get.bind(state.storage);
    const underlyingSetAlarm = storage.setAlarm.bind(state.storage);
    storage.list = async (options?: unknown) => {
      counted.lists += 1;
      return await underlyingList(options);
    };
    storage.get = async (key: unknown, options?: unknown) => {
      counted.gets += 1;
      return await underlyingGet(key, options);
    };
    storage.setAlarm = async (at: unknown, options?: unknown) => {
      counted.alarms += 1;
      return await underlyingSetAlarm(at, options);
    };
  });

  const clients: LoadClient[] = [];
  const perJoinCosts: number[] = [];

  // ---- everybody arrives, one at a time, which is how a room fills at the top of the hour ----
  for (let seat = 0; seat < participants; seat += 1) {
    const present = [...clients];
    const before = framesAcross(present);
    clients.push(await openSocket(stub, firmId, meetingId, seatHandle(seat)));
    if (present.length > ROSTER_DELTA_THRESHOLD) {
      // Every socket already in the room should receive exactly one frame for this arrival. Waited
      // for rather than paused on, so a slow machine lengthens the run instead of failing it.
      await waitFor(() => framesAcross(present) - before >= present.length, 5_000);
      await settle(10);
      perJoinCosts.push((framesAcross(present) - before) / present.length);
    }
  }
  await settle();

  // From here the counters are about FRAMES, so the arrival phase's spend is left behind: a join is
  // an upgrade rather than a frame, and mixing the two would make the per-frame bound unreadable.
  const listsBefore = counted.lists;
  const getsBefore = counted.gets;
  let framesSent = 0;

  // ---- everybody publishes a microphone and a camera ----
  for (const client of clients) {
    client.send(
      JSON.stringify({
        v: 1,
        type: "publish",
        sessionDescription: { type: "offer", sdp: "v=0 load-offer" },
        tracks: [
          { trackName: `${client.attendanceId}:microphone`, mid: "0", kind: "audio" },
          { trackName: `${client.attendanceId}:camera`, mid: "1", kind: "video" },
        ],
      }),
    );
    framesSent += 1;
  }
  await waitUntilQuiet(clients);

  // ---- everybody talks at once, several times, which is what the presence throttle is for ----
  const alarmsBeforePresence = counted.alarms;
  for (let burst = 0; burst < 3; burst += 1) {
    for (const client of clients) {
      client.send(
        JSON.stringify({ v: 1, type: "presence", speaking: burst % 2 === 0, muted: false }),
      );
      framesSent += 1;
    }
  }
  await waitUntilQuiet(clients);
  const presenceAlarms = counted.alarms - alarmsBeforePresence;

  // ---- the gallery turns a page: everybody asks for the whole list again ----
  for (const client of clients) {
    client.send(JSON.stringify({ v: 1, type: "sync" }));
    framesSent += 1;
  }
  await waitUntilQuiet(clients);

  const listsAfter = counted.lists;
  const getsAfter = counted.gets;

  // ---- a supersede storm: a tenth of the room's connections drop and come straight back ----
  const reconnecting = Math.max(1, Math.floor(participants / 10));
  for (let seat = 0; seat < reconnecting; seat += 1) {
    clients.push(await openSocket(stub, firmId, meetingId, seatHandle(seat)));
  }
  await waitUntilQuiet(clients);

  // ---- the host ends it ----
  await stub.end(new Date().toISOString());
  await settle(100);

  const busiest = clients.reduce((most, client) => Math.max(most, client.frames), 0);
  for (const client of clients) client.close();

  return {
    participants,
    framesDelivered: framesAcross(clients),
    framesOnBusiestSocket: busiest,
    framesPerJoinPerSocket:
      perJoinCosts.length === 0
        ? 0
        : perJoinCosts.reduce((total, one) => total + one, 0) / perJoinCosts.length,
    framesSent,
    storageLists: listsAfter - listsBefore,
    storageListsPerFrame: framesSent === 0 ? 0 : (listsAfter - listsBefore) / framesSent,
    storageGets: getsAfter - getsBefore,
    alarmsArmed: counted.alarms,
    presenceAlarms,
    wallMilliseconds: Date.now() - startedAt,
  };
}

/** One socket, opened exactly as the meetings route opens one, counting what it is sent. */
async function openSocket(
  stub: ReturnType<typeof env.MEETING_ROOM.get>,
  firmId: string,
  meetingId: string,
  attendanceId: string,
): Promise<LoadClient> {
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        // A name nobody could mistake for a person's: nothing in this harness reads it, and a
        // fixture that looked like a real member is a fixture somebody quotes in a report.
        displayName: `seat ${attendanceId}`,
        medium: "video",
        hostRole: null,
        locked: false,
        lobby: "off",
        waiting: false,
        waitingFrom: "",
      }),
      { headers: { Upgrade: "websocket" } },
    ),
  );
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no WebSocket on the 101");
  const client: LoadClient = {
    attendanceId,
    frames: 0,
    send: (text) => {
      socket.send(text);
    },
    close: () => {
      try {
        socket.close(1000, "load pass over");
      } catch {
        // Already closed by the room ending the meeting, which is the ordinary case here.
      }
    },
  };
  socket.accept();
  // COUNTED, NEVER KEPT. Three hundred sockets holding every frame they were sent is the harness
  // running out of memory measuring a room that did not.
  socket.addEventListener("message", () => {
    client.frames += 1;
  });
  await waitFor(() => client.frames > 0, 10_000);
  return client;
}

/** The pass's numbers, as one line a person reads off a terminal. */
export function reportLine(report: MeetingRoomLoadReport): string {
  return [
    `participants=${String(report.participants)}`,
    `framesDelivered=${String(report.framesDelivered)}`,
    `framesOnBusiestSocket=${String(report.framesOnBusiestSocket)}`,
    `framesPerJoinPerSocket=${report.framesPerJoinPerSocket.toFixed(3)}`,
    `framesSent=${String(report.framesSent)}`,
    `storageLists=${String(report.storageLists)}`,
    `storageListsPerFrame=${report.storageListsPerFrame.toFixed(3)}`,
    `storageGets=${String(report.storageGets)}`,
    `alarmsArmed=${String(report.alarmsArmed)}`,
    `presenceAlarms=${String(report.presenceAlarms)}`,
    `wallMilliseconds=${String(report.wallMilliseconds)}`,
  ].join(" ");
}
