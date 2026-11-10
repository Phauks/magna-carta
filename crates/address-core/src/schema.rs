//! The address index schema and the analyzers its fields are indexed with.
//!
//! Four indexed fields and the stored parts of the offer:
//!
//! - `number` — the house number, one lowercased token, matched exactly.
//! - `words` — the street, unit, city and postcode as words (simple tokenizer, lowercased, folded to
//!   ASCII so `PEÑA` and `pena` meet), document ids only.
//! - `prefixes` — every 2-to-12-character prefix of those same words, for the word still being typed.
//! - `region` — the state code, one lowercased token. Used only to bias toward the caller's state; never
//!   a filter.
//!
//! **No field norms anywhere.** Norms are a byte per document per field, loaded whole the first time a
//! query scores against the field — the measured first query spent most of its 35 MB reading them — and
//! the scoring here never uses document length.

use tantivy::schema::{
    Field, IndexRecordOption, NumericOptions, Schema, TextFieldIndexing, TextOptions, STORED,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RawTokenizer, SimpleTokenizer, TextAnalyzer,
    WhitespaceTokenizer,
};
use tantivy::Index;

use crate::error::AddressError;

/// Raw value, lowercased: the whole field is one token.
pub(crate) const EXACT_ANALYZER: &str = "address_exact";
/// Words: split on anything not a letter or digit, lowercased, folded to ASCII.
pub(crate) const WORD_ANALYZER: &str = "address_words";
/// Prefix tokens are produced from already-analysed words, so they need only splitting.
pub(crate) const PREFIX_ANALYZER: &str = "address_prefixes";

/// The generation an address partition's footer carries, and the only one this crate opens.
///
/// A partition is packaged in `search-core`'s split format, footer included, but it is not that
/// crate's schema: its fields and analyzers are the ones in this file. So it carries a generation of
/// its own. It used to borrow the document index's, which meant a change to how the body of a document
/// is cut into words would have made every address partition in the bucket unreadable until the next
/// monthly build. The value is the one those partitions were stamped with, so none of them moves.
/// Bump it on any change to the fields below or to how their text is cut.
pub const ADDRESS_INDEX_GENERATION: u32 = 1;

/// The shortest prefix indexed. One character would put every address under a few dozen terms.
pub const MINIMUM_PREFIX_CHARACTERS: usize = 2;
/// The longest prefix indexed. A typed word longer than this is matched by its first twelve characters.
pub const MAXIMUM_PREFIX_CHARACTERS: usize = 12;

pub(crate) fn word_analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build()
}

fn exact_analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(RawTokenizer::default())
        .filter(LowerCaser)
        .build()
}

fn prefix_analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(WhitespaceTokenizer::default()).build()
}

/// Register the three analyzers on an index. Needed wherever documents are added; registered on every
/// opened index as well so an index is never left holding a field whose analyzer it cannot name.
pub(crate) fn register_analyzers(index: &Index) {
    let tokenizers = index.tokenizers();
    tokenizers.register(EXACT_ANALYZER, exact_analyzer());
    tokenizers.register(WORD_ANALYZER, word_analyzer());
    tokenizers.register(PREFIX_ANALYZER, prefix_analyzer());
}

/// The schema and typed handles to its fields.
#[derive(Clone, Debug)]
pub struct AddressSchema {
    schema: Schema,
    pub(crate) number: Field,
    pub(crate) words: Field,
    pub(crate) prefixes: Field,
    pub(crate) region: Field,
    pub(crate) street: Field,
    pub(crate) unit: Field,
    pub(crate) city: Field,
    pub(crate) postcode: Field,
    pub(crate) longitude: Field,
    pub(crate) latitude: Field,
}

fn indexed(analyzer: &str) -> TextFieldIndexing {
    TextFieldIndexing::default()
        .set_tokenizer(analyzer)
        .set_index_option(IndexRecordOption::Basic)
        .set_fieldnorms(false)
}

impl AddressSchema {
    /// The one schema, built the same way every time.
    pub fn build() -> Self {
        let mut builder = Schema::builder();
        // Indexed and stored: the stored value keeps the source's case (`12A`), the indexed token is
        // lowercased by the analyzer.
        let number = builder.add_text_field(
            "number",
            TextOptions::default()
                .set_indexing_options(indexed(EXACT_ANALYZER))
                .set_stored(),
        );
        let words = builder.add_text_field(
            "words",
            TextOptions::default().set_indexing_options(indexed(WORD_ANALYZER)),
        );
        let prefixes = builder.add_text_field(
            "prefixes",
            TextOptions::default().set_indexing_options(indexed(PREFIX_ANALYZER)),
        );
        let region = builder.add_text_field(
            "region",
            TextOptions::default()
                .set_indexing_options(indexed(EXACT_ANALYZER))
                .set_stored(),
        );
        // Stored only: the offer's parts. Their words are already in `words`.
        let street = builder.add_text_field("street", STORED);
        let unit = builder.add_text_field("unit", STORED);
        let city = builder.add_text_field("city", STORED);
        let postcode = builder.add_text_field("postcode", STORED);
        let longitude = builder.add_f64_field("longitude", NumericOptions::default().set_stored());
        let latitude = builder.add_f64_field("latitude", NumericOptions::default().set_stored());
        Self {
            schema: builder.build(),
            number,
            words,
            prefixes,
            region,
            street,
            unit,
            city,
            postcode,
            longitude,
            latitude,
        }
    }

    /// Resolve the fields of an opened index by name, refusing an index that lacks any of them: a split
    /// that is not an address partition must fail to open rather than answer every query with nothing.
    pub fn from_schema(schema: &Schema) -> Result<Self, AddressError> {
        let field = |name: &'static str| {
            schema
                .get_field(name)
                .map_err(|_| AddressError::IncompatibleIndex("a required field is missing"))
        };
        Ok(Self {
            schema: schema.clone(),
            number: field("number")?,
            words: field("words")?,
            prefixes: field("prefixes")?,
            region: field("region")?,
            street: field("street")?,
            unit: field("unit")?,
            city: field("city")?,
            postcode: field("postcode")?,
            longitude: field("longitude")?,
            latitude: field("latitude")?,
        })
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }
}

impl Default for AddressSchema {
    fn default() -> Self {
        Self::build()
    }
}

/// Append every 2-to-12-character prefix of `word` to `output`, space-separated. `word` is one token the
/// word analyzer produced, so it is already lowercased and folded.
pub(crate) fn push_prefixes(word: &str, output: &mut String) {
    let mut end_positions = word
        .char_indices()
        .map(|(position, character)| position + character.len_utf8());
    for (count, end) in (1..).zip(&mut end_positions) {
        if count > MAXIMUM_PREFIX_CHARACTERS {
            break;
        }
        if count >= MINIMUM_PREFIX_CHARACTERS {
            if let Some(prefix) = word.get(..end) {
                if !output.is_empty() {
                    output.push(' ');
                }
                output.push_str(prefix);
            }
        }
    }
}

/// The tokens the word analyzer makes of `text`.
pub(crate) fn analyse_words(analyzer: &mut TextAnalyzer, text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut stream = analyzer.token_stream(text);
    while let Some(token) = stream.next() {
        tokens.push(token.text.clone());
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_run_from_two_to_twelve_characters() {
        let mut output = String::new();
        push_prefixes("lawson", &mut output);
        assert_eq!(output, "la law laws lawso lawson");
        let mut long = String::new();
        push_prefixes("abcdefghijklmnop", &mut long);
        assert_eq!(long.split(' ').count(), 11);
        assert!(long.ends_with("abcdefghijkl"));
        let mut short = String::new();
        push_prefixes("a", &mut short);
        assert!(short.is_empty());
    }

    #[test]
    fn the_word_analyzer_lowercases_folds_and_splits() {
        let mut analyzer = word_analyzer();
        assert_eq!(
            analyse_words(&mut analyzer, "CALLE PEÑA 12-B #4"),
            vec!["calle", "pena", "12", "b", "4"]
        );
    }

    #[test]
    fn no_indexed_field_carries_norms() {
        let schema = AddressSchema::build();
        for (_, entry) in schema.schema().fields() {
            assert!(
                !entry.has_fieldnorms(),
                "field {} must not store norms",
                entry.name()
            );
        }
    }

    #[test]
    fn a_foreign_schema_is_refused() {
        let mut builder = Schema::builder();
        builder.add_text_field("body", STORED);
        assert!(AddressSchema::from_schema(&builder.build()).is_err());
    }
}
