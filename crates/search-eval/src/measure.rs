//! Timing: warmup, then a fixed number of timed iterations, reduced to percentiles.
//!
//! The percentile convention here is deliberately IDENTICAL to the TypeScript load-profile runner's
//! (`packages/fixtures/src/load-profile/runner.ts`): the sample at index `ceil(fraction * count) - 1`
//! of the ascending samples, clamped into range. Two harnesses that both print "p95" must mean the same
//! thing by it, or a reader comparing a database read against an engine query is comparing two
//! different statistics that happen to share a label.
//!
//! `Instant` is monotonic, so an NTP step during a run cannot produce a negative or wildly large sample
//! the way a wall-clock read could.

use std::time::Instant;

use serde::Serialize;

/// One measured operation's latency distribution. Every field is milliseconds except `iterations`.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Latency {
    /// How many timed samples are behind these figures (warmup excluded).
    pub iterations: usize,
    pub min_ms: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

fn round_micros(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

/// The sample at `ceil(fraction * count) - 1`, clamped. `samples` must be ascending and non-empty.
pub fn percentile(samples: &[f64], fraction: f64) -> f64 {
    debug_assert!(!samples.is_empty());
    let count = samples.len();
    let index = ((fraction * count as f64).ceil() as usize)
        .saturating_sub(1)
        .min(count - 1);
    samples[index]
}

impl Latency {
    /// Reduce raw millisecond samples to a distribution. Sorts a copy — the caller keeps its samples.
    pub fn from_samples(samples: &[f64]) -> Self {
        let mut sorted = samples.to_vec();
        sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
        Self {
            iterations: sorted.len(),
            min_ms: round_micros(sorted[0]),
            p50_ms: round_micros(percentile(&sorted, 0.5)),
            p95_ms: round_micros(percentile(&sorted, 0.95)),
            p99_ms: round_micros(percentile(&sorted, 0.99)),
            max_ms: round_micros(sorted[sorted.len() - 1]),
        }
    }
}

/// Run `operation` `warmup + iterations` times and reduce the timed tail to a distribution.
///
/// The warmup exists because the first calls pay costs a steady-state query does not — page faults on
/// freshly-allocated corpus memory, and the allocator reaching its working size. Discarding them is what
/// makes the reported figures describe the engine rather than the process's first moments.
pub fn measure<Operation: FnMut()>(
    warmup: usize,
    iterations: usize,
    mut operation: Operation,
) -> Latency {
    assert!(iterations > 0, "a measurement needs at least one iteration");
    let mut samples = Vec::with_capacity(iterations);
    for index in 0..(warmup + iterations) {
        let started = Instant::now();
        operation();
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        if index >= warmup {
            samples.push(elapsed);
        }
    }
    Latency::from_samples(&samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_match_the_load_profile_runner_convention() {
        // Ten samples 1..=10. ceil(0.5*10)-1 = 4 -> 5; ceil(0.95*10)-1 = 9 -> 10.
        let samples: Vec<f64> = (1..=10).map(f64::from).collect();
        assert_eq!(percentile(&samples, 0.5), 5.0);
        assert_eq!(percentile(&samples, 0.95), 10.0);
        assert_eq!(percentile(&samples, 0.99), 10.0);
        // A single sample is every percentile of itself.
        assert_eq!(percentile(&[42.0], 0.5), 42.0);
        assert_eq!(percentile(&[42.0], 0.99), 42.0);
    }

    #[test]
    fn a_distribution_reports_the_sample_count_behind_it() {
        let latency = Latency::from_samples(&[3.0, 1.0, 2.0]);
        assert_eq!(latency.iterations, 3);
        assert_eq!(latency.min_ms, 1.0);
        assert_eq!(latency.max_ms, 3.0);
        assert_eq!(latency.p50_ms, 2.0);
    }

    #[test]
    fn measure_discards_the_warmup_iterations() {
        let mut calls = 0usize;
        let latency = measure(3, 5, || calls += 1);
        assert_eq!(calls, 8, "warmup and timed iterations both run");
        assert_eq!(latency.iterations, 5, "only the timed tail is reported");
    }
}
