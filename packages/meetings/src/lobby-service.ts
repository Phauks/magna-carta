import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MeetingAttendanceId, MeetingId } from "@magna-carta/identifiers/types";
import { requireHostGrant } from "./hosting-service.ts";
import { readAttendanceInMeeting } from "./hosting-statements.ts";
import {
  admitAttendanceUnderCapStatement,
  listWaitingAttendance,
  setMeetingLobbyStatement,
} from "./lobby-statements.ts";
import {
  MAX_MEETING_LOBBY,
  type MeetingAdmissionOutcome,
  type MeetingDenialOutcome,
  type MeetingLobbyDecision,
  type MeetingLobbyEntry,
  type MeetingLobbyMode,
} from "./lobby-types.ts";
import {
  closeAttendanceStatement,
  countOpenAttendance,
  readMeeting,
} from "./meeting-statements.ts";
import {
  MAX_MEETING_PARTICIPANTS,
  type MeetingAttendanceRow,
  type MeetingDepartureReason,
  type MeetingRow,
} from "./types.ts";
import { refuse } from "./validation.ts";
import type { MeetingHostingOptions } from "./hosting-service.ts";

// THE DOOR'S WRITE PATHS: opening and closing the lobby, letting named people in, and turning named
// people away.
//
// Nothing here reads a clock, holds a database binding, or calls anything external — the clock, the
// actor and the random source arrive as options, exactly as they do for the meeting record and for
// hosting. The room is told what changed AFTER the batch commits, by the route, on the standing
// `participantLeft` / `end` precedent: nobody is admitted on the wire by a write that then failed.
//
// EVERY ACT HERE IS A HOST ACT, and the authority is the grant rather than the key. `meetings:host`
// says a firm lets this member convene meetings; `requireHostGrant` says they are running THIS one,
// and every path below composes it ahead of itself.

/** The label the admission's capacity guard carries, exported because a caller has to match on it. */
export const ADMIT_PARTICIPANT_GUARD = "meeting.lobby.admit";

/** The label a denial's stay-closing carries. */
export const DENY_PARTICIPANT_GUARD = "meeting.lobby.deny";

/** The label the door's own setting carries, opened or closed. */
export const SET_LOBBY_GUARD = "meeting.lobby.setting";

// The label a stay closed at the door carries. Named once so the column, the audit metadata and the
// barred-entry read cannot drift on a string.
const DENIED = "denied" satisfies MeetingDepartureReason;

/**
 * Who is at the door of one meeting.
 *
 * Read whole rather than paged and bounded by construction: the door insert's own guard holds
 * `MAX_MEETING_LOBBY`, so this is a hundred rows at the very most however long a meeting runs. The
 * limit is bound one past the ceiling, so a lobby that somehow exceeded it reads as a list that is
 * too long rather than as a read of the whole table.
 */
export async function listMeetingLobby(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingHostingOptions,
): Promise<readonly MeetingLobbyEntry[]> {
  await readExisting(database, meetingId, options);
  // THE GRANT, on a READ. Everywhere else in this subsystem a read is reachable by anybody who may
  // join — who is running the room, who is in it, what was said. This one is not: it is a list of
  // people a host has not yet decided about, and in a lobby that exists because somebody might
  // arrive who should not, telling the room who is outside it is the leak the door was shut to
  // prevent.
  await requireHostGrant(database, meetingId, options.actorUserId);
  return await listWaitingAttendance(database, meetingId, MAX_MEETING_LOBBY + 1);
}

/**
 * The door, opened or closed.
 *
 * TURNING THE LOBBY OFF DOES NOT ADMIT THE PEOPLE ALREADY AT THE DOOR. They stay in the list until a
 * host admits them, and the panel goes on showing them: a setting is not a decision about a named
 * person, and somebody may be waiting precisely because the host intends to deny them. A switch that
 * became an admission nobody made is the one way this control could do harm.
 *
 * A meeting already in the state asked for produces no statements, on the lock's rule: writing it
 * again would move an instant and an actor a record already carries.
 */
export async function setMeetingLobby(
  database: SqlDatabase,
  meetingId: MeetingId,
  lobby: MeetingLobbyMode,
  options: MeetingHostingOptions,
): Promise<{ changed: boolean; effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  // A CO-HOST MAY MOVE THE DOOR. They are running the meeting with the host, and the act is
  // reversible by either of them — the same line the lock sits on.
  await requireHostGrant(database, meetingId, options.actorUserId);

  if (meeting.lobby === lobby) {
    return { changed: false, effect: { statements: [], outboxMessages: [] } };
  }

  const now = options.clock.now();
  return {
    changed: true,
    effect: {
      statements: [
        guarded(setMeetingLobbyStatement(database, { id: meetingId, lobby, now }), SET_LOBBY_GUARD),
        domainAuditStatement(database, {
          event: "meetings.meeting.lobbyChanged",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // One event with a labelled direction rather than two event names, for the reason the
          // departure vocabulary is one: the question a record is read for is when the door moved.
          metadata: { lobby, changedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Named people let in — and the reason there is no server-side "admit everyone".
 *
 * Admit all sends the identifiers the host's panel was showing. A server-side "all" would admit
 * whoever arrived in the millisecond after the host looked at the list, which is precisely the person
 * the host did not decide about — and in a lobby that exists because somebody might arrive who
 * should not, that is the whole failure.
 *
 * ONE OUTCOME PER IDENTIFIER, so a batch that half-lands is legible rather than a single refusal for
 * five people. The seats are counted ONCE, here, and spent down the list in the order the host sent
 * it: a host admitting five into two free seats learns which three did not get in. That count cannot
 * hold the ceiling — it is a round trip earlier than the write — so each admission carries the same
 * count in its own WHERE and is guarded, exactly as the arrival's insert is.
 */
export async function admitParticipants(
  database: SqlDatabase,
  meetingId: MeetingId,
  participantIds: readonly MeetingAttendanceId[],
  options: MeetingHostingOptions,
): Promise<{
  decisions: readonly MeetingLobbyDecision<MeetingAdmissionOutcome>[];
  effect: EffectWrite;
}> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);
  await requireHostGrant(database, meetingId, options.actorUserId);

  const now = options.clock.now();
  let seats = MAX_MEETING_PARTICIPANTS - (await countOpenAttendance(database, meetingId));
  const decisions: MeetingLobbyDecision<MeetingAdmissionOutcome>[] = [];
  const statements: EffectStatement[] = [];

  for (const participantId of distinct(participantIds)) {
    const stay = await readAttendanceInMeeting(database, meetingId, participantId);
    if (stay === undefined || !isWaiting(stay)) {
      decisions.push({ participantId, outcome: "not-waiting" });
      continue;
    }
    if (seats <= 0) {
      decisions.push({ participantId, outcome: "room-full" });
      continue;
    }
    seats -= 1;
    decisions.push({ participantId, outcome: "admitted" });
    statements.push(
      guarded(
        admitAttendanceUnderCapStatement(database, {
          id: participantId,
          meetingId,
          capacity: MAX_MEETING_PARTICIPANTS,
          now,
        }),
        ADMIT_PARTICIPANT_GUARD,
      ),
      domainAuditStatement(database, {
        event: "meetings.meeting.admitted",
        subjectId: meetingId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
        // Identifiers and instants. Who was let in, by whom, and when — there is nothing else a
        // door knows, and nothing anybody said ever reaches this record.
        metadata: {
          attendanceId: participantId,
          userId: stay.user_id,
          waitingFrom: stay.waiting_from,
          admittedAt: now,
        },
      }),
    );
  }

  return { decisions, effect: { statements, outboxMessages: [] } };
}

/**
 * Named people turned away.
 *
 * DENIAL BARS RE-ENTRY for the life of the meeting, which is why it closes the stay rather than
 * deleting the row: a denial that did not bar would be a button that does nothing — the member
 * presses Join again and is back at the front of the queue. The stay closes with `denied`, the join
 * path's barred-entry read finds it, and the record keeps who waited and was never let in, which is
 * a thing a firm may need to say.
 *
 * Nothing is announced to the people in the room: they never knew somebody was at the door.
 */
export async function denyParticipants(
  database: SqlDatabase,
  meetingId: MeetingId,
  participantIds: readonly MeetingAttendanceId[],
  options: MeetingHostingOptions,
): Promise<{
  decisions: readonly MeetingLobbyDecision<MeetingDenialOutcome>[];
  effect: EffectWrite;
}> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);
  await requireHostGrant(database, meetingId, options.actorUserId);

  const now = options.clock.now();
  const decisions: MeetingLobbyDecision<MeetingDenialOutcome>[] = [];
  const statements: EffectStatement[] = [];

  for (const participantId of distinct(participantIds)) {
    const stay = await readAttendanceInMeeting(database, meetingId, participantId);
    if (stay === undefined || !isWaiting(stay)) {
      decisions.push({ participantId, outcome: "not-waiting" });
      continue;
    }
    decisions.push({ participantId, outcome: "denied" });
    statements.push(
      guarded(
        closeAttendanceStatement(database, { id: participantId, reason: DENIED, now }),
        DENY_PARTICIPANT_GUARD,
      ),
      // THE DEPARTURE ROW EVERY OTHER WAY OF LEAVING WRITES, labelled — so "when did each person
      // stop being in the room" stays one read over one event name, which is the whole reason that
      // vocabulary exists. Its actor is the member whose stay it records, exactly as a socket loss
      // and a removal write it.
      domainAuditStatement(database, {
        event: "meetings.meeting.left",
        subjectId: meetingId,
        actorUserId: stay.user_id,
        clock: options.clock,
        randomSource: options.randomSource,
        metadata: {
          attendanceId: participantId,
          joinedAt: stay.joined_at,
          leftAt: now,
          reason: DENIED,
        },
      }),
      // And the host's act beside it, because the departure row's actor is the member and it has
      // nowhere to put somebody else — the removal's own pair, for the same reason.
      domainAuditStatement(database, {
        event: "meetings.meeting.denied",
        subjectId: meetingId,
        actorUserId: options.actorUserId,
        clock: options.clock,
        randomSource: options.randomSource,
        metadata: {
          attendanceId: participantId,
          userId: stay.user_id,
          waitingFrom: stay.waiting_from,
          deniedAt: now,
        },
      }),
    );
  }

  return { decisions, effect: { statements, outboxMessages: [] } };
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

/** Whether this stay is at the door: the `WAITING_PREDICATE`, asked of a row already read. */
export function isWaiting(stay: MeetingAttendanceRow): boolean {
  return stay.left_at === null && stay.waiting_from !== null && stay.admitted_at === null;
}

// A host naming the same person twice in one batch must not spend two seats on them, and must not
// write two admissions over one stay. The first mention decides, which is the order the panel was
// showing.
function distinct(participantIds: readonly MeetingAttendanceId[]): readonly MeetingAttendanceId[] {
  return [...new Set(participantIds)];
}

// The room, through the same gate a read goes through — so an id-addressed act cannot reach a
// meeting a list read could not. The refusal is the family's one refusal for every way a room is out
// of reach, because a meeting is reachable only through its event.
async function readExisting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingHostingOptions,
): Promise<MeetingRow> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) {
    refuse("meeting-unknown-event", "that is not a meeting you can reach");
  }
  return meeting;
}

function assertNotEnded(meeting: MeetingRow): void {
  if (meeting.status === "ended") {
    refuse("meeting-already-ended", "this meeting has ended");
  }
}
