//! The carving fallback pillar: format-agnostic extraction of embedded known-type
//! files from any blob. Scans a header/footer signature table, bounds each
//! candidate, validates it, and returns the found files with an honest,
//! never-complete loss manifest. A separate entry point — NOT part of the
//! detect()-keyed repair/diagnose dispatch.

mod signatures;

pub use signatures::{Signature, SIGNATURES};

use aho_corasick::AhoCorasick;

/// One located candidate: which signature matched, the extracted byte range, and
/// whether it was cut at the size cap because no footer was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub signature: usize,
    pub start: usize,
    pub end: usize,
    pub truncated: bool,
}

/// Scan `bytes` for every signature header, and bound each match's extent by the
/// type's footer (searched after the header, within `max_len`) or, failing that,
/// by `max_len` / the next header / end of blob (recorded `truncated`). Overlapping
/// candidates are skipped: after emitting one, scanning resumes at its end. Stops
/// after `max_count` candidates.
pub fn scan_candidates(bytes: &[u8], max_count: usize) -> Vec<Candidate> {
    // Build the automaton from the header patterns, in SIGNATURES order so a match's
    // pattern index maps straight back to the signature.
    let headers: Vec<&[u8]> = SIGNATURES.iter().map(|s| s.header).collect();
    let automaton = match AhoCorasick::new(&headers) {
        Ok(automaton) => automaton,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(m) = automaton.find(&bytes[cursor..]) else {
            break;
        };
        let signature = m.pattern().as_usize();
        let start = cursor + m.start();
        let sig = &SIGNATURES[signature];

        let body_start = start + sig.header.len();
        let cap_end = start.saturating_add(sig.max_len).min(bytes.len());
        let (end, truncated) = match sig.footer {
            Some(footer) => match find_from(&bytes[..cap_end], footer, body_start) {
                Some(at) => (at + footer.len(), false),
                None => (cap_end, true),
            },
            None => (cap_end, true),
        };

        out.push(Candidate {
            signature,
            start,
            end,
            truncated,
        });
        if out.len() >= max_count {
            break;
        }
        // Resume after this candidate to avoid re-matching a header inside it.
        cursor = end.max(start + 1);
    }
    out
}

/// Index of the first occurrence of `needle` in `haystack` at or after `start`.
fn find_from(haystack: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    if needle.is_empty() || start >= haystack.len() || haystack.len() - start < needle.len() {
        return None;
    }
    haystack[start..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|position| start + position)
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    /// A blob = junk + a tiny fake JPEG (header..footer) + junk.
    fn blob_with_jpeg() -> Vec<u8> {
        let mut v = b"....junk....".to_vec();
        v.extend_from_slice(&[0xFF, 0xD8, 0xFF]); // JPEG header
        v.extend_from_slice(b"body");
        v.extend_from_slice(&[0xFF, 0xD9]); // JPEG footer
        v.extend_from_slice(b"....trailing....");
        v
    }

    #[test]
    fn finds_an_embedded_candidate_bounded_by_its_footer() {
        let blob = blob_with_jpeg();
        let found = scan_candidates(&blob, 1000);
        assert_eq!(found.len(), 1);
        let c = &found[0];
        assert_eq!(SIGNATURES[c.signature].media_type, "image/jpeg");
        assert!(!c.truncated);
        // The extracted range is exactly header..=footer.
        assert_eq!(
            &blob[c.start..c.end],
            &[0xFF, 0xD8, 0xFF, b'b', b'o', b'd', b'y', 0xFF, 0xD9]
        );
    }

    #[test]
    fn a_header_without_a_footer_is_truncated_and_bounded() {
        let mut blob = b"junk".to_vec();
        blob.extend_from_slice(&[0xFF, 0xD8, 0xFF]);
        blob.extend_from_slice(b"no footer here");
        let found = scan_candidates(&blob, 1000);
        assert_eq!(found.len(), 1);
        assert!(found[0].truncated);
        assert_eq!(found[0].end, blob.len()); // bounded to end of blob
    }

    #[test]
    fn junk_yields_no_candidates() {
        assert!(scan_candidates(b"nothing to see here at all", 1000).is_empty());
    }

    #[test]
    fn respects_the_count_cap() {
        let mut blob = Vec::new();
        for _ in 0..5 {
            blob.extend_from_slice(&[0xFF, 0xD8, 0xFF]);
            blob.extend_from_slice(&[0xFF, 0xD9]);
        }
        assert_eq!(scan_candidates(&blob, 2).len(), 2);
    }
}
