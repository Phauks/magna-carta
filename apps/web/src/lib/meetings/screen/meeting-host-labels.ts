/*
 * The words the room uses for who is running it, in one home.
 *
 * A tile draws the badge, a roster row draws the same badge, a menu offers the act that changes it,
 * and a panel lists everybody holding one. Four surfaces saying "Co-host", "Cohost", "co-host" and
 * "Co-Host" is how a reader learns that four parts of one screen were written by four people — so
 * the spelling is settled once, here, and read from the wire's own two values.
 */
import type { MeetingHostRole } from "@magna-carta/meeting-protocol/types";

/** What a role is called on screen. */
export function hostRoleLabel(role: MeetingHostRole): string {
  return role === "host" ? "Host" : "Co-host";
}

/** What somebody spotlighted for the room is called, wherever the mark or the act is drawn. */
export const SPOTLIGHT_LABEL = "Spotlighted for everyone";

/**
 * What a raised hand is called, wherever the mark is drawn.
 *
 * Three surfaces draw it — a tile, a roster row and the host's own queue — which is exactly the
 * count of surfaces this file exists for. It is the STATE and not the act: the controls that put a
 * hand up and take it down name themselves.
 */
export const HAND_RAISED_LABEL = "Hand raised";

/**
 * What somebody from outside the firm is called, wherever the mark is drawn.
 *
 * Two surfaces draw it — a row at the door, and a line in the attendance record — and the second is
 * read months later by somebody who was not in the room, so both must say the same word for the
 * same fact.
 */
export const GUEST_LABEL = "Guest";

/**
 * The Directory name a guest's link was minted for, in the words beside the name they gave.
 *
 * It is stated rather than compared: an organization's link is ordinarily used by one of its
 * people, so two different names are the usual shape and not a warning. What matters is that a
 * host reads both before deciding, which is why the two are never folded into one.
 */
export function invitedAsLabel(invitedName: string): string {
  return `Invited as ${invitedName}`;
}

/**
 * A guest's line in the attendance record: the name they gave at the door, marked, with the name the
 * link was minted for beside it — "Jane Hollis (Guest, invited as Acme Corporation)".
 *
 * Both names, because a reader six months later must be able to see at a glance that the person who
 * attended is not the record the invitation named, which is the one thing a forwarded link leaves
 * behind.
 */
export function guestAttendeeLabel(confirmedName: string, invitedName: string | null): string {
  return invitedName === null
    ? `${confirmedName} (${GUEST_LABEL})`
    : `${confirmedName} (${GUEST_LABEL}, invited as ${invitedName})`;
}
