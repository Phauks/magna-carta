import { KEYWORD_LETTER_FOLDS } from "./keyword-letter-folds.ts";
import { parseRecordQuery } from "./record-index-query.ts";

// How a reader's text becomes a question for the keyword engine over the words inside files.
//
// THE READER'S TEXT IS NEVER QUERY SYNTAX, here as in the record index. The engine's query language
// has operators (AND, OR, a minus sign, a field prefix, a pattern between slashes), and a search box
// that passed text through would let a stray quotation mark turn a search into an error and let
// "trust OR estate" mean something its author did not type. So the text is taken apart by the same
// parser the record index uses, and the engine's query is rebuilt from the words alone. A search of a
// matter then means the same thing in a note and in a document:
//
//   - every word typed must appear in the passage;
//   - the last word matches as the start of a word, because a search box is read mid-word;
//   - words inside quotation marks, and a word with punctuation inside it, match as that exact run;
//   - case and accents do not matter.
//
// One difference from the record index follows from the engine and is stated instead of hidden. A
// PASSAGE is a page: every word must be on the same page of the document, not merely somewhere in it.
//
// WHO FOLDS WHAT. The engine composes, folds and lowercases a document's words as it indexes them,
// and does the same to a quoted word in a question, so a quoted word goes to it as the reader typed
// it. A pattern is the exception: the engine compares it with the index's words as they are held and
// does nothing to it first. So the one unfinished word is folded here, from the table the engine
// publishes about itself (keyword-letter-folds.ts), and a test holds the two together.
//
// The shapes written here are pinned against the engine itself by the tests named
// `the_query_text_the_application_builds_from_a_search_box_means_what_it_says` and
// `accents_do_not_matter_in_the_text_or_in_the_question` in crates/search-core/src/lib.rs, because
// the two sides are in different languages and nothing else compares them.

// The engine cuts text at every character that is not a letter or a digit, so an accent that arrives
// as a character of its own separates two words there. The record index's parser keeps such a mark
// inside the word; it is cut out again here. The parser has composed the text already, as the engine
// does, so a mark is only left where the letter and the accent have no composed form.
const ENGINE_WORD = /[\p{L}\p{N}]+/gu;

// A word that can stand as its own pattern: letters and digits have no meaning in one.
const LETTERS_AND_DIGITS = /^[\p{L}\p{N}]+$/u;

// The engine's one searchable field. A pattern has to name it; a quoted word does not.
const BODY_FIELD = "body";

// The engine drops a word longer than this when it indexes, so a longer one in a question can match
// nothing. Counted in bytes and after folding, as the engine counts it.
const LONGEST_INDEXED_WORD_BYTES = 40;

// Built on first use: a module that builds a table as it loads spends the Worker's startup budget
// on every request that never searches.
let foldedLetters: ReadonlyMap<string, string> | undefined;

function foldOf(letter: string): string | undefined {
  foldedLetters ??= new Map(
    KEYWORD_LETTER_FOLDS.flatMap(([word, letters]) =>
      Array.from(letters, (character) => [character, word] as const),
    ),
  );
  return foldedLetters.get(letter);
}

// A word as the index holds it: each letter folded where the engine folds it, lowercased otherwise.
// Letter by letter on purpose. The engine lowercases one character at a time, so a capital sigma is
// the same letter wherever it stands in a word, and lowercasing the whole word would not agree.
export function asIndexed(word: string): string {
  let indexed = "";
  for (const letter of word) indexed += foldOf(letter) ?? letter.toLowerCase();
  return indexed;
}

// Every word of a text as the engine cuts it, and where each starts. The text is taken as given: a
// caller that has not composed it yet composes it first, as the engine does.
export function engineWordsOf(text: string): { readonly word: string; readonly start: number }[] {
  return Array.from(text.matchAll(ENGINE_WORD), (match) => ({
    word: match[0],
    start: match.index,
  }));
}

function byteLength(word: string): number {
  return new TextEncoder().encode(word).length;
}

// The engine's query text for a reader's text, or null when the text holds nothing the engine could
// match. Null is "ask nothing", never "ask for everything".
export function keywordQueryText(readerText: string): string | null {
  const clauses: string[] = [];
  for (const term of parseRecordQuery(readerText)) {
    const words = term.tokens.flatMap((token) => token.match(ENGINE_WORD) ?? []);
    if (words.length === 0) continue;
    const indexed = words.map(asIndexed);
    // A word the index cannot hold is a term nothing satisfies, and every term is required.
    if (indexed.some((word) => byteLength(word) > LONGEST_INDEXED_WORD_BYTES)) return null;
    const [unfinished] = indexed;
    // Letters and digits only, so nothing inside the quotation marks can end them.
    const quoted = `+"${words.join(" ")}"`;
    if (!term.prefix) {
      clauses.push(quoted);
    } else if (words.length > 1) {
      clauses.push(`${quoted}*`);
    } else if (unfinished !== undefined && LETTERS_AND_DIGITS.test(unfinished)) {
      // One unfinished word. The engine's own prefix form needs two words, so this one is a pattern
      // over the index's words: the letters typed, as the index holds them, then anything.
      clauses.push(`+${BODY_FIELD}:/${unfinished}.*/`);
    } else {
      // A handful of digit signs fold to a digit with punctuation around it (a digit in
      // parentheses), which would mean something in a pattern. Such a word is asked for whole.
      clauses.push(quoted);
    }
  }
  return clauses.length === 0 ? null : clauses.join(" ");
}
