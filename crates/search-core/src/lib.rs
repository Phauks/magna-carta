//! `search-core` — the discovery keyword index, engine-side and port-free.
//!
//! This crate is to search what `pdf-core` is to documents: a pure-Rust core that knows Tantivy and
//! bytes and nothing about firms, R2, or Cloudflare. It builds an index from extracted passages,
//! packages it as a self-contained [`split`] that can live in per-firm R2, and queries splits back into
//! ranked hits. The firm/catalog/isolation logic wraps this crate in the search Worker's Container; the
//! crate stays unit-testable without any of that.
//!
//! What is proven here: the split *format* and the build -> split -> query round trip; the
//! [`SplitDirectory`] that serves Tantivy's reads as ranged reads against a split in R2, so a query
//! fetches only the postings it walks; the [`SplitSearcher`] that holds a split open so a resident
//! process pays that setup once rather than per query; and [`merge_splits_over_readers`], the merge
//! behind index compaction, which collapses many per-document splits into one and drops the document
//! versions a re-index has superseded. Still deferred: the footer's per-field pruning digest, which
//! extends the format without changing it — see [`split`] for where it hooks in.

mod directory;
mod error;
mod merge;
mod query;
mod schema;
mod split;

pub use directory::{open_index, read_footer_ranged, RangeReader, SplitDirectory};
pub use error::SearchError;
pub use merge::{merge_splits, merge_splits_over_readers, MergedSplit};
pub use query::{
    query_over_reader, query_searchers, query_split, query_splits, query_splits_over_readers, Hit,
    SplitSearcher,
};
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

    fn matching(split: &[u8], query: &str) -> Vec<String> {
        let mut found: Vec<String> = query_split(split, query, 10)
            .unwrap()
            .into_iter()
            .map(|hit| hit.document_id)
            .collect();
        found.sort();
        found
    }

    #[test]
    fn the_query_text_the_application_builds_from_a_search_box_means_what_it_says() {
        // The application never passes a reader's text through as query syntax. It rebuilds the
        // question from the words alone (packages/search/src/keyword-query.ts): every word required,
        // each one quoted so it is a literal, and the word still being typed marked as the start of a
        // word. This pins that the engine reads that text the way the application means it, because
        // the two are written in different languages and nothing else compares them.
        let split = build_split(&corpus()).unwrap();

        // Every word is required: the two words are in different documents, so nothing holds both.
        assert!(matching(&split, "+\"buyer\" +\"environmental\"").is_empty());
        assert_eq!(matching(&split, "+\"buyer\" +\"premises\""), ["doc-3"]);

        // The last word may be unfinished, alone or after others.
        assert_eq!(matching(&split, "+body:/indemn.*/"), ["doc-1"]);
        assert_eq!(
            matching(&split, "+\"environmental\" +body:/liab.*/"),
            ["doc-2"]
        );
        assert_eq!(matching(&split, "+body:/buy.*/"), ["doc-1", "doc-3"]);
        // A finished word is a whole word: "buy" is not in any document.
        assert!(matching(&split, "+\"buy\"").is_empty());

        // A quoted run is adjacent and in order; its last word may be unfinished too.
        assert_eq!(matching(&split, "+\"prior owner\""), ["doc-2"]);
        assert!(matching(&split, "+\"owner prior\"").is_empty());
        assert_eq!(matching(&split, "+\"prior own\"*"), ["doc-2"]);

        // A word with punctuation inside it is the run of its pieces, as the index cut it.
        assert_eq!(matching(&split, "+\"as is\""), ["doc-3"]);

        // Case does not matter.
        assert_eq!(matching(&split, "+\"ENVIRONMENTAL\""), ["doc-2"]);
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

    #[test]
    fn a_held_open_searcher_answers_repeatedly_and_identically() {
        // The property a warm query server needs: opening is separable from asking, and asking twice of
        // the same open split gives the same answer as asking once through the one-shot path.
        let split = build_split(&corpus()).unwrap();
        let searcher = SplitSearcher::over_split(&split).unwrap();
        let first = searcher.search("buyer", 10).unwrap();
        let second = searcher.search("buyer", 10).unwrap();
        assert_eq!(first, second);
        assert_eq!(first, query_split(&split, "buyer", 10).unwrap());
        // A different question of the same open split is answered without reopening it.
        assert_eq!(searcher.search("indemnify", 10).unwrap().len(), 1);
    }

    #[test]
    fn holding_a_split_open_costs_the_setup_reads_once_rather_than_per_query() {
        use std::io;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        #[derive(Debug)]
        struct CountingReader {
            data: Vec<u8>,
            reads: AtomicUsize,
        }
        impl RangeReader for CountingReader {
            fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
                let end = offset
                    .checked_add(length)
                    .filter(|end| *end <= self.data.len())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::UnexpectedEof, "range past end")
                    })?;
                self.reads.fetch_add(1, Ordering::Relaxed);
                Ok(self.data[offset..end].to_vec())
            }
            fn total_len(&self) -> usize {
                self.data.len()
            }
        }

        let split = build_split(&corpus()).unwrap();
        let reader = Arc::new(CountingReader {
            data: split,
            reads: AtomicUsize::new(0),
        });

        let searcher = SplitSearcher::over_reader(reader.clone()).unwrap();
        let after_open = reader.reads.load(Ordering::Relaxed);
        searcher.search("buyer", 10).unwrap();
        let after_first = reader.reads.load(Ordering::Relaxed);
        searcher.search("buyer", 10).unwrap();
        let after_second = reader.reads.load(Ordering::Relaxed);

        assert!(after_open > 0, "opening a split has to read something");
        let first_query = after_first - after_open;
        let repeat_query = after_second - after_first;
        // A cold one-shot query pays the open AND the first query's lazy per-field setup; a repeat
        // against the same held-open split pays neither. In a deployment every one of those reads is an
        // R2 range GET, so this difference is the whole reason a warm Container can be sub-second when a
        // cold one cannot — and it is why the one-shot entry points cannot measure warm latency.
        let cold = after_open + first_query;
        assert!(
            repeat_query < first_query,
            "a repeat query ({repeat_query} reads) must cost less than the first ({first_query})"
        );
        assert!(
            repeat_query * 3 <= cold,
            "a warm repeat ({repeat_query} reads) should be a fraction of a cold one-shot ({cold})"
        );
    }

    #[test]
    fn an_excluded_document_cannot_contribute_a_hit() {
        // The window between a document being re-indexed and the next compaction physically removing
        // its old passages from the merged split: the split still holds them, and the exclusion is what
        // stops them matching meanwhile.
        let split = build_split(&corpus()).unwrap();
        let all = SplitSearcher::over_split(&split).unwrap();
        assert_eq!(all.search("buyer", 10).unwrap().len(), 2);

        let filtered = SplitSearcher::over_split(&split)
            .unwrap()
            .excluding_documents(&["doc-1".to_owned()]);
        let hits = filtered.search("buyer", 10).unwrap();
        assert_eq!(hits.len(), 1, "doc-1 is excluded, doc-3 remains");
        assert_eq!(hits[0].document_id, "doc-3");
        // The exclusion is exact, not a prefix: "doc-1" must not also take out "doc-2" or "doc-3".
        assert!(filtered.search("indemnify", 10).unwrap().is_empty());
    }

    #[test]
    fn a_ranged_multi_split_query_matches_the_in_memory_one() {
        use std::io;
        use std::sync::Arc;

        #[derive(Debug)]
        struct SliceReader(Vec<u8>);
        impl RangeReader for SliceReader {
            fn read_range(&self, offset: usize, length: usize) -> io::Result<Vec<u8>> {
                let end = offset
                    .checked_add(length)
                    .filter(|end| *end <= self.0.len())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::UnexpectedEof, "range past end")
                    })?;
                Ok(self.0[offset..end].to_vec())
            }
            fn total_len(&self) -> usize {
                self.0.len()
            }
        }

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
        let readers: Vec<Arc<dyn RangeReader>> = vec![
            Arc::new(SliceReader(split_a.clone())),
            Arc::new(SliceReader(split_b.clone())),
        ];

        let ranged = query_splits_over_readers(&readers, "environmental", 10).unwrap();
        let in_memory = query_splits(&[&split_a, &split_b], "environmental", 10).unwrap();
        assert_eq!(
            ranged, in_memory,
            "the ranged multi-split path must rank identically to the in-memory one"
        );
        assert_eq!(ranged.len(), 2);
    }

    #[test]
    fn merging_two_splits_answers_the_same_question_in_one() {
        // The compaction contract at its smallest: the merged split returns what the fan-out returned.
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
        let fanned = query_splits(&[&split_a, &split_b], "environmental", 10).unwrap();
        let merged = merge_splits(&[&split_a, &split_b], &[]).unwrap();
        let compacted = query_split(&merged.bytes, "environmental", 10).unwrap();

        let fanned_ids: Vec<&str> = fanned.iter().map(|hit| hit.document_id.as_str()).collect();
        let compacted_ids: Vec<&str> = compacted
            .iter()
            .map(|hit| hit.document_id.as_str())
            .collect();
        assert_eq!(fanned_ids, compacted_ids);
    }
}
