import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmEventId,
  MatterEventId,
  MeetingAttendanceId,
  MeetingId,
  MeetingPersonalRoomId,
  MeetingRecordingId,
  UserId,
} from "@magna-carta/identifiers/types";
import { isGuestStayHandle } from "./guest-removal.ts";
import { closeGuestStayAfterSocketLoss } from "./guest-service.ts";
import {
  closeAllAttendanceStatement,
  closeAllGuestStaysStatement,
  closeAttendanceStatement,
  countOpenAttendance,
  endMeetingStatement,
  endScheduledMeetingStatement,
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
  countWaitingAttendance,
  insertWaitingAttendanceUnderCapStatement,
} from "./lobby-statements.ts";
import { isWaiting } from "./lobby-service.ts";
import { MAX_MEETING_LOBBY, type MeetingLobbyMode } from "./lobby-types.ts";
import {
  insertHostGrantStatement,
  readBarredStay,
  readLiveHostGrant,
} from "./hosting-statements.ts";
import { requireHostGrant } from "./hosting-service.ts";
import { readSessionEventZone, settleSessionEventStatement } from "./personal-room-statements.ts";
import { stopRecordingForMeetingEnd } from "./recording-service.ts";
import {
  MAX_MEETING_PARTICIPANTS,
  type MeetingDepartureReason,
  type MeetingEventKind,
  type MeetingMedium,
  type MeetingParticipantHandle,
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

/**
 * The label the DOOR's insert carries, which is a different ceiling and a different answer.
 *
 * A full room needs somebody to leave; a full lobby needs a host to look at the list. One label for
 * both would leave the route unable to tell a member which of the two happened.
 */
export const JOIN_LOBBY_CAPACITY_GUARD = "meeting.join.lobbyCapacity";

/** The label the host's own ending carries, for the same reason the one above is named here. */
export const END_MEETING_GUARD = "meeting.end";

/**
 * The label the ending a CANCELLED EVENT drags behind it carries.
 *
 * Its own label rather than the one above, because the two refusals mean opposite things to the
 * caller. A host's ending that matches no row met a meeting somebody else already closed. A
 * cancellation's closing that matches no row met a meeting that is now LIVE — somebody walked into
 * the room between the cancel's read and its commit — or one the host closed in the same window, and
 * those two are a refusal and a success respectively. One label for both would leave the calendar
 * route unable to tell them apart, which is the whole of why it exists.
 */
export const CANCEL_CLOSING_GUARD = "meeting.cancelClosing";

// WHAT A MEETING IS WHEN NOBODY SAID. Video, because that is what every meeting started before calls
// existed was, and because the narrower answer is the one a member has to ask for rather than the one
// they are given by a caller that has not been updated.
const DEFAULT_MEETING_MEDIUM = "video" satisfies MeetingMedium;

// AND WHETHER ARRIVALS WAIT WHEN NOBODY SAID. Off, because every participant today is a firm member
// arriving at an event they are on, and a lobby on by default would put a colleague in a queue for
// every ordinary hearing. Unlike the medium, a host may change it afterwards — see `setMeetingLobby`
// in ./lobby-service.ts.
const DEFAULT_MEETING_LOBBY = "off" satisfies MeetingLobbyMode;

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
  // Whether arrivals wait at a door. Read ONLY when this request opens the room — one meeting per
  // event, so the first Start decides and a second one asking differently gets the room that exists.
  // A host changes it afterwards through `setMeetingLobby`, which is the difference between this
  // setting and the medium above.
  readonly lobby?: MeetingLobbyMode;
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

  return {
    ...openMeetingOnEvent(database, { ...input, matterId: event.matter_id }, options),
    created: true,
  };
}

/**
 * The room itself, for a caller that has ALREADY answered the questions `createMeeting` reads the
 * event to answer.
 *
 * There is exactly one such caller and it is the reason this is separate: scheduling a meeting is
 * recording a calendar event with a medium on it, and the route that does both composes them into
 * ONE batch — so at the moment the room is minted, the event it hangs on has been composed and not
 * yet committed, and no read can see it. `createMeeting` is the entry point everywhere else and
 * still answers the walled-matter question the only way it can be answered, by reading.
 *
 * It is exported under its own name rather than hidden behind an optional argument on
 * `createMeeting`, because skipping that read is a decision a caller has to take deliberately: the
 * caller is asserting that it has just written the event itself, under its own permission check, in
 * the batch this insert is joining. Nothing else may use it — an id-addressed caller that skipped
 * the read would be a hole in the gate a member's matter wall is believed to close.
 *
 * The event's uniqueness is still held underneath either way: one meeting per event is a partial
 * unique index, so two batches racing to open a room on one event end with one room.
 */
export function openMeetingOnEvent(
  database: SqlDatabase,
  input: CreateMeetingInput & {
    readonly matterId: string | null;
    // Set only by opening a personal room, which writes the event and the session together.
    readonly personalRoomId?: MeetingPersonalRoomId;
  },
  options: MeetingServiceOptions,
): { meetingId: MeetingId; effect: EffectWrite } {
  const now = options.clock.now();
  const meetingId = newIdentifier("meeting", options.randomSource);
  const medium = input.medium ?? DEFAULT_MEETING_MEDIUM;
  const lobby = input.lobby ?? DEFAULT_MEETING_LOBBY;
  return {
    meetingId,
    effect: {
      statements: [
        insertMeetingStatement(database, {
          id: meetingId,
          eventKind: input.eventKind,
          medium,
          lobby,
          matterEventId: input.eventKind === "matter" ? (input.eventId as MatterEventId) : null,
          firmEventId: input.eventKind === "firm" ? (input.eventId as FirmEventId) : null,
          createdByUserId: options.actorUserId,
          personalRoomId: input.personalRoomId ?? null,
          now,
        }),
        // THE STARTER IS THE HOST, written in the same batch as the room.
        //
        // `created_by_user_id` above stays exactly what it is — who opened the room, a fact that
        // never changes — and is deliberately NOT read as the host: the two are the same person
        // only until the first hand-over, and a record that conflated them would answer "who was
        // running the meeting when she was removed" with the name of somebody who had left.
        //
        // `granted_by_user_id` is null because nobody gave it. Pressing Start is how this grant
        // comes to exist, and attributing it to the starter would be the record claiming they
        // handed the room to themselves.
        insertHostGrantStatement(database, {
          id: newIdentifier("meetingHost", options.randomSource),
          meetingId,
          userId: options.actorUserId,
          role: "host",
          grantedByUserId: null,
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
            lobby,
            eventId: input.eventId,
            matterId: input.matterId,
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
): Promise<{ attendanceId: MeetingAttendanceId; waiting: boolean; effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const open = await readOpenAttendance(database, meetingId, options.actorUserId);
  if (open !== undefined) {
    // Their existing stay back, whichever side of the door it is on — a browser reconnecting at the
    // door keeps its place in the queue rather than going to the back of it.
    return {
      attendanceId: open.id,
      waiting: isWaiting(open),
      effect: { statements: [], outboxMessages: [] },
    };
  }

  // A MEMBER A HOST TURNED AWAY DOES NOT COME BACK IN, whether they were put out of the room or
  // turned away at the door. Asked before the lock, because the two answers are different and this
  // one is about this member: an unlocked room is still closed to them. It is the MEETING they are
  // barred from and not the event — a new meeting on the same event is a new room, and a host who
  // wants them back starts one.
  const barred = await readBarredStay(database, meetingId, options.actorUserId);
  if (barred?.ended_reason === "denied") {
    refuse("meeting-not-admitted", "a host did not admit you to this meeting");
  }
  if (barred !== undefined) {
    refuse("meeting-removed", "you were removed from this meeting");
  }

  // THE DOOR. A locked room refuses arrivals and touches nobody already in it, which is why this is
  // after the open-stay read above: a member already in the meeting when it was locked is not
  // turned out of it by their own browser reconnecting.
  //
  // LOCK BEATS THE LOBBY. A locked room is shut to everybody, so there is nothing to queue for and
  // a waiting stay opened here would be somebody standing outside a door that will not be answered.
  if (meeting.locked_at !== null) {
    refuse("meeting-locked", "this meeting is locked");
  }

  const now = options.clock.now();
  const attendanceId = newIdentifier("meetingAttendance", options.randomSource);

  // WHOEVER MAY RUN THIS ROOM DOES NOT WAIT. Holding `meetings:host` is deliberately not enough — a
  // paralegal with the key walking past the door of a confidential matter discussion is exactly what
  // a host turns the lobby on to prevent — so the question is the GRANT on this meeting, which is
  // the same authority every host act asks about.
  const running =
    meeting.lobby === "on"
      ? await readLiveHostGrant(database, meetingId, options.actorUserId)
      : undefined;
  if (meeting.lobby === "on" && running === undefined) {
    // THE DOOR'S OWN CEILING, read here for the same reason the room's is read below: this produces
    // the REASON a member is given, and the insert's guard produces the limit. A queue is not
    // somewhere a firm should be able to accumulate ten thousand rows.
    const queued = await countWaitingAttendance(database, meetingId);
    if (queued >= MAX_MEETING_LOBBY) {
      refuse(
        "meeting-lobby-full",
        `this meeting's lobby is full; it holds ${String(MAX_MEETING_LOBBY)} people`,
      );
    }
    return {
      attendanceId,
      waiting: true,
      effect: waitAtTheDoor(database, meetingId, attendanceId, now, options),
    };
  }

  // THE CAP, counted over the stays that are IN THE ROOM at this moment rather than over anything
  // stored. The number is a product decision about what a tile grid and a browser's bandwidth can
  // carry, not a limit of the routing layer; refusing the arrival past it with a reason is honest,
  // and a room that admits everybody and degrades for all of them is not.
  //
  // This read is what produces the REASON. It cannot produce the limit: it is a round trip earlier
  // than the write, so a dozen browsers pressing Join together all read the same free seat and all
  // pass. The insert carries the same count in its own WHERE and is guarded, which is what actually
  // holds the ceiling — see insertAttendanceUnderCapStatement.
  const present = await countOpenAttendance(database, meetingId);
  if (present >= MAX_MEETING_PARTICIPANTS) {
    refuse(
      "meeting-room-full",
      `this meeting is full; it holds ${String(MAX_MEETING_PARTICIPANTS)} people`,
    );
  }

  const firstArrival = meeting.status === "scheduled";
  return {
    attendanceId,
    waiting: false,
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
 * The stay a waiting arrival opens, and what it deliberately does NOT do.
 *
 * It does not flip the room live and it writes no `meetings.meeting.started` row: the room becomes
 * live when the first person is actually IN it, and somebody standing at a door has not started a
 * meeting. A lobby-on room whose host never arrives therefore keeps a record that says exactly
 * that — scheduled, with people who waited.
 *
 * Its own audit event rather than `joined` with a label, because these are two different facts about
 * two different instants: the arrival at the door, and the admission that a host decides on later.
 * A single event with a flag would make "when did this person get into the meeting" a question you
 * answer by finding the second row anyway.
 */
function waitAtTheDoor(
  database: SqlDatabase,
  meetingId: MeetingId,
  attendanceId: MeetingAttendanceId,
  now: string,
  options: MeetingServiceOptions,
): EffectWrite {
  return {
    statements: [
      guarded(
        insertWaitingAttendanceUnderCapStatement(database, {
          id: attendanceId,
          meetingId,
          userId: options.actorUserId,
          lobbyCapacity: MAX_MEETING_LOBBY,
          now,
        }),
        JOIN_LOBBY_CAPACITY_GUARD,
      ),
      domainAuditStatement(database, {
        event: "meetings.meeting.waiting",
        subjectId: meetingId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
        metadata: { attendanceId, waitingFrom: now },
      }),
    ],
    outboxMessages: [],
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

  const open = await readOpenAttendance(database, meetingId, options.actorUserId);
  if (open === undefined) {
    // A room nobody has walked into is told apart from one the caller simply is not in, because the
    // two are different mistakes. Asked only when there is no stay: GIVING UP AT THE DOOR is a leave
    // and the room is still `scheduled` while somebody waits in it — a waiter who walks away from a
    // meeting nobody has started yet must be able to close their own stay.
    if (meeting.status !== "live") {
      refuse("meeting-not-live", "nobody has joined this meeting yet");
    }
    refuse("meeting-not-joined", "you are not in this meeting");
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          closeAttendanceStatement(database, { id: open.id, reason: DEPARTED, now }),
          "meeting.leave",
        ),
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
  attendanceId: MeetingParticipantHandle,
  options: SocketLossOptions,
): Promise<{ closed: boolean; effect: EffectWrite }> {
  // A GUEST'S STAY IS A ROW IN THE SECOND TABLE, and the room holds nothing but its handle — so the
  // sweep is handed either kind and the prefix says which. One entry point rather than two, because
  // the room's sweep is one act over everybody whose grace ran out, and a room that had to know
  // which table to ask would be a room that knew about tables.
  if (isGuestStayHandle(attendanceId)) {
    return await closeGuestStayAfterSocketLoss(database, attendanceId, options);
  }
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
          closeAttendanceStatement(database, { id: attendanceId, reason: SOCKET_LOST, now }),
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

  // ENDING IS A HOST ACT, and this line is a deliberate narrowing of what it used to be. On the
  // permission key alone, any member holding `meetings:host` could close any meeting they could see
  // the event for, from anywhere, without being in it — a hole the key was never meant to cover,
  // which survived because End was the only host act and the starter was the only realistic caller.
  // The ordinary case is unchanged, because the starter holds a grant from the instant the room
  // exists; a key-holder who needs to close an abandoned room claims it first, which leaves a record
  // of exactly that.
  await requireHostGrant(database, meetingId, options.actorUserId);

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // Every open stay of BOTH kinds, at the one instant — members and guests, waiting and
        // admitted. The guest table is the second statement of the same batch rather than a later
        // write, so the record never holds a meeting that ended with a guest still in it.
        closeAllAttendanceStatement(database, { meetingId, now }),
        closeAllGuestStaysStatement(database, { meetingId, now }),
        guarded(
          endMeetingStatement(database, {
            id: meetingId,
            endedByUserId: options.actorUserId,
            now,
          }),
          END_MEETING_GUARD,
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
        // A PERSONAL-ROOM SESSION'S EVENT WAS WRITTEN WITH NO END, because nobody knew one; ending
        // the session is what gives it one.
        ...(await sessionEventSettlement(database, meeting, now)),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * The statement that gives a personal-room session's event its end, or nothing for a meeting on an
 * event somebody scheduled — that event's end is what they wrote, and a meeting running long does not
 * rewrite the diary.
 */
export async function sessionEventSettlement(
  database: SqlDatabase,
  meeting: Pick<
    MeetingRow,
    "id" | "personal_room_id" | "event_kind" | "matter_event_id" | "firm_event_id"
  >,
  endedAt: string,
): Promise<SqlStatement[]> {
  if (meeting.personal_room_id === null) return [];
  const timeZone = await readSessionEventZone(database, meeting.id);
  const eventId = meeting.event_kind === "matter" ? meeting.matter_event_id : meeting.firm_event_id;
  if (timeZone === undefined || eventId === null) return [];
  return [
    settleSessionEventStatement(database, {
      eventKind: meeting.event_kind,
      eventId,
      timeZone,
      endedAt,
      now: endedAt,
    }),
  ];
}

/**
 * The ending a CANCELLED EVENT drags behind it — the room nobody walked into, closed in the same
 * batch as the sitting it was for.
 *
 * WHY IT IS NOT `endMeeting` WITH A DIFFERENT CALLER. Ending is the host's act and it is addressed
 * to a meeting whatever state it is in; this is a tidy-up addressed only to a meeting that is still
 * SCHEDULED, and the difference has to live in the statement rather than in the caller's read. A
 * cancel reads the meeting, composes, and commits in a second round trip; between those two a member
 * can join, which makes the room live and puts people in it. The general statement matches
 * `status <> 'ended'` and would close it under them, with the room itself never told — so the
 * precondition rides the WHERE (see `endScheduledMeetingStatement`) and the guard label is this
 * path's own, because a refusal here is a race the calendar route answers rather than a fault.
 *
 * The audit row is the same `meetings.meeting.ended` event: what happened is that the meeting ended,
 * and a second event name for the same fact would split every later reading of the record in two.
 *
 * A RECORDING RUNNING IN THE ROOM STOPS WITH IT, in this same batch, exactly as it does on the host's
 * own ending — `meeting-ended`, attributed to the member cancelling. A room nobody walked into can
 * still be recorded (a recording may start before anybody speaks), and a meeting closed under a
 * running recording would leave the record saying a recording ran on in a meeting that had finished.
 * Its statements go AFTER the closing guard, so a cancel refused by the race rolls the stop back with
 * it. Nobody is in the room to be told; the recorder lets go of it on its own next pass, once it reads
 * that the record is no longer `recording`, and `stoppedRecordingId` names it for a caller that would
 * rather tell it at once.
 */
export async function endScheduledMeetingForCancelledEvent(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingServiceOptions,
): Promise<{ effect: EffectWrite; stoppedRecordingId: MeetingRecordingId | null }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const now = options.clock.now();
  const stopped = await stopRecordingForMeetingEnd(database, meetingId, {
    clock: { now: () => now },
    actorUserId: options.actorUserId,
    randomSource: options.randomSource,
  });
  return {
    stoppedRecordingId: stopped?.recording.id ?? null,
    effect: {
      statements: [
        // NO CLOSE-ALL BESIDE IT, unlike the host's own ending. The guard below refuses unless the
        // room holds no open stay, so there is never one to close — and including the statement
        // anyway is not harmless: a stay opened in the race window carries a `joined_at` LATER than
        // this batch's instant, and closing it here writes a span that ends before it began. The
        // schema's own CHECK refuses that, which would reach the caller as a fault instead of as
        // the refusal the guard exists to produce. The guard is FIRST for the same reason: a batch
        // stops at the statement that refuses it, so nothing before it can raise something else.
        guarded(
          endScheduledMeetingStatement(database, {
            id: meetingId,
            endedByUserId: options.actorUserId,
            now,
          }),
          CANCEL_CLOSING_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.meeting.ended",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { startedAt: meeting.started_at, endedAt: now },
        }),
        ...(stopped?.effect.statements ?? []),
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
