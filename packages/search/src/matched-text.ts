import { asIndexed, engineWordsOf } from "./keyword-query.ts";
import { asRecordIndexed, parseRecordQuery, recordWordsOf } from "./record-index-query.ts";

// A reader's words, found again in the text a result shows.
//
// An index says a record answers a question. It does not say where in the record, so the words are
// found again here, by the rules of the index that made the match: the text is cut into words and
// each word folded the way that index cuts and folds, and each term of the question is matched the
// way the question asked for it, a whole word, the start of a word, or a run of words in order.
// Two things are made from that: the STRETCH of a long text where the words are, which is what a
// result quotes, and the MARKS, which say where in a shown text each matched word begins and ends.
//
// THIS DECIDES NOTHING. Every result was already returned by a statement that bound the matter and
// composed the visibility predicate. What is here only says more about a text that statement
// returned, so a word this module fails to find costs a mark and never a result, and nothing it
// finds can add one.
//
// Plain text and offsets out. Nothing here is markup: a mark is two numbers, and the screen that
// draws it decides what a marked word looks like.

// Where one matched run begins and ends in a text, in UTF-16 code units, the end not included, so
// `text.slice(start, end)` is the run. Marks come sorted and never overlap.
export interface TextMark {
  readonly start: number;
  readonly end: number;
}

export interface MatchedText {
  readonly text: string;
  readonly marks: readonly TextMark[];
}

// How one index reads text.
export interface WordRules {
  // Whether the index composes a letter and its accent into one character before it cuts. A text
  // read under such rules is composed first, and the marks are offsets into the composed text.
  readonly composes: boolean;
  readonly cut: (text: string) => readonly { readonly word: string; readonly start: number }[];
  readonly fold: (word: string) => string;
}

// The record index: a note's text, a narrative, a description.
export const RECORD_WORD_RULES: WordRules = {
  composes: false,
  cut: recordWordsOf,
  fold: asRecordIndexed,
};

// The file contents index: the words inside a matter's files.
export const FILE_WORD_RULES: WordRules = {
  composes: true,
  cut: engineWordsOf,
  fold: asIndexed,
};

// About two lines of a result. Long enough to read as a sentence, short enough to stay an excerpt.
export const EXCERPT_CHARACTERS = 200;
// How much of that comes before the first word found, so the sentence is entered and not joined
// mid-clause at the match.
const LEAD_CHARACTERS = 60;

interface QuestionTerm {
  // The term's words as the index holds them, in order.
  readonly words: readonly string[];
  // Whether the last of them matches as the start of a word.
  readonly prefix: boolean;
}

function questionTerms(rules: WordRules, readerText: string): QuestionTerm[] {
  const terms: QuestionTerm[] = [];
  for (const term of parseRecordQuery(readerText)) {
    const words = term.tokens.flatMap((token) =>
      rules.cut(token).map(({ word }) => rules.fold(word)),
    );
    if (words.length > 0) terms.push({ words, prefix: term.prefix });
  }
  return terms;
}

interface HeldWord {
  readonly indexed: string;
  readonly start: number;
  readonly end: number;
}

function heldWords(rules: WordRules, text: string): HeldWord[] {
  return rules.cut(text).map(({ word, start }) => ({
    indexed: rules.fold(word),
    start,
    end: start + word.length,
  }));
}

function termMatchesAt(words: readonly HeldWord[], at: number, term: QuestionTerm): boolean {
  if (at + term.words.length > words.length) return false;
  return term.words.every((wanted, offset) => {
    const held = words[at + offset]?.indexed ?? "";
    const last = offset === term.words.length - 1;
    return last && term.prefix ? held.startsWith(wanted) : held === wanted;
  });
}

interface Found {
  // Where the run starts and ends in the text.
  readonly start: number;
  readonly end: number;
  readonly term: number;
}

function findTerms(words: readonly HeldWord[], terms: readonly QuestionTerm[]): Found[] {
  const found: Found[] = [];
  for (let at = 0; at < words.length; at += 1) {
    const first = words[at];
    if (first === undefined) continue;
    terms.forEach((term, index) => {
      if (!termMatchesAt(words, at, term)) return;
      const last = words[at + term.words.length - 1] ?? first;
      found.push({ start: first.start, end: last.end, term: index });
    });
  }
  return found;
}

// Sorted, and with every run that touches or overlaps another joined to it, so a screen can walk
// the marks once from the start of the text.
export function mergeTextMarks(marks: readonly TextMark[]): TextMark[] {
  const sorted = marks
    .filter((mark) => mark.end > mark.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: TextMark[] = [];
  for (const mark of sorted) {
    const before = merged.at(-1);
    if (before !== undefined && mark.start <= before.end) {
      merged[merged.length - 1] = { start: before.start, end: Math.max(before.end, mark.end) };
    } else {
      merged.push({ start: mark.start, end: mark.end });
    }
  }
  return merged;
}

// Where a reader's words are in a text, by one index's rules. The text returned is the text the
// marks are offsets into: the text given, composed first where the index composes.
//
// A word matched by its start is marked whole. The reader typed "ease" and the record says
// "easement"; the word that answered is the one on the page.
export function markWords(rules: WordRules, text: string, readerText: string): MatchedText {
  const read = rules.composes ? text.normalize("NFC") : text;
  const terms = questionTerms(rules, readerText);
  if (terms.length === 0) return { text: read, marks: [] };
  const found = findTerms(heldWords(rules, read), terms);
  return { text: read, marks: mergeTextMarks(found) };
}

const ASCII_CAPITAL = /[A-Z]/gu;

// Capitals lowered the way a name match compares them: the unaccented Latin letters and no others,
// one character for one, so an offset into the folded text is an offset into the text.
function asNameCompared(text: string): string {
  return text.replace(ASCII_CAPITAL, (capital) => capital.toLowerCase());
}

// Where a reader's text is in a name or a number that was matched as CHARACTERS: the whole of what
// they typed, wherever it falls, as a place that matches a file name or an invoice number compares
// it. Not words: "0142" is marked in the middle of "2026-0142-A".
export function markCharacters(text: string, readerText: string): readonly TextMark[] {
  const wanted = asNameCompared(readerText.trim());
  if (wanted === "") return [];
  const held = asNameCompared(text);
  const marks: TextMark[] = [];
  let from = 0;
  for (;;) {
    const at = held.indexOf(wanted, from);
    if (at === -1) break;
    marks.push({ start: at, end: at + wanted.length });
    from = at + wanted.length;
  }
  return marks;
}

// Moves a cut off the middle of a word, and off the middle of a character written as two units.
function settleForward(text: string, at: number, limit: number): number {
  let position = at;
  while (position < limit && !/\s/u.test(text[position - 1] ?? " ")) position += 1;
  return position;
}

function settleBackward(text: string, at: number, limit: number): number {
  let position = at;
  while (position > limit && !/\s/u.test(text[position] ?? " ")) position -= 1;
  return position;
}

function isLowSurrogate(unit: string | undefined): boolean {
  if (unit === undefined) return false;
  const code = unit.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

// The stretch of `text` where the reader's words are, by one index's rules, or null when none of
// them are in it (the text was cut short before the match, or the match was on something the text
// does not hold, a caller's name beside what was said).
export function excerptAtWords(rules: WordRules, text: string, readerText: string): string | null {
  const terms = questionTerms(rules, readerText);
  if (terms.length === 0) return null;
  // Composed, where the index composes before it cuts. The excerpt is cut from this text.
  const read = rules.composes ? text.normalize("NFC") : text;
  const found = findTerms(heldWords(rules, read), terms);
  if (found.length === 0) return null;

  // The stretch holding the most of the question's terms, and the first such stretch. A page that
  // has every word once in one sentence and one of them twenty times elsewhere is quoted at the
  // sentence.
  let best = found[0] as Found;
  let bestCount = 0;
  for (let anchor = 0; anchor < found.length && bestCount < terms.length; anchor += 1) {
    const from = found[anchor] as Found;
    const until = from.start - LEAD_CHARACTERS + EXCERPT_CHARACTERS;
    const present = new Set<number>();
    for (let next = anchor; next < found.length; next += 1) {
      const other = found[next] as Found;
      if (other.start >= until) break;
      present.add(other.term);
    }
    if (present.size > bestCount) {
      best = from;
      bestCount = present.size;
    }
  }

  let from = Math.max(0, best.start - LEAD_CHARACTERS);
  if (from > 0) from = settleForward(read, from, best.start);
  let to = Math.min(read.length, from + EXCERPT_CHARACTERS);
  if (to < read.length) {
    const settled = settleBackward(read, to, best.start);
    // A stretch with no space in it (a script written without them) is cut where it stands.
    to = settled > best.start ? settled : to;
    if (isLowSurrogate(read[to])) to -= 1;
  }
  const excerpt = oneLine(read.slice(from, to));
  if (excerpt === "") return null;
  return `${from > 0 ? "…" : ""}${excerpt}${to < read.length ? "…" : ""}`;
}

// The opening of a text too long to show whole, cut at a word.
function openingOf(text: string): string {
  let to = settleBackward(text, EXCERPT_CHARACTERS, 0);
  if (to === 0) to = EXCERPT_CHARACTERS;
  if (isLowSurrogate(text[to])) to -= 1;
  return `${oneLine(text.slice(0, to))}…`;
}

// What a result shows of a record's text, and where the reader's words are in it.
//
// A text short enough to show is shown as it is. A longer one is quoted at the stretch where the
// words are, so a match on the fortieth line of a note is on the screen instead of below the fold
// of a result that shows its first two lines. Where the words are not in the text at all, because
// the record matched on something beside it, the opening is shown and nothing is marked.
export function recordExcerpt(text: string, readerText: string): MatchedText {
  const shown =
    text.length <= EXCERPT_CHARACTERS
      ? text
      : (excerptAtWords(RECORD_WORD_RULES, text, readerText) ?? openingOf(text));
  return markWords(RECORD_WORD_RULES, shown, readerText);
}
