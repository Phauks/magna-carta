import { VOTE_DISPLAY_FLOOR } from "./vocabulary.ts";

// How the board renders numbers and names it holds. Kept beside the vocabulary rather than in the
// interface so the API and every screen answer the same way.

// A vote count as a reader sees it. Below the floor the exact number is withheld: on a new post, "2"
// next to a request about one firm's workflow tells the reader that firm voted.
export function displayedVoteCount(voteCount: number): number | null {
  return voteCount < VOTE_DISPLAY_FLOOR ? null : voteCount;
}

export function voteCountText(voteCount: number): string {
  const shown = displayedVoteCount(voteCount);
  return shown === null ? `<${VOTE_DISPLAY_FLOOR}` : String(shown);
}

// The display name a new profile is offered: the given name and the family name's initial, e.g.
// "Dana R.". It is a SUGGESTION the person can change or replace with a pseudonym; the account's name
// column is never rendered on the board.
export function suggestedDisplayName(givenName: string | null, familyName: string | null): string {
  const given = givenName?.trim() ?? "";
  const familyInitial = familyName?.trim().charAt(0) ?? "";
  if (given === "") {
    return "Member";
  }
  return familyInitial === "" ? given : `${given} ${familyInitial.toUpperCase()}.`;
}

// Up to two letters for an avatar, from the display name only.
export function displayInitials(displayName: string): string {
  const words = displayName
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word !== "");
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}
