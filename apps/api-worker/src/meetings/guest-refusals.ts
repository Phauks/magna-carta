import type { MeetingValidationCode } from "@magna-carta/meetings/validation";
import type { GuestLaneRefusal } from "../chokepoint/chokepoint.ts";

// WHAT A GUEST HOLDING A SIGNED LINK IS TOLD WHEN IT CANNOT BE USED — one table, read by the
// chokepoint's guest lane on every request and by the guest routes for a refusal the arrival itself
// raises, so the lane and the routes cannot give one condition two answers.
//
// Every sentence here is said to somebody the firm sent a link to, and ends where they can act: ask the
// firm for a new one. None of them names a matter, an event, a member or anything else about the
// meeting beyond what the link's own holder already knows. The sentence never carries the token.

const ASK_FOR_A_NEW_LINK = "Ask the firm for a new link.";

/**
 * The refusal for one of the guest link's own codes, or null for a code that is not the link's — which
 * the caller answers through the meetings family's own mapping, so a locked room says to a guest what
 * it says to a member.
 */
export function guestLinkRefusalFor(code: MeetingValidationCode): GuestLaneRefusal | null {
  switch (code) {
    case "guest-link-not-valid":
      return {
        type: "guest-link-not-valid",
        status: 410,
        title: "This link no longer works",
        detail: `This link has been replaced by a newer one. ${ASK_FOR_A_NEW_LINK}`,
      };
    case "guest-link-expired":
      return {
        type: "guest-link-expired",
        status: 410,
        title: "This link has expired",
        detail: `This link was only good until shortly after the meeting. ${ASK_FOR_A_NEW_LINK}`,
      };
    case "guest-link-revoked":
      return {
        type: "guest-link-revoked",
        status: 410,
        title: "This link was withdrawn",
        detail: `The firm has withdrawn this link. ${ASK_FOR_A_NEW_LINK}`,
      };
    case "guest-link-exhausted":
      return {
        type: "guest-link-exhausted",
        status: 409,
        title: "This link has been used up",
        detail: `This link has been used to join as many times as it can be. ${ASK_FOR_A_NEW_LINK}`,
      };
    // The family's own type, so a guest's screen and a member's read one problem for one condition.
    case "meeting-already-ended":
      return {
        type: "meeting-ended",
        status: 409,
        title: "This meeting has ended",
        detail: "The meeting this link was for is over.",
      };
    default:
      return null;
  }
}
