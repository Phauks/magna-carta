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
//   - words inside quotation marks, and a word with punctuation inside it, match as that exact run.
//
// Two differences from the record index follow from the engine and are stated instead of hidden.
// ACCENTS MATTER: the engine lowercases a word and leaves its accents, so "pena" does not find "Peña"
// inside a file. And a PASSAGE is a page: every word must be on the same page of the document, not
// merely somewhere in it.
//
// The shapes written here are pinned against the engine itself by the test named
// `the_query_text_the_application_builds_from_a_search_box_means_what_it_says` in
// crates/search-core/src/lib.rs, because the two sides are in different languages and nothing else
// compares them.

// The engine cuts text at every character that is not a letter or a digit, so an accent that arrives
// as a character of its own separates two words there. The record index's parser keeps such a mark
// inside the word; it is cut out again here.
const ENGINE_WORD = /[\p{L}\p{N}]+/gu;

// The engine's one searchable field. A pattern has to name it; a quoted word does not.
const BODY_FIELD = "body";

// The engine drops a word longer than this when it indexes, so a longer one in a question can match
// nothing. Counted in bytes, as the engine counts it.
const LONGEST_INDEXED_WORD_BYTES = 40;

function engineWords(tokens: readonly string[]): string[] {
  // Lowercased here because a pattern is compared with the words as the index holds them, which is
  // lowercased. A quoted word is lowercased by the engine either way.
  return tokens.flatMap((token) => token.toLowerCase().match(ENGINE_WORD) ?? []);
}

function byteLength(word: string): number {
  return new TextEncoder().encode(word).length;
}

// The engine's query text for a reader's text, or null when the text holds nothing the engine could
// match. Null is "ask nothing", never "ask for everything".
export function keywordQueryText(readerText: string): string | null {
  const clauses: string[] = [];
  for (const term of parseRecordQuery(readerText)) {
    const words = engineWords(term.tokens);
    if (words.length === 0) continue;
    // A word the index cannot hold is a term nothing satisfies, and every term is required.
    if (words.some((word) => byteLength(word) > LONGEST_INDEXED_WORD_BYTES)) return null;
    const [onlyWord] = words;
    if (!term.prefix) {
      // Letters and digits only, so nothing inside the quotation marks can end them.
      clauses.push(`+"${words.join(" ")}"`);
    } else if (words.length === 1 && onlyWord !== undefined) {
      // One unfinished word. The engine's own prefix form needs two words, so this one is a pattern
      // over the index's words: the letters typed, then anything. Letters and digits have no meaning
      // in a pattern, so the word is its own pattern.
      clauses.push(`+${BODY_FIELD}:/${onlyWord}.*/`);
    } else {
      clauses.push(`+"${words.join(" ")}"*`);
    }
  }
  return clauses.length === 0 ? null : clauses.join(" ");
}
