import type { RandomSource } from "@magna-carta/identifiers/random";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmEventId,
  MatterEventId,
  MeetingId,
  MeetingPersonalRoomId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingLobbyMode } from "./lobby-types.ts";
import type { MeetingEventKind, MeetingMedium, MeetingStatus } from "./types.ts";

// A MEMBER'S PERSONAL ROOM — a room they always have, reached by a link that does not change.
//
// The room is the standing link and the owner's defaults, and nothing else. Each time the owner opens
// it, an ordinary event and an ordinary meeting are written, and `meeting.personal_room_id` names the
// room. So a session is a meeting like any other: attendance, the door, hosting, chat, guests and
// recording read it through its event exactly as they read every meeting, and none of them learned a
// new kind of room.

// THE LINK CODE: ten characters from an alphabet with no look-alikes (no 0/o, 1/l/i), so a code read
// aloud or copied by hand arrives intact. Thirty-one symbols to the tenth power is about 8 × 10¹⁴ —
// the code is an address inside the firm behind sign-in, not a secret, so this guards against
// collision and casual guessing rather than against an attacker. The database CHECK holds the length
// and the character class.
export const PERSONAL_ROOM_LINK_CODE_LENGTH = 10;
const LINK_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A fresh link code. Rejection-sampled, so every symbol is equally likely. */
export function newPersonalRoomLinkCode(randomSource: RandomSource = cryptoRandomSource): string {
  const limit = 256 - (256 % LINK_CODE_ALPHABET.length);
  let code = "";
  while (code.length < PERSONAL_ROOM_LINK_CODE_LENGTH) {
    for (const byte of randomSource(PERSONAL_ROOM_LINK_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length];
      if (code.length === PERSONAL_ROOM_LINK_CODE_LENGTH) break;
    }
  }
  return code;
}

/** Whether a string could be a link code at all — refused before any read, so a probe costs nothing. */
/**
 * Whether a string could be a room's address name at all (lower-case letters, digits and hyphens, at
 * most forty). Anything else is refused before a read.
 */
export function isPersonalRoomAddress(value: string): boolean {
  return value.length > 0 && value.length <= 40 && /^[a-z0-9-]+$/.test(value);
}

export function isPersonalRoomLinkCode(value: string): boolean {
  return (
    value.length === PERSONAL_ROOM_LINK_CODE_LENGTH &&
    /^[a-z0-9]+$/.test(value) &&
    value.split("").every((character) => LINK_CODE_ALPHABET.includes(character))
  );
}

/** One room, in the database's own column names. */
export interface MeetingPersonalRoomRow {
  readonly id: MeetingPersonalRoomId;
  readonly owner_user_id: UserId;
  readonly link_code: string;
  readonly medium: MeetingMedium;
  readonly lobby: MeetingLobbyMode;
  readonly link_replaced_at: string | null;
  // The room's address by name (/room/trevor). Every room has one; null only in a row read before
  // the column was filled.
  readonly address_name: string | null;
  // A member's own room, or one the firm shares; see `MEETING_ROOM_KINDS`.
  readonly kind: MeetingRoomKind;
  // The room's own name; null for a member's room they have not named.
  readonly title: string | null;
  // When a shared room was taken off the list; null while it is in use.
  readonly retired_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// A MEMBER'S OWN ROOM OR ONE THE FIRM SHARES. A member has at most one room of their own, which only
// they open. A shared room ("Red Room", "Large Conference Room") is set up by anybody who may host
// meetings, and opened by anybody who may: it stands for a place, not a person.
export const MEETING_ROOM_KINDS = ["personal", "shared"] as const;
export type MeetingRoomKind = (typeof MEETING_ROOM_KINDS)[number];

/** The longest name a room may be given, as the database holds it. */
export const MEETING_ROOM_TITLE_MAXIMUM = 80;

/** What a room is called: its own name, or for a member's room they have not named, theirs. */
export function roomDisplayName(
  room: { readonly kind: MeetingRoomKind; readonly title: string | null },
  ownerDisplayName: string,
): string {
  if (room.title !== null) return room.title;
  return room.kind === "shared" ? "Shared room" : `${ownerDisplayName}'s Room`;
}

/** A room as a link reads it: the room, its owner's name, and whether the owner is still a member. */
export interface PersonalRoomAtLink extends MeetingPersonalRoomRow {
  readonly owner_display_name: string;
  readonly owner_active: number;
}

/** The session a room has open, with what deciding whether it is still in use needs. */
export interface PersonalRoomOpenSession {
  readonly id: MeetingId;
  readonly status: MeetingStatus;
  readonly event_kind: MeetingEventKind;
  readonly matter_event_id: MatterEventId | null;
  readonly firm_event_id: FirmEventId | null;
  readonly started_at: string | null;
  readonly time_zone: string;
  // Stays of either kind in the room or at its door right now.
  readonly present_count: number;
  // When the last stay closed, or null when none has.
  readonly last_left_at: string | null;
}

// THE EVENT'S TITLE. A session is written before anybody has said what it is about, so the title says
// whose room it was; a member renames the event like any other, and moving it onto a matter keeps
// whatever it says by then.
export function personalRoomEventTitle(ownerDisplayName: string): string {
  return `${ownerDisplayName}'s room`;
}

/**
 * A room's name as a member typed it: the spaces at either end taken off and runs of space made one.
 * Undefined where nothing is left or it is too long, which the service refuses.
 */
export function cleanRoomTitle(typed: string): string | undefined {
  const cleaned = typed.replaceAll(/\s+/g, " ").trim();
  return cleaned.length === 0 || cleaned.length > MEETING_ROOM_TITLE_MAXIMUM ? undefined : cleaned;
}

// THE PERSONAL ROOM'S OWN REFUSALS, as a vocabulary of their own on the recording's precedent: only
// these routes raise them, and the room's one switch over `MeetingValidationCode` stays as it is.
export type MeetingPersonalRoomRefusalCode =
  // A link code that names no room, or the room of somebody who has left the firm. One answer for
  // both, because the second is not the caller's business and the remedy is the same: ask for a link.
  | "personal-room-unknown"
  // Opening, or changing, a room that is not the caller's. Only its owner opens it, so a room is never
  // in use without the person whose room it is.
  | "personal-room-not-owner"
  // A room name that is empty, or longer than `MEETING_ROOM_TITLE_MAXIMUM`.
  | "personal-room-invalid-title"
  // Moving a meeting onto a matter that cannot be moved: it is not a personal-room session, it is
  // already on a matter, or the caller is neither the room's owner nor running the session.
  | "meeting-move-refused";

export class MeetingPersonalRoomRefusedError extends Error {
  constructor(
    readonly code: MeetingPersonalRoomRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "MeetingPersonalRoomRefusedError";
  }
}

export function refusePersonalRoom(code: MeetingPersonalRoomRefusalCode, message: string): never {
  throw new MeetingPersonalRoomRefusedError(code, message);
}

/**
 * One member of the firm as the Firm Rooms list shows them: their room's link where they have set
 * one up, and the session it has open with how many people are in it. A member with no room is a
 * row with nulls, so the list can say "No room set up" rather than leave them out.
 */
/** One shared room as the firm's list shows it, with the session it has open. */
export interface SharedRoomRow {
  readonly id: MeetingPersonalRoomId;
  readonly title: string | null;
  readonly address_name: string | null;
  readonly medium: MeetingMedium;
  readonly lobby: MeetingLobbyMode;
  readonly set_up_by: string;
  readonly open_meeting_id: MeetingId | null;
  readonly live_count: number;
}

export interface FirmRoomRow {
  readonly user_id: UserId;
  readonly display_name: string;
  readonly link_code: string | null;
  readonly address_name: string | null;
  readonly title: string | null;
  readonly medium: MeetingMedium | null;
  readonly open_meeting_id: MeetingId | null;
  readonly live_count: number;
}
