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

/// How well a candidate was validated. `Decoded` (image header parsed) and
/// `Delimited` (non-image, header and footer both present) are reported recovered;
/// `Unconfirmed` (truncated, or an image whose header will not parse) is reported
/// lost — a signature match is not proof of a complete file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    Decoded,
    Delimited,
    Unconfirmed,
}

/// Validate a carved run. A truncated candidate is always `Unconfirmed`. An image
/// is `Decoded` only if its header parses; a delimited non-image is `Delimited`.
pub fn validate(run: &[u8], candidate: &Candidate) -> Confidence {
    if candidate.truncated {
        return Confidence::Unconfirmed;
    }
    let sig = &SIGNATURES[candidate.signature];
    if sig.image {
        if image_header_ok(sig.media_type, run) {
            Confidence::Decoded
        } else {
            Confidence::Unconfirmed
        }
    } else {
        // Non-image, header+footer found (truncated == false): structurally bounded.
        Confidence::Delimited
    }
}

/// Best-effort image validation via a header-only decode (never a full pixel
/// decode — that bounds work and avoids a decode bomb on a huge carved image).
fn image_header_ok(media_type: &str, run: &[u8]) -> bool {
    match media_type {
        // zune-jpeg 0.5's `JpegDecoder` reads via `ZByteReaderTrait`, which a bare
        // `&[u8]` does not implement directly — wrap it in `ZCursor` (re-exported
        // from zune_jpeg so no separate zune-core dependency is needed).
        "image/jpeg" => {
            zune_jpeg::JpegDecoder::new(zune_jpeg::zune_core::bytestream::ZCursor::new(run))
                .decode_headers()
                .is_ok()
        }
        // zune-png 0.4's `PngDecoder` reads via `ZReaderTrait`, implemented directly
        // for `&[u8]`, so no wrapper is needed here.
        "image/png" => zune_png::PngDecoder::new(run).decode_headers().is_ok(),
        _ => false,
    }
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

#[cfg(test)]
mod validate_tests {
    use super::*;

    #[test]
    fn a_real_png_header_decodes() {
        // Minimal valid PNG (1x1) — decode_headers must accept it.
        let png: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let candidate = Candidate {
            signature: png_index(),
            start: 0,
            end: png.len(),
            truncated: false,
        };
        assert_eq!(validate(png, &candidate), Confidence::Decoded);
    }

    #[test]
    fn a_fake_png_that_does_not_decode_is_unconfirmed() {
        let fake = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFF, 0xFF, 0xFF,
        ];
        let candidate = Candidate {
            signature: png_index(),
            start: 0,
            end: fake.len(),
            truncated: false,
        };
        assert_eq!(validate(fake, &candidate), Confidence::Unconfirmed);
    }

    #[test]
    fn a_delimited_non_image_is_delimited() {
        // A ZIP candidate with header+footer found (truncated: false) validates structurally.
        let zip_index = SIGNATURES
            .iter()
            .position(|s| s.media_type == "application/zip")
            .unwrap();
        let candidate = Candidate {
            signature: zip_index,
            start: 0,
            end: 8,
            truncated: false,
        };
        assert_eq!(
            validate(b"PK\x03\x04PK\x05\x06", &candidate),
            Confidence::Delimited
        );
    }

    #[test]
    fn a_truncated_candidate_is_unconfirmed() {
        let zip_index = SIGNATURES
            .iter()
            .position(|s| s.media_type == "application/zip")
            .unwrap();
        let candidate = Candidate {
            signature: zip_index,
            start: 0,
            end: 4,
            truncated: true,
        };
        assert_eq!(validate(b"PK\x03\x04", &candidate), Confidence::Unconfirmed);
    }

    fn png_index() -> usize {
        SIGNATURES
            .iter()
            .position(|s| s.media_type == "image/png")
            .unwrap()
    }
}
