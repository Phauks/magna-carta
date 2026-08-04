//! `search-core` — the discovery keyword index, engine-side and port-free.
//!
//! This crate is to search what `pdf-core` is to documents: a pure-Rust core that knows Tantivy and
//! bytes and nothing about firms, R2, or Cloudflare. It builds an index from extracted passages,
//! packages it as a self-contained [`split`] that can live in per-firm R2, and queries splits back into
//! ranked hits. The firm/catalog/isolation logic wraps this crate in the search Worker's Container; the
//! crate stays unit-testable without any of that.
//!
//! What is proven here (the first buildable slice of the search-index design): the split *format* and
//! the build -> split -> query round trip. What is deliberately deferred to the next slice: the
//! directory that serves Tantivy's reads as HTTP ranged reads against a split in R2 (so a query fetches
//! only the postings it walks), and the footer's per-field pruning digest. Both extend this format
//! without changing it — see [`split`] for exactly where they hook in.

mod directory;
mod error;
mod query;
mod schema;
mod split;

pub use directory::{open_index, read_footer_ranged, RangeReader, SplitDirectory};
pub use error::SearchError;
pub use query::{query_over_reader, query_split, query_splits, Hit};
pub use schema::{SearchSchema, SCHEMA_GENERATION};
pub use split::{build_split, read_footer, FileEntry, Footer, IndexDocument};

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(document_id: &str, chunk_id: &str, body: &str) -> IndexDocument {
        IndexDocument {
            document_id: document_id.to_owned(),
            chunk_id: chunk_id.to_owned(),
            body: body.to_owned(),
        }
    }

    fn corpus() -> Vec<IndexDocument> {
        vec![
            doc(
                "doc-1",
                "doc-1:p1",
                "The seller shall indemnify the buyer against all claims.",
            ),
            doc(
                "doc-2",
                "doc-2:p1",
                "Environmental liability remains with the prior owner.",
            ),
            doc(
                "doc-3",
                "doc-3:p1",
                "The buyer accepts the premises in as-is condition.",
            ),
        ]
    }

    #[test]
    fn a_split_round_trips_through_its_footer() {
        let split = build_split(&corpus()).unwrap();
        let footer = read_footer(&split).unwrap();
        assert_eq!(footer.schema_generation, SCHEMA_GENERATION);
        assert_eq!(footer.document_count, 3);
        // A real Tantivy index writes at least meta.json plus segment files.
        assert!(
            footer.files.len() >= 2,
            "expected index files, got {}",
            footer.files.len()
        );
        // Every file range sits inside the split's data region (before the footer).
        for file in &footer.files {
            assert!(
                file.offset + file.len <= split.len(),
                "file {} overruns the split",
                file.name
            );
        }
    }

    #[test]
    fn a_batch_lands_as_a_single_segment() {
        // A split is one immutable unit and must hold exactly one Tantivy segment. Two reasons, and the
        // test guards both: a query consults every segment's term dictionary, so extra segments are
        // per-query I/O the split model exists to avoid; and the segment count decides a split's size
        // and read cost, so anything that lets it vary makes both unmeasurable. It varies as soon as
        // indexing is multi-threaded — each worker that receives documents commits its own segment, and
        // which workers receive any is up to the scheduler. Enough documents here that a multi-threaded
        // writer would reliably spread them.
        let documents: Vec<IndexDocument> = (0..200)
            .map(|i| {
                doc(
                    &format!("doc-{i}"),
                    &format!("doc-{i}:p1"),
                    "the parties agree to the terms set forth in this agreement",
                )
            })
            .collect();
        let footer = read_footer(&build_split(&documents).unwrap()).unwrap();

        // Tantivy names every file of a segment `<segment-id>.<extension>`; the index-level files
        // (meta.json, .managed.json) carry no segment id. So the distinct stems of the segment files
        // are the segments.
        let segments: std::collections::BTreeSet<&str> = footer
            .files
            .iter()
            .map(|file| file.name.as_str())
            .filter(|name| !name.starts_with('.') && *name != "meta.json")
            .filter_map(|name| name.split('.').next())
            .collect();

        assert_eq!(
            segments.len(),
            1,
            "a batch must build exactly one segment, got {segments:?}"
        );
    }

    #[test]
    fn a_keyword_query_finds_the_document_that_contains_the_term() {
        let split = build_split(&corpus()).unwrap();
        let hits = query_split(&split, "indemnify", 10).unwrap();
        assert_eq!(hits.len(), 1, "only doc-1 contains 'indemnify'");
        assert_eq!(hits[0].document_id, "doc-1");
        assert_eq!(hits[0].chunk_id, "doc-1:p1");
        assert!(
            hits[0].score > 0.0,
            "a match must carry a positive BM25 score"
        );
    }

    #[test]
    fn the_body_text_is_searchable_but_never_returned() {
        // The index is a term index, not a doc-store: a hit points at the passage (ids) but does not
        // carry its text, which the design keeps in R2. Hit has no body field — this test documents
        // that contract by exercising the shape.
        let split = build_split(&corpus()).unwrap();
        let hits = query_split(&split, "buyer", 10).unwrap();
        assert_eq!(hits.len(), 2, "'buyer' appears in doc-1 and doc-3");
        for hit in &hits {
            assert!(!hit.document_id.is_empty());
            assert!(!hit.chunk_id.is_empty());
        }
    }

    #[test]
    fn a_phrase_query_needs_adjacent_terms() {
        let split = build_split(&corpus()).unwrap();
        // "prior owner" is a phrase in doc-2; "owner prior" is not a phrase anywhere.
        let present = query_split(&split, "\"prior owner\"", 10).unwrap();
        assert_eq!(present.len(), 1);
        assert_eq!(present[0].document_id, "doc-2");
        let absent = query_split(&split, "\"owner prior\"", 10).unwrap();
        assert!(absent.is_empty(), "the reversed phrase must not match");
    }

    #[test]
    fn a_query_spanning_two_splits_merges_by_score() {
        // Two independently-built splits (as two ingest batches would produce) answer one query, merged
        // to a single ranked list — the multi-split query path in miniature.
        let split_a = build_split(&[doc(
            "a-1",
            "a-1:p1",
            "discovery of buried environmental waste",
        )])
        .unwrap();
        let split_b = build_split(&[doc(
            "b-1",
            "b-1:p1",
            "the environmental report was disclosed",
        )])
        .unwrap();
        let hits = query_splits(&[&split_a, &split_b], "environmental", 10).unwrap();
        assert_eq!(hits.len(), 2, "both splits contain 'environmental'");
        let ids: Vec<&str> = hits.iter().map(|h| h.document_id.as_str()).collect();
        assert!(ids.contains(&"a-1") && ids.contains(&"b-1"));
        // Descending score, then deterministic id tiebreak.
        assert!(hits[0].score >= hits[1].score);
    }

    #[test]
    fn a_footer_from_a_foreign_generation_is_refused() {
        // Corrupt the recorded generation and confirm the reader refuses rather than opening a split it
        // may misread — the "generation gates schema changes" rule.
        let mut split = build_split(&corpus()).unwrap();
        let footer = read_footer(&split).unwrap();
        let mut wrong = footer.clone();
        wrong.schema_generation = SCHEMA_GENERATION + 1;
        let footer_bytes = serde_json::to_vec(&wrong).unwrap();
        // Rebuild the tail: data region stays, replace footer + trailer.
        let trailer_len = 8;
        let old_footer_len =
            u64::from_le_bytes(split[split.len() - trailer_len..].try_into().unwrap()) as usize;
        let data_end = split.len() - trailer_len - old_footer_len;
        split.truncate(data_end);
        split.extend_from_slice(&footer_bytes);
        split.extend_from_slice(&(footer_bytes.len() as u64).to_le_bytes());

        let error = read_footer(&split).unwrap_err();
        assert!(matches!(error, SearchError::IncompatibleGeneration { .. }));
    }

    #[test]
    fn a_truncated_split_is_rejected_not_panicked() {
        let split = build_split(&corpus()).unwrap();
        assert!(
            read_footer(&split[..4]).is_err(),
            "a split shorter than the trailer must error"
        );
    }
}
