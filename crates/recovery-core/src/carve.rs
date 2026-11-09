//! The carving fallback pillar: format-agnostic extraction of embedded known-type
//! files from any blob. Scans a header/footer signature table, resolves each
//! candidate's extent by trying footer positions until one actually PARSES/DECODES
//! as its type, and returns the found files with an honest, never-complete loss
//! manifest. A separate entry point — NOT part of the detect()-keyed dispatch.
//!
//! `recovered: true` always means a carved run actually parsed/decoded as its type
//! (a real image/zip/pdf), never merely that a header and a terminator byte were
//! present — a coincidental or premature terminator (a ZIP end-of-central-directory
//! signature inside compressed data, a JPEG thumbnail's EOI before the main image)
//! is stepped over, and a run that never validates is reported lost, not recovered.

mod signatures;

pub use signatures::{Signature, SIGNATURES};

use std::io::Cursor;

use aho_corasick::AhoCorasick;

use crate::error::RepairError;
use crate::limits::MAX_ENTRY_COUNT;
use crate::model::{LossManifest, RecoveredItem, RepairResult, SalvagedFile};

/// The most footer positions to try per header before giving up. Bounds the work
/// on a pathological blob (a header followed by a dense field of terminator bytes)
/// while still stepping over a handful of premature terminators (a thumbnail EOI,
/// an incremental-update marker).
const MAX_FOOTER_ATTEMPTS: usize = 256;

/// The total number of validation parses allowed across one `carve` call. Bounds
/// aggregate work when a blob fans out into many header × footer-attempt parses;
/// real inputs use far fewer. A host wiring `carve` to an endpoint must still cap
/// the input size and run heavy blobs on the container lane — this bounds the
/// parse fan-out, not wall-clock.
const MAX_TOTAL_VALIDATIONS: usize = 1024;

/// How one header's extent resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    /// A footer-delimited run that actually parsed/decoded as its type.
    Validated,
    /// A header with NO terminator within the cap — a truncated partial (real data
    /// up to the cap, but incomplete): worth handing back, flagged not recovered.
    Truncated,
    /// A header (with one or more terminators present) but no extent that parsed —
    /// a false-positive header or content too corrupt to trust: listed lost, not
    /// emitted.
    NoValidExtent,
}

/// Extract embedded known-type files from an arbitrary blob. Format-agnostic
/// fallback for when the format pillars cannot help. Each recovered fragment is a
/// run that actually parsed/decoded as its type; the loss manifest lists every
/// candidate and is deliberately never "fully recovered" — carving cannot certify
/// it found every embedded file. `Err(Unrepairable)` when nothing extractable and
/// trustworthy is present.
pub fn carve(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    // Build the automaton from the header patterns, in SIGNATURES order so a match's
    // pattern index maps straight back to the signature.
    let headers: Vec<&[u8]> = SIGNATURES.iter().map(|s| s.header).collect();
    let automaton = match AhoCorasick::new(&headers) {
        Ok(automaton) => automaton,
        Err(_) => return Err(RepairError::Unrepairable),
    };

    let mut files = Vec::new();
    let mut items = Vec::new();
    let mut cursor = 0;
    let mut index = 0u32;
    let mut budget = MAX_TOTAL_VALIDATIONS;
    while cursor < bytes.len() && items.len() < MAX_ENTRY_COUNT {
        let Some(m) = automaton.find(&bytes[cursor..]) else {
            break;
        };
        let signature = m.pattern().as_usize();
        let start = cursor + m.start();
        let sig = &SIGNATURES[signature];
        let (end, outcome, more_after) = resolve_extent(bytes, sig, start, &mut budget);

        index += 1;
        let name = format!("{index:04}.{}", sig.extension);
        // recovered = actually parsed/decoded; emit = worth handing back. A truncated
        // partial is emitted but flagged not recovered; a header that never validated
        // is listed lost and NOT emitted, so garbage is never handed back.
        let (recovered, emit, detail) = match outcome {
            // A later end-marker after a valid run means the blob may hold a newer
            // revision of this file or another file — disclosed so a recovered
            // fragment is never implied to be the exclusive or latest version.
            Outcome::Validated if more_after => (
                true,
                true,
                "extracted as a valid file; a later end-marker was found, so the source may hold a newer revision or additional data".to_string(),
            ),
            Outcome::Validated => (true, true, String::new()),
            Outcome::Truncated => (
                false,
                true,
                "header found but no terminator within the size cap; extraction is truncated"
                    .to_string(),
            ),
            Outcome::NoValidExtent => (
                false,
                false,
                "signature matched but no valid file could be extracted".to_string(),
            ),
        };
        if emit {
            files.push(SalvagedFile {
                name: name.clone(),
                bytes: bytes[start..end].to_vec(),
                media_type: Some(sig.media_type.to_string()),
            });
        }
        items.push(RecoveredItem {
            name,
            recovered,
            detail,
        });

        // Advance past a validated/truncated run (its bytes are consumed); for a
        // header that never validated, step just past the header so a real file
        // sitting right after a false-positive header is still found.
        cursor = match outcome {
            Outcome::Validated | Outcome::Truncated => end.max(start + 1),
            Outcome::NoValidExtent => start + sig.header.len(),
        };

        // The validation budget is spent — remaining headers cannot be confirmed,
        // so stop rather than spin scanning without validating.
        if budget == 0 {
            break;
        }
    }

    if files.is_empty() {
        // No candidates, or candidates found but none produced a trustworthy file.
        return Err(RepairError::Unrepairable);
    }

    Ok(RepairResult {
        files,
        loss: LossManifest {
            items,
            // Carving can never certify it found every embedded file.
            fully_recovered: false,
            // Every output is a verbatim byte range — nothing is fabricated.
            synthesized: Vec::new(),
        },
    })
}

/// Resolve one header's extent. Try each footer occurrence (shortest run first)
/// and accept the first run that VALIDATES as a real file of its type; this steps
/// over premature terminators (a thumbnail's EOI, a coincidental end-of-archive
/// signature). If no footer occurrence validates, report `NoValidExtent` (a footer
/// was present but nothing parsed) or `Truncated` (no footer at all within the cap).
/// Returns `(end, outcome, more_after)`; `more_after` is true when a validated run
/// has a further footer occurrence after it (the blob may hold more of this file or
/// another). `budget` is the shared count of validation parses left this carve;
/// exhausting it stops further attempts (they resolve as `NoValidExtent`).
fn resolve_extent(
    bytes: &[u8],
    sig: &Signature,
    start: usize,
    budget: &mut usize,
) -> (usize, Outcome, bool) {
    let body_start = start + sig.header.len();
    let cap_end = start.saturating_add(sig.max_len).min(bytes.len());
    match sig.footer {
        None => {
            if *budget == 0 {
                return (cap_end, Outcome::NoValidExtent, false);
            }
            *budget -= 1;
            if validate_run(sig, &bytes[start..cap_end]) {
                (cap_end, Outcome::Validated, false)
            } else {
                (cap_end, Outcome::NoValidExtent, false)
            }
        }
        Some(footer) => {
            let mut search = body_start;
            let mut any_footer = false;
            let mut attempts = 0;
            while attempts < MAX_FOOTER_ATTEMPTS && *budget > 0 {
                let Some(at) = find_from(&bytes[..cap_end], footer, search) else {
                    break;
                };
                any_footer = true;
                attempts += 1;
                *budget -= 1;
                // The footer signature is not always the file's last byte — a ZIP's
                // end-of-central-directory record carries 18 fixed bytes plus a
                // variable comment after its signature. Compute the true end.
                let end = footer_end(sig, bytes, at, cap_end);
                if validate_run(sig, &bytes[start..end]) {
                    let more_after = find_from(&bytes[..cap_end], footer, end).is_some();
                    return (end, Outcome::Validated, more_after);
                }
                search = at + 1;
            }
            if any_footer {
                (cap_end, Outcome::NoValidExtent, false)
            } else {
                (cap_end, Outcome::Truncated, false)
            }
        }
    }
}

/// The byte index just past a file's real end, given its footer signature matched
/// at `at`. For most types the footer IS the last bytes; ZIP's end-of-central-
/// directory record extends 22 fixed bytes plus its comment beyond the signature.
fn footer_end(sig: &Signature, bytes: &[u8], at: usize, cap_end: usize) -> usize {
    match sig.media_type {
        "application/zip" => {
            // EOCD layout: signature(4) + 16 fixed bytes + comment length(2) at
            // offset 20 + comment. Fall back to the bare signature if the fixed
            // record does not fit (a truncated EOCD — validation will then reject it).
            if at + 22 <= bytes.len() {
                let comment_len = u16::from_le_bytes([bytes[at + 20], bytes[at + 21]]) as usize;
                (at + 22 + comment_len).min(cap_end)
            } else {
                at + sig.footer.map_or(0, |f| f.len())
            }
        }
        _ => at + sig.footer.map_or(0, |f| f.len()),
    }
}

/// Validate a carved run by actually parsing/decoding it as its type — so a
/// recovered fragment is a real file, not a coincidental header+footer. Images use
/// a header-only decode (bounds work, no full-pixel decode bomb); ZIP/PDF use their
/// readers. An unknown type never validates.
fn validate_run(sig: &Signature, run: &[u8]) -> bool {
    match sig.media_type {
        // zune-jpeg 0.5's `JpegDecoder` reads via `ZByteReaderTrait`, which a bare
        // `&[u8]` does not implement — wrap it in `ZCursor` (re-exported from
        // zune_jpeg, so no separate zune-core dependency is needed).
        "image/jpeg" => {
            zune_jpeg::JpegDecoder::new(zune_jpeg::zune_core::bytestream::ZCursor::new(run))
                .decode_headers()
                .is_ok()
        }
        // zune-png 0.5 reads via `ZByteReaderTrait` too, so it takes the same `ZCursor` wrapper.
        "image/png" => {
            zune_png::PngDecoder::new(zune_png::zune_core::bytestream::ZCursor::new(run))
                .decode_headers()
                .is_ok()
        }
        // A real archive opens (central directory present and consistent).
        "application/zip" => zip::ZipArchive::new(Cursor::new(run)).is_ok(),
        // A real PDF loads (a findable, parseable cross-reference + trailer).
        "application/pdf" => lopdf::Document::load_mem(run).is_ok(),
        _ => false,
    }
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
mod tests {
    use super::*;

    /// A minimal valid 1x1 PNG.
    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    fn sig_for(media_type: &str) -> &'static Signature {
        SIGNATURES
            .iter()
            .find(|s| s.media_type == media_type)
            .unwrap()
    }

    fn minimal_pdf() -> Vec<u8> {
        use lopdf::{dictionary, Document, Object};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    // ── validate_run: recovered:true means a real parse/decode ────────────────

    #[test]
    fn validate_run_accepts_a_real_png_and_rejects_garbage() {
        let sig = sig_for("image/png");
        assert!(validate_run(sig, TINY_PNG));
        assert!(!validate_run(
            sig,
            &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFF]
        ));
    }

    #[test]
    fn validate_run_accepts_a_real_zip_and_rejects_a_fake_delimited_one() {
        let sig = sig_for("application/zip");
        let zip = crate::zip_repair::tests_build_minimal_zip();
        assert!(validate_run(sig, &zip));
        // A coincidental header+EOCD-signature bounding garbage must NOT validate —
        // this is the crown-rule fix: structural delimiting alone is not recovery.
        assert!(!validate_run(
            sig,
            b"PK\x03\x04 not a real archive PK\x05\x06 tail"
        ));
    }

    #[test]
    fn validate_run_accepts_a_real_pdf_and_rejects_a_fake_delimited_one() {
        let sig = sig_for("application/pdf");
        assert!(validate_run(sig, &minimal_pdf()));
        assert!(!validate_run(sig, b"%PDF-1.5 not a real document %%EOF"));
    }

    // ── carve end to end ──────────────────────────────────────────────────────

    #[test]
    fn carves_an_embedded_png_and_never_claims_full_recovery() {
        let mut blob = b"leading junk".to_vec();
        blob.extend_from_slice(TINY_PNG);
        blob.extend_from_slice(b"trailing junk");
        let result = carve(&blob).expect("carvable");
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].media_type.as_deref(), Some("image/png"));
        assert_eq!(result.files[0].name, "0001.png");
        assert_eq!(result.files[0].bytes, TINY_PNG);
        assert!(!result.loss.fully_recovered);
        assert!(result.loss.synthesized.is_empty());
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 1);
    }

    #[test]
    fn a_later_end_marker_is_disclosed_not_implied_exclusive() {
        // Two valid PNGs back to back: both are recovered, and the first discloses
        // that a later end-marker exists (so it is not implied to be the only one).
        let mut blob = TINY_PNG.to_vec();
        blob.extend_from_slice(TINY_PNG);
        let result = carve(&blob).expect("carvable");
        assert_eq!(result.files.len(), 2);
        assert!(result.loss.items[0].recovered);
        assert!(result.loss.items[0].detail.contains("later end-marker"));
        // The second (last) one has no later end-marker, so no such note.
        assert!(!result.loss.items[1].detail.contains("later end-marker"));
    }

    #[test]
    fn carves_an_embedded_zip() {
        let zip = crate::zip_repair::tests_build_minimal_zip();
        let mut blob = b"....".to_vec();
        blob.extend_from_slice(&zip);
        blob.extend_from_slice(b"....");
        let result = carve(&blob).expect("carvable");
        assert!(result
            .files
            .iter()
            .any(|f| f.media_type.as_deref() == Some("application/zip")));
    }

    #[test]
    fn a_fake_delimited_candidate_is_listed_lost_not_recovered() {
        // A real PNG plus a coincidental zip header+EOCD around garbage: the PNG is
        // recovered, the fake zip is NOT emitted and is reported lost.
        let mut blob = b"PK\x03\x04garbage between PK\x05\x06".to_vec();
        blob.extend_from_slice(TINY_PNG);
        let result = carve(&blob).expect("the png is carvable");
        assert!(result
            .files
            .iter()
            .all(|f| f.media_type.as_deref() != Some("application/zip")));
        assert!(result
            .files
            .iter()
            .any(|f| f.media_type.as_deref() == Some("image/png")));
        // The fake zip is accounted for as lost.
        assert!(result.loss.items.iter().any(|i| !i.recovered));
    }

    #[test]
    fn a_blob_with_no_signatures_is_unrepairable() {
        assert!(carve(b"just some plain text, nothing embedded at all").is_err());
    }

    #[test]
    fn a_blob_of_only_false_positive_headers_is_unrepairable() {
        // A zip header + EOCD around garbage, nothing else — no valid file → Err.
        assert!(carve(b"PK\x03\x04 nope PK\x05\x06").is_err());
    }

    #[test]
    fn a_truncated_jpeg_is_emitted_but_flagged_not_recovered() {
        let mut blob = b"junk".to_vec();
        blob.extend_from_slice(&[0xFF, 0xD8, 0xFF]); // JPEG header, no FF D9 terminator
        blob.extend_from_slice(b"incomplete image data with no terminator");
        let result = carve(&blob).expect("a truncated partial is handed back");
        assert!(!result.loss.fully_recovered);
        assert!(result.loss.items.iter().any(|i| !i.recovered));
        assert_eq!(result.files.len(), 1); // the truncated partial is emitted
    }

    #[test]
    fn a_gif_header_is_no_longer_carved() {
        // GIF was dropped (its 1-byte 0x3B trailer cannot honestly delimit a file).
        let blob = b"GIF89a\x00\x01\x02\x3b trailing";
        assert!(carve(blob).is_err());
    }
}
