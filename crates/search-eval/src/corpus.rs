//! The synthetic discovery corpus the benchmark measures against.
//!
//! Two properties make a corpus usable as a benchmark input, and this module exists to guarantee both.
//!
//! **Deterministic.** The same seed produces byte-identical passages, so two runs on one machine differ
//! only by the machine's own noise and a baseline comparison means something. Randomness comes from one
//! small seeded generator in this file and nowhere else — the same discipline the TypeScript fixtures
//! harness applies to generated rows (`packages/fixtures/CLAUDE.md`).
//!
//! **Realistically skewed.** BM25 weights a term by its rarity and the top-k collector's work depends on
//! how many documents match, so a corpus of uniformly-random words would make every query cost the same
//! and measure nothing. Terms here are laid down in explicit frequency bands — a term that is in almost
//! every document, one in roughly a tenth, one in a handful, and one in exactly one — so the query
//! classes in `queries.rs` have *known* selectivity and the report can say what each number was measured
//! over instead of hoping the corpus was interesting.

use search_core::IndexDocument;

/// A small seeded generator (xorshift64*), written out here rather than taken as a dependency so the
/// corpus's determinism is readable in one place and cannot change under a version bump.
pub struct Generator {
    state: u64,
}

impl Generator {
    pub fn new(seed: u64) -> Self {
        // A zero state is a fixed point for xorshift, so it is never allowed.
        Self {
            state: if seed == 0 {
                0x9E37_79B9_7F4A_7C15
            } else {
                seed
            },
        }
    }

    fn next_u64(&mut self) -> u64 {
        let mut value = self.state;
        value ^= value >> 12;
        value ^= value << 25;
        value ^= value >> 27;
        self.state = value;
        value.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// A value in `0..bound`. `bound` of zero yields zero rather than dividing by it.
    fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            return 0;
        }
        (self.next_u64() % bound as u64) as usize
    }

    /// True with probability `numerator / denominator`, evaluated in integers so the draw is exactly
    /// reproducible rather than depending on floating-point rounding.
    fn chance(&mut self, numerator: u32, denominator: u32) -> bool {
        self.below(denominator as usize) < numerator as usize
    }
}

/// Ordinary connective and boilerplate words, drawn uniformly to give every passage a body. They carry
/// no selectivity signal of their own — they are what the frequency-band terms below are diluted into.
const FILLER: &[&str] = &[
    "the",
    "of",
    "and",
    "to",
    "in",
    "for",
    "with",
    "any",
    "such",
    "by",
    "on",
    "that",
    "or",
    "as",
    "which",
    "from",
    "under",
    "between",
    "made",
    "date",
    "hereby",
    "further",
    "provided",
    "executed",
    "delivered",
    "written",
    "above",
    "attached",
    "referenced",
    "foregoing",
];

/// In almost every document. A query for one of these matches nearly the whole corpus, which is the
/// collector's worst case: the term is cheap to look up and expensive to rank.
pub const COMMON_TERM: &str = "agreement";

/// In roughly a tenth of documents — an ordinary review query, selective enough to prune but broad
/// enough that the postings list is long.
pub const MID_TERM: &str = "indemnify";

/// A second mid-band term, laid down independently of `MID_TERM`, so a two-term boolean query has a
/// meaningfully smaller result set than either term alone.
pub const SECOND_MID_TERM: &str = "warranty";

/// In a handful of documents. The band the split model is built for: a short postings list and a small
/// ranged read regardless of how large the corpus around it grew.
pub const RARE_TERM: &str = "subrogation";

/// In exactly one document, always. The floor of per-query cost — whatever this query costs is what the
/// engine spends before it has ranked anything at all.
pub const UNIQUE_TERM: &str = "zzzsingletonmarker";

/// An exact two-word sequence laid down adjacently in a fraction of documents, so a phrase query has
/// something to match. Phrase matching reads positions as well as postings, which is why it is measured
/// as its own class rather than assumed to cost the same as a two-term boolean.
pub const PHRASE_FIRST_WORD: &str = "prior";
pub const PHRASE_SECOND_WORD: &str = "owner";

/// How often each band's term is laid into a document, as an exact `numerator / denominator` draw.
/// These are the corpus's parameters — the report prints the resulting hit counts beside every latency,
/// so a reader never has to trust these numbers, only read what they produced.
const COMMON_IN: (u32, u32) = (95, 100);
const MID_IN: (u32, u32) = (10, 100);
const SECOND_MID_IN: (u32, u32) = (8, 100);
const RARE_IN: (u32, u32) = (1, 500);
const PHRASE_IN: (u32, u32) = (5, 100);

/// The shape of one corpus: how many documents, and how each document is chunked into the passages that
/// are the actual unit of the index. A passage rather than a document is what gets indexed and what a hit
/// points at (`packages/search/src/port.ts`), so passage count — not document count — is what the engine
/// sees, and the report prints both.
#[derive(Clone, Copy, Debug)]
pub struct CorpusSpec {
    pub documents: usize,
    pub passages_per_document: usize,
    pub words_per_passage: usize,
}

impl CorpusSpec {
    pub fn passages(&self) -> usize {
        self.documents * self.passages_per_document
    }
}

/// Build one document's passages. Band terms are drawn per DOCUMENT and then placed in one of its
/// passages, because that is how a real document behaves: a term that appears in a contract appears
/// somewhere in the contract, not independently in each of its pages. Drawing per passage instead would
/// multiply every band's true document frequency by the passage count and quietly destroy the
/// selectivity the bands exist to create.
fn build_document(
    generator: &mut Generator,
    document_index: usize,
    spec: &CorpusSpec,
    force_unique_term: bool,
) -> Vec<IndexDocument> {
    let document_id = format!("file_{document_index:08}");

    // Decide this document's band membership once, then choose which passage carries each term.
    let mut planted: Vec<(usize, String)> = Vec::new();
    let passage_count = spec.passages_per_document.max(1);
    let mut plant = |generator: &mut Generator, text: String| {
        let passage = generator.below(passage_count);
        planted.push((passage, text));
    };

    if generator.chance(COMMON_IN.0, COMMON_IN.1) {
        plant(generator, COMMON_TERM.to_owned());
    }
    if generator.chance(MID_IN.0, MID_IN.1) {
        plant(generator, MID_TERM.to_owned());
    }
    if generator.chance(SECOND_MID_IN.0, SECOND_MID_IN.1) {
        plant(generator, SECOND_MID_TERM.to_owned());
    }
    if generator.chance(RARE_IN.0, RARE_IN.1) {
        plant(generator, RARE_TERM.to_owned());
    }
    if generator.chance(PHRASE_IN.0, PHRASE_IN.1) {
        plant(
            generator,
            format!("{PHRASE_FIRST_WORD} {PHRASE_SECOND_WORD}"),
        );
    }
    if force_unique_term {
        plant(generator, UNIQUE_TERM.to_owned());
    }

    (0..passage_count)
        .map(|passage_index| {
            let mut words: Vec<String> = Vec::with_capacity(spec.words_per_passage);
            for (target_passage, text) in &planted {
                if *target_passage == passage_index {
                    words.push(text.clone());
                }
            }
            while words.len() < spec.words_per_passage {
                words.push(FILLER[generator.below(FILLER.len())].to_owned());
            }
            IndexDocument {
                document_id: document_id.clone(),
                chunk_id: format!("{document_id}:p{passage_index}"),
                body: words.join(" "),
            }
        })
        .collect()
}

/// Generate the whole corpus as a flat passage list, in document order.
///
/// Exactly one document is given [`UNIQUE_TERM`], and it is deliberately placed in the LAST document
/// rather than the first: an engine that happened to favour early documents would flatter a
/// first-document needle, and the last position is the one a sequential scan reaches most slowly.
pub fn generate(spec: &CorpusSpec, seed: u64) -> Vec<IndexDocument> {
    let mut generator = Generator::new(seed);
    let mut passages = Vec::with_capacity(spec.passages());
    for document_index in 0..spec.documents {
        let is_last = document_index + 1 == spec.documents;
        passages.extend(build_document(
            &mut generator,
            document_index,
            spec,
            is_last,
        ));
    }
    passages
}

/// Split a flat passage list into per-document batches — the shape the indexing pipeline publishes
/// today, where a split's object key is derived from one document version
/// (`packages/search/src/split.ts`), so a corpus of N document versions is N splits.
pub fn by_document(passages: &[IndexDocument]) -> Vec<Vec<IndexDocument>> {
    let mut batches: Vec<Vec<IndexDocument>> = Vec::new();
    for passage in passages {
        match batches.last_mut() {
            Some(batch)
                if batch
                    .first()
                    .is_some_and(|first| first.document_id == passage.document_id) =>
            {
                batch.push(passage.clone());
            }
            _ => batches.push(vec![passage.clone()]),
        }
    }
    batches
}

#[cfg(test)]
mod tests {
    use super::*;

    const SMALL: CorpusSpec = CorpusSpec {
        documents: 400,
        passages_per_document: 4,
        words_per_passage: 30,
    };

    #[test]
    fn the_same_seed_produces_the_same_corpus() {
        let first = generate(&SMALL, 42);
        let second = generate(&SMALL, 42);
        assert_eq!(first.len(), second.len());
        for (left, right) in first.iter().zip(second.iter()) {
            assert_eq!(left.document_id, right.document_id);
            assert_eq!(left.chunk_id, right.chunk_id);
            assert_eq!(left.body, right.body);
        }
    }

    #[test]
    fn a_different_seed_produces_a_different_corpus() {
        let first = generate(&SMALL, 42);
        let second = generate(&SMALL, 43);
        assert!(first
            .iter()
            .zip(second.iter())
            .any(|(l, r)| l.body != r.body));
    }

    #[test]
    fn the_unique_term_is_in_exactly_one_document() {
        let passages = generate(&SMALL, 42);
        let carrying: std::collections::BTreeSet<&str> = passages
            .iter()
            .filter(|passage| passage.body.contains(UNIQUE_TERM))
            .map(|passage| passage.document_id.as_str())
            .collect();
        assert_eq!(carrying.len(), 1, "expected one document, got {carrying:?}");
    }

    #[test]
    fn the_frequency_bands_are_ordered_as_designed() {
        // The bands only do their job if they come out in the intended order: common covers most of the
        // corpus, mid a slice of it, rare a handful, unique exactly one. This asserts the ORDER rather
        // than exact counts, so tuning a band's parameters does not break the test while a band that
        // collapsed into another one does.
        let passages = generate(&SMALL, 42);
        let documents_containing = |term: &str| -> usize {
            passages
                .iter()
                .filter(|passage| passage.body.contains(term))
                .map(|passage| passage.document_id.as_str())
                .collect::<std::collections::BTreeSet<&str>>()
                .len()
        };
        let common = documents_containing(COMMON_TERM);
        let mid = documents_containing(MID_TERM);
        let rare = documents_containing(RARE_TERM);
        assert!(
            common > mid && mid > rare && rare >= 1,
            "bands out of order: common {common}, mid {mid}, rare {rare}"
        );
        assert!(
            common > SMALL.documents / 2,
            "the common band must cover most of the corpus, got {common} of {}",
            SMALL.documents
        );
    }

    #[test]
    fn splitting_by_document_preserves_every_passage() {
        let passages = generate(&SMALL, 42);
        let batches = by_document(&passages);
        assert_eq!(batches.len(), SMALL.documents);
        assert_eq!(
            batches.iter().map(Vec::len).sum::<usize>(),
            SMALL.passages()
        );
        for batch in &batches {
            let first = &batch[0].document_id;
            assert!(batch.iter().all(|passage| &passage.document_id == first));
        }
    }
}
