import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MeetingAttendanceId, MeetingId, UserId } from "@magna-carta/identifiers/types";
import {
  countOtherHostsPresent,
  insertHostGrantStatement,
  readAttendanceInMeeting,
  readLiveHostGrant,
  readLiveHostGrants,
  revokeHostGrantStatement,
  setMeetingLockStatement,
} from "./hosting-statements.ts";
import type { MeetingHostRole, MeetingHostRow } from "./hosting-types.ts";
import { closeAttendanceStatement, readMeeting, readOpenAttendance } from "./meeting-statements.ts";
import type { MeetingRow } from "./types.ts";
import { refuse } from "./validation.ts";

// RUNNING A MEETING: who holds the room, who they share it with, who is put out of it, and whether
// the door is open.
//
// Nothing here reads a clock, holds a database binding, or calls anything external — the clock, the
// actor and the random source arrive as options, exactly as they do for the meeting record itself.
// The room is told what changed AFTER the batch commits, by the route, on the existing
// `participantLeft` / `end` precedent: nobody is told the room changed by a write that then failed.
//
// WHAT THE PERMISSION KEY DOES AND DOES NOT DO. `meetings:host` is checked at the chokepoint and
// says the caller is the kind of member a firm lets run meetings. It says nothing about THIS room,
// and every act below asks the record instead — which is the whole of what `requireHostGrant` is
// for.

/** The label the hand-over's outgoing half carries, exported because a caller has to match on it. */
export const HANDOVER_GUARD = "meeting.hosting.handOver";

/** The label a withdrawal carries — a co-host's grant closed by the host. */
export const REVOKE_HOSTING_GUARD = "meeting.hosting.revoke";

/** The label the removal's stay-closing carries. */
export const REMOVE_PARTICIPANT_GUARD = "meeting.hosting.remove";

/** The label the door carries, shut or opened. */
export const LOCK_MEETING_GUARD = "meeting.hosting.lock";

// The label the departure row carries for somebody a host put out. Named once so the column, the
// audit metadata and the barred-entry read cannot drift on a string.
const REMOVED = "removed";

export interface MeetingHostingOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate every calendar source composes. Hosting has no visibility rule of its own —
  // it inherits the meeting's, which inherits the event's — so this rides the read on the way to
  // every write, and a room a list read could not reach cannot be taken over by its handle.
  readonly visibility: VisibleMatterPredicate;
}

/**
 * THE ONE AUTHORITY CHOKEPOINT. Every host act composes this ahead of itself, and it answers with
 * the caller's role so the act can then ask whether a co-host may do this particular thing.
 *
 * It reads the RECORD rather than the permission set, because the two answer different questions:
 * the key says a firm lets this member convene meetings, and the grant says they are running this
 * one. Before this existed, End was gated on the key alone — so any Attorney in the firm could close
 * any meeting they could see the event for, from anywhere, without being in it. That hole survived
 * because End was the only host act and the starter was the only realistic caller.
 */
export async function requireHostGrant(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
): Promise<MeetingHostRow> {
  const grant = await readLiveHostGrant(database, meetingId, userId);
  if (grant === undefined) {
    refuse("meeting-not-host", "you are not hosting this meeting");
  }
  return grant;
}

/**
 * Hosting handed over, or a co-host named — and, when the caller names themselves, a claim.
 *
 * ONE PATH FOR ALL THREE, because they are one act with different arguments: writing or closing a
 * grant. Four separate paths would be four places for the grant invariants to drift, and the
 * invariants are the only hard part.
 *
 * THE TARGET MUST BE IN THE ROOM. A running meeting is not handed to somebody who is not in it —
 * the room would be held by a browser that is not open, and the next act would be a claim. The
 * claim is the exception and is the whole of why it exists.
 */
export async function grantHosting(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: { readonly userId: UserId; readonly role: MeetingHostRole },
  options: MeetingHostingOptions,
): Promise<{ claimed: boolean; effect: EffectWrite }> {
  if (input.userId === options.actorUserId) {
    return { ...(await claimHosting(database, meetingId, options)) };
  }

  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  // A CO-HOST MAY NOT HAND THE ROOM OVER OR NAME ANOTHER CO-HOST. They are running the meeting with
  // the host; they are not running the host.
  const caller = await requireHostGrant(database, meetingId, options.actorUserId);
  if (caller.role !== "host") {
    refuse("meeting-not-host", "only the host of this meeting can name who else runs it");
  }

  const stay = await readOpenAttendance(database, meetingId, input.userId);
  if (stay === undefined) {
    refuse("meeting-not-joined", "that member is not in this meeting");
  }

  const existing = await readLiveHostGrant(database, meetingId, input.userId);
  if (existing?.role === input.role) {
    // Already true. Writing it again would open a second interval for a grant that never lapsed,
    // which is the leave path's rule about a stay that is already closed.
    return { claimed: false, effect: { statements: [], outboxMessages: [] } };
  }

  const now = options.clock.now();
  const grantId = newIdentifier("meetingHost", options.randomSource);
  const handingOver = input.role === "host";
  return {
    claimed: false,
    effect: {
      statements: [
        // THE OUTGOING GRANTS FIRST, because the live-host index is what settles two hand-overs
        // racing and a batch stops at the statement that refuses it: closing before opening means
        // the loser aborts on its own guard rather than on a constraint one statement later.
        ...(existing === undefined
          ? []
          : [
              guarded(
                revokeHostGrantStatement(database, {
                  meetingId,
                  userId: input.userId,
                  revokedByUserId: options.actorUserId,
                  now,
                }),
                HANDOVER_GUARD,
              ),
            ]),
        ...(handingOver
          ? [
              guarded(
                revokeHostGrantStatement(database, {
                  meetingId,
                  userId: options.actorUserId,
                  revokedByUserId: options.actorUserId,
                  now,
                }),
                HANDOVER_GUARD,
              ),
            ]
          : []),
        insertHostGrantStatement(database, {
          id: grantId,
          meetingId,
          userId: input.userId,
          role: input.role,
          grantedByUserId: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: handingOver
            ? "meetings.meeting.hostingHandedOver"
            : "meetings.meeting.coHostNamed",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers, instants and a closed-vocabulary role. Nothing about the meeting itself —
          // no title, no roster, and nothing anybody said.
          metadata: { userId: input.userId, role: input.role, grantedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A ROOM NOBODY IS RUNNING, TAKEN OVER — and the reason hosting does not simply pass on its own.
 *
 * A host whose tunnel drops for ninety seconds has not stopped hosting, and a rule that reassigned
 * the room on a socket loss would hand a client meeting to whoever happened to be next in the roster
 * while the partner's laptop woke up. The stronger reason is the second: a host assigned by nobody
 * is a host nobody chose, and the first act of an auto-promoted host would be attributed to somebody
 * who never asked for the room.
 *
 * So the grant stands while its holder is away, and what a member does instead is CLAIM — refused
 * the moment anybody else holding a grant is in the room, and audited as a claim rather than as a
 * hand-over, because nobody gave it.
 *
 * "Anybody ELSE" is the part worth reading twice. A co-host sitting alone in a room whose host went
 * offline holds a live grant, so a count over every grant would refuse them the one act their
 * co-host grant does not carry and leave the room permanently without a host — which is exactly the
 * state this exists to end.
 */
export async function claimHosting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingHostingOptions,
): Promise<{ claimed: boolean; effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const own = await readLiveHostGrant(database, meetingId, options.actorUserId);
  if (own?.role === "host") {
    // The caller is already the host of this room. Nothing to claim and nothing to write.
    return { claimed: false, effect: { statements: [], outboxMessages: [] } };
  }

  if ((await countOtherHostsPresent(database, meetingId, options.actorUserId)) > 0) {
    refuse("meeting-not-host", "somebody is already hosting this meeting");
  }

  // The grant the claim displaces, if the room has one: an abandoned host, whose holder is not in
  // the meeting. An ABSENT CO-HOST KEEPS THEIRS — the claim is about the room having nobody running
  // it, and stripping every other grant on the way past would be a second act nobody asked for.
  const displaced = (await readLiveHostGrants(database, meetingId)).filter(
    (grant) => grant.role === "host" || grant.user_id === options.actorUserId,
  );

  const now = options.clock.now();
  const grantId = newIdentifier("meetingHost", options.randomSource);
  return {
    claimed: true,
    effect: {
      statements: [
        // Closed by the claimer, and `revoked_by_user_id` says so truthfully. Both closings are
        // forced by an index rather than chosen: the live-host index refuses a second host outright,
        // and the per-member index refuses the claimer holding two grants at once.
        ...displaced.map((grant) =>
          guarded(
            revokeHostGrantStatement(database, {
              meetingId,
              userId: grant.user_id,
              revokedByUserId: options.actorUserId,
              now,
            }),
            HANDOVER_GUARD,
          ),
        ),
        insertHostGrantStatement(database, {
          id: grantId,
          meetingId,
          userId: options.actorUserId,
          role: "host",
          // Null, because nobody gave it. That absence is the difference between this row and a
          // hand-over's, and it is what the record is read for.
          grantedByUserId: null,
          now,
        }),
        domainAuditStatement(database, {
          event: "meetings.meeting.hostingClaimed",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { userId: options.actorUserId, role: "host", grantedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A co-host's grant withdrawn.
 *
 * ONLY A CO-HOST'S. The host's own grant is not withdrawable by this route in either direction — a
 * co-host withdrawing it would be taking the room, which is what a hand-over is for, and a host
 * withdrawing their own would leave a running meeting with nobody holding it and no act left but a
 * claim.
 */
export async function revokeHosting(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
  options: MeetingHostingOptions,
): Promise<{ effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const caller = await requireHostGrant(database, meetingId, options.actorUserId);
  if (caller.role !== "host") {
    refuse("meeting-not-host", "only the host of this meeting can withdraw a co-host");
  }

  const grant = await readLiveHostGrant(database, meetingId, userId);
  if (grant === undefined) {
    // Already true: the member holds nothing to withdraw. The caller asked for them not to be
    // running the room and they are not, so this is a success with nothing to write.
    return { effect: { statements: [], outboxMessages: [] } };
  }
  if (grant.role === "host") {
    refuse("meeting-not-host", "the host's own grant is handed over rather than withdrawn");
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          revokeHostGrantStatement(database, {
            meetingId,
            userId,
            revokedByUserId: options.actorUserId,
            now,
          }),
          REVOKE_HOSTING_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.meeting.coHostWithdrawn",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { userId, role: grant.role, revokedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Somebody put out of the room.
 *
 * TWO AUDIT ROWS, AND THEY RECORD TWO DIFFERENT FACTS. The stay closes with the same
 * `meetings.meeting.left` event every other departure writes, carrying `reason: 'removed'` — so
 * "when did each person stop being in the room" stays one read rather than a union over event names,
 * which is why that vocabulary exists at all. Beside it, `meetings.meeting.removed` records that a
 * host ACTED, with the host as its actor: the departure row's actor is the member whose presence it
 * records, and it has nowhere to put somebody else.
 *
 * The stay is addressed by its own handle within this meeting, so a removal can never reach across
 * meetings however the caller addressed it. A co-host may not remove the host, and nobody removes
 * themselves through this control: leaving is how a person leaves.
 */
export async function removeParticipant(
  database: SqlDatabase,
  meetingId: MeetingId,
  attendanceId: MeetingAttendanceId,
  options: MeetingHostingOptions,
): Promise<{ userId: UserId; effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  const caller = await requireHostGrant(database, meetingId, options.actorUserId);

  const stay = await readAttendanceInMeeting(database, meetingId, attendanceId);
  if (stay === undefined || stay.left_at !== null) {
    refuse("meeting-not-joined", "that is not somebody who is in this meeting");
  }
  if (stay.user_id === options.actorUserId) {
    refuse("meeting-not-host", "leaving is how a person leaves a meeting");
  }

  const target = await readLiveHostGrant(database, meetingId, stay.user_id);
  if (caller.role !== "host" && target?.role === "host") {
    refuse("meeting-not-host", "only the host of this meeting can remove the host");
  }

  const now = options.clock.now();
  return {
    userId: stay.user_id,
    effect: {
      statements: [
        guarded(
          closeAttendanceStatement(database, { id: attendanceId, reason: REMOVED, now }),
          REMOVE_PARTICIPANT_GUARD,
        ),
        // THE GRANT GOES WITH THEM. A co-host put out of the room holding a live grant could walk
        // straight back into the authority by claiming it, and would show on the roster of a room
        // they are not in as somebody running it.
        ...(target === undefined
          ? []
          : [
              guarded(
                revokeHostGrantStatement(database, {
                  meetingId,
                  userId: stay.user_id,
                  revokedByUserId: options.actorUserId,
                  now,
                }),
                REMOVE_PARTICIPANT_GUARD,
              ),
            ]),
        domainAuditStatement(database, {
          event: "meetings.meeting.removed",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { attendanceId, userId: stay.user_id, removedAt: now },
        }),
        domainAuditStatement(database, {
          event: "meetings.meeting.left",
          subjectId: meetingId,
          // The member whose presence the row records, exactly as every other departure writes it.
          actorUserId: stay.user_id,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            attendanceId,
            joinedAt: stay.joined_at,
            leftAt: now,
            reason: REMOVED,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * The door, shut or opened.
 *
 * A LOCKED ROOM REFUSES ARRIVALS AND TOUCHES NOBODY ALREADY IN IT. It is one act with a boolean
 * rather than two, because the instant and the actor move together in both directions and two paths
 * would be two places for that pair to drift.
 *
 * A room already in the state asked for produces no statements. Writing again would move the
 * instant and the actor a record already carries — the leave path's rule, and the redaction's.
 */
export async function setMeetingLocked(
  database: SqlDatabase,
  meetingId: MeetingId,
  locked: boolean,
  options: MeetingHostingOptions,
): Promise<{ changed: boolean; effect: EffectWrite }> {
  const meeting = await readExisting(database, meetingId, options);
  assertNotEnded(meeting);

  // A CO-HOST MAY SHUT THE DOOR. They are running the meeting with the host, and the act is
  // reversible by either of them.
  await requireHostGrant(database, meetingId, options.actorUserId);

  if ((meeting.locked_at !== null) === locked) {
    return { changed: false, effect: { statements: [], outboxMessages: [] } };
  }

  const now = options.clock.now();
  return {
    changed: true,
    effect: {
      statements: [
        guarded(
          setMeetingLockStatement(database, {
            id: meetingId,
            locked,
            lockedByUserId: options.actorUserId,
            now,
          }),
          LOCK_MEETING_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.meeting.lockChanged",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // One event with a labelled direction rather than two event names, for the reason the
          // departure vocabulary is one: the question a record is read for is when the door moved.
          metadata: { locked, changedAt: now },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------------------------

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
