import { FILE_WORD_RULES, excerptAtWords } from "./matched-text.ts";

// The sentence a file result quotes: the stretch of a passage where the reader's words are.
//
// The index has already said this passage answers the question. What it does not say is where in
// the passage, so the words are found again, by the index's own rules: the passage is cut and
// folded exactly as the engine cut and folded it (keyword-query.ts holds both to the engine's
// table), and each term of the question is matched the way the question asked for it. A match the
// index made is therefore a match found here, accents and capitals included. The finding and the
// cutting are matched-text.ts's, shared with the record index's results; what is here is the
// choice of rules.
//
// Plain text out. A result shows it as a line of the document, and nothing in it is markup.

// The excerpt of `passageText` for the reader's text, or null when none of the reader's words are
// in it (the passage was cut short before the match, or it is another reading than the index's).
export function keywordExcerpt(passageText: string, readerText: string): string | null {
  return excerptAtWords(FILE_WORD_RULES, passageText, readerText);
}
