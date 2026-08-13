//! `search-eval` -- the standardized performance benchmark for the search and discovery read path.
//!
//! One command, output an owner can read: how fast a keyword query is, at what corpus size, and where
//! the read path falls over. Run it with
//!
//! ```text
//! cargo run -p search-eval --profile benchmark -- benchmark
//! ```
//!
//! and see this crate's `README.md` for how to run it and how to read what it prints.
//!
//! It is deliberately NOT part of any test or check gate: it builds and queries corpora of tens of
//! thousands of passages and takes minutes, which is exactly the kind of slow default the repository's
//! build-performance standard keeps off the normal path. The crate's own unit tests are tiny and do run
//! with the workspace, but they exercise the harness, never the benchmark tiers.

mod benchmark;
mod corpus;
mod measure;
mod queries;
mod reader;
mod report;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use corpus::CorpusSpec;
use report::Report;

/// The corpus seed. Fixed forever: changing it rebuilds a different corpus and silently invalidates
/// every committed baseline, so it is a constant rather than an option.
const CORPUS_SEED: u64 = 20_260_813;

/// Passages per document, and words per passage. A reviewed discovery document is chunked into several
/// passages before indexing, and the passage -- not the document -- is what the engine sees.
const PASSAGES_PER_DOCUMENT: usize = 8;
const WORDS_PER_PASSAGE: usize = 40;

/// The corpus tiers, in ascending size. They bracket the scope the discovery index is built for: a
/// matter under review holds thousands to tens of thousands of documents, so `expected` sits in the
/// middle of that range and `large` at the top of it. `smoke` is the fast tier for a quick check.
const TIERS: &[(&str, usize)] = &[("smoke", 250), ("expected", 5_000), ("large", 25_000)];

/// Split counts for the fan-out axis, spanning a matter with a handful of indexed documents to one with
/// a few thousand. The top point deliberately equals the `expected` corpus tier's document count, so the
/// two axes meet at one directly comparable place: the same documents in one compacted split versus in
/// one split each. That pair is what the cost of not compacting can be read straight off.
const FANOUT_SPLIT_COUNTS: &[usize] = &[1, 10, 100, 1_000, 5_000];

fn main() {
    let mut arguments = std::env::args().skip(1);
    let mode = arguments.next();
    let flags: Vec<String> = arguments.collect();
    match mode.as_deref() {
        Some("benchmark") => {
            let quick = flags.iter().any(|flag| flag == "--quick");
            run_benchmark(quick);
        }
        other => {
            eprintln!("unknown mode {other:?}");
            eprintln!("usage: search-eval benchmark [--quick]");
            eprintln!("  benchmark          every corpus tier and the whole fan-out axis; writes the baseline file");
            eprintln!(
                "  benchmark --quick  the smoke tier and two fan-out points only; writes nothing"
            );
            std::process::exit(2);
        }
    }
}

fn build_profile() -> String {
    // Which profile the binary was compiled with changes the numbers materially, so it is recorded
    // rather than assumed. `debug_assertions` is the one signal available at runtime; the workspace's
    // own release profile optimizes for SIZE, which is why the documented command uses `benchmark`.
    if cfg!(debug_assertions) {
        "DEBUG BUILD -- numbers are several times slower than an optimized build and are not comparable to a baseline taken with --profile benchmark".to_owned()
    } else {
        "optimized build (run with --profile benchmark for the documented, speed-optimized settings)"
            .to_owned()
    }
}

fn run_benchmark(quick: bool) {
    let tiers: Vec<(&str, usize)> = if quick {
        TIERS.iter().take(1).copied().collect()
    } else {
        TIERS.to_vec()
    };
    let fanout_counts: Vec<usize> = if quick {
        FANOUT_SPLIT_COUNTS.iter().take(2).copied().collect()
    } else {
        FANOUT_SPLIT_COUNTS.to_vec()
    };

    let mut corpus_tiers = Vec::new();
    for (name, documents) in &tiers {
        eprintln!("measuring corpus tier \"{name}\" ({documents} documents)...");
        let spec = CorpusSpec {
            documents: *documents,
            passages_per_document: PASSAGES_PER_DOCUMENT,
            words_per_passage: WORDS_PER_PASSAGE,
        };
        // `tier` is a &'static str in the result; the tier table is a static, so this leak-free lookup
        // recovers the static lifetime rather than allocating one.
        let static_name = TIERS
            .iter()
            .find(|(candidate, _)| candidate == name)
            .map(|(candidate, _)| *candidate)
            .unwrap_or("tier");
        match benchmark::run_corpus_tier(static_name, &spec, CORPUS_SEED) {
            Ok(result) => corpus_tiers.push(result),
            Err(detail) => {
                eprintln!("{detail}");
                std::process::exit(1);
            }
        }
    }

    // The fan-out axis is measured with the mid-band query: it is the ordinary review query, and it
    // matches in enough splits that the merge is doing real work rather than discarding empties.
    let fanout_class = "mid-term";
    let fanout_query = corpus::MID_TERM;
    let mut fanout = Vec::new();
    for count in &fanout_counts {
        eprintln!("measuring fan-out over {count} split(s)...");
        match benchmark::run_fanout_point(
            *count,
            PASSAGES_PER_DOCUMENT,
            WORDS_PER_PASSAGE,
            fanout_class,
            fanout_query,
            CORPUS_SEED,
        ) {
            Ok(point) => fanout.push(point),
            Err(detail) => {
                eprintln!("{detail}");
                std::process::exit(1);
            }
        }
    }

    let unix_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);

    let report = Report {
        taken_at_utc: report::iso8601_utc(unix_seconds),
        taken_at_unix_seconds: unix_seconds,
        machine: report::machine_label(),
        build_profile: build_profile(),
        engine: "crates/search-core over Tantivy, BM25 keyword ranking".to_owned(),
        schema_generation: search_core::SCHEMA_GENERATION,
        corpus_seed: CORPUS_SEED,
        result_limit: queries::RESULT_LIMIT,
        warmup_iterations: benchmark::WARMUP_ITERATIONS,
        timed_iterations: benchmark::TIMED_ITERATIONS,
        fanout_timed_iterations: benchmark::FANOUT_TIMED_ITERATIONS,
        corpus_tiers,
        fanout,
        not_measured: report::not_measured(),
    };

    report::print(&report);

    if quick {
        println!("--quick run: partial tiers, no baseline written.");
        return;
    }

    // Anchored on the crate directory so the command works from anywhere, the same way pdf-eval's
    // corpus lookup does.
    let baseline_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("search-benchmark-baseline.json");
    match serde_json::to_string_pretty(&report) {
        Ok(json) => match std::fs::write(&baseline_path, format!("{json}\n")) {
            Ok(()) => println!("baseline written: {}", baseline_path.display()),
            Err(error) => eprintln!("warning: could not write the baseline: {error}"),
        },
        Err(error) => eprintln!("warning: could not serialize the baseline: {error}"),
    }
}
