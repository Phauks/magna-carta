import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmEventId,
  MatterEventId,
  MeetingAttendanceId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  closeAllAttendanceStatement,
  closeAttendanceStatement,
  countOpenAttendance,
  endMeetingStatement,
  insertAttendanceUnderCapStatement,
  insertMeetingStatement,
  readAttendance,
  readMeeting,
  readMeetingEvent,
  readMeetingForEvent,
  readOpenAttendance,
  startMeetingStatement,
} from "./meeting-statements.ts";
import {
  MAX_MEETING_PARTICIPANTS,
  type MeetingDepartureReason,
  type MeetingEventKind,
  type MeetingMedium,
  type MeetingRow,
} from "./types.ts";
import { refuse } from "./validation.ts";

// The meeting's write paths: start a room on an event, arrive, leave, and close it.
//
// Nothing here reads a clock, holds a database binding, or calls anything external: the clock, the
// actor and the random source arrive as options, which is what lets a fixture mint a byte-identical
// batch. The routing credentials, the signaling socket and the media itself are the Worker's, and
// none of them is reachable from this package — what is recorded here is that a gathering happened
// and who was in it, which is the only part that belongs in the firm's record at all.

/**
 * The label the attendance insert's guard carries, exported because a caller has to match on it.
 *
 * A guard refusal reaches a route as one error type for every guard in the batch, and what separates
 * "the room filled up while you were joining" from a genuine fault is this string. Naming it here
 * keeps the two ends from drifting on a literal — a route matching a label nothing raises would
 * answer every capacity race with an Error ID.
 */
export const JOIN_CAPACITY_GUARD = "meeting.join.capacity";

// WHAT A MEETING IS WHEN NOBODY SAID. Video, because that is what every meeting started before calls
// existed was, and because the narrower answer is the one a member has to ask for rather than the one
// they are given by a caller that has not been updated.
const DEFAULT_MEETING_MEDIUM = "video" satisfies MeetingMedium;

// The two labels the departure audit row carries, named once so the two write paths cannot drift on
// a string.
const DEPARTED = "left" satisfies MeetingDepartureReason;
const SOCKET_LOST = "socket-lost" satisfies MeetingDepartureReason;

export interface MeetingServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate every calendar source composes. A meeting has no visibility rule of its own —
  // it inherits the event's — so this rides every read on the way to every write, and an id-addressed
  // write path cannot reach a room a list read could not.
  readonly visibility: VisibleMatterPredicate;
}

export interface CreateMeetingInput {
  readonly eventKind: MeetingEventKind;
  readonly eventId: string;
  // Sound alone, or sound and pictures. Optional here and defaulted to a video meeting, because a
  // caller that has not heard of calls must keep getting what it has always got; the ROOM is what
  // holds the medium to what was chosen, and the choice is made once — see the note below on why a
  // meeting's medium never changes.
  readonly medium?: MeetingMedium;
}

/**
 * Starting a meeting on a calendar event — and doing it AGAIN is not an error.
 *
 * Two members opening the same hearing and both pressing Start is the ordinary case, not a race to
 * be punished: what they want is to be in the same room, so the second call returns the first
 * member's room and writes nothing. `created` is what tells the two apart for a caller that answers
 * differently. The database holds the same rule underneath, as a partial unique index per event
 * column, so a pair that arrives in the same instant still ends up in one room rather than two.
 */
export async function createMeeting(
  database: SqlDatabase,
  input: CreateMeetingInput,
  options: MeetingServiceOptions,
): Promise<{ meetingId: MeetingId; created: boolean; effect: EffectWrite }> {
  // THE EVENT IS READ FIRST, AND THROUGH THE GATE. An event that does not exist and one on a matter
  // the member may not see are the same refusal: telling them apart would make this an existence
  // oracle for walled matters — ask about an id, learn from the wording whether it is real.
  const event = await readMeetingEvent(
    database,
    input.eventKind,
    input.eventId,
    options.visibility,
  );
  if (event === undefined) {
    refuse("meeting-unknown-event", "that is not an event you can start a meeting on");
  }

  const existing = await readMeetingForEvent(
    database,
    input.eventKind,
    input.eventId,
    options.visibility,
  );
  if (existing !== undefined) {
    return {
      meetingId: existing.id,
      created: false,
      effect: { statements: [], outboxMessages: [] },
    };
  }

  const now = options.clock.now();
  const meetingId = newIdentifier("meeting", options.randomSource);
  const medium = input.medium ?? DEFAULT_MEETING_MEDIUM;
  return {
    meetingId,
    created: true,
    effect: {
      statements: [
        insertMeetingStatement(database, {
          id: meetingId,
          eventKind: input.eventKind,
          medium,
          matterEventId: input.eventKind === "matter" ? (input.eventId as MatterEventId) : null,
          firmEventId: input.eventKind === "firm" ? (input.eventId as FirmEventId) : null,
          createdByUserId: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "meetings.meeting.created",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and instants. There is nothing else a meeting knows: no title, no
          // participant list, and above all nothing anybody said — the media is routed between
          // browsers and never reaches this platform at all.
          metadata: {
            eventKind: input.eventKind,
            // A closed-vocabulary label, which is what an audit field may carry: it says what kind
            // of gathering this was without saying anything about what happened in it.
            medium,
            eventId: input.eventId,
            matterId: event.matter_id,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Arriving. The first arrival is what makes the room live and what sets `started_at` — not the
 * creation, and not the hour the event was scheduled for.
 *
 * A member who is already in the room gets their existing stay back rather than a second one, so a
 * reconnecting browser occupies one seat and a leave has one row to close. A member who genuinely
 * left and came back has a closed stay behind them, so this opens a new one and the record shows
 * both — which is the whole reason attendance is a row per stay rather than a flag per person.
 */
export async function joinMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingServiceOptions,
): Promise<{ attendanceId: MeetingAttendanceId; effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const open = await readOpenAttendance(database, meetingId, options.actorUserId);
  if (open !== undefined) {
    return { attendanceId: open.id, effect: { statements: [], outboxMessages: [] } };
  }

  // THE CAP, counted over the open stays at this moment rather than over anything stored. Twelve is
  // a product decision about what a tile grid can show and hear, not a limit of the routing layer;
  // refusing the thirteenth person with a reason is honest, and a room that admits everybody and
  // degrades for all of them is not.
  //
  // This read is what produces the REASON. It cannot produce the limit: it is a round trip earlier
  // than the write, so a dozen browsers pressing Join together all read eleven and all pass. The
  // insert carries the same count in its own WHERE and is guarded, which is what actually holds the
  // ceiling — see insertAttendanceUnderCapStatement.
  const present = await countOpenAttendance(database, meetingId);
  if (present >= MAX_MEETING_PARTICIPANTS) {
    refuse(
      "meeting-room-full",
      `this meeting is full; it holds ${String(MAX_MEETING_PARTICIPANTS)} people`,
    );
  }

  const now = options.clock.now();
  const attendanceId = newIdentifier("meetingAttendance", options.randomSource);
  const firstArrival = meeting.status === "scheduled";
  return {
    attendanceId,
    effect: {
      statements: [
        guarded(
          insertAttendanceUnderCapStatement(database, {
            id: attendanceId,
            meetingId,
            userId: options.actorUserId,
            capacity: MAX_MEETING_PARTICIPANTS,
            now,
          }),
          JOIN_CAPACITY_GUARD,
        ),
        ...(firstArrival ? [startMeetingStatement(database, { id: meetingId, now })] : []),
        ...(firstArrival
          ? [
              domainAuditStatement(database, {
                event: "meetings.meeting.started",
                subjectId: meetingId,
                actorUserId: options.actorUserId,
                clock: options.clock,
                randomSource: options.randomSource,
                metadata: { startedAt: now },
              }),
            ]
          : []),
        domainAuditStatement(database, {
          event: "meetings.meeting.joined",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { attendanceId, joinedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Leaving. Closes the caller's own stay and nothing else — the statement names the row by its id, so
 * a leave can never reach across the roster however the caller addressed it.
 */
export async function leaveMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);
  if (meeting.status !== "live") {
    refuse("meeting-not-live", "nobody has joined this meeting yet");
  }

  const open = await readOpenAttendance(database, meetingId, options.actorUserId);
  if (open === undefined) {
    refuse("meeting-not-joined", "you are not in this meeting");
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(closeAttendanceStatement(database, { id: open.id, now }), "meeting.leave"),
        domainAuditStatement(database, {
          event: "meetings.meeting.left",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            attendanceId: open.id,
            joinedAt: open.joined_at,
            leftAt: now,
            reason: DEPARTED,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/** What the room needs to close a stay nobody is going to close by hand. */
export interface SocketLossOptions {
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

/**
 * A stay closed because the connection went and did not come back.
 *
 * WHY THIS IS NOT `leaveMeeting`. Leaving is an act somebody took, and it is refused when the caller
 * is not in the room, when the meeting has not started and when it has ended — all correct for a
 * person pressing a button, and all wrong for a sweep tidying up after a closed laptop, which has no
 * actor to refuse and must never leave a stay open because the meeting moved underneath it. So this
 * is addressed to the STAY rather than to the meeting-and-member pair, and it takes no visibility
 * predicate: the room is closing its own record, not answering a reader.
 *
 * The audit row says what happened rather than pretending somebody left: the same
 * `meetings.meeting.left` event, carrying `reason` from a two-value vocabulary, so the record can be
 * read for how a gathering emptied — people leaving, against connections dropping — without a second
 * event name meaning almost the same thing. `actorUserId` is the member whose stay it is, because it
 * is their presence the row records; nobody else acted.
 *
 * A stay that is already closed produces NO statements and `closed: false`. That is the ordinary
 * outcome of a race with the leave route or with the host ending the meeting, and moving an instant
 * somebody's record already carries would be a worse answer than doing nothing.
 */
export async function closeAttendanceAfterSocketLoss(
  database: SqlDatabase,
  attendanceId: MeetingAttendanceId,
  options: SocketLossOptions,
): Promise<{ closed: boolean; effect: EffectWrite }> {
  const stay = await readAttendance(database, attendanceId);
  if (stay === undefined || stay.left_at !== null) {
    return { closed: false, effect: { statements: [], outboxMessages: [] } };
  }

  const now = options.clock.now();
  return {
    closed: true,
    effect: {
      statements: [
        guarded(
          closeAttendanceStatement(database, { id: attendanceId, now }),
          "meeting.socketLoss",
        ),
        domainAuditStatement(database, {
          event: "meetings.meeting.left",
          subjectId: stay.meeting_id,
          actorUserId: stay.user_id,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers, instants and one closed-vocabulary label. Nothing about the connection
          // itself: which network failed is not the firm's record of who was in the room.
          metadata: {
            attendanceId,
            joinedAt: stay.joined_at,
            leftAt: now,
            reason: SOCKET_LOST,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Ending it. Every open stay closes at ONE instant — one statement rather than a walk over the
 * roster — because the meeting ended once, and a set of rows carrying instants milliseconds apart
 * would say people left at slightly different times, which is not what happened.
 *
 * A room nobody joined can be ended too, and deliberately: one meeting per event is held by the
 * database, so a room somebody opened by mistake and could not close would block that event from
 * ever having a meeting again.
 */
export async function endMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        closeAllAttendanceStatement(database, { meetingId, now }),
        guarded(
          endMeetingStatement(database, {
            id: meetingId,
            endedByUserId: options.actorUserId,
            now,
          }),
          "meeting.end",
        ),
        domainAuditStatement(database, {
          event: "meetings.meeting.ended",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The span the room was open for, in two instants. `startedAt` is null when nobody ever
          // arrived, which is itself the fact worth keeping about a meeting that did not happen.
          metadata: { startedAt: meeting.started_at, endedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The room, through the same gate a read goes through. A handle that names nothing and one naming a
// room behind a matter the caller may not see raise the SAME refusal as an unknown event, because a
// meeting is reachable only through its event: those are one question, and answering them
// differently would make every write path an existence oracle.
async function readExisting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingServiceOptions,
): Promise<MeetingRow> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) {
    refuse("meeting-unknown-event", "that is not a meeting you can reach");
  }
  return meeting;
}

// A meeting that has ended is not rejoined, not left again, and not ended twice. The attendance rows
// under it describe one gathering; a second gathering is a second room on the same event, which is
// what starting a new meeting gives you.
function assertNotEnded(meeting: MeetingRow): void {
  if (meeting.status === "ended") {
    refuse("meeting-already-ended", "this meeting has ended");
  }
}
