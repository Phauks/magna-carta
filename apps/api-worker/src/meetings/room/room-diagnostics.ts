import {
  meetingRoomAdmitted,
  meetingRoomAlarmRan,
  meetingRoomClientReport,
  meetingRoomDenied,
  meetingRoomEnded,
  meetingRoomJoined,
  meetingRoomLayerChanged,
  meetingRoomLocked,
  meetingRoomMessageRelayed,
  meetingRoomMuted,
  meetingRoomPollRelayed,
  meetingRoomPresenceRelayed,
  meetingRoomQuestionRelayed,
  meetingRoomReactionsRelayed,
  meetingRoomPublished,
  meetingRoomRefused,
  meetingRoomRemoved,
  meetingRoomSocketLost,
  meetingRoomStorageReadBudget,
  meetingRoomSubscribed,
  meetingRoomSuperseded,
  meetingRoomSwept,
  meetingRoomWelcomed,
} from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { refusedFrame } from "@magna-carta/meeting-protocol/frames";
import type {
  MeetingClientFrame,
  MeetingDiagnosticSample,
  MeetingRefusalReason,
} from "@magna-carta/meeting-protocol/frames";
import { realtimeLoggerFor } from "../sfu/realtime-failure.ts";
import { runningUnderTest } from "../sfu/sfu-client.ts";
import {
  putParticipant,
  readParticipant,
  readRoom,
  refuseAndClose,
  storageReadCounts,
  trySend,
  type RoomContext,
  type StoredClientSample,
} from "./room-state.ts";

// WHY A MEETING RECORDS ANYTHING AT ALL, when the whole subsystem is built to record as little as
// possible.
//
// Everything a room holds is deleted: the roster when somebody leaves, the sessions when the meeting
// ends, the object itself a day later. That is the right posture for what people said to each other
// and the wrong one for whether the platform worked — a meeting of three hundred that went badly
// used to leave behind attendance and an Error ID on whichever refusal a member happened to see, and
// nothing else. Nobody could answer "was it us", and the first three-hundred-person meeting that
// goes wrong is the wrong moment to find that out.
//
// So this module is the room's one emitter, and everything about what it may say is decided in the
// telemetry catalog rather than here. Each event is an allowlist builder enumerating exactly its
// fields, which are identifiers the platform minted, counts, closed enums and instants; there is no
// declared field for a display name, a track name, a session description or anything a person typed,
// so a future call site cannot smuggle one through. That is the same structural redaction the rest
// of the platform logs by (docs/conventions/error-logging.md), applied to the one subsystem where
// the metadata alone is a disclosure: who a firm meets, and for how long, needs no transcript.
//
// WHAT IS NOT RECORDED PER OCCURRENCE. Presence is relayed many times a second in a real discussion
// and a frame arrives as fast as a browser can write one. An event for each would be the hot-path
// work golden rule 10 forbids and would cost more than the room does. Presence is recorded once per
// coalesced flush with the count it covered; the storage a frame spends is SAMPLED. Everything else
// here happens at most once per act.
//
// NOTHING HERE MAY THROW INTO A CALLER. A room that dropped a meeting because telemetry was
// unhappy would be worse than a room that recorded nothing, so every record is wrapped and a failed
// one is lost silently. The logger itself already degrades to nothing without its binding.

/**
 * HOW OFTEN ONE PARTICIPANT'S BROWSER MAY TELL THE ROOM ABOUT ITS CONNECTION.
 *
 * The browser samples its own connection on this cadence, so a well-behaved client lands one report
 * per window and the throttle never fires. What it bounds is the other kind of client: a report
 * costs a storage write and a telemetry event, and a browser can send frames as fast as it can write
 * to a socket. A report inside the window is DROPPED rather than deferred, on exactly the reasoning
 * the sync throttle is dropped on (room-frames.ts): a sample is a restatement of a measurement that
 * is taken again in a moment, so the one held back is superseded before it could be sent.
 *
 * It is not on the wire, because only this end reads it: nothing is refused for being too fast, and
 * a browser divides by no number of its own.
 */
export const DIAGNOSTIC_REPORT_INTERVAL_MILLISECONDS = 5_000;

/**
 * HOW OFTEN A FRAME'S STORAGE SPEND IS MEASURED — one frame in this many.
 *
 * A measurement that costs what the thing it measures costs is not a measurement. The room's whole
 * economy is the rule that the roster is read at most once per frame, and the way to know whether
 * that holds is to watch a sample of frames rather than to instrument every one of them.
 */
export const STORAGE_BUDGET_SAMPLE_EVERY = 20;

/**
 * HOW OFTEN A SOCKET REFUSED FOR ITS FRAME BUDGET IS RECORDED — one refusal in this many.
 *
 * Every other refusal in this room is an event, and that is right for all of them: each is one act
 * the room would not perform, and there is a bounded number of them per meeting. A budget refusal is
 * the opposite shape — it is what a socket sending in a loop gets, so a client producing a thousand
 * a second would produce a thousand events a second, and the record of a flood would cost more than
 * the flood. It is sampled for exactly the reason the storage budget beside it is: a measurement
 * that costs what the thing it measures costs is not a measurement.
 *
 * The SENDING half is never sampled — every refused frame is answered on the wire, because a browser
 * that is told nothing cannot slow down.
 */
export const FRAME_BUDGET_REFUSAL_SAMPLE_EVERY = 20;

/** Which meeting, in which firm — the two handles every event in the family is correlated by. */
export interface RoomIdentity {
  readonly firmId: string;
  readonly meetingId: string;
}

/**
 * The storage a frame spent, taken at its start.
 *
 * APPROXIMATE UNDER CONCURRENCY, and said so rather than hidden: the counters belong to the room,
 * not to one frame, so two frames in flight share their spend and each is charged for part of the
 * other's. A budget is what this is for — "does a subscribe still read the roster once" — and that
 * question survives the imprecision. A ledger would not, and nothing here is one.
 */
export interface FrameStorageBudget {
  readonly lists: number;
  readonly gets: number;
}

// ---------------------------------------------------------------------------------------------
// The logger, and the seam a test reads it through
// ---------------------------------------------------------------------------------------------

// A Durable Object is constructed by the runtime with the deployment's own environment, so a test
// driving the room directly cannot hand it one of its own — the same constraint the routing
// service's fake is installed through (sfu/sfu-client.ts), and the same shape of answer.
let testLogger: Logger | null = null;

/**
 * Installs (or, with null, removes) a logger for the duration of a test, and resets the sampler.
 *
 * The reset is not tidiness: the frame counter is module state shared by every test in a file, so a
 * case asserting that a frame's storage spend was recorded has to know which frame is the sampled
 * one. Installing the logger is that case's start, so it is where the count begins.
 */
export function setRoomDiagnosticsLoggerForTests(logger: Logger | null): void {
  testLogger = logger;
  framesSeen = 0;
  budgetRefusalsSeen = 0;
}

// A module-level override that anything could set would be a way to redirect the whole fleet's
// meeting telemetry, so it is inert outside a test runner — the posture the routing-service seam
// takes, for the same reason.
function loggerFor(room: RoomContext): Logger {
  if (testLogger !== null && runningUnderTest()) return testLogger;
  return realtimeLoggerFor(room.env);
}

/**
 * The context one event is stamped with.
 *
 * The correlation id is MINTED PER EVENT rather than carried, and that is a statement about what a
 * room is: it is woken by a frame, by an alarm or by a route, and there is no enclosing unit of work
 * for a family of events to share. What joins them is the meeting, which is a declared field on
 * every one of them — so a meeting is one query, and correlation is left meaning what it means
 * everywhere else rather than being redefined here.
 */
function eventContext(): { correlationId: string; now: string } {
  return { correlationId: newCorrelationId(), now: new Date().toISOString() };
}

/**
 * Which meeting this is, from whichever of the two places can answer without costing a read.
 *
 * A socket's attachment carries the firm and the meeting and is already in the caller's hand for
 * every frame, so a frame-driven event pays nothing. An alarm and a route callback have no socket,
 * and for those the room's own stored record is read. A room that has never been addressed holds
 * neither, and an event with nothing to correlate it by is worth less than the read it would cost,
 * so it is not recorded at all.
 */
async function identityFor(
  room: RoomContext,
  given: RoomIdentity | undefined,
): Promise<RoomIdentity | undefined> {
  if (given !== undefined) return given;
  const stored = await readRoom(room);
  return stored === undefined ? undefined : { firmId: stored.firmId, meetingId: stored.meetingId };
}

// One record, through the standard pipeline, never reaching the caller if it fails.
function emit(room: RoomContext, build: (logger: Logger) => void): void {
  try {
    build(loggerFor(room));
  } catch {
    // A meeting is not worth ending over a log line. The failure modes here are a binding that has
    // gone away and a runtime that will not serialize, and neither is anything a participant can
    // act on — the room's own failures reach the pipeline through recordRoomFailure instead.
  }
}

// ---------------------------------------------------------------------------------------------
// Arriving, and the door
// ---------------------------------------------------------------------------------------------

/** A socket took a stay — into the room, or into the lobby. */
export async function recordJoined(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  facts: {
    readonly medium: string;
    readonly hostRole: string | null;
    readonly waiting: boolean;
    readonly rejoined: boolean;
  },
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomJoined(eventContext(), {
        ...where,
        attendanceId,
        medium: facts.medium,
        hostRole: facts.hostRole,
        waiting: facts.waiting,
        rejoined: facts.rejoined,
      }),
    );
  });
}

/** The welcome is on the wire, which is the instant this socket is in the room. */
export async function recordWelcomed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  rosterSize: number,
  waitingSize: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomWelcomed(eventContext(), { ...where, attendanceId, rosterSize, waitingSize }),
    );
  });
}

/** A newer socket for one stay hung up on the ones that were holding it. */
export async function recordSuperseded(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  socketCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomSuperseded(eventContext(), { ...where, attendanceId, socketCount }));
  });
}

/** A host let people in from the door — one event for the batch, never one per person. */
export async function recordAdmitted(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  admittedCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomAdmitted(eventContext(), { ...where, admittedCount }));
  });
}

/** A host turned people away at the door. */
export async function recordDenied(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  deniedCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomDenied(eventContext(), { ...where, deniedCount }));
  });
}

// ---------------------------------------------------------------------------------------------
// What a frame did
// ---------------------------------------------------------------------------------------------

/** Tracks the routing service confirmed, counted by kind. The names are never recorded. */
export async function recordPublished(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  counts: {
    readonly trackCount: number;
    readonly audioCount: number;
    readonly videoCount: number;
    readonly refusedCount: number;
  },
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomPublished(eventContext(), { ...where, attendanceId, ...counts }));
  });
}

/** What a subscription asked for against what the service actually forwarded. */
export async function recordSubscribed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  requestedCount: number,
  forwardedCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomSubscribed(eventContext(), {
        ...where,
        attendanceId,
        requestedCount,
        forwardedCount,
      }),
    );
  });
}

/** A change of simulcast layer, and how many sections the service would not change. */
export async function recordLayerChanged(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  trackCount: number,
  refusedCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomLayerChanged(eventContext(), { ...where, attendanceId, trackCount, refusedCount }),
    );
  });
}

/**
 * A refusal, sent and recorded in one act.
 *
 * It sends the frame as well as recording it, because a refusal that was recorded and not sent — or
 * sent and not recorded — is exactly the drift this exists to close: the member holds an Error ID
 * the record does not know, or the record names a refusal nobody saw. One call, both halves.
 *
 * `frameType` is the protocol's own enum for what arrived, and the empty string for a frame too
 * malformed to name one, which is a fact rather than a gap.
 */
export async function refuseAndRecord(
  room: RoomContext,
  socket: WebSocket,
  identity: RoomIdentity | undefined,
  attendanceId: string | null,
  reason: MeetingRefusalReason,
  frameType: MeetingClientFrame["type"] | "",
  errorId: string | null = null,
): Promise<void> {
  trySend(socket, refusedFrame(reason, errorId ?? undefined));
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomRefused(eventContext(), {
        ...where,
        attendanceId,
        reason,
        errorId,
        frameType,
      }),
    );
  });
}

// How many budget refusals this instance has answered, which is what the sampler counts against.
// Module state rather than instance state, on exactly the terms the frame counter below is: it does
// not survive hibernation, and a sample taken across a wake is as good as one taken within it.
let budgetRefusalsSeen = 0;

/**
 * A frame refused for arriving faster than the room will serve — sent every time, recorded sometimes.
 *
 * The two halves come apart here and nowhere else in this module. A refusal is ordinarily sent and
 * recorded in one act so the member's Error ID and the record cannot drift; there is no Error ID on
 * this one, and the thing that would drift instead is the volume — a flood answered with an event
 * apiece is a flood the record amplifies. So the wire is served in full and the record is sampled.
 */
export async function refuseOverBudget(
  room: RoomContext,
  socket: WebSocket,
  identity: RoomIdentity | undefined,
  attendanceId: string | null,
  frameType: MeetingClientFrame["type"] | "",
): Promise<void> {
  budgetRefusalsSeen += 1;
  if (budgetRefusalsSeen % FRAME_BUDGET_REFUSAL_SAMPLE_EVERY !== 1) {
    trySend(socket, refusedFrame("rate-limited"));
    return;
  }
  await refuseAndRecord(room, socket, identity, attendanceId, "rate-limited", frameType);
}

/**
 * The same, for a refusal the socket does not survive.
 *
 * Whether a refusal is fatal is the ROOM's decision and stays in room-state.ts, which is why this
 * delegates rather than closing the socket itself: there is one answer to what a refusal-and-close
 * looks like on the wire, and this adds the record to it.
 */
export async function refuseAndCloseRecorded(
  room: RoomContext,
  socket: WebSocket,
  identity: RoomIdentity | undefined,
  attendanceId: string | null,
  reason: MeetingRefusalReason,
  frameType: MeetingClientFrame["type"] | "",
): Promise<void> {
  refuseAndClose(socket, reason);
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomRefused(eventContext(), {
        ...where,
        attendanceId,
        reason,
        errorId: null,
        frameType,
      }),
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Presence, which is recorded by the flush rather than by the transition
// ---------------------------------------------------------------------------------------------

/** The held-back transitions one alarm relayed, as one event carrying the count it covered. */
export async function recordPresenceRelayed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  relayedCount: number,
): Promise<void> {
  if (relayedCount === 0) return;
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomPresenceRelayed(eventContext(), { ...where, relayedCount }));
  });
}

/**
 * Reactions relayed, once per act — one for a named reaction, one for a whole second's counts.
 *
 * Recorded per RELAY rather than per reaction, which is the same arrangement presence has and for
 * the same arithmetic: below the threshold a participant may send one a second and there are at most
 * sixteen of them, and above it the room sends one frame a second however many arrived. So this
 * costs one event a second in the case it is built for, carrying the number it covered.
 */
export async function recordReactionsRelayed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  reactionCount: number,
  coalesced: boolean,
): Promise<void> {
  if (reactionCount === 0) return;
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomReactionsRelayed(eventContext(), { ...where, reactionCount, coalesced }));
  });
}

/**
 * A chat message's copy carried into the room — the socket count, and which of the two acts it was.
 *
 * The record of what was SAID is the firm's own transcript and never this stream: there is no
 * declared field for the body or for the message handle, so a call site cannot add one without
 * arguing for it in the catalog first.
 */
export async function recordMessageRelayed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  recipientCount: number,
  redaction: boolean,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomMessageRelayed(eventContext(), { ...where, recipientCount, redaction }));
  });
}

/**
 * A poll's copy carried into the room — opened, closed, or a second's tallies — as the socket count
 * and, for a tally, how many polls the flush covered. Nothing about what was asked or chosen has a
 * field in the catalog to travel in.
 */
export async function recordPollRelayed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  act: "opened" | "closed" | "tally",
  recipientCount: number,
  pollCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomPollRelayed(eventContext(), { ...where, act, recipientCount, pollCount }),
    );
  });
}

/**
 * A question's copy carried into the room — asked, its state changed, or a second's upvote counts —
 * on the poll event's terms.
 */
export async function recordQuestionRelayed(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  act: "asked" | "updated" | "tally",
  recipientCount: number,
  questionCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomQuestionRelayed(eventContext(), { ...where, act, recipientCount, questionCount }),
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Dropping, sweeping and ending
// ---------------------------------------------------------------------------------------------

/** A socket went away and this stay's own grace period started. */
export async function recordSocketLost(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  waiting: boolean,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomSocketLost(eventContext(), { ...where, attendanceId, waiting }));
  });
}

/** The grace sweep closed stays whose own minute ran out — the roster's and the door's. */
export async function recordSwept(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  participantCount: number,
  waitingCount: number,
): Promise<void> {
  if (participantCount === 0 && waitingCount === 0) return;
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomSwept(eventContext(), { ...where, participantCount, waitingCount }));
  });
}

/** The meeting is over, with the size it ended at. */
export async function recordEnded(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  participantCount: number,
  waitingCount: number,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomEnded(eventContext(), { ...where, participantCount, waitingCount }));
  });
}

/**
 * The one alarm woke, and which of its jobs were due.
 *
 * Recorded even when it found nothing to do, and that case is the interesting one: a room has four
 * deadlines sharing one alarm, and an alarm that runs, does none of them and re-arms is the shape of
 * a deadline nobody lowered — which is the only way this mechanism can spin.
 */
export async function recordAlarmRan(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  jobs: {
    readonly sweptParticipants: number;
    readonly sweptWaiting: number;
    readonly presenceFlushed: number;
    readonly reactionsFlushed: number;
    readonly endedMarkerRetired: boolean;
    readonly rearmed: boolean;
  },
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomAlarmRan(eventContext(), { ...where, ...jobs }));
  });
}

// ---------------------------------------------------------------------------------------------
// Running the room
// ---------------------------------------------------------------------------------------------

/** A microphone a host closed, or the whole room's — one event either way. */
export async function recordMuted(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  act: {
    readonly attendanceId: string | null;
    readonly byAttendanceId: string;
    readonly scope: "one" | "everyone";
    readonly mutedCount: number;
  },
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomMuted(eventContext(), { ...where, ...act }));
  });
}

/** A host put somebody out of the meeting. Who did it is the hosting route's audit row. */
export async function recordRemoved(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomRemoved(eventContext(), { ...where, attendanceId }));
  });
}

/** The door was shut, or opened again. */
export async function recordLocked(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  locked: boolean,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(meetingRoomLocked(eventContext(), { ...where, locked }));
  });
}

// ---------------------------------------------------------------------------------------------
// What the browser measured about itself
// ---------------------------------------------------------------------------------------------

/**
 * Takes one browser's report, if its window has closed: the record, and the answer whether to relay.
 *
 * Read-modify-write under the gate, for the reason every other throttle in this room is: two reports
 * arriving together would otherwise both read the same instant and both pass, which is precisely the
 * burst this bounds. A stay with no roster entry claims nothing and is answered false — the frame is
 * about a participant the room has already let go of.
 *
 * THE SAMPLE IS KEPT ON THE PARTICIPANT AND NOWHERE ELSE. It is the latest one only, it is a handful
 * of numbers, and it dies with the room like every other thing here. How somebody's connection
 * behaved is not a fact about the meeting and never reaches the meeting's record.
 */
export async function acceptClientReport(
  room: RoomContext,
  attendanceId: string,
  sample: MeetingDiagnosticSample,
): Promise<boolean> {
  const now = Date.now();
  return await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return false;
    const previous =
      participant.reportAt === undefined || participant.reportAt === null
        ? Number.NaN
        : Date.parse(participant.reportAt);
    if (!Number.isNaN(previous) && now - previous < DIAGNOSTIC_REPORT_INTERVAL_MILLISECONDS) {
      return false;
    }
    await putParticipant(room, attendanceId, {
      ...participant,
      reportAt: new Date(now).toISOString(),
      lastSample: storedSampleOf(sample, new Date(now).toISOString()),
    });
    return true;
  });
}

/**
 * The frame's shape, flattened to the record's.
 *
 * FLAT BECAUSE THE RECORD IS SMALL AND THE EVENT IS FLAT. A telemetry field carries a primitive and
 * nothing else — a structure has no way through the allowlist — so the flattening has to happen
 * somewhere, and doing it once here means the stored sample and the recorded one cannot disagree
 * about what "the outbound width" is. An absent measurement is null rather than zero: a browser that
 * has published nothing took no reading, which is a different fact from a reading of none.
 */
export function storedSampleOf(sample: MeetingDiagnosticSample, at: string): StoredClientSample {
  return {
    at,
    quality: sample.quality ?? null,
    roundTripMilliseconds: sample.roundTripMilliseconds ?? null,
    lossFraction: sample.lossFraction ?? null,
    jitterMilliseconds: sample.jitterMilliseconds ?? null,
    outboundRid: sample.outbound?.rid ?? null,
    outboundWidth: sample.outbound?.width ?? null,
    outboundHeight: sample.outbound?.height ?? null,
    outboundBitsPerSecond: sample.outbound?.bitrate ?? null,
    inboundCount: sample.inboundCount ?? null,
  };
}

/** One accepted report, on the record. */
export async function recordClientReport(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  attendanceId: string,
  sample: StoredClientSample,
): Promise<void> {
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomClientReport(eventContext(), {
        ...where,
        attendanceId,
        quality: sample.quality,
        roundTripMilliseconds: sample.roundTripMilliseconds,
        lossFraction: sample.lossFraction,
        jitterMilliseconds: sample.jitterMilliseconds,
        outboundRid: sample.outboundRid,
        outboundWidth: sample.outboundWidth,
        outboundHeight: sample.outboundHeight,
        outboundBitsPerSecond: sample.outboundBitsPerSecond,
        inboundCount: sample.inboundCount,
      }),
    );
  });
}

// ---------------------------------------------------------------------------------------------
// What a frame costs the room
// ---------------------------------------------------------------------------------------------

// The spend itself is counted in room-state.ts, where it is actually spent — a counter bumped from
// here would be a second place that has to remember which reads are the expensive ones, and it would
// be wrong the first time somebody added a third. This module decides only which frames to watch.
let framesSeen = 0;

/**
 * Opens a frame's budget, or answers null for a frame that is not being sampled.
 *
 * The first frame after a wake is always sampled, which is deliberate: a woken room's first frame is
 * the one that reads the most, because nothing it needs is in the object's cache yet.
 */
export function beginFrameBudget(): FrameStorageBudget | null {
  framesSeen += 1;
  if (framesSeen % STORAGE_BUDGET_SAMPLE_EVERY !== 1) return null;
  return storageReadCounts();
}

/** Closes a sampled frame's budget and records what it spent. */
export async function recordFrameBudget(
  room: RoomContext,
  identity: RoomIdentity | undefined,
  frameType: MeetingClientFrame["type"] | "",
  opened: FrameStorageBudget | null,
): Promise<void> {
  if (opened === null) return;
  const spent = storageReadCounts();
  const listCount = spent.lists - opened.lists;
  const getCount = spent.gets - opened.gets;
  const where = await identityFor(room, identity);
  if (where === undefined) return;
  emit(room, (logger) => {
    logger.log(
      meetingRoomStorageReadBudget(eventContext(), { ...where, frameType, listCount, getCount }),
    );
  });
}
