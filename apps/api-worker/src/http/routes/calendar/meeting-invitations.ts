/*
 * WHO IS TOLD THAT A MEETING WAS SCHEDULED ON AN EVENT: the colleagues on it, as one outbox message
 * riding the batch that opened the room. Pure, so both of the calendar's scheduling paths share it.
 */
import {
  CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC,
  type CalendarEventMeetingScheduledPayload,
} from "@magna-carta/calendar/notifications";
import type { MeetingEventKind } from "@magna-carta/meetings/types";

/**
 * The colleagues on an event, and nobody else.
 *
 * Directory entities get nothing: an external guest has no way in yet, and a notification pointing
 * at a room they cannot enter is worse than silence. The actor is left off — nobody needs inviting
 * to the meeting they just scheduled. Deduplicated because a participant list is edited by hand.
 */
export function invitedMembers(
  participants: readonly {
    readonly participantKind: string;
    readonly memberUserId?: string | null;
  }[],
  actorUserId: string,
): readonly string[] {
  const invited = participants.flatMap((participant) => {
    const memberUserId = participant.memberUserId ?? null;
    if (participant.participantKind !== "member" || memberUserId === null) return [];
    return memberUserId === actorUserId ? [] : [memberUserId];
  });
  return [...new Set(invited)];
}

/**
 * The invitation, as an outbox message or none at all.
 *
 * A FIRM EVENT RAISES NOTHING, and the reason is a table rebuild rather than a decision:
 * `notification_event.subject_kind` is a SQLite CHECK with no `firmEvent` value in it, and widening
 * one rebuilds a table `notification_recipient` points at, which cannot complete against a firm
 * database that holds data (packages/database/src/reviewed-rebuilds.ts). The firm meeting is
 * scheduled, created and joinable; it is the invitation alone that waits on that migration.
 */
export function meetingInvitations(
  event: {
    readonly kind: MeetingEventKind;
    readonly id: string;
    readonly matterId?: string | null;
  },
  meetingId: string,
  medium: string,
  invited: readonly string[],
): { topic: string; payload: CalendarEventMeetingScheduledPayload }[] {
  const matterId = event.matterId ?? null;
  if (event.kind !== "matter" || matterId === null || invited.length === 0) return [];
  return [
    {
      topic: CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC,
      payload: {
        matterEventId: event.id,
        matterId,
        meetingId,
        medium,
        invitedMemberUserIds: invited,
      },
    },
  ];
}
