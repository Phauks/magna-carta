//! The measured runs themselves: two axes, each varying exactly one thing.
//!
//! **Axis one — corpus size.** One compacted split holding the whole corpus, queried at each tier. This
//! answers "how fast is a query, and at what corpus size", and it is the shape the compaction pass in
//! the index design produces.
//!
//! **Axis two — split fan-out.** The same query against a corpus published the way the pipeline
//! publishes it TODAY: one split per document version, because a split's object key is derived from
//! `(document, version)` (`packages/search/src/split.ts`) and the query is handed every live split key
//! the catalog holds (`apps/worker/src/search/keyword-search.ts`). Per-query cost on this axis grows
//! with the NUMBER OF SPLITS rather than with the corpus, which is why it is measured separately —
//! it is the axis that falls over first, and the gap between the two axes is what compaction is worth.

use std::sync::Arc;

use search_core::{
    build_split, merge_splits_over_readers, query_over_reader, query_split, query_splits,
    query_splits_over_readers, read_footer, IndexDocument, RangeReader, SplitSearcher,
};
use serde::Serialize;

use crate::corpus::{self, CorpusSpec};
use crate::measure::{measure, Latency};
use crate::queries::{self, RESULT_LIMIT};
use crate::reader::CountingReader;

/// Warmup and timed iteration counts. Small enough that the whole benchmark stays a few minutes, large
/// enough that a p95 is drawn from more than a handful of samples. Both are printed in the report, so a
/// figure is never quoted without the number of queries behind it.
pub const WARMUP_ITERATIONS: usize = 3;
pub const TIMED_ITERATIONS: usize = 30;

/// Fan-out is measured with fewer iterations at the top of the range: a thousand-split query is slow by
/// construction, and thirty of them would dominate the run for a figure whose shape is already clear.
pub const FANOUT_TIMED_ITERATIONS: usize = 10;

#[derive(Clone, Debug, Serialize)]
pub struct QueryMeasurement {
    pub class: &'static str,
    pub query: String,
    pub meaning: &'static str,
    /// How many ranked hits came back, capped by the result limit. This is the selectivity behind the
    /// latency — the same query text means something different against a corpus it barely matches.
    pub hits: usize,
    /// Latency of a query served through the ranged reader: the production access pattern, where each
    /// read would be an R2 range GET. Includes opening the index, which a warm Container would not pay
    /// per query — `index_open` on the tier records that component separately.
    pub ranged: Latency,
    /// Separate ranged reads one such query performed. In a deployment each is a network round trip.
    pub ranged_reads: usize,
    /// Total bytes those reads pulled.
    pub ranged_bytes: usize,
    /// Latency of the same query against a split the engine is **holding open** — the warm steady state
    /// a resident Container has, where opening the index and its per-field setup were paid once for the
    /// life of the split rather than per query. This is the figure the sub-second target is stated
    /// against, and it could not be measured at all until the engine exposed a reusable searcher.
    pub warm: Latency,
    /// Separate ranged reads a warm query performed. The difference between this and `ranged_reads` is
    /// exactly what a resident process saves per query.
    pub warm_reads: usize,
    pub warm_bytes: usize,
    /// Latency of the same query with the whole split already materialized in memory — the shape of a
    /// Container whose local cache already holds the split.
    pub materialized: Latency,
}

#[derive(Clone, Debug, Serialize)]
pub struct CorpusTier {
    pub tier: &'static str,
    pub documents: usize,
    pub passages: usize,
    pub words_per_passage: usize,
    /// Size of the built split in bytes — what the firm's R2 bucket stores for this corpus.
    pub split_bytes: usize,
    /// Tantivy segments inside the split. The split model wants exactly one: a query consults every
    /// segment's term dictionary, so a split that fell into several costs more per query and has no
    /// stable read cost to reason about.
    pub segments: usize,
    /// Wall-clock time to build the split from the passages, single-threaded as the builder pins it.
    pub build_ms: f64,
    /// Cost of opening the index through the ranged reader, with no query run. This is the fixed
    /// per-query tax a COLD reader pays before ranking anything.
    pub index_open: Latency,
    pub index_open_reads: usize,
    pub index_open_bytes: usize,
    pub queries: Vec<QueryMeasurement>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FanoutPoint {
    /// Number of live splits the query fans over — one per document version, as published today.
    pub splits: usize,
    pub passages: usize,
    /// Total bytes across every split, so the fan-out cost can be read against the data it covers.
    pub total_split_bytes: usize,
    pub class: &'static str,
    pub hits: usize,
    /// Latency of the engine's own multi-split query with every split already in memory.
    pub materialized: Latency,
    /// Latency of the same fan-out served through the engine's own ranged multi-split query, one reader
    /// per split. This is the read shape a deployed query has, minus the network.
    pub ranged: Latency,
    pub ranged_reads: usize,
    pub ranged_bytes: usize,
    /// What compaction does to this exact point: the same splits merged into one, then the same query
    /// run against the result. Everything below is the "after" to the fields above.
    pub compacted: CompactedPoint,
}

/// The same documents after compaction — the fan-out point's counterfactual, measured rather than
/// argued. Merging is done through the engine's ranged merge, so even the build side of compaction is
/// measured the way a Container would perform it.
#[derive(Clone, Debug, Serialize)]
pub struct CompactedPoint {
    /// Wall-clock time to merge every split into one. Compaction is background work off the query path,
    /// so this is a cost-to-run figure, never a latency a member waits on.
    pub merge_ms: f64,
    /// The merged split's size, against `total_split_bytes` above — per-split fixed overhead is paid
    /// once instead of once per document, so the merged bytes are the storage side of the same win.
    pub split_bytes: usize,
    /// Hits from the merged split. Must equal the fan-out's hit count: compaction that changed what a
    /// query matches would not be compaction.
    pub hits: usize,
    pub ranged: Latency,
    pub ranged_reads: usize,
    pub ranged_bytes: usize,
    /// The warm figure for the compacted split — a resident Container holding the one merged split open.
    pub warm: Latency,
    pub warm_reads: usize,
}

/// Count the Tantivy segments bundled in a split. Tantivy names every file of a segment
/// `<segment-id>.<extension>`; the index-level files (`meta.json`, the dot-prefixed managed file) carry
/// no segment id, so the distinct stems of the remaining files are the segments.
fn segments_in(split: &[u8]) -> usize {
    let Ok(footer) = read_footer(split) else {
        return 0;
    };
    footer
        .files
        .iter()
        .map(|file| file.name.as_str())
        .filter(|name| !name.starts_with('.') && *name != "meta.json")
        .filter_map(|name| name.split('.').next())
        .collect::<std::collections::BTreeSet<&str>>()
        .len()
}

fn elapsed_ms<Value>(operation: impl FnOnce() -> Value) -> (Value, f64) {
    let started = std::time::Instant::now();
    let value = operation();
    (value, started.elapsed().as_secs_f64() * 1000.0)
}

/// Measure one corpus tier: build the compacted split, then time every query class against it both
/// through the ranged reader and fully materialized.
pub fn run_corpus_tier(
    tier: &'static str,
    spec: &CorpusSpec,
    seed: u64,
) -> Result<CorpusTier, String> {
    let passages = corpus::generate(spec, seed);
    let (built, build_ms) = elapsed_ms(|| build_split(&passages));
    let split = built.map_err(|error| format!("{tier}: building the split failed: {error:?}"))?;

    let reader = CountingReader::new(split.clone());
    let dynamic: Arc<dyn RangeReader> = reader.clone();

    reader.reset();
    search_core::open_index(dynamic.clone())
        .map_err(|error| format!("{tier}: opening the index failed: {error:?}"))?;
    let open_tally = reader.tally();
    let index_open = measure(WARMUP_ITERATIONS, TIMED_ITERATIONS, || {
        let _index = search_core::open_index(dynamic.clone());
    });

    let mut queries = Vec::new();
    for class in queries::classes() {
        // One untimed run establishes the hit count and the read tally, so counting cannot land inside
        // a timed sample and the reported reads describe exactly one query rather than an average.
        reader.reset();
        let hits = query_over_reader(dynamic.clone(), &class.text, RESULT_LIMIT)
            .map_err(|error| format!("{tier}/{}: query failed: {error:?}", class.name))?;
        let tally = reader.tally();

        let ranged = measure(WARMUP_ITERATIONS, TIMED_ITERATIONS, || {
            let _hits = query_over_reader(dynamic.clone(), &class.text, RESULT_LIMIT);
        });

        // The warm steady state: one searcher held open across every query, exactly as a resident
        // Container holds a live split. The reads are counted after a first query has run, so what is
        // recorded is the marginal cost of asking again rather than the lazy setup the first ask pays.
        let searcher = SplitSearcher::over_reader(dynamic.clone()).map_err(|error| {
            format!(
                "{tier}/{}: opening a searcher failed: {error:?}",
                class.name
            )
        })?;
        searcher
            .search(&class.text, RESULT_LIMIT)
            .map_err(|error| format!("{tier}/{}: warm query failed: {error:?}", class.name))?;
        reader.reset();
        searcher
            .search(&class.text, RESULT_LIMIT)
            .map_err(|error| format!("{tier}/{}: warm query failed: {error:?}", class.name))?;
        let warm_tally = reader.tally();
        let warm = measure(WARMUP_ITERATIONS, TIMED_ITERATIONS, || {
            let _hits = searcher.search(&class.text, RESULT_LIMIT);
        });

        let materialized = measure(WARMUP_ITERATIONS, TIMED_ITERATIONS, || {
            let _hits = query_split(&split, &class.text, RESULT_LIMIT);
        });

        queries.push(QueryMeasurement {
            class: class.name,
            query: class.text.clone(),
            meaning: class.meaning,
            hits: hits.len(),
            ranged,
            ranged_reads: tally.reads,
            ranged_bytes: tally.bytes,
            warm,
            warm_reads: warm_tally.reads,
            warm_bytes: warm_tally.bytes,
            materialized,
        });
    }

    Ok(CorpusTier {
        tier,
        documents: spec.documents,
        passages: spec.passages(),
        words_per_passage: spec.words_per_passage,
        split_bytes: split.len(),
        segments: segments_in(&split),
        build_ms: (build_ms * 1000.0).round() / 1000.0,
        index_open,
        index_open_reads: open_tally.reads,
        index_open_bytes: open_tally.bytes,
        queries,
    })
}

/// Build one split per document, as the indexing pipeline publishes them.
fn per_document_splits(passages: &[IndexDocument]) -> Result<Vec<Vec<u8>>, String> {
    corpus::by_document(passages)
        .iter()
        .map(|batch| build_split(batch).map_err(|error| format!("split build failed: {error:?}")))
        .collect()
}

/// Measure the fan-out axis at one split count, for one query class.
pub fn run_fanout_point(
    split_count: usize,
    passages_per_document: usize,
    words_per_passage: usize,
    class_name: &'static str,
    query_text: &str,
    seed: u64,
) -> Result<FanoutPoint, String> {
    let spec = CorpusSpec {
        documents: split_count,
        passages_per_document,
        words_per_passage,
    };
    let passages = corpus::generate(&spec, seed);
    let splits = per_document_splits(&passages)?;
    let total_split_bytes: usize = splits.iter().map(Vec::len).sum();

    let borrowed: Vec<&[u8]> = splits.iter().map(Vec::as_slice).collect();
    let hits = query_splits(&borrowed, query_text, RESULT_LIMIT)
        .map_err(|error| format!("fan-out {split_count}: query failed: {error:?}"))?;

    let materialized = measure(WARMUP_ITERATIONS, FANOUT_TIMED_ITERATIONS, || {
        let _hits = query_splits(&borrowed, query_text, RESULT_LIMIT);
    });

    let counting: Vec<Arc<CountingReader>> = splits
        .iter()
        .map(|split| CountingReader::new(split.clone()))
        .collect();
    let readers: Vec<Arc<dyn RangeReader>> = counting
        .iter()
        .map(|reader| reader.clone() as Arc<dyn RangeReader>)
        .collect();

    for reader in &counting {
        reader.reset();
    }
    query_splits_over_readers(&readers, query_text, RESULT_LIMIT)
        .map_err(|error| format!("fan-out {split_count}: ranged query failed: {error:?}"))?;
    let tally_reads: usize = counting.iter().map(|reader| reader.tally().reads).sum();
    let tally_bytes: usize = counting.iter().map(|reader| reader.tally().bytes).sum();

    let ranged = measure(WARMUP_ITERATIONS, FANOUT_TIMED_ITERATIONS, || {
        let _ = query_splits_over_readers(&readers, query_text, RESULT_LIMIT);
    });

    let compacted = run_compacted_point(&readers, query_text)?;

    Ok(FanoutPoint {
        splits: split_count,
        passages: spec.passages(),
        total_split_bytes,
        class: class_name,
        hits: hits.len(),
        materialized,
        ranged,
        ranged_reads: tally_reads,
        ranged_bytes: tally_bytes,
        compacted,
    })
}

/// Compact one fan-out point's splits into a single split and measure the same query against it.
///
/// The merge runs through the engine's ranged merge over the same readers the fan-out used, so the
/// "after" side of the comparison is produced by the same code a compaction pass in a Container would
/// run — not by rebuilding the corpus into one split, which would measure a pipeline that does not exist.
fn run_compacted_point(
    readers: &[Arc<dyn RangeReader>],
    query_text: &str,
) -> Result<CompactedPoint, String> {
    let (merged, merge_ms) = elapsed_ms(|| merge_splits_over_readers(readers, &[]));
    let merged =
        merged.map_err(|error| format!("compacting {} splits failed: {error:?}", readers.len()))?;

    let reader = CountingReader::new(merged.bytes.clone());
    let dynamic: Arc<dyn RangeReader> = reader.clone();

    reader.reset();
    let hits = query_over_reader(dynamic.clone(), query_text, RESULT_LIMIT)
        .map_err(|error| format!("compacted query failed: {error:?}"))?;
    let tally = reader.tally();
    let ranged = measure(WARMUP_ITERATIONS, FANOUT_TIMED_ITERATIONS, || {
        let _ = query_over_reader(dynamic.clone(), query_text, RESULT_LIMIT);
    });

    let searcher = SplitSearcher::over_reader(dynamic.clone())
        .map_err(|error| format!("opening a compacted searcher failed: {error:?}"))?;
    searcher
        .search(query_text, RESULT_LIMIT)
        .map_err(|error| format!("compacted warm query failed: {error:?}"))?;
    reader.reset();
    searcher
        .search(query_text, RESULT_LIMIT)
        .map_err(|error| format!("compacted warm query failed: {error:?}"))?;
    let warm_tally = reader.tally();
    let warm = measure(WARMUP_ITERATIONS, FANOUT_TIMED_ITERATIONS, || {
        let _ = searcher.search(query_text, RESULT_LIMIT);
    });

    Ok(CompactedPoint {
        merge_ms: (merge_ms * 1000.0).round() / 1000.0,
        split_bytes: merged.bytes.len(),
        hits: hits.len(),
        ranged,
        ranged_reads: tally.reads,
        ranged_bytes: tally.bytes,
        warm,
        warm_reads: warm_tally.reads,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tiny_tier_measures_end_to_end() {
        // Small enough to stay a unit test, large enough that every query class finds something to do.
        let spec = CorpusSpec {
            documents: 60,
            passages_per_document: 2,
            words_per_passage: 20,
        };
        let tier = run_corpus_tier("test", &spec, 7).unwrap();
        assert_eq!(tier.documents, 60);
        assert_eq!(tier.passages, 120);
        assert!(tier.split_bytes > 0);
        assert_eq!(tier.segments, 1, "one batch must build exactly one segment");
        assert_eq!(tier.queries.len(), queries::classes().len());

        let unique = tier
            .queries
            .iter()
            .find(|measurement| measurement.class == "unique-term")
            .expect("the unique-term class must be measured");
        assert_eq!(unique.hits, 1, "the unique term is in exactly one passage");
        assert!(
            unique.ranged_reads > 0,
            "a ranged query must pull at least one read"
        );
        assert!(
            unique.ranged_bytes < tier.split_bytes,
            "a single-hit query must read less than the whole split; read {} of {}",
            unique.ranged_bytes,
            tier.split_bytes
        );
        assert!(
            unique.warm_reads < unique.ranged_reads,
            "a warm query ({} reads) must cost less than a cold one ({})",
            unique.warm_reads,
            unique.ranged_reads
        );
    }

    #[test]
    fn a_small_fanout_point_measures_end_to_end() {
        let point = run_fanout_point(8, 2, 20, "rare-term", corpus::COMMON_TERM, 7).unwrap();
        assert_eq!(point.splits, 8);
        assert_eq!(point.passages, 16);
        assert!(point.total_split_bytes > 0);
        assert!(
            point.ranged_reads >= point.splits,
            "each split needs at least one read of its own"
        );
    }

    #[test]
    fn compacting_a_fanout_point_costs_fewer_reads_for_the_same_answer() {
        // The comparison the whole exercise turns on, pinned as a test so a regression in the merge
        // shows up in the gate rather than only in a benchmark someone has to remember to run.
        let point = run_fanout_point(12, 2, 20, "rare-term", corpus::COMMON_TERM, 7).unwrap();
        assert_eq!(
            point.compacted.hits, point.hits,
            "compaction must not change what a query matches"
        );
        assert!(
            point.compacted.ranged_reads < point.ranged_reads,
            "compacted {} reads should be under the fan-out's {}",
            point.compacted.ranged_reads,
            point.ranged_reads
        );
        assert!(
            point.compacted.split_bytes < point.total_split_bytes,
            "one merged split should be smaller than the {} splits it replaced",
            point.splits
        );
    }
}
