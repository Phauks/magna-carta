import { asIndexed, engineWordsOf } from "./keyword-query.ts";
import { parseRecordQuery } from "./record-index-query.ts";

// The sentence a file result quotes: the stretch of a passage where the reader's words are.
//
// The index has already said this passage answers the question. What it does not say is where in
// the passage, so the words are found again here, by the index's own rules: the passage is cut and
// folded exactly as the engine cut and folded it (keyword-query.ts holds both to the engine's
// table), and each term of the question is matched the way the question asked for it, a whole word,
// the start of a word, or a run of words in order. A match the index made is therefore a match
// found here, accents and capitals included.
//
// Plain text out. A result shows it as a line of the document, and nothing in it is markup.

// About two lines of a result. Long enough to read as a sentence, short enough to stay an excerpt.
const EXCERPT_CHARACTERS = 200;
// How much of that comes before the first word found, so the sentence is entered and not joined
// mid-clause at the match.
const LEAD_CHARACTERS = 60;

interface QuestionTerm {
  // The term's words as the index holds them, in order.
  readonly words: readonly string[];
  // Whether the last of them matches as the start of a word.
  readonly prefix: boolean;
}

function questionTerms(readerText: string): QuestionTerm[] {
  const terms: QuestionTerm[] = [];
  for (const term of parseRecordQuery(readerText)) {
    const words = term.tokens.flatMap((token) =>
      engineWordsOf(token).map(({ word }) => asIndexed(word)),
    );
    if (words.length > 0) terms.push({ words, prefix: term.prefix });
  }
  return terms;
}

interface PassageWord {
  readonly indexed: string;
  readonly start: number;
  readonly end: number;
}

function termMatchesAt(words: readonly PassageWord[], at: number, term: QuestionTerm): boolean {
  if (at + term.words.length > words.length) return false;
  return term.words.every((wanted, offset) => {
    const held = words[at + offset]?.indexed ?? "";
    const last = offset === term.words.length - 1;
    return last && term.prefix ? held.startsWith(wanted) : held === wanted;
  });
}

interface Found {
  readonly start: number;
  readonly term: number;
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

// The excerpt of `passageText` for the reader's text, or null when none of the reader's words are
// in it (the passage was cut short before the match, or it is another reading than the index's).
export function keywordExcerpt(passageText: string, readerText: string): string | null {
  const terms = questionTerms(readerText);
  if (terms.length === 0) return null;
  // Composed, as the engine composes before it cuts. The excerpt is cut from this text.
  const text = passageText.normalize("NFC");
  const words: PassageWord[] = engineWordsOf(text).map(({ word, start }) => ({
    indexed: asIndexed(word),
    start,
    end: start + word.length,
  }));

  const found: Found[] = [];
  for (let at = 0; at < words.length; at += 1) {
    const start = words[at]?.start ?? 0;
    terms.forEach((term, index) => {
      if (termMatchesAt(words, at, term)) found.push({ start, term: index });
    });
  }
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
  if (from > 0) from = settleForward(text, from, best.start);
  let to = Math.min(text.length, from + EXCERPT_CHARACTERS);
  if (to < text.length) {
    const settled = settleBackward(text, to, best.start);
    // A stretch with no space in it (a script written without them) is cut where it stands.
    to = settled > best.start ? settled : to;
    if (isLowSurrogate(text[to])) to -= 1;
  }
  const excerpt = text.slice(from, to).replace(/\s+/gu, " ").trim();
  if (excerpt === "") return null;
  return `${from > 0 ? "…" : ""}${excerpt}${to < text.length ? "…" : ""}`;
}
