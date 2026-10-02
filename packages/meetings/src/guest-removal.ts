import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import { closeGuestStayStatement } from "./guest-statements.ts";
import type { MeetingDepartureReason } from "./types.ts";

// A GUEST PUT OUT BY A HOST, and how a stay handle says which table it lives in — the two pieces of the
// guest concern that the member-side host acts reach.
//
// They live apart from `guest-service.ts` so that `hosting-service.ts`, `lobby-service.ts` and
// `meeting-service.ts` can reach them without importing the guest service, which itself composes the
// host-grant chokepoint from `hosting-service.ts`. Everything here depends only on statements and
// types, so no service imports another through it.

/** Whether a stay handle names a guest's stay rather than a member's — the prefix is the table. */
export function isGuestStayHandle(handle: string): handle is MeetingGuestStayId {
  return isIdentifier(handle, "meetingGuestStay");
}

/**
 * A guest's stay closed by a HOST — removed from the room — as the statements that write it.
 *
 * Reached by a removal addressed to the stay (`removeParticipant` in ./hosting-service.ts). A
 * withdrawal of the LINK does not come here: it closes the stay `left` rather than `removed`, because
 * a removal bars the person and a withdrawal is a decision about a credential (`revokeGuestLink` in
 * ./guest-service.ts). TWO audit rows, on the member removal's reasoning:
 * `meetings.meeting.removed` records that a host acted, and `meetings.guest.left` is the departure
 * every way of leaving writes. The guard label is the caller's, so each act's lost race is told apart.
 */
export function removalOfGuestStatements(
  database: SqlDatabase,
  meetingId: MeetingId,
  stayId: MeetingGuestStayId,
  invitationId: MeetingGuestInvitationId,
  now: string,
  options: {
    readonly actorUserId: UserId;
    readonly clock: { now(): string };
    readonly randomSource?: RandomSource;
    readonly reason: MeetingDepartureReason;
    readonly joinedAt: string;
    readonly guard: string;
  },
): readonly EffectStatement[] {
  return [
    guarded(
      closeGuestStayStatement(database, { id: stayId, reason: options.reason, now }),
      options.guard,
    ),
    domainAuditStatement(database, {
      event: "meetings.meeting.removed",
      subjectId: meetingId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { participantKind: "guest", stayId, invitationId, removedAt: now },
    }),
    domainAuditStatement(database, {
      event: "meetings.guest.left",
      subjectId: meetingId,
      // A guest is not a member, so the departure row names nobody in the actor column; the stay and
      // the invitation are who it is about.
      actorUserId: null,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {
        stayId,
        invitationId,
        joinedAt: options.joinedAt,
        leftAt: now,
        reason: options.reason,
      },
    }),
  ];
}
