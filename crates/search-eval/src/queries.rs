//! The query classes the benchmark times, and what each one is for.
//!
//! One "search latency" number is not a useful answer, because the engine's cost is dominated by how
//! many documents a query matches and by whether it has to read positions as well as postings. These
//! classes span that range deliberately, from a query that matches almost the whole corpus to one that
//! matches a single passage, so the report can show where in that range a real review query would land
//! rather than quoting a single figure whose selectivity nobody knows.

use crate::corpus;

/// One class: what to ask the engine, and the one-line meaning the report prints beside its numbers so a
/// reader who did not write this file knows what the figure describes.
pub struct QueryClass {
    pub name: &'static str,
    pub text: String,
    pub meaning: &'static str,
}

pub fn classes() -> Vec<QueryClass> {
    vec![
        QueryClass {
            name: "unique-term",
            text: corpus::UNIQUE_TERM.to_owned(),
            meaning: "one passage in the whole corpus matches; the floor of per-query cost",
        },
        QueryClass {
            name: "rare-term",
            text: corpus::RARE_TERM.to_owned(),
            meaning: "a handful of documents match; the band the split model is designed for",
        },
        QueryClass {
            name: "mid-term",
            text: corpus::MID_TERM.to_owned(),
            meaning: "roughly a tenth of documents match; an ordinary review query",
        },
        QueryClass {
            name: "common-term",
            text: corpus::COMMON_TERM.to_owned(),
            meaning: "almost every document matches; the ranking collector's worst case",
        },
        QueryClass {
            name: "two-term-boolean",
            text: format!("{} AND {}", corpus::MID_TERM, corpus::SECOND_MID_TERM),
            meaning: "two mid-band postings lists intersected",
        },
        QueryClass {
            name: "phrase",
            text: format!(
                "\"{} {}\"",
                corpus::PHRASE_FIRST_WORD,
                corpus::PHRASE_SECOND_WORD
            ),
            meaning: "an exact adjacent pair; reads term positions, not just postings",
        },
    ]
}

/// How many ranked hits a query asks for. A review queue shows a page at a time, and the top-k collector's
/// work grows with k, so the limit is a parameter of the measurement rather than an incidental constant.
pub const RESULT_LIMIT: usize = 20;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_class_is_named_and_explained() {
        let classes = classes();
        assert!(classes.len() >= 5);
        for class in &classes {
            assert!(!class.name.is_empty());
            assert!(!class.text.is_empty());
            assert!(
                !class.meaning.is_empty(),
                "{} has no stated meaning",
                class.name
            );
        }
    }

    #[test]
    fn class_names_are_unique() {
        let classes = classes();
        let names: std::collections::BTreeSet<&str> =
            classes.iter().map(|class| class.name).collect();
        assert_eq!(names.len(), classes.len());
    }
}
