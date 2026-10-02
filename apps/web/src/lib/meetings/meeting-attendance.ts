/*
 * Who was in a meeting, as its attendance record reads — members and guests in one list.
 *
 * ONE LIST, TWO KINDS OF PERSON. A member's stay and a guest's stay are kept apart on the server and
 * read back together, in the order the stays began, so the record reads as the meeting happened
 * rather than as two lists somebody has to interleave by eye. What differs is only how each is named:
 * a member by the name the firm knows them by, a guest by the name they gave at the door with the
 * Directory name their link was minted for beside it.
 *
 * A GUEST HAS NO MEMBER IDENTITY, and the row says so by having none: `userId` is null for a guest
 * and never guessed at, and nothing here falls back to printing a handle at a reader.
 */
import type { MeetingAttendanceEntry } from "@magna-carta/api-client";
import { guestAttendeeLabel } from "./screen/meeting-host-labels.ts";

/** One stay in the room, as a line of the record. */
export interface MeetingAttendanceRow {
  readonly id: string;
  readonly participantKind: "member" | "guest";
  /** The member behind a member's stay. Null for a guest, who has none. */
  readonly userId: string | null;
  /** What the person went by in the room: a member's name, or what a guest typed at the door. */
  readonly displayName: string;
  /** The Directory name a guest's link was minted for. Null for a member. */
  readonly invitedName: string | null;
  readonly joinedAt: string;
  readonly leftAt: string | null;
}

/** What a member's stay with no name on it is drawn as. The handle is never printed in its place. */
const UNNAMED_MEMBER = "Somebody at the firm";
/** What a guest's stay with no name on it is drawn as, before the mark and the invited name. */
const UNNAMED_GUEST = "Unnamed";

/**
 * One entry of the attendance read, as a row.
 *
 * A guest is only ever a guest because the server said so, and a guest's member identity is null
 * here even if something upstream were ever to carry one: the row a screen draws for somebody from
 * outside the firm has nothing in it that reaches a member.
 */
export function readAttendanceEntry(entry: MeetingAttendanceEntry): MeetingAttendanceRow {
  const guest = entry.participantKind === "guest";
  return {
    id: entry.id,
    participantKind: guest ? "guest" : "member",
    userId: guest ? null : entry.userId,
    displayName: entry.displayName,
    invitedName: guest ? entry.invitedName : null,
    joinedAt: entry.joinedAt,
    leftAt: entry.leftAt,
  };
}

/** Who a line of the record names, in the words the record reads. */
export function attendeeLabel(row: MeetingAttendanceRow): string {
  if (row.participantKind === "guest") {
    return guestAttendeeLabel(
      row.displayName === "" ? UNNAMED_GUEST : row.displayName,
      row.invitedName,
    );
  }
  return row.displayName === "" ? UNNAMED_MEMBER : row.displayName;
}
