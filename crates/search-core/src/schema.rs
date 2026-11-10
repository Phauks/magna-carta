//! The discovery keyword-index schema.
//!
//! One schema, versioned, shared by every split so a query can open splits built at different times
//! as one index. The fields are deliberately minimal: the index carries the *searchable* text and the
//! identifiers needed to hydrate a hit back through the data-access layer — never the document's full
//! content, which lives in R2 (the "bulk content to R2, never the index" rule the design follows).

use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, INDEXED, STORED, STRING,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RemoveLongFilter, SimpleTokenizer, TextAnalyzer, Tokenizer,
};
use tantivy::Index;
use unicode_normalization::{is_nfc_quick, IsNormalized, UnicodeNormalization};

/// The schema generation. A split records the generation it was built with; a query refuses to open a
/// split whose generation it does not understand, so a schema change never silently mixes incompatible
/// splits (the "index generation gates schema changes" rule in the design). Bump on any field change,
/// and on any change to how a field's text is cut into words: two splits whose words were cut
/// differently answer the same question differently, which is exactly the mixing this gates.
///
/// Generation 2 folds accents in the body (see [`BODY_TOKENIZER`]). Generation 1 lowercased only.
pub const SCHEMA_GENERATION: u32 = 2;

/// The name the body field's analyzer is registered under.
///
/// The index records this NAME, not the analyzer, so every index this crate creates or opens has to
/// have the analyzer registered under it before anything is written or asked: see
/// [`register_tokenizers`]. An index opened without it cannot parse a question at all, which is the
/// loud failure; the quiet one would be registering a different analyzer under the same name.
pub const BODY_TOKENIZER: &str = "folded_words";

/// The longest word, in bytes, the body keeps. A longer run is not a word anybody searches for (a
/// base64 block, a hash), and dropping it keeps the term dictionary from filling with them. Counted
/// AFTER folding, so the limit is the same for a word however it was accented, and the application
/// can apply the same limit to a question (packages/search/src/keyword-query.ts).
pub const LONGEST_BODY_WORD_BYTES: usize = 40;

/// Cuts text into words at every character that is not a letter or a digit, after composing it.
///
/// An accented letter can arrive as two characters, the letter and then its accent, and text taken
/// out of a PDF very often does. The accent is not a letter, so cutting first would turn "Peña" into
/// "pen" and "a" and no spelling of the name would find it. Composing first makes the pair the one
/// letter it is wherever a composed form exists; a pair with none is still cut at the accent, in a
/// document and in a question alike.
///
/// A word's offsets are into the composed text. Nothing reads them: the body is not stored, and a
/// passage is re-read from the document for display.
#[derive(Clone, Default)]
struct ComposedWords {
    composed: String,
    words: SimpleTokenizer,
}

impl Tokenizer for ComposedWords {
    type TokenStream<'a> = <SimpleTokenizer as Tokenizer>::TokenStream<'a>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        // Almost all text is composed already, and the check is a table lookup per character.
        if text.is_ascii() || is_nfc_quick(text.chars()) == IsNormalized::Yes {
            return self.words.token_stream(text);
        }
        self.composed.clear();
        self.composed.extend(text.nfc());
        self.words.token_stream(&self.composed)
    }
}

/// How the body's text becomes words: composed and cut by [`ComposedWords`], Latin letters folded to
/// their unaccented form, then lowercased, so "pena" finds "Peña" and "resume" finds "résumé" the
/// way they already do in the firm's record index. A letter with no unaccented Latin form (any other
/// script) is only lowercased.
///
/// FOLDED BEFORE LOWERCASED, and the order is not a matter of taste. The folding table gives a few
/// lowercase letters a capital (a small-capital letter, a g with a caron), so lowercasing first would
/// leave capitals in the index that no question could ever spell.
///
/// What this does to each letter is written out in `tests/fixtures/body-letter-folds.tsv`, which the
/// application's query builder is held to (packages/search/src/keyword-query.ts): a pattern is
/// compared with the words as the index holds them, so the application has to compose and fold an
/// unfinished word itself, the same way.
fn body_analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(ComposedWords::default())
        .filter(AsciiFoldingFilter)
        .filter(LowerCaser)
        // The filter keeps a word strictly shorter than its limit, so the limit is one past the
        // longest word kept.
        .filter(RemoveLongFilter::limit(LONGEST_BODY_WORD_BYTES + 1))
        .build()
}

/// Register the analyzers this schema names on an index. Called on EVERY index the crate creates or
/// opens, building, querying and merging alike, and returns the index so a call site reads as one
/// expression.
pub fn register_tokenizers(index: Index) -> Index {
    index.tokenizers().register(BODY_TOKENIZER, body_analyzer());
    index
}

/// The resolved schema plus typed handles to its fields, so call sites never look fields up by string.
#[derive(Clone)]
pub struct SearchSchema {
    schema: Schema,
    document_id: Field,
    chunk_id: Field,
    body: Field,
}

impl SearchSchema {
    /// Build the one canonical schema. Deterministic — the same field order every time, so two splits
    /// built independently share a byte-comparable schema.
    pub fn build() -> Self {
        let mut builder = Schema::builder();
        // The document this text came from — stored so a hit can name it, and a string (untokenized)
        // so an exact-id lookup or a delete-by-id matches the whole identifier, not a token of it.
        let document_id = builder.add_text_field("document_id", STRING | STORED);
        // The passage/page within the document (the semantic half chunks the same way). Stored so a hit
        // points at the exact passage, not just the document.
        let chunk_id = builder.add_text_field("chunk_id", STRING | STORED);
        // The searchable text: cut into words by the body's own analyzer, and positional (positions are
        // what phrase and proximity queries need). Not stored: the passage text is re-read from R2 for
        // display, so storing it in the index too would duplicate the doc-store for no query benefit.
        let body = builder.add_text_field(
            "body",
            TextOptions::default().set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer(BODY_TOKENIZER)
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            ),
        );
        // `INDEXED` is referenced so the import is used even before more field types land; kept explicit
        // to document that every searchable field must opt into indexing.
        let _ = INDEXED;
        let schema = builder.build();
        Self {
            schema,
            document_id,
            chunk_id,
            body,
        }
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn document_id(&self) -> Field {
        self.document_id
    }

    pub fn chunk_id(&self) -> Field {
        self.chunk_id
    }

    pub fn body(&self) -> Field {
        self.body
    }
}

impl Default for SearchSchema {
    fn default() -> Self {
        Self::build()
    }
}

#[cfg(test)]
mod tests {
    use std::fmt::Write as _;

    use tantivy::tokenizer::TokenStream;
    use unicode_normalization::is_nfc;

    use super::body_analyzer;

    /// The committed table, and where a run that is asked to rewrite it puts the new one.
    const LETTER_FOLDS: &str = include_str!("../tests/fixtures/body-letter-folds.tsv");
    const LETTER_FOLDS_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/body-letter-folds.tsv"
    );

    const LETTER_FOLDS_HEADER: &str = "\
# What the body analyzer does to a letter or digit beyond lowercasing it: the character's code point,
# a tab, the word it becomes. Every letter and digit that is not listed is only lowercased. A character
# that composing the text replaces with another is not listed, because it never reaches this step.
# Rendered by the test beside the analyzer (crates/search-core/src/schema.rs); never edited by hand.
# packages/search/src/keyword-letter-folds.ts is rendered from this file.
";

    fn words(text: &str) -> Vec<String> {
        let mut analyzer = body_analyzer();
        let mut stream = analyzer.token_stream(text);
        let mut words = Vec::new();
        while stream.advance() {
            words.push(stream.token().text.clone());
        }
        words
    }

    fn rendered_letter_folds() -> String {
        let mut rendered = String::from(LETTER_FOLDS_HEADER);
        for character in ('\u{80}'..=char::MAX).filter(|character| character.is_alphanumeric()) {
            // Composing replaces this character with another (an angstrom sign with the letter it
            // is), so the analyzer's later steps, and the application's table, only see that one.
            if !is_nfc(&character.to_string()) {
                continue;
            }
            let analyzed = words(&character.to_string());
            assert_eq!(
                analyzed.len(),
                1,
                "U+{:04X} is a letter or digit and did not come out as one word",
                u32::from(character)
            );
            let lowercased: String = character.to_lowercase().collect();
            if analyzed[0] != lowercased {
                writeln!(rendered, "{:04x}\t{}", u32::from(character), analyzed[0]).unwrap();
            }
        }
        rendered
    }

    #[test]
    fn the_letter_fold_table_is_what_the_body_analyzer_does() {
        // The application folds an unfinished word itself, from a table rendered from this file, so
        // the file has to be the analyzer's behaviour and nothing else. A change here (a new engine
        // version with a different table, a different filter order) is a change to what every index
        // holds: it comes with a schema generation bump, and with the application's table re-rendered
        // (`node packages/search/scripts/render-keyword-letter-folds.mts`).
        let rendered = rendered_letter_folds();
        if std::env::var_os("SEARCH_CORE_WRITE_FIXTURES").is_some() {
            std::fs::write(LETTER_FOLDS_PATH, &rendered).unwrap();
            return;
        }
        assert!(
            rendered == LETTER_FOLDS,
            "tests/fixtures/body-letter-folds.tsv is not what the body analyzer does. If the change \
             is meant, re-render it with SEARCH_CORE_WRITE_FIXTURES=1, bump SCHEMA_GENERATION, and \
             re-render the application's table."
        );
    }

    #[test]
    fn a_word_is_folded_and_then_lowercased() {
        assert_eq!(words("Peña RÉSUMÉ Straße"), ["pena", "resume", "strasse"]);
        // Letters the folding table gives a capital still reach the index in lowercase.
        assert_eq!(words("\u{01E7}\u{1D00}"), ["ga"]);
        // A capital I with a dot is one plain letter, not an i and a mark that would cut the word.
        assert_eq!(words("\u{0130}stanbul"), ["istanbul"]);
        // A letter and its accent as two characters are the one letter, where a composed form exists.
        assert_eq!(
            words("Pen\u{0303}a re\u{0301}sume\u{0301}"),
            ["pena", "resume"]
        );
        // Where none exists the word is cut at the accent.
        assert_eq!(words("x\u{0303}y"), ["x", "y"]);
        // Another script is lowercased and otherwise left alone.
        assert_eq!(words("ΟΔΟΣ Ёж"), ["οδοσ", "ёж"]);
    }
}
