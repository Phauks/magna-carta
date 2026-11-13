/*
 * Finding words within one conversation: which of the turns on screen hold them, and where.
 *
 * It runs in the browser over the turns the reader has, because a conversation is short and is
 * already on the screen: the server's search finds a CONVERSATION among the member's record, and
 * this finds a MESSAGE inside the one that is open. A match ignores case and nothing else, so what
 * it marks is what the reader typed, letter for letter.
 *
 * It finds in the words of a turn as the reader sees them. A turn with no words (an answer still
 * being written, a message its author removed) has nothing to find in.
 */
import type { TextMark } from "$lib/search/marked-text.ts";
import type { MagnusTurn } from "./magnus-api.ts";

/**
 * The turns a transcript shows: every turn except those an edit set aside, and except a removed
 * answer whose words the reader is not shown (its question's marker stands for both). One home, so
 * the transcript and the find bar count the same messages.
 */
export function shownTurns(turns: readonly MagnusTurn[]): readonly MagnusTurn[] {
  return turns.filter(
    (turn) =>
      turn.supersededAt === null &&
      !(turn.speaker === "magnus" && turn.removedAt !== null && turn.content === null),
  );
}

/** What the reader typed, as a finder reads it: nothing at all when it is only spaces. */
export function findQuery(text: string): string {
  return text.trim();
}

/**
 * Where `query` stands in `text`, ignoring case, as marks a MarkedText draws. Lowering the case of a
 * few letters changes a string's length (the dotted capital I, for one), and offsets in the lowered
 * string would then point at the wrong letters of the original; such a text is matched exactly
 * instead, which is a narrower find and never a wrong one.
 */
export function findMarks(text: string, query: string): readonly TextMark[] {
  if (query === "" || text === "") return [];
  const folded = text.toLowerCase();
  const sameLength = folded.length === text.length;
  const haystack = sameLength ? folded : text;
  const needle = sameLength ? query.toLowerCase() : query;
  const marks: TextMark[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    marks.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return marks;
}

/** The turns, in order, whose words hold the query. */
export function matchingTurnIds(turns: readonly MagnusTurn[], query: string): readonly string[] {
  if (query === "") return [];
  return turns
    .filter((turn) => turn.content !== null && findMarks(turn.content, query).length > 0)
    .map((turn) => turn.id);
}

/** The match a step moves to, wrapping at either end. */
export function steppedMatch(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return 0;
  return (((current + step) % count) + count) % count;
}
