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
