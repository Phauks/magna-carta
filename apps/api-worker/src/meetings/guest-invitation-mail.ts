import { endOfCivilDayInstant, instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
import { formatDate, formatTimeOfDay } from "@magna-carta/design-system/formatters";
import type { GuestEventFacts } from "@magna-carta/meetings/guest-types";

// THE MAIL A GUEST RECEIVES, pure and testable, and the one instant a link's life is measured from.
//
// WHAT IT CARRIES, AND WHAT IT NEVER DOES. The firm's name, the event's title, the event's start in
// the event's own zone, and the link — and nothing else about the matter. The title is disclosed
// because the host's act of inviting this person to this meeting discloses it; no matter identifier,
// no matter name beyond whatever the title already says, no participant list and no document travels.
//
// THE LINK GOES TO A SCREEN THAT SPENDS NOTHING ON OPEN. A mail client that prefetches links, a
// corporate scanner that follows every address in an inbound message, and a person who clicks twice
// must all cost nothing — so the link opens the arrival page, which only reads, and what spends it is
// the guest pressing Join there. The bare token travels on its own line as the typed fallback, the
// confirmation mail's arrangement, so a mail program that refuses links is not a dead end.

/** Where the arrival page lives on the application's own origin, outside the signed-in shell. */
export const GUEST_ARRIVAL_SCREEN_PATH = "/join";

/** The class the send is counted under — never the body, never the address. */
export const GUEST_INVITATION_MESSAGE_CLASS = "meeting-guest-invitation";

/** The arrival page for one link, on the origin the request that minted it arrived at. */
export function guestArrivalLink(origin: string, token: string): string {
  return `${origin}${GUEST_ARRIVAL_SCREEN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * The subject and body of one invitation.
 *
 * The start is written in the event's own zone — its own day and its own clock, labelled with the
 * zone — because the server has no reader's zone to convert into, and a converted time in the wrong
 * zone is worse than an honest one labelled with where it is true. An all-day event says so.
 */
export function guestInvitationEmail(input: {
  readonly firmName: string;
  readonly event: GuestEventFacts;
  readonly origin: string;
  readonly token: string;
}): { readonly subject: string; readonly text: string } {
  const link = guestArrivalLink(input.origin, input.token);
  const when = describeStart(input.event);
  const firm = input.firmName === "" ? "A firm" : input.firmName;
  return {
    subject: `${firm} has invited you to a meeting: ${input.event.title}`,
    text:
      `${firm} has invited you to join a meeting.\n\n` +
      `${input.event.title}\n${when}\n\n` +
      `Open this link to join:\n\n${link}\n\n` +
      `You will be asked to confirm your name, and you can check your camera and microphone before ` +
      `anybody can see or hear you. You will wait until a host at ${firm} lets you in.\n\n` +
      `If your mail program does not open links, go to ${input.origin}${GUEST_ARRIVAL_SCREEN_PATH}/ ` +
      `followed by this code:\n\n${input.token}\n\n` +
      `This link is for you. It stops working a few hours after the meeting, or earlier if the firm ` +
      `withdraws it. If you were not expecting it, you can ignore this message.`,
  };
}

/**
 * The instant an event ends, in its own zone — what a link's expiry is measured from.
 *
 * An event with no end time ends at the END OF ITS OWN DAY IN ITS OWN ZONE, never at midnight UTC: a
 * server that took UTC's day would expire a Honolulu firm's link during the meeting it was minted for.
 * A multi-day event ends on its last day. A zone the runtime cannot resolve falls back to the end of
 * the day in UTC rather than throwing a host out of the act of inviting somebody over a calendar row.
 */
export function eventEndInstant(event: GuestEventFacts): string {
  const lastDay = event.endsOn ?? event.startsOn;
  try {
    const ends =
      event.endsAtTime === null
        ? endOfCivilDayInstant(lastDay, event.timeZone)
        : instantForCivilDateTime(lastDay, event.endsAtTime, event.timeZone);
    return new Date(ends).toISOString();
  } catch {
    return new Date(endOfCivilDayInstant(lastDay, "UTC")).toISOString();
  }
}

// The letter is written in English, and the server holds no reader's locale to use instead.
const MAIL_LOCALE = "en-US";

// "Oct 5, 2026 at 9:30 AM PDT (America/Los_Angeles)", through the platform's own formatters. The DAY
// is `formatDate`'s — a recorded day, pinned so it never moves. The CLOCK is `formatTimeOfDay` over the
// instant the event starts, read in the EVENT'S zone with that zone's letters: a stamp leaving this
// machine for somebody whose clock is not the firm's, which is the case its `zoneName` option is for.
// A zone the runtime cannot resolve falls back to the wall clock the event records, labelled, rather
// than throwing a host out of the act of inviting somebody over a calendar row.
function describeStart(event: GuestEventFacts): string {
  const day = formatDate(event.startsOn, { locale: MAIL_LOCALE });
  if (event.startsAtTime === null) return `${day} (all day, ${event.timeZone})`;
  try {
    const startsAt = instantForCivilDateTime(event.startsOn, event.startsAtTime, event.timeZone);
    const clock = formatTimeOfDay(startsAt, {
      locale: MAIL_LOCALE,
      timeZone: event.timeZone,
      zoneName: true,
    });
    return `${day} at ${clock} (${event.timeZone})`;
  } catch {
    return `${day} at ${event.startsAtTime} (${event.timeZone})`;
  }
}
