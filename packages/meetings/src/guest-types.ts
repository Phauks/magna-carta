import type {
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingDepartureReason, MeetingMedium, MeetingStatus } from "./types.ts";

// SOMEBODY FROM OUTSIDE THE FIRM IN A MEETING — the link that gets them to the door, and the stay
// they hold once they are there.
//
// A GUEST IS A DIRECTORY ENTITY ON THE EVENT, never a free address, so the record always names
// somebody the firm knows and the conflicts corpus can see. The link proves possession of a mailbox
// and nothing more: it gets a person to the lobby, and a host admits them. A guest holds no session
// and never will — nothing here names a user, and nothing about a guest can reach a member-only path.
//
// It is a stopgap with a named successor. When the client portal's grant model lands it subsumes the
// link, and the two tables behind these types are what it absorbs.

// HOW LONG A LINK OUTLIVES ITS EVENT, AND THE MOST IT CAN LIVE AT ALL.
//
// `expires_at = min(mint + GUEST_LINK_MAX_DAYS, max(eventEnd, mint) + GUEST_LINK_GRACE_HOURS)`,
// computed once at mint and stored on the row, never re-derived at read time.
//
// Two hours covers a hearing that starts late or a meeting that runs long without leaving a live link
// behind for a week afterwards. A fortnight bounds a link minted against an event scheduled far out,
// and it is a ceiling rather than the rule, because the ordinary case — invite this morning for this
// afternoon — should not leave a credential alive for a fortnight.
export const GUEST_LINK_GRACE_HOURS = 2;
export const GUEST_LINK_MAX_DAYS = 14;

// HOW MANY TIMES ONE LINK MAY BE SPENT AT THE DOOR, over its whole life.
//
// A link is deliberately NOT burned on first use: a guest whose laptop sleeps, whose browser crashes
// or who loses the network for two minutes must be able to come back without telephoning the firm in
// the middle of a hearing. What bounds a link forwarded to a crowd is this count, and twenty is far
// more than a bad connection spends and far fewer than a company-wide forward would.
export const MAX_GUEST_ARRIVALS = 20;

// HOW LONG THE CREDENTIAL AN ARRIVAL MINTS LASTS — never longer than the link it was spent from. The
// grant rides every later guest request and the socket's address, so it is shorter-lived than the
// link: long enough for the longest meeting anybody sits through, and dead with the meeting anyway.
export const GUEST_GRANT_LIFETIME_HOURS = 12;

// THE LONGEST NAME A GUEST MAY GIVE AT THE DOOR. It is untrusted display text a host reads before
// deciding who comes in, so it is bounded, whitespace-normalized, and never written over the
// Directory's own name anywhere. Also a CHECK on the stay row.
export const MAX_GUEST_CONFIRMED_NAME_LENGTH = 80;

// WHICH KIND OF DIRECTORY ENTITY A LINK WAS MINTED FOR. An organization is not a special case: the
// person who arrives on a company's link confirms their own name at the door, and the record then
// reads "Acme Corporation — arrived as Jane Hollis", which is more true than either half alone. Also a
// CHECK on the invitation row.
export const MEETING_GUEST_ENTITY_KINDS = Object.freeze(["person", "organization"] as const);
export type MeetingGuestEntityKind = (typeof MEETING_GUEST_ENTITY_KINDS)[number];

/** One invitation, in the database's own column names. The secret itself is never a column. */
export interface MeetingGuestInvitationRow {
  readonly id: MeetingGuestInvitationId;
  readonly meeting_id: MeetingId;
  readonly entity_kind: MeetingGuestEntityKind;
  readonly entity_id: string;
  readonly invited_name: string;
  readonly directory_email_id: string | null;
  /** SHA-256 of the secret, lowercase hex. */
  readonly token_secret_hash: string;
  readonly secret_version: number;
  readonly issued_by_user_id: UserId;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly revoked_by_user_id: UserId | null;
  readonly arrival_count: number;
  readonly last_arrival_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** One guest's stay, in the database's own column names — `meeting_attendance`'s shape. */
export interface MeetingGuestStayRow {
  readonly id: MeetingGuestStayId;
  readonly meeting_id: MeetingId;
  readonly invitation_id: MeetingGuestInvitationId;
  readonly confirmed_name: string;
  readonly joined_at: string;
  /** Never null: a guest always waits. */
  readonly waiting_from: string;
  readonly admitted_at: string | null;
  readonly admitted_by_user_id: UserId | null;
  readonly left_at: string | null;
  readonly ended_reason: MeetingDepartureReason | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * One invitation as a host's Guests panel paints it — NEVER the token, never the secret, never even
 * a truncated piece of either. Unlike a capture address, which a person has to read off a screen,
 * this credential only ever travels by e-mail.
 */
export interface MeetingGuestInvitationEntry {
  readonly id: MeetingGuestInvitationId;
  readonly entityKind: MeetingGuestEntityKind;
  readonly entityId: string;
  readonly invitedName: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly arrivalCount: number;
  readonly lastArrivalAt: string | null;
}

/**
 * THE MEETING, AS SOMEBODY HOLDING ITS LINK MAY KNOW IT.
 *
 * A DISTINCT SHAPE from `MeetingSummary`, not the same one with fields left empty: a nulled field is
 * a field somebody later restores, and the matter and the event behind a meeting must never be
 * reachable from here. The firm's name, the event's title and time in the event's own zone, the
 * medium, where the meeting stands, and the name the link was minted for — and nothing else. The
 * firm's name is the Worker's to supply, because it lives on the control plane.
 */
export interface GuestMeetingSummary {
  readonly firmName: string;
  readonly title: string;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly medium: MeetingMedium;
  readonly status: MeetingStatus;
  readonly invitedName: string;
}

/**
 * The event facts an expiry and a mail are computed from — the event's own day and times in its own
 * zone. The Worker turns these into an instant; this package reads no clock and knows no zone.
 */
export interface GuestEventFacts {
  readonly title: string;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly startsAtTime: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
}

/**
 * When a link minted at `mintedAt` stops working, given the instant its event ends.
 *
 * `eventEndsAt` is the CALLER's to compute, because it needs the event's own time zone and this
 * package has none: an event with no end time ends at the end of its own day in its own zone, and a
 * server that took midnight UTC instead would expire a Honolulu firm's link during the meeting it was
 * minted for.
 */
export function guestLinkExpiresAt(mintedAt: string, eventEndsAt: string): string {
  const minted = Date.parse(mintedAt);
  const eventEnd = Date.parse(eventEndsAt);
  const ceiling = minted + GUEST_LINK_MAX_DAYS * 24 * 60 * 60 * 1000;
  const graced =
    Math.max(Number.isNaN(eventEnd) ? minted : eventEnd, minted) +
    GUEST_LINK_GRACE_HOURS * 60 * 60 * 1000;
  return new Date(Math.min(ceiling, graced)).toISOString();
}

/** When a grant minted at `mintedAt` from a link expiring at `linkExpiresAt` stops working. */
export function guestGrantExpiresAt(mintedAt: string, linkExpiresAt: string): string {
  const grantCeiling = Date.parse(mintedAt) + GUEST_GRANT_LIFETIME_HOURS * 60 * 60 * 1000;
  return new Date(Math.min(grantCeiling, Date.parse(linkExpiresAt))).toISOString();
}
