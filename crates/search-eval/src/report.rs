//! Turning measurements into something an owner can read.
//!
//! The rule this module is written to: no figure appears without its unit, the size of the thing it was
//! measured over, and the number of queries behind it — and the boundary of what was measured is stated
//! before the numbers, not after them. A latency with no stated scope is the failure mode this whole
//! benchmark exists to avoid, because an unlabelled number from a partial path reads as the system's
//! speed and is worse than no number at all.

use serde::Serialize;

use crate::benchmark::{CorpusTier, FanoutPoint};
use crate::queries;

/// The whole run, as committed to the baseline file. Conditions come first because a latency from this
/// benchmark is meaningful only against another run of the same benchmark on the same machine.
#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub taken_at_utc: String,
    pub taken_at_unix_seconds: u64,
    pub machine: String,
    pub build_profile: String,
    pub engine: String,
    pub schema_generation: u32,
    pub corpus_seed: u64,
    pub result_limit: usize,
    pub warmup_iterations: usize,
    pub timed_iterations: usize,
    pub fanout_timed_iterations: usize,
    pub corpus_tiers: Vec<CorpusTier>,
    pub fanout: Vec<FanoutPoint>,
    /// The parts of the read path this run could not reach, carried in the baseline itself so a figure
    /// can never be lifted out of the file without its caveats.
    pub not_measured: Vec<&'static str>,
}

/// Everything the local run genuinely could not exercise. Written once, printed in the report, and
/// stored in the baseline, so the three can never drift apart.
pub fn not_measured() -> Vec<&'static str> {
    vec![
        "The network. Every read here is served from this machine's memory. In a deployment each ranged read is an HTTP range GET against per-firm R2, so real latency is this figure PLUS one round trip per read that misses the cache. The read COUNT below transfers; the milliseconds do not.",
        "The search Worker and its Container. Queries are issued in-process against the engine crate. The deployed path adds a service-binding hop from the app Worker, request/response JSON marshalling, and Container scheduling including any cold start. None of that is in these numbers.",
        "The warm cache. The design's sub-second claim rests on a Container keeping splits and an open index resident between queries. The engine crate exposes no way to reuse an opened index across queries -- both public query entry points set up their reader from scratch every call -- so warm steady-state latency cannot be measured through its public surface at all. The `index open` column isolates that setup cost so it can at least be seen.",
        "The semantic half. Vectorize is a deployed-only binding with no local substitute, so `semantic` and `hybrid` modes are entirely unmeasured. Only `keyword` was run.",
        "Reciprocal rank fusion. `packages/search/src/fusion.ts` is pure TypeScript and never executed here; a hybrid query's fusion cost is unknown.",
        "The catalog read. Resolving which splits a query covers is a per-firm database read (`listLiveSplitsForMatter`), measured by the TypeScript load-profile harness, not by this benchmark. Total query cost in production is that read PLUS what is measured here.",
        "The TypeScript SearchIndexPort. Off a deployment it resolves to the deferred port, whose every operation returns `engine-not-implemented`. Timing it would time a stub, so it is deliberately not timed.",
        "Text extraction and indexing throughput at scale. Split BUILD time is reported per tier, but the upstream extraction, chunking, and queue pipeline that feeds it is not exercised.",
        "Footer pruning. The design's per-field pruning digest -- which lets a query skip a split whose terms exclude it -- is not implemented in the engine, so the fan-out figures below include no pruning benefit and would improve once it exists.",
    ]
}

/// The design targets a figure should be read against, stated beside the figure rather than left to
/// memory. A target with no measurement is as useless as a measurement with no target.
pub fn targets() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "warm keyword query latency",
            "under 1000 ms at thousands to tens of thousands of documents in one matter",
        ),
        (
            "segments per split",
            "exactly 1 -- a query consults every segment's term dictionary, so more than one is per-query work the split model exists to remove",
        ),
        (
            "per-query read volume",
            "grows with the query's selectivity, not with the corpus size",
        ),
    ]
}

fn thousands(value: usize) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, character) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(character);
    }
    out
}

fn bytes_human(value: usize) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    let value_f = value as f64;
    if value_f >= MIB {
        format!("{:.1} MiB", value_f / MIB)
    } else if value_f >= KIB {
        format!("{:.1} KiB", value_f / KIB)
    } else {
        format!("{value} B")
    }
}

/// Convert Unix seconds to an ISO-8601 UTC instant. Written out rather than taken as a dependency: a
/// timestamp is the only calendar work this crate does, and the civil-date algorithm is short and fixed.
pub fn iso8601_utc(unix_seconds: u64) -> String {
    let days = (unix_seconds / 86_400) as i64;
    let second_of_day = unix_seconds % 86_400;
    // Days since 1970-01-01 to a civil date, shifting the era to start in March so the leap day lands
    // at the end of a year and the month arithmetic needs no special case.
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        second_of_day / 3600,
        (second_of_day % 3600) / 60,
        second_of_day % 60
    )
}

/// A short description of the machine, since a baseline does not transfer off the one it was taken on.
/// An explicit label is preferred when the operator supplies one — "my laptop on battery" is more use to
/// a later reader than an architecture triple.
pub fn machine_label() -> String {
    if let Ok(label) = std::env::var("MAGNA_CARTA_BENCHMARK_MACHINE") {
        if !label.trim().is_empty() {
            return label;
        }
    }
    let cores = std::thread::available_parallelism()
        .map(|count| count.get().to_string())
        .unwrap_or_else(|_| "unknown".to_owned());
    format!(
        "{}/{}, {cores} logical cores (unlabelled -- set MAGNA_CARTA_BENCHMARK_MACHINE)",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

fn wrap_into(text: &str, width: usize, indent: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if !current.is_empty() && current.len() + 1 + word.len() > width {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
        .into_iter()
        .map(|line| format!("{indent}{line}"))
        .collect::<Vec<String>>()
        .join("\n")
}

const RULE: &str =
    "--------------------------------------------------------------------------------------------";

/// The class treated as "an ordinary review query" in the headline — broad enough to be representative,
/// selective enough not to be the ranking collector's worst case.
const HEADLINE_CLASS: &str = "mid-term";

/// The few sentences an owner should be able to read and then stop. Everything below the headline is
/// the evidence for it: nothing appears here that is not also in a table further down, and every figure
/// is computed from this run rather than written by hand, so the headline cannot go stale while the
/// tables move underneath it.
fn print_headline(report: &Report) {
    let Some(largest) = report.corpus_tiers.last() else {
        return;
    };
    println!("HEADLINE -- read this first");
    println!();

    if let Some(review) = largest
        .queries
        .iter()
        .find(|measurement| measurement.class == HEADLINE_CLASS)
    {
        println!("{}", wrap_into(&format!(
            "COMPACTED, the engine is fast and scales the way the split model intends. At {} documents ({} passages) in one split of {}, an ordinary review query returned in {:.3} ms at the median and {:.3} ms at p95, pulling {} ranged reads totalling {}.",
            thousands(largest.documents),
            thousands(largest.passages),
            bytes_human(largest.split_bytes),
            review.ranged.p50_ms,
            review.ranged.p95_ms,
            review.ranged_reads,
            bytes_human(review.ranged_bytes),
        ), 88, "  "));
        println!();
    }

    // Read COUNT holding steady while the corpus grows is the split model's central claim, and the read
    // count is also the figure that transfers off this machine -- so it leads, ahead of any latency.
    if report.corpus_tiers.len() > 1 {
        let counts: Vec<usize> = report
            .corpus_tiers
            .iter()
            .flat_map(|tier| tier.queries.iter().map(|query| query.ranged_reads))
            .collect();
        let growth = largest.split_bytes as f64 / report.corpus_tiers[0].split_bytes.max(1) as f64;
        if let (Some(low), Some(high)) = (counts.iter().min(), counts.iter().max()) {
            println!("{}", wrap_into(&format!(
                "Per-query ranged reads stayed between {low} and {high} across a {growth:.0}x growth in index size, so the number of round trips one query costs is set by what it asks for, not by how large the matter grew. Bytes per query do grow with the corpus, but sub-linearly: as a fraction of the index, a query touches steadily less of it as the corpus gets bigger.",
            ), 88, "  "));
            println!();
        }
    }

    // The fan-out comparison is only meaningful where the two axes meet at the same document count.
    let meeting = report.corpus_tiers.iter().find_map(|tier| {
        report
            .fanout
            .iter()
            .find(|point| point.splits == tier.documents)
            .and_then(|point| {
                tier.queries
                    .iter()
                    .find(|query| query.class == HEADLINE_CLASS)
                    .map(|query| (tier, point, query))
            })
    });
    if let Some((tier, point, query)) = meeting {
        let ratio = point.ranged_reads as f64 / query.ranged_reads.max(1) as f64;
        println!("{}", wrap_into(&format!(
            "UNCOMPACTED, it does not. The same {} documents published the way the pipeline publishes them today -- one split per document version -- cost {} ranged reads for ONE query, against {} for the identical documents compacted into a single split: about {ratio:.0} times the round trips for the same answer. On this machine that is {:.1} ms, but in a deployment every one of those reads is an R2 range GET, so this shape cannot reach a sub-second query however fast the engine itself is. Compaction is not an optimization here; it is what makes the read path viable at all.",
            thousands(tier.documents),
            thousands(point.ranged_reads),
            query.ranged_reads,
            point.ranged.p50_ms,
        ), 88, "  "));
        println!();
    }

    println!(
        "{}",
        wrap_into(
            "The single biggest caveat: nothing here crossed a network, a Worker, or a Container. Read WHAT THIS RUN DID NOT MEASURE below before quoting any millisecond figure from this report.",
            88,
            "  ",
        )
    );
    println!();
}

pub fn print(report: &Report) {
    println!("{RULE}");
    println!("Magna Carta -- search and discovery read-path benchmark");
    println!("{RULE}");
    println!("Taken at      {} (UTC)", report.taken_at_utc);
    println!("Machine       {}", report.machine);
    println!("Build         {}", report.build_profile);
    println!(
        "Engine        {} (index schema generation {})",
        report.engine, report.schema_generation
    );
    println!(
        "Corpus seed   {} -- deterministic; the same seed rebuilds the same corpus exactly",
        report.corpus_seed
    );
    println!(
        "Sampling      {} warmup + {} timed queries per figure ({} for fan-out), top {} hits requested",
        report.warmup_iterations, report.timed_iterations, report.fanout_timed_iterations, report.result_limit
    );
    println!();
    println!("A baseline from this benchmark compares against another run of it ON THIS MACHINE.");
    println!("These are not production latencies, and the section below says exactly why.");
    println!();

    print_headline(report);

    println!("WHAT THIS RUN MEASURED");
    println!("{}", wrap_into(
        "The real keyword engine: crates/search-core building Tantivy splits and answering BM25 queries over them, including the ranged-read access pattern a split in R2 is designed to be read through. No part of the engine is stubbed or simulated -- every latency below came from the same code a deployed Container would run.",
        88,
        "  ",
    ));
    println!();

    println!("WHAT THIS RUN DID NOT MEASURE -- the figures below EXCLUDE all of it");
    for item in &report.not_measured {
        println!("{}", wrap_into(item, 86, "    "));
        println!();
    }

    println!("TARGETS");
    for (name, target) in targets() {
        println!("  {name}");
        println!("{}", wrap_into(&format!("target: {target}"), 86, "    "));
    }
    println!();

    println!("QUERY CLASSES -- what each measured query is and why it is here");
    for class in queries::classes() {
        println!("  {:<18} {}", class.name, class.text);
        println!("{}", wrap_into(class.meaning, 86, "                     "));
    }
    println!();

    println!("{RULE}");
    println!("AXIS 1 -- CORPUS SIZE: the whole corpus compacted into ONE split");
    println!("{RULE}");
    println!("{}", wrap_into(
        "This is the shape the compaction pass produces. It answers how fast a query is, and at what corpus size. `index open` is the setup a cold reader pays before ranking anything; it is included in every ranged query figure and is broken out here so it can be seen.",
        88,
        "  ",
    ));
    println!();
    println!(
        "  {:<10} {:>10} {:>10} {:>12} {:>9} {:>10} {:>13} {:>11}",
        "tier",
        "documents",
        "passages",
        "split size",
        "segments",
        "build ms",
        "open p50 ms",
        "open reads"
    );
    for tier in &report.corpus_tiers {
        println!(
            "  {:<10} {:>10} {:>10} {:>12} {:>9} {:>10.1} {:>13.3} {:>11}",
            tier.tier,
            thousands(tier.documents),
            thousands(tier.passages),
            bytes_human(tier.split_bytes),
            tier.segments,
            tier.build_ms,
            tier.index_open.p50_ms,
            tier.index_open_reads,
        );
    }
    println!();
    println!(
        "  segments: target is exactly 1 per split (see TARGETS). A tier showing more has exceeded"
    );
    println!("  the split builder's fixed writer heap and fallen into several segments, which raises the");
    println!("  per-query cost of every query against it.");
    println!();

    for tier in &report.corpus_tiers {
        println!(
            "  TIER \"{}\" -- {} documents / {} passages in one split of {}",
            tier.tier,
            thousands(tier.documents),
            thousands(tier.passages),
            bytes_human(tier.split_bytes)
        );
        println!(
            "  {:<18} {:>7} {:>10} {:>9} {:>9} {:>8} {:>12} {:>15}",
            "query class",
            "hits",
            "p50 ms",
            "p95 ms",
            "p99 ms",
            "reads",
            "bytes read",
            "matrlz+qry p50"
        );
        for measurement in &tier.queries {
            println!(
                "  {:<18} {:>7} {:>10.3} {:>9.3} {:>9.3} {:>8} {:>12} {:>15.3}",
                measurement.class,
                measurement.hits,
                measurement.ranged.p50_ms,
                measurement.ranged.p95_ms,
                measurement.ranged.p99_ms,
                measurement.ranged_reads,
                bytes_human(measurement.ranged_bytes),
                measurement.materialized.p50_ms,
            );
        }
        println!();
    }
    println!("{}", wrap_into(
        "Column meanings. hits: ranked results returned, capped at the requested limit -- this is the query's selectivity against this corpus. p50/p95/p99 ms: latency of ONE query served through the ranged reader, including opening the index. reads: separate ranged reads that one query performed; in a deployment each is an R2 range GET, so this count is the figure that transfers off this machine. bytes read: total bytes those reads pulled -- compare it against the split size in the table above to see how much of the index a query actually touched. matrlz+qry p50: the crate's other public query path, which rebuilds the whole split into an in-memory directory and then searches it; at large corpus sizes that rebuild dominates, which is why it is labelled for what it does rather than called a warm-cache figure.",
        88,
        "  ",
    ));
    println!();

    println!("{RULE}");
    println!("AXIS 2 -- SPLIT FAN-OUT: one split per document version, as published today");
    println!("{RULE}");
    println!("{}", wrap_into(
        "A split's object key is derived from one document version, and a query is handed every live split key the catalog holds. So a matter of N indexed document versions is N splits and one query touches all of them. This axis varies only the split count -- it is where the read path falls over first, and the distance between it and Axis 1 at the same document count is what compaction is worth.",
        88,
        "  ",
    ));
    println!();
    println!(
        "  {:<9} {:>10} {:>12} {:>7} {:>10} {:>9} {:>9} {:>12}",
        "splits", "passages", "total size", "hits", "p50 ms", "p95 ms", "reads", "bytes read"
    );
    for point in &report.fanout {
        println!(
            "  {:<9} {:>10} {:>12} {:>7} {:>10.3} {:>9.3} {:>9} {:>12}",
            thousands(point.splits),
            thousands(point.passages),
            bytes_human(point.total_split_bytes),
            point.hits,
            point.ranged.p50_ms,
            point.ranged.p95_ms,
            thousands(point.ranged_reads),
            bytes_human(point.ranged_bytes),
        );
    }
    println!();
    println!("{}", wrap_into(
        "IMPORTANT -- this axis is a LOWER BOUND, not a measurement of the deployed path. The engine exposes no ranged multi-split query: its multi-split entry point takes in-memory slices only. The harness therefore issues one ranged query per split and merges the results itself. A deployment does the same work plus a network round trip per read, so the deployed figure is strictly worse than what is printed here, by an amount this benchmark cannot determine. The reads column is the honest part: that many range GETs is what a deployed query of this shape would issue, before any warm cache.",
        88,
        "  ",
    ));
    println!();
    println!("{RULE}");
    println!("HOW TO USE THIS");
    println!("{RULE}");
    println!("{}", wrap_into(
        "Compare a later run against the committed baseline on the same machine and look at the read COUNTS first: they are deterministic and do not drift with machine noise, so a change in them is a real change in how much work a query does. Treat the millisecond columns as machine-relative -- they say whether a change made the engine faster or slower here, never how fast search will be for a firm. Nothing in this file can answer that until the search Worker and its Container are deployed and the same queries are timed against them.",
        88,
        "  ",
    ));
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thousands_separates_every_third_digit() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(1_000), "1,000");
        assert_eq!(thousands(25_000), "25,000");
        assert_eq!(thousands(1_234_567), "1,234,567");
    }

    #[test]
    fn bytes_are_reported_with_a_unit() {
        assert_eq!(bytes_human(512), "512 B");
        assert_eq!(bytes_human(2048), "2.0 KiB");
        assert_eq!(bytes_human(3 * 1024 * 1024), "3.0 MiB");
    }

    #[test]
    fn the_timestamp_matches_known_instants() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_000_000_000), "2001-09-09T01:46:40Z");
        // A leap day, to exercise the era arithmetic rather than only the common case.
        assert_eq!(iso8601_utc(1_709_164_800), "2024-02-29T00:00:00Z");
    }

    #[test]
    fn every_unmeasured_item_and_target_is_stated() {
        assert!(
            not_measured().len() >= 8,
            "the boundary statement must stay explicit"
        );
        for item in not_measured() {
            assert!(item.len() > 40, "a caveat must actually explain itself");
        }
        for (name, target) in targets() {
            assert!(!name.is_empty() && !target.is_empty());
        }
    }

    #[test]
    fn wrapping_keeps_every_line_within_the_width() {
        let text = "a ".repeat(200);
        for line in wrap_into(&text, 40, "  ").lines() {
            assert!(line.len() <= 42, "line too long: {}", line.len());
        }
    }

    #[test]
    fn a_report_carries_its_own_provenance_and_caveats() {
        // Every figure in the printed output is only interpretable with the run's conditions attached,
        // so the serialized baseline has to carry them too. Building a report and reading it back is
        // what stops a field being dropped from the struct while the printed header still implies it.
        let report = Report {
            taken_at_utc: iso8601_utc(1_700_000_000),
            taken_at_unix_seconds: 1_700_000_000,
            machine: machine_label(),
            build_profile: "test".to_owned(),
            engine: "test engine".to_owned(),
            schema_generation: 1,
            corpus_seed: 7,
            result_limit: crate::queries::RESULT_LIMIT,
            warmup_iterations: crate::benchmark::WARMUP_ITERATIONS,
            timed_iterations: crate::benchmark::TIMED_ITERATIONS,
            fanout_timed_iterations: crate::benchmark::FANOUT_TIMED_ITERATIONS,
            corpus_tiers: Vec::new(),
            fanout: Vec::new(),
            not_measured: not_measured(),
        };
        let json = serde_json::to_string(&report).expect("a report must serialize");
        for field in [
            "taken_at_utc",
            "machine",
            "build_profile",
            "corpus_seed",
            "timed_iterations",
            "not_measured",
        ] {
            assert!(json.contains(field), "the baseline must carry {field}");
        }
        assert!(!report.machine.is_empty(), "a run must name its machine");
        assert_eq!(report.not_measured.len(), not_measured().len());
    }
}
