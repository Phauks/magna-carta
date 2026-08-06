//! The dual-target determinism vectors.
//!
//! This engine compiles native for the discovery Container and the desktop client, and to `wasm32`
//! for the Worker and the browser. THE TWO MUST PRODUCE THE SAME BYTES, because the extracted text
//! feeds a hash and an index: a desktop that normalizes, chunks, or fingerprints differently from
//! the server builds an index that disagrees with the server's about what a document says, and two
//! fingerprints of one document that do not match are a deduplication that has silently stopped
//! working.
//!
//! The vectors below are COMMITTED VALUES, not self-comparisons. A test that runs the same code
//! twice and compares proves determinism within a build and nothing at all about the other target,
//! or about next year's toolchain. Every value here was computed once and pinned, and the same
//! assertions run under `cargo test` (native) and `wasm-pack test` (wasm32), so the two targets are
//! compared against the same fixed answers rather than against each other.

use crate::chunk::Page;
use crate::digest::digest_all;
use crate::fingerprint::text_fingerprint;
use crate::normalize::normalize;
use crate::{passages_from_pages, DocumentReading, Limits};

/// The fixture every vector below is computed over: mixed line endings, a decomposed accent, a
/// non-breaking space, and a zero-width joiner — one of each thing normalization exists to settle.
const FIXTURE: &str =
    "The\u{00A0}seller shall inde\u{200D}mnify Rene\u{0301}e.\r\nEnvironmental liability follows.\r";

/// Every assertion, in one function, called from a native `#[test]` and a wasm `#[wasm_bindgen_test]`
/// so neither target can drift without the other noticing.
pub(crate) fn assert_determinism_vectors() {
    // 1. Normalization — the boundary everything else is derived through.
    assert_eq!(
        normalize(FIXTURE),
        "The seller shall indemnify Renée.\nEnvironmental liability follows."
    );

    // 2. The five-algorithm digest set, over bytes rather than text, so it is target-independent by
    //    construction and pinned here to prove it.
    let digests = digest_all(b"exhibit 12");
    assert_eq!(digests.md5, "df20153f94e2af584ff1b2c1714f2f3b");
    assert_eq!(
        digests.sha256,
        "4eb3d012300ed2896b3c433da6cf12c4e742bca2403fd9dbd71eda4fa32e0c65"
    );

    // 3. Chunking — the passage boundaries the index is built on.
    let passages = passages_from_pages(&[
        Page {
            page_index: 0,
            lines: vec![
                "the seller shall".to_owned(),
                "indemnify the buyer".to_owned(),
            ],
        },
        Page {
            page_index: 1,
            lines: vec!["  ".to_owned()],
        },
        Page {
            page_index: 2,
            lines: vec!["environmental liability".to_owned()],
        },
    ]);
    assert_eq!(passages.len(), 2);
    assert_eq!(passages[0].chunk_id, "page-0");
    assert_eq!(passages[0].text, "the seller shall\nindemnify the buyer");
    assert_eq!(passages[1].chunk_id, "page-2");
    assert_eq!(passages[1].page, 3);

    // 4. The near-duplicate fingerprint over the normalized text.
    assert_eq!(text_fingerprint(&normalize(FIXTURE)), 0x138b_f27d_fd90_8826);

    // 5. The whole pipeline over one document, so the ORDER of the stages is pinned too — a
    //    fingerprint taken before normalization instead of after would pass every check above.
    let bytes = FIXTURE.as_bytes();
    let DocumentReading::Read(read) = crate::read_document(bytes, &Limits::default()).unwrap()
    else {
        panic!("the fixture reads as a document");
    };
    assert_eq!(read.passages.len(), 1);
    assert_eq!(read.fingerprint, text_fingerprint(&normalize(FIXTURE)));
    assert_eq!(read.digests.sha256, digest_all(bytes).sha256);
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_native_target_produces_the_committed_vectors() {
        super::assert_determinism_vectors();
    }
}

#[cfg(all(target_arch = "wasm32", test))]
mod wasm_tests {
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn the_wasm_target_produces_the_same_committed_vectors() {
        super::assert_determinism_vectors();
    }
}
