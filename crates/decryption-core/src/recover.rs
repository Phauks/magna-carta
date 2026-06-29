//! Per-shard password recovery: iterates the word range in a `ShardSpec`,
//! expands each word via the assigned `RuleSet`, and verifies each candidate
//! against the `RecoveryJob` hash.
//!
//! This module is native-only (rayon) and is excluded from the WASM build.

use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;

use crate::dictionary::verify;
use crate::rules::{expand, RuleSet};
use crate::shard::ShardSpec;
use crate::RecoveryJob;

/// The outcome of running `recover_shard` over one keyspace slice.
pub struct ShardOutcome {
    /// The first candidate that authenticates against the job's hash, if any.
    pub found: Option<String>,
    /// How many candidates were actually submitted to `verify` before the search
    /// ended. Under rayon parallel `find_map_any`, multiple threads race to the
    /// result, so this may be slightly higher than the winning candidate's
    /// position in the expansion sequence.
    pub candidates_tried: usize,
}

/// Run password recovery over the slice of `words` described by `spec`.
///
/// For each word in `words[spec.word_start..spec.word_end]` (the range is
/// clamped to `words.len()` — this function never panics on an out-of-range
/// spec), every rule in `rules` is applied via `expand` to produce candidates.
/// Candidates are verified against `job` in parallel across rayon threads;
/// the first candidate that authenticates is returned together with the count
/// of candidates actually verified.
pub fn recover_shard(
    job: &RecoveryJob,
    words: &[String],
    spec: &ShardSpec,
    rules: &RuleSet,
) -> ShardOutcome {
    // Clamp the range so an over-sized spec never causes a slice-index panic.
    let start = spec.word_start.min(words.len());
    let end = spec.word_end.min(words.len());
    let word_slice = &words[start..end];

    let candidates_tried = AtomicUsize::new(0);

    // par_iter over the word slice; for each word, expand via the rule set and
    // verify candidates sequentially within that word's expansion. find_map_any
    // short-circuits across threads as soon as any thread returns Some.
    let found = word_slice.par_iter().find_map_any(|word| {
        for candidate in expand(word, rules) {
            candidates_tried.fetch_add(1, Ordering::Relaxed);
            if verify(job, &candidate) {
                return Some(candidate);
            }
        }
        None
    });

    ShardOutcome {
        found,
        candidates_tried: candidates_tried.load(Ordering::Relaxed),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::parse_rules;
    use crate::shard::ShardSpec;
    use crate::{Format, OoxmlAdapter, RecoveryJob};

    // hashcat example_hashes mode 9600 (MS Office 2013 agile, `$office$`).
    // Password for this vector is "hashcat".
    // Source: https://hashcat.net/wiki/doku.php?id=example_hashes
    const OFFICE_2013_EXAMPLE: &str = "$office$*2013*100000*256*16*7dd611d7eb4c899f74816d1dec817b3b*948dc0b2c2c6c32f14b5995a543ad037*0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895";

    fn office_2013_job() -> RecoveryJob {
        let params = OoxmlAdapter::parse_hash(OFFICE_2013_EXAMPLE)
            .expect("OFFICE_2013_EXAMPLE parses to valid KdfParams");
        RecoveryJob {
            format: Format::Ooxml,
            hash: OFFICE_2013_EXAMPLE.into(),
            hashcat_mode: 9600,
            params,
        }
    }

    /// Noop rule (`:`) passes words verbatim; "hashcat" at index 1 is found.
    #[test]
    fn finds_password_in_shard_via_rules() {
        let job = office_2013_job();
        let words: Vec<String> = vec!["foo".into(), "hashcat".into(), "bar".into()];
        let rules = parse_rules(":").expect("noop rule parses");
        let outcome = recover_shard(
            &job,
            &words,
            &ShardSpec {
                word_start: 0,
                word_end: 3,
            },
            &rules,
        );
        assert_eq!(outcome.found.as_deref(), Some("hashcat"));
        assert!(outcome.candidates_tried >= 1);
    }

    /// A shard covering only index 1..2 must NOT find "hashcat" at index 0.
    #[test]
    fn shard_range_is_respected() {
        let job = office_2013_job();
        let words: Vec<String> = vec!["hashcat".into(), "foo".into()];
        let rules = parse_rules(":").expect("noop rule parses");
        let outcome = recover_shard(
            &job,
            &words,
            &ShardSpec {
                word_start: 1,
                word_end: 2,
            },
            &rules,
        );
        assert_eq!(outcome.found, None);
    }

    /// A rule transformation feeds verify: word "HASHCAT" + rule `l` (lowercase)
    /// produces candidate "hashcat" which authenticates.
    #[test]
    fn rule_expansion_feeds_verify() {
        let job = office_2013_job();
        // "HASHCAT" in uppercase; the `l` rule lowercases it to "hashcat".
        let words: Vec<String> = vec!["HASHCAT".into()];
        let rules = parse_rules("l").expect("lowercase rule parses");
        let outcome = recover_shard(
            &job,
            &words,
            &ShardSpec {
                word_start: 0,
                word_end: 1,
            },
            &rules,
        );
        assert_eq!(outcome.found.as_deref(), Some("hashcat"));
        assert_eq!(outcome.candidates_tried, 1);
    }

    /// A spec whose end exceeds words.len() is clamped — no panic.
    #[test]
    fn out_of_range_spec_is_clamped_not_panicked() {
        let job = office_2013_job();
        let words: Vec<String> = vec!["foo".into()];
        let rules = parse_rules(":").expect("noop rule parses");
        // word_end=999 far exceeds words.len()=1; must not panic.
        let outcome = recover_shard(
            &job,
            &words,
            &ShardSpec {
                word_start: 0,
                word_end: 999,
            },
            &rules,
        );
        // "foo" is not the password, so found is None; candidates_tried is 1.
        assert_eq!(outcome.found, None);
        assert_eq!(outcome.candidates_tried, 1);
    }
}
