//! The near-duplicate fingerprint: a 64-bit SimHash over word shingles of normalized text.
//!
//! What it is for, and what it is deliberately not. Clustering, thresholds, and the reviewer-facing
//! similarity surface are not built here — this module only computes and compares the value. It is
//! computed now because it is free where the text is already in memory and ruinous later: the text
//! of a whole production would have to be re-extracted to backfill it, which at discovery volumes is
//! not a migration but a second processing run.
//!
//! Why SimHash and not a content hash: an exact hash answers "are these the same bytes", which the
//! SHA-256 already answers. This answers "is this the same document with a paragraph changed", which
//! is the question a reviewer looking at ten thousand versions of one contract is actually asking.
//! Two fingerprints are compared by Hamming distance — small distance, similar documents.
//!
//! Determinism is the whole contract. No floating point, no hash-map iteration, no randomized
//! hashing, no locale: the same normalized text produces the same 64 bits on every target, forever,
//! or a re-processing years from now silently reclusters a corpus.

use crate::limits::Limits;

/// How many consecutive words make one shingle. Three is the standard trade: short enough that a
/// changed sentence leaves most shingles intact, long enough that common phrases do not make every
/// document in a corpus look alike.
const SHINGLE_WORDS: usize = 3;

/// Fingerprint already-normalized text. The input MUST be `normalize`d output — the whole point of
/// the normalization boundary is that two renderings of one document reach this function identical.
pub fn text_fingerprint(normalized_text: &str) -> u64 {
    text_fingerprint_with_limits(normalized_text, &Limits::default())
}

/// [`text_fingerprint`] with an explicit shingle ceiling.
pub fn text_fingerprint_with_limits(normalized_text: &str, limits: &Limits) -> u64 {
    let words: Vec<&str> = normalized_text.split_ascii_whitespace().collect();
    if words.is_empty() {
        return 0;
    }
    // A signed accumulator per bit: each shingle pushes every bit toward one or zero, and the sign
    // of the total is the bit. Integers throughout — a float accumulator would make the answer
    // depend on summation order.
    let mut weights = [0i64; 64];
    let shingles = if words.len() < SHINGLE_WORDS {
        1
    } else {
        words.len() - SHINGLE_WORDS + 1
    };
    for start in 0..shingles.min(limits.max_fingerprint_shingles) {
        let end = (start + SHINGLE_WORDS).min(words.len());
        let hash = hash_shingle(&words[start..end]);
        for (bit, weight) in weights.iter_mut().enumerate() {
            if hash >> bit & 1 == 1 {
                *weight += 1;
            } else {
                *weight -= 1;
            }
        }
    }
    let mut fingerprint = 0u64;
    for (bit, weight) in weights.iter().enumerate() {
        // A tied bit resolves to one, so the rule is total: there is no input for which the answer
        // depends on anything but the counts.
        if *weight >= 0 {
            fingerprint |= 1 << bit;
        }
    }
    fingerprint
}

/// FNV-1a over the shingle's words with a single space between them. Chosen because it is a fixed,
/// tiny, unseeded specification: a hash whose constants live in the standard library could change
/// with a toolchain and silently reshuffle every fingerprint the platform has ever stored.
fn hash_shingle(words: &[&str]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            hash ^= u64::from(b' ');
            hash = hash.wrapping_mul(PRIME);
        }
        for byte in word.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(PRIME);
        }
    }
    hash
}

/// How many bits two fingerprints differ in. Zero means the normalized texts produced the same
/// signature; 64 means they agree on nothing.
pub fn hamming_distance(left: u64, right: u64) -> u32 {
    (left ^ right).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalize::normalize;

    const CONTRACT: &str = "The seller shall indemnify and hold harmless the buyer against any \
        environmental liability arising from the operation of the facility before the closing date, \
        including remediation costs and third party claims.";

    #[test]
    fn identical_text_fingerprints_identically() {
        assert_eq!(text_fingerprint(CONTRACT), text_fingerprint(CONTRACT));
    }

    #[test]
    fn a_committed_vector_pins_the_value_across_toolchains_and_targets() {
        // A stored fingerprint is compared against fingerprints computed years later, so the
        // algorithm is a wire format. This vector fails if the hash, the shingle width, the bit
        // order, or the tie rule ever moves.
        assert_eq!(
            text_fingerprint("the seller shall indemnify"),
            0x97fb_b7be_bfe1_da6f
        );
        assert_eq!(text_fingerprint(""), 0);
    }

    #[test]
    fn a_small_edit_moves_only_a_few_bits_and_a_different_document_moves_many() {
        let edited = CONTRACT.replace("before the closing date", "after the closing date");
        let unrelated = "Plaintiff moves for summary judgment on the third cause of action, \
            arguing that no genuine dispute of material fact remains as to the statute of limitations.";
        let near = hamming_distance(text_fingerprint(CONTRACT), text_fingerprint(&edited));
        let far = hamming_distance(text_fingerprint(CONTRACT), text_fingerprint(unrelated));
        assert!(near < far, "near {near} should be under far {far}");
        assert!(near <= 12, "a one-word edit moved {near} bits");
        assert!(far >= 20, "an unrelated document moved only {far} bits");
    }

    #[test]
    fn word_order_is_content_rather_than_noise() {
        let forward = "the seller shall indemnify the buyer";
        let reversed = "the buyer shall indemnify the seller";
        assert_ne!(text_fingerprint(forward), text_fingerprint(reversed));
    }

    #[test]
    fn the_normalization_boundary_makes_two_renderings_of_one_document_agree() {
        let windows = "The\u{00A0}seller shall indemnify\r\nthe buyer.";
        let unix = "The seller shall indemnify\nthe buyer.";
        assert_eq!(
            text_fingerprint(&normalize(windows)),
            text_fingerprint(&normalize(unix))
        );
    }

    #[test]
    fn the_shingle_ceiling_bounds_the_work_without_changing_a_short_documents_answer() {
        let limits = Limits {
            max_fingerprint_shingles: 4,
            ..Limits::default()
        };
        // A document under the ceiling is unaffected by it.
        let short = "the seller shall indemnify";
        assert_eq!(
            text_fingerprint_with_limits(short, &limits),
            text_fingerprint(short)
        );
        // A document over it still answers, rather than running unbounded.
        let long = CONTRACT.repeat(50);
        assert_ne!(text_fingerprint_with_limits(&long, &limits), 0);
    }
}
