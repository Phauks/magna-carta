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
  insertAttendanceStatement,
  insertMeetingStatement,
  readMeeting,
  readMeetingEvent,
  readMeetingForEvent,
  readOpenAttendance,
  startMeetingStatement,
} from "./meeting-statements.ts";
import { MAX_MEETING_PARTICIPANTS, type MeetingEventKind, type MeetingRow } from "./types.ts";
import { refuse } from "./validation.ts";

// The meeting's write paths: start a room on an event, arrive, leave, and close it.
//
// Nothing here reads a clock, holds a database binding, or calls anything external: the clock, the
// actor and the random source arrive as options, which is what lets a fixture mint a byte-identical
// batch. The routing credentials, the signaling socket and the media itself are the Worker's, and
// none of them is reachable from this package — what is recorded here is that a gathering happened
// and who was in it, which is the only part that belongs in the firm's record at all.

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
  return {
    meetingId,
    created: true,
    effect: {
      statements: [
        insertMeetingStatement(database, {
          id: meetingId,
          eventKind: input.eventKind,
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
        insertAttendanceStatement(database, {
          id: attendanceId,
          meetingId,
          userId: options.actorUserId,
          now,
        }),
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
          metadata: { attendanceId: open.id, joinedAt: open.joined_at, leftAt: now },
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
