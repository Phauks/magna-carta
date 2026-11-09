//! Reading what a person typed, and turning it into an index query.
//!
//! The shape of a typed address is fixed enough to parse without a grammar: a house number first, then
//! words, the last of which is usually still being typed. So:
//!
//! - The first word must start with a digit. It is the house number and is matched exactly. Text that
//!   does not start with a number is not an address being typed, and gets no suggestions.
//! - Without a second word there is no query: a house number alone matches a whole country.
//! - Every word after the number but the last is complete, and matched exactly against `words`. A word
//!   typed in full that USPS abbreviates (`street`, `north`) also matches its abbreviation, and a
//!   two-letter state code also matches the region, so a pasted full address still finds itself.
//! - The last word is the one being typed and is matched against `prefixes`. A one-character last word
//!   is too short to be a prefix (the index holds two characters and up); it only lifts addresses that
//!   have it as a whole word, such as a directional.
//! - A `near` region is a bonus, never a filter: a person in Nevada may be entering a client in Texas.
//!
//! Every clause scores a constant. With no field norms and no term frequencies every match of the same
//! words would score the same anyway; constants make that explicit, and make scores from the four
//! partitions comparable, which raw BM25 would not be (its weights depend on each partition's own
//! statistics).

use tantivy::query::{BooleanQuery, ConstScoreQuery, Occur, Query, TermQuery};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::Term;

use crate::address::Building;
use crate::cleaning::{abbreviation, normalise, normalise_capped};
use crate::partition::is_region_code;
use crate::schema::{analyse_words, word_analyzer, AddressSchema, MAXIMUM_PREFIX_CHARACTERS};

/// The most characters of typed text the parser reads. An address is well under this; anything past it
/// is not typing, and reading it would only cost work.
pub const MAXIMUM_QUERY_CHARACTERS: usize = 200;
/// The most words after the house number the parser keeps, for the same reason.
pub const MAXIMUM_QUERY_WORDS: usize = 12;

/// What every required clause scores.
const REQUIRED_SCORE: f32 = 1.0;
/// The bonus for an address that has the last typed word as a whole word, so `100 main` puts
/// `MAIN ST` above `MAINSAIL DR`.
const WHOLE_WORD_BONUS: f32 = 1.0;
/// The bonus for an address in the caller's region. Larger than the whole-word bonus: a nearby match is
/// the likelier intent. Still only a bonus, so a match elsewhere is offered after the nearby ones.
const NEAR_BONUS: f32 = 2.0;

/// Typed text, read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedQuery {
    /// The house number, lowercased.
    pub number: String,
    /// The words after the number that are complete, as the index's word analyzer spells them.
    pub complete: Vec<String>,
    /// The last word, still being typed: at least two characters.
    pub typing: Option<String>,
    /// A one-character last word, used only as a bonus.
    pub trailing_letter: Option<String>,
}

/// Parse typed text. `None` means there is nothing to ask the index, and the answer is an empty list.
pub fn parse_query(text: &str) -> Option<ParsedQuery> {
    let capped: String = text.chars().take(MAXIMUM_QUERY_CHARACTERS).collect();
    let normalised = normalise_capped(&capped, MAXIMUM_QUERY_CHARACTERS);
    let (first, rest) = normalised.split_once(' ')?;
    if !first.starts_with(|character: char| character.is_ascii_digit()) {
        return None;
    }
    let mut words = analyse_words(&mut word_analyzer(), rest);
    words.truncate(MAXIMUM_QUERY_WORDS);
    let last = words.pop()?;
    let (typing, trailing_letter) = if last.chars().count() == 1 {
        (None, Some(last))
    } else {
        (Some(last), None)
    };
    if typing.is_none() && words.is_empty() {
        return None;
    }
    Some(ParsedQuery {
        number: first.to_lowercase(),
        complete: words,
        typing,
        trailing_letter,
    })
}

fn term(field: Field, text: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, text),
        IndexRecordOption::Basic,
    ))
}

fn constant(query: Box<dyn Query>, score: f32) -> Box<dyn Query> {
    Box::new(ConstScoreQuery::new(query, score))
}

fn any_of(mut alternatives: Vec<Box<dyn Query>>) -> Box<dyn Query> {
    if alternatives.len() == 1 {
        if let Some(only) = alternatives.pop() {
            return only;
        }
    }
    Box::new(BooleanQuery::union(alternatives))
}

/// The alternatives a whole word may match: itself, its USPS abbreviation, and the region when it is a
/// state code.
fn whole_word_alternatives(schema: &AddressSchema, word: &str) -> Vec<Box<dyn Query>> {
    let upper = word.to_uppercase();
    let mut alternatives = vec![term(schema.words, word)];
    if let Some(short) = abbreviation(&upper) {
        let short = short.to_lowercase();
        if short != word {
            alternatives.push(term(schema.words, &short));
        }
    }
    if is_region_code(&upper) {
        alternatives.push(term(schema.region, word));
    }
    alternatives
}

/// The query for a suggestion list. `near` is a region code in either case.
pub(crate) fn suggestion_query(
    schema: &AddressSchema,
    parsed: &ParsedQuery,
    near: Option<&str>,
) -> Box<dyn Query> {
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(
        Occur::Must,
        constant(term(schema.number, &parsed.number), REQUIRED_SCORE),
    )];
    for word in &parsed.complete {
        clauses.push((
            Occur::Must,
            constant(
                any_of(whole_word_alternatives(schema, word)),
                REQUIRED_SCORE,
            ),
        ));
    }
    if let Some(typing) = &parsed.typing {
        let prefix: String = typing.chars().take(MAXIMUM_PREFIX_CHARACTERS).collect();
        let mut alternatives = vec![term(schema.prefixes, &prefix)];
        // A word typed in full that is only ever indexed abbreviated (`street`) would otherwise match
        // nothing once the person finishes typing it.
        if let Some(short) = abbreviation(&typing.to_uppercase()) {
            alternatives.push(term(schema.words, &short.to_lowercase()));
        }
        if is_region_code(&typing.to_uppercase()) {
            alternatives.push(term(schema.region, typing));
        }
        clauses.push((Occur::Must, constant(any_of(alternatives), REQUIRED_SCORE)));
        clauses.push((
            Occur::Should,
            constant(term(schema.words, typing), WHOLE_WORD_BONUS),
        ));
    }
    if let Some(letter) = &parsed.trailing_letter {
        clauses.push((
            Occur::Should,
            constant(term(schema.words, letter), WHOLE_WORD_BONUS),
        ));
    }
    if let Some(near) = near {
        clauses.push((
            Occur::Should,
            constant(term(schema.region, &near.to_lowercase()), NEAR_BONUS),
        ));
    }
    Box::new(BooleanQuery::new(clauses))
}

/// The query for every row of one building: the number, every street word, the postcode (or the city
/// when there is no postcode), and the region, all exact. `None` when the building is too incomplete to
/// name one.
pub(crate) fn building_query(
    schema: &AddressSchema,
    building: &Building,
) -> Option<Box<dyn Query>> {
    let number = building.number.to_lowercase();
    if number.is_empty() {
        return None;
    }
    let mut analyzer = word_analyzer();
    let street = analyse_words(&mut analyzer, &building.street);
    if street.is_empty() {
        return None;
    }
    let place = if building.postcode.is_empty() {
        analyse_words(&mut analyzer, &building.city)
    } else {
        analyse_words(&mut analyzer, &building.postcode)
    };
    let mut clauses: Vec<(Occur, Box<dyn Query>)> =
        vec![(Occur::Must, term(schema.number, &number))];
    for word in street.iter().chain(place.iter()) {
        clauses.push((Occur::Must, term(schema.words, word)));
    }
    if !building.region.is_empty() {
        clauses.push((
            Occur::Must,
            term(schema.region, &building.region.to_lowercase()),
        ));
    }
    Some(Box::new(BooleanQuery::new(clauses)))
}

/// A building as a caller sent it, brought to the spelling the index stores, so `w center st` and
/// `W CENTER ST` name the same building.
pub(crate) fn normalise_building(building: &Building) -> Building {
    Building {
        number: normalise(&building.number),
        street: normalise(&building.street),
        city: normalise(&building.city),
        region: normalise(&building.region),
        postcode: normalise(&building.postcode),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(
        number: &str,
        complete: &[&str],
        typing: Option<&str>,
        letter: Option<&str>,
    ) -> ParsedQuery {
        ParsedQuery {
            number: number.to_owned(),
            complete: complete.iter().map(|word| (*word).to_owned()).collect(),
            typing: typing.map(str::to_owned),
            trailing_letter: letter.map(str::to_owned),
        }
    }

    #[test]
    fn a_number_and_a_partial_word_is_a_query() {
        assert_eq!(
            parse_query("1402 lawson cr"),
            Some(parsed("1402", &["lawson"], Some("cr"), None))
        );
        assert_eq!(
            parse_query("1402 la"),
            Some(parsed("1402", &[], Some("la"), None))
        );
    }

    #[test]
    fn text_that_does_not_start_with_a_number_is_not_a_query() {
        assert_eq!(parse_query("lawson creek 1402"), None);
        assert_eq!(parse_query("#12 main"), None);
        assert_eq!(parse_query(""), None);
        assert_eq!(parse_query("   "), None);
    }

    #[test]
    fn a_single_word_is_not_a_query() {
        assert_eq!(parse_query("1402"), None);
        assert_eq!(parse_query("1402 "), None);
        assert_eq!(parse_query("1402 ,"), None);
    }

    #[test]
    fn a_trailing_space_changes_nothing() {
        assert_eq!(parse_query("1402 lawson "), parse_query("1402 lawson"));
    }

    #[test]
    fn a_one_letter_last_word_is_only_a_bonus() {
        assert_eq!(parse_query("1402 m"), None);
        assert_eq!(
            parse_query("1402 main s"),
            Some(parsed("1402", &["main"], None, Some("s")))
        );
    }

    #[test]
    fn punctuation_case_and_accents_are_read_the_way_the_index_spells_them() {
        assert_eq!(
            parse_query("12-B Calle Peña, San Juan"),
            Some(parsed(
                "12-b",
                &["calle", "pena", "san"],
                Some("juan"),
                None
            ))
        );
    }

    #[test]
    fn very_long_input_is_capped_in_characters_and_words() {
        let long = format!("12 {}", "main ".repeat(1000));
        let query = parse_query(&long).expect("still a query");
        assert!(query.complete.len() < MAXIMUM_QUERY_WORDS);
        let words = format!(
            "12 {}",
            (0..50)
                .map(|n| format!("w{n}"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let query = parse_query(&words).expect("still a query");
        assert_eq!(query.complete.len() + 1, MAXIMUM_QUERY_WORDS);
        let one_huge_word = format!("12 {}", "x".repeat(10_000));
        let query = parse_query(&one_huge_word).expect("still a query");
        assert!(query.typing.expect("typing").chars().count() < MAXIMUM_QUERY_CHARACTERS);
    }
}
