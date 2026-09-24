/*
 * The user identifiers a trust movement carries, as names.
 *
 * The ledger is served `recordedBy`, `authorizedBy` and `requestedBy` as identifiers, because that
 * is what the record stores: a member's display name can change and a movement's account of who
 * wrote it down cannot. The firm's roster ($lib/members/firm-roster.svelte.ts) is what turns one
 * into the other, and it is the SHARED roster rather than a read of this surface's own — a page
 * that reads the same list a second time is a second place for "what if it fails" to drift.
 *
 * WHERE THE NAME CANNOT BE READ, THE IDENTIFIER STANDS. A reader refused the roster, or a movement
 * written by somebody no longer listed, still gets the handle the record holds plus a line saying
 * why it is not a name. Rendering nothing would say the movement had no author.
 */
import type { FirmMemberSummary } from "$lib/members/members-api.ts";

/** What a cell or a fact row shows for one user identifier, and what its hover says. */
export interface MemberDisplay {
  readonly text: string;
  /** The hover, where there is something to explain. Absent once the name is the name. */
  readonly title: string | undefined;
}

/** What the hover says where an identifier could not be resolved to a name. */
export const MEMBER_NAME_UNREADABLE = "The member's name could not be read.";

/** What it says while the roster is still being read: the identifier is standing in, not failing. */
export const MEMBER_NAME_READING = "Reading the firm's member list.";

/**
 * One identifier as a name where the roster can say, and as itself where it cannot.
 *
 * `members` is null while the roster read is in flight and an empty list where it failed or the
 * reader may not have it; the two say different things on the hover, because one of them clears on
 * its own and the other does not.
 */
export function memberDisplay(
  identifier: string,
  members: readonly FirmMemberSummary[] | null,
): MemberDisplay {
  if (members === null) return { text: identifier, title: MEMBER_NAME_READING };
  const member = members.find((candidate) => candidate.userId === identifier);
  if (member === undefined) return { text: identifier, title: MEMBER_NAME_UNREADABLE };
  return { text: member.displayName, title: undefined };
}
