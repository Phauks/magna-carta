//! Keyspace sharding: splits a wordlist index range into near-even contiguous
//! slices for parallel candidate generation.
//!
//! Each shard is a half-open index range `[word_start, word_end)` into the
//! wordlist. Shards are contiguous and together cover `0..word_count` exactly,
//! so every word is processed by exactly one worker.

use crate::rules::RuleSet;

/// A half-open wordlist index range `[word_start, word_end)`.
///
/// A worker assigned this shard processes words at indices
/// `word_start..word_end` from the wordlist, applying every rule in the
/// assigned `RuleSet` to each word.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShardSpec {
    /// Inclusive start index into the wordlist.
    pub word_start: usize,
    /// Exclusive end index into the wordlist.
    pub word_end: usize,
}

/// Split `word_count` wordlist entries into at most `shard_count` contiguous,
/// near-even, non-empty shards whose union is exactly `0..word_count`.
///
/// Properties guaranteed by the return value:
/// - No shard is empty (`word_end > word_start` for every element).
/// - Shards are contiguous: `shards[i].word_end == shards[i+1].word_start`.
/// - The union spans exactly `0..word_count`:
///   `shards.first().word_start == 0` and `shards.last().word_end == word_count`.
/// - The sum of each shard's size equals `word_count`.
///
/// Edge-case behaviour:
/// - `shard_count == 0` is treated as `1` (a single shard covering all words).
/// - When `word_count < shard_count`, at most `word_count` non-empty shards are
///   emitted; the tail of empty shards that would otherwise result is dropped.
/// - When `word_count == 0`, an empty `Vec` is returned (no coverage needed).
///
/// Never panics on any combination of inputs.
pub fn split_keyspace(word_count: usize, shard_count: usize) -> Vec<ShardSpec> {
    if word_count == 0 {
        return Vec::new();
    }

    let effective_count = if shard_count == 0 { 1 } else { shard_count };

    let base = word_count / effective_count;
    let remainder = word_count % effective_count;

    let mut shards = Vec::with_capacity(effective_count.min(word_count));
    let mut cursor = 0usize;

    for index in 0..effective_count {
        // The first `remainder` shards each carry one extra word so that the
        // distribution is as even as possible.
        let size = if index < remainder { base + 1 } else { base };

        // Once size reaches zero (base == 0 and the remainder budget is
        // exhausted) all subsequent shards would also be empty — stop here.
        if size == 0 {
            break;
        }

        shards.push(ShardSpec {
            word_start: cursor,
            word_end: cursor + size,
        });
        cursor += size;
    }

    shards
}

/// The total number of password candidates this shard generates.
///
/// Each of the `word_end - word_start` words is combined with every rule in
/// `rules`, producing one candidate per (word, rule) pair.
pub fn shard_candidate_count(spec: &ShardSpec, rules: &RuleSet) -> usize {
    (spec.word_end - spec.word_start) * rules.len()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::parse_rules;

    #[test]
    fn split_is_complete_and_disjoint() {
        let shards = split_keyspace(100, 8);
        assert_eq!(shards.first().unwrap().word_start, 0);
        assert_eq!(shards.last().unwrap().word_end, 100);
        // contiguous, no gap/overlap
        for pair in shards.windows(2) {
            assert_eq!(pair[0].word_end, pair[1].word_start);
        }
        let total: usize = shards.iter().map(|s| s.word_end - s.word_start).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn handles_fewer_words_than_shards() {
        let shards = split_keyspace(3, 8); // never an empty middle shard that breaks coverage
        let total: usize = shards.iter().map(|s| s.word_end - s.word_start).sum();
        assert_eq!(total, 3);
    }

    #[test]
    fn shard_candidate_count_is_words_times_rules() {
        let rules = parse_rules(":\nl\nu").expect("three-rule set parses");
        let spec = ShardSpec {
            word_start: 10,
            word_end: 20,
        };
        // 10 words × 3 rules = 30 candidates
        assert_eq!(shard_candidate_count(&spec, &rules), 30);
    }

    #[test]
    fn zero_word_count_covers_nothing() {
        let shards = split_keyspace(0, 8);
        let total: usize = shards.iter().map(|s| s.word_end - s.word_start).sum();
        assert_eq!(total, 0);
    }

    #[test]
    fn zero_shard_count_treated_as_one() {
        let shards = split_keyspace(50, 0);
        assert_eq!(shards.len(), 1);
        assert_eq!(shards[0].word_start, 0);
        assert_eq!(shards[0].word_end, 50);
    }

    #[test]
    fn exact_divisible_split_has_equal_shards() {
        let shards = split_keyspace(12, 4);
        assert_eq!(shards.len(), 4);
        for shard in &shards {
            assert_eq!(shard.word_end - shard.word_start, 3);
        }
    }

    #[test]
    fn single_word_across_many_shards() {
        let shards = split_keyspace(1, 100);
        assert_eq!(shards.len(), 1);
        assert_eq!(shards[0].word_start, 0);
        assert_eq!(shards[0].word_end, 1);
    }
}
