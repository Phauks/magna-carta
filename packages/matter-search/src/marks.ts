import {
  FILE_WORD_RULES,
  RECORD_WORD_RULES,
  markCharacters,
  markWords,
  recordExcerpt,
  type MatchedText,
} from "@magna-carta/search/matched-text";
import type { MatchKind, MatterSearchHit, SourceMarking } from "./types.ts";

// The last step of both searches: each hit a reader is about to be shown says where their words
// are in it.
//
// IT RUNS AFTER EVERYTHING THAT DECIDES AN ANSWER. The statement has bound the matter (or composed
// the visible-matter predicate), the limit has cut the rows, and the source has projected them.
// What happens here cannot add a hit, drop one or reorder them; it rewrites two texts of a hit and
// attaches offsets. So nothing about access rests on it, and a word it fails to find costs a mark.
//
// THE RULE IS THE SOURCE'S, declared on it (`marking`), because how a text was matched is a fact
// about the source: a note's words through the record index, a file's name as characters, a
// document's sentence by the file contents engine. One rule applied to every source would mark a
// date, or mark a file's name for words that are inside the file.
//
// A RECORD'S LONG TEXT IS QUOTED, NOT SENT WHOLE. A note can run to pages, and a result shows two
// lines of it. Sent whole, the words that answered are usually below what the result shows, and a
// page of fifty results carries fifty notes to draw a hundred lines. So a text matched through the
// record index is cut to the stretch the words are in before it is marked.

function unmarked(text: string): MatchedText {
  return { text, marks: [] };
}

function markedBy(kind: MatchKind | null, text: string, query: string): MatchedText {
  if (kind === "record-words") return markWords(RECORD_WORD_RULES, text, query);
  if (kind === "file-words") return markWords(FILE_WORD_RULES, text, query);
  if (kind === "characters") return { text, marks: markCharacters(text, query) };
  return unmarked(text);
}

function shownExcerpt(kind: MatchKind | null, text: string, query: string): MatchedText {
  // Only a record's own text is cut here. A file's sentence arrives already cut, from the kept
  // text the index job wrote, and a name is never an excerpt.
  return kind === "record-words" ? recordExcerpt(text, query) : markedBy(kind, text, query);
}

// One hit with its marks, and with its excerpt cut to what a result shows.
export function withMarks(
  marking: SourceMarking,
  hit: MatterSearchHit,
  query: string,
): MatterSearchHit {
  const title = markedBy(marking.title, hit.title, query);
  const snippet = hit.snippet === null ? null : shownExcerpt(marking.snippet, hit.snippet, query);
  return {
    ...hit,
    title: title.text,
    titleMarks: title.marks,
    snippet: snippet === null ? null : snippet.text,
    snippetMarks: snippet === null ? [] : snippet.marks,
  };
}
