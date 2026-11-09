//! The ZIP archetype-family repair pillar: salvage entries from local file
//! headers, re-emit a fresh archive, diagnose ZIP corruption.

use std::io::{Cursor, Read, Write};
use zip::read::{read_zipfile_from_stream, ZipArchive};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::RepairError;
use crate::limits::{MAX_ENTRY_COUNT, MAX_ENTRY_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES};
use crate::model::{CorruptionKind, LossManifest, Recoverability, RecoveredItem, RepairResult};

#[derive(Debug, Clone)]
pub struct SalvagedEntry {
    pub name: String,
    pub data: Option<Vec<u8>>,
    pub recovered: bool,
    pub detail: String,
}

/// Read each entry sequentially from its local file header, ignoring the
/// (missing/corrupt) central directory. A fully-decoded entry is recovered with
/// its bytes; an entry whose body cannot be fully read (truncated/corrupt) is
/// recorded lost, never silently dropped. Stops at the central-directory
/// signature or end of stream.
///
/// Enforces `MAX_ENTRY_COUNT`, `MAX_ENTRY_UNCOMPRESSED_BYTES`, and
/// `MAX_TOTAL_UNCOMPRESSED_BYTES` to guard against decompression bombs.
pub fn salvage_entries(bytes: &[u8]) -> Vec<SalvagedEntry> {
    salvage_entries_capped(
        bytes,
        MAX_ENTRY_UNCOMPRESSED_BYTES,
        MAX_TOTAL_UNCOMPRESSED_BYTES,
        MAX_ENTRY_COUNT,
    )
}

/// Inner implementation of `salvage_entries` with explicit caps. Used directly
/// in tests to exercise the cap logic with small synthetic limits.
fn salvage_entries_capped(
    bytes: &[u8],
    max_entry_bytes: u64,
    max_total_bytes: u64,
    max_count: usize,
) -> Vec<SalvagedEntry> {
    let mut reader = Cursor::new(bytes);
    let mut out = Vec::new();
    let mut total_recovered_bytes: u64 = 0;

    loop {
        // Stop after max_count entries have been seen.
        if out.len() >= max_count {
            break;
        }

        // A read error at the header boundary (e.g. truncated header) ends the scan.
        let next = match read_zipfile_from_stream(&mut reader) {
            Ok(Some(file)) => file,
            Ok(None) => break, // hit the central-directory signature: no more local entries
            Err(_) => break,   // a malformed/truncated local header: stop scanning
        };
        let name = next
            .name()
            .map(std::borrow::Cow::into_owned)
            .unwrap_or_else(|_| String::from_utf8_lossy(next.name_raw()).into_owned());
        // Directory entries carry no data; skip them (they are recreated on re-emit).
        if name.ends_with('/') {
            continue;
        }
        let mut file = next;

        // Read at most max_entry_bytes + 1 decompressed bytes. Reading one byte beyond
        // the cap detects whether the full entry exceeds it without loading the entire
        // payload into memory first.
        let cap: u64 = max_entry_bytes.saturating_add(1);
        let mut data = Vec::new();
        let read_result = (&mut file).take(cap).read_to_end(&mut data);

        match read_result {
            Err(_) => {
                out.push(SalvagedEntry {
                    name,
                    data: None,
                    recovered: false,
                    detail: "entry body truncated or corrupt".into(),
                });
            }
            Ok(_) => {
                if data.len() as u64 > max_entry_bytes {
                    // Only cap bytes were read; drain the remaining compressed bytes
                    // so the stream cursor stays aligned with the next local file header.
                    std::io::copy(&mut file, &mut std::io::sink()).ok();
                    out.push(SalvagedEntry {
                        name,
                        data: None,
                        recovered: false,
                        detail: "entry exceeds the per-entry size cap".into(),
                    });
                } else {
                    let entry_bytes = data.len() as u64;
                    if total_recovered_bytes.saturating_add(entry_bytes) > max_total_bytes {
                        out.push(SalvagedEntry {
                            name,
                            data: None,
                            recovered: false,
                            detail: "archive exceeds the total size cap".into(),
                        });
                        break; // stop inflating further
                    }
                    total_recovered_bytes += entry_bytes;
                    out.push(SalvagedEntry {
                        name,
                        data: Some(data),
                        recovered: true,
                        detail: String::new(),
                    });
                }
            }
        }
    }
    out
}

/// Write a fresh, valid zip (with a correct central directory) from recovered
/// (name, bytes) pairs. Entries are Deflated.
///
/// Per-entry write failures (from `start_file` or `write_all`) skip the entry
/// and push its name to the returned `skipped_names` — the loop continues so
/// remaining entries can still be written. Only `finish()` failing returns
/// `Err(Unrepairable)`. If every entry was skipped and there were entries to
/// write, `Err(Unrepairable)` is also returned.
pub fn rebuild_archive(
    entries: &[(String, Vec<u8>)],
) -> Result<(Vec<u8>, Vec<String>), RepairError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut skipped_names: Vec<String> = Vec::new();

    for (name, bytes) in entries {
        if writer.start_file(name, options).is_err() {
            skipped_names.push(name.clone());
            continue;
        }
        if writer.write_all(bytes).is_err() {
            skipped_names.push(name.clone());
            continue;
        }
    }

    // All entries were skipped and there were entries to write → nothing to salvage.
    if !entries.is_empty() && skipped_names.len() == entries.len() {
        return Err(RepairError::Unrepairable);
    }

    let cursor = writer.finish().map_err(|_| RepairError::Unrepairable)?;
    Ok((cursor.into_inner(), skipped_names))
}

/// Classify a zip's health: a readable central directory means intact; an
/// unreadable one with recoverable local-header entries is repairable; nothing
/// recoverable is unrecoverable.
///
/// The entry scan is delegated to `salvage_entries`, which enforces
/// decompression-bomb caps; diagnose inherits those caps.
pub fn diagnose_zip(bytes: &[u8]) -> (Vec<CorruptionKind>, Recoverability) {
    if ZipArchive::new(Cursor::new(bytes)).is_ok() {
        return (Vec::new(), Recoverability::Intact);
    }
    let recovered = salvage_entries(bytes)
        .into_iter()
        .filter(|e| e.recovered)
        .count();
    if recovered > 0 {
        (
            vec![CorruptionKind::MissingEndOfCentralDirectory],
            Recoverability::Repairable,
        )
    } else {
        (
            vec![CorruptionKind::Truncated],
            Recoverability::Unrecoverable,
        )
    }
}

/// Repair a damaged zip: salvage entries from local file headers, reconstruct the
/// OPC skeleton if it is an OOXML package, re-emit a fresh archive, and record an
/// honest loss manifest. Errors (rather than emitting an empty archive) when
/// nothing is recoverable.
pub fn repair_zip(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    let salvaged = salvage_entries(bytes);
    let recovered: Vec<(String, Vec<u8>)> = salvaged
        .iter()
        .filter_map(|e| e.data.clone().map(|d| (e.name.clone(), d)))
        .collect();
    if recovered.is_empty() {
        return Err(RepairError::Unrepairable);
    }

    // Snapshot names before OPC reconstruction to identify synthesized parts later.
    let is_ooxml = crate::ooxml::is_ooxml(&recovered);
    let names_before: std::collections::HashSet<String> =
        recovered.iter().map(|(n, _)| n.clone()).collect();

    let recovered = if is_ooxml {
        crate::ooxml::reconstruct_opc(recovered)
    } else {
        recovered
    };

    // Synthesized = parts added by OPC reconstruction that were not in the salvage scan.
    let synthesized: Vec<String> = recovered
        .iter()
        .filter_map(|(n, _)| {
            if names_before.contains(n) {
                None
            } else {
                Some(n.clone())
            }
        })
        .collect();

    let (bytes_out, skipped_names) = rebuild_archive(&recovered)?;

    let mut items: Vec<RecoveredItem> = salvaged
        .iter()
        .map(|e| RecoveredItem {
            name: e.name.clone(),
            recovered: e.recovered,
            detail: e.detail.clone(),
        })
        .collect();

    // Entries skipped during rebuild are recorded as not recovered in the loss manifest.
    if !skipped_names.is_empty() {
        let skipped_set: std::collections::HashSet<&str> =
            skipped_names.iter().map(String::as_str).collect();
        for item in &mut items {
            if item.recovered && skipped_set.contains(item.name.as_str()) {
                item.recovered = false;
                item.detail = "entry lost during archive rebuild".into();
            }
        }
        // Synthesized parts that were also skipped during rebuild are recorded as lost.
        for name in &skipped_names {
            if synthesized.contains(name) {
                items.push(RecoveredItem {
                    name: name.clone(),
                    recovered: false,
                    detail: "synthesized entry lost during archive rebuild".into(),
                });
            }
        }
    }

    let fully_recovered = items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        files: vec![crate::model::SalvagedFile {
            name: "repaired.zip".to_string(),
            bytes: bytes_out,
            media_type: Some("application/zip".to_string()),
        }],
        loss: LossManifest {
            items,
            fully_recovered,
            synthesized,
        },
    })
}

/// Test-support: build a minimal valid zip (one stored entry). Public for the
/// diagnose-framework test; not part of the repair API.
// Fixture scaffolding, and the only reason it is compiled into the library rather than sitting under
// `#[cfg(test)]` is that an integration test needs to reach it. Nothing untrusted flows in here — the
// bytes are the two literals below — so a failure is a broken test rather than the abort on a crafted
// archive that the workspace `unwrap_used` rule exists to prevent.
#[allow(clippy::unwrap_used)]
#[doc(hidden)]
pub fn tests_build_minimal_zip() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    writer.start_file("a.txt", options).unwrap();
    writer.write_all(b"alpha").unwrap();
    writer.finish().unwrap().into_inner()
}

#[cfg(test)]
mod salvage_tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    /// Build a valid zip with the given (name, content) entries, Deflated.
    pub(super) fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    /// Offset of the first central directory header (PK\x01\x02).
    pub(super) fn central_dir_offset(zip: &[u8]) -> usize {
        zip.windows(4)
            .position(|w| w == [0x50, 0x4B, 0x01, 0x02])
            .expect("a valid zip has a central directory")
    }

    /// Offset of the Nth local file header (PK\x03\x04), 0-indexed.
    fn nth_local_header_offset(zip: &[u8], n: usize) -> usize {
        zip.windows(4)
            .enumerate()
            .filter(|(_, w)| *w == [0x50, 0x4B, 0x03, 0x04])
            .map(|(i, _)| i)
            .nth(n)
            .unwrap_or_else(|| panic!("zip does not have a local header at index {n}"))
    }

    /// Byte offset at which the compressed body of the entry whose local header
    /// starts at `hdr_offset` begins (i.e. after the fixed header, filename,
    /// and extra field).
    fn body_start(zip: &[u8], hdr_offset: usize) -> usize {
        let fname_len = u16::from_le_bytes([zip[hdr_offset + 26], zip[hdr_offset + 27]]) as usize;
        let extra_len = u16::from_le_bytes([zip[hdr_offset + 28], zip[hdr_offset + 29]]) as usize;
        hdr_offset + 30 + fname_len + extra_len
    }

    #[test]
    fn salvages_all_entries_from_a_central_directory_stripped_zip() {
        let zip = build_zip(&[
            ("a.txt", b"alpha"),
            ("b.txt", b"bravo"),
            ("c.txt", b"charlie"),
        ]);
        // Remove everything from the central directory onward — local headers survive.
        let truncated = &zip[..central_dir_offset(&zip)];
        let entries = salvage_entries(truncated);
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|e| e.recovered));
        assert_eq!(entries[0].name, "a.txt");
        assert_eq!(entries[0].data.as_deref(), Some(&b"alpha"[..]));
        assert_eq!(entries[2].data.as_deref(), Some(&b"charlie"[..]));
    }

    #[test]
    fn salvages_intact_entries_and_marks_a_truncated_tail_entry_lost() {
        let zip = build_zip(&[
            ("keep.txt", b"this entry is intact"),
            ("lost.txt", &[7u8; 4096]),
        ]);
        // Locate the start of "lost.txt"'s compressed body precisely so that the
        // cut lands inside the body regardless of how small it compresses.
        // (The repetitive content compresses to just a handful of bytes with
        // DEFLATE, so a fixed `central_dir_offset - N` offset is unreliable.)
        let lost_hdr = nth_local_header_offset(&zip, 1);
        let lost_body = body_start(&zip, lost_hdr);
        // Cut 5 bytes into the compressed body — safely within any DEFLATE
        // stream for 4 KiB of identical bytes.
        let cut = lost_body + 5;
        let truncated = &zip[..cut];
        let entries = salvage_entries(truncated);
        // The first entry is fully present and recovered.
        let keep = entries
            .iter()
            .find(|e| e.name == "keep.txt")
            .expect("keep.txt present");
        assert!(keep.recovered);
        assert_eq!(keep.data.as_deref(), Some(&b"this entry is intact"[..]));
        // The second entry is present in the local-header scan but its body is truncated → lost.
        let lost = entries.iter().find(|e| e.name == "lost.txt");
        if let Some(lost) = lost {
            assert!(
                !lost.recovered,
                "a truncated entry body must be marked lost"
            );
            assert!(lost.data.is_none());
        }
        // (If the truncation removed the second local header entirely, only keep.txt appears —
        // still correct: nothing is falsely reported recovered.)
    }

    #[test]
    fn per_entry_size_cap_marks_oversized_entry_as_lost() {
        // Entry content is 10 bytes; cap is 8 bytes → entry must be marked lost.
        let zip = build_zip(&[("big.txt", b"0123456789")]);
        let truncated = &zip[..central_dir_offset(&zip)];
        let entries = salvage_entries_capped(truncated, 8, u64::MAX, usize::MAX);
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].recovered, "oversized entry must be marked lost");
        assert!(entries[0].data.is_none());
        assert_eq!(entries[0].detail, "entry exceeds the per-entry size cap");
    }
}

#[cfg(test)]
mod rebuild_tests {
    use super::*;

    #[test]
    fn rebuilt_archive_is_a_valid_zip_with_the_same_entries() {
        let entries = vec![
            ("a.txt".to_string(), b"alpha".to_vec()),
            ("dir/b.txt".to_string(), b"bravo".to_vec()),
        ];
        let (zip, skipped) = rebuild_archive(&entries).expect("rebuild");
        assert!(skipped.is_empty(), "no entries should be skipped");
        // The result must be a valid, central-directory-bearing zip.
        let mut archive = ZipArchive::new(Cursor::new(zip)).expect("valid zip");
        assert_eq!(archive.len(), 2);
        let mut a = archive.by_name("a.txt").expect("a.txt present");
        let mut content = String::new();
        std::io::Read::read_to_string(&mut a, &mut content).unwrap();
        assert_eq!(content, "alpha");
    }

    #[test]
    fn duplicate_entry_names_do_not_panic_or_cause_total_loss() {
        // Empirical check: zip 8.6 start_file does not return an error for a
        // duplicate entry name — both entries are written, the archive is valid,
        // and skipped_names is empty. This test asserts resilience regardless of
        // the outcome: no panic and at least unique.txt survives.
        let entries = vec![
            ("dupe.txt".to_string(), b"first".to_vec()),
            ("dupe.txt".to_string(), b"second".to_vec()),
            ("unique.txt".to_string(), b"unique content".to_vec()),
        ];
        let (zip, _skipped) = rebuild_archive(&entries)
            .expect("rebuild must not fail entirely when unique.txt is present");
        let mut archive = ZipArchive::new(Cursor::new(zip)).expect("valid zip");
        // unique.txt must survive regardless of what happened to the duplicate.
        assert!(
            archive.by_name("unique.txt").is_ok(),
            "unique.txt must be in the rebuilt archive"
        );
    }
}

#[cfg(test)]
mod repair_tests {
    use super::*;
    use zip::read::ZipArchive;

    #[test]
    fn repairs_a_central_directory_stripped_zip_and_lists_recovered_entries() {
        let zip = salvage_tests::build_zip(&[("a.txt", b"alpha"), ("b.txt", b"bravo")]);
        let truncated = &zip[..salvage_tests::central_dir_offset(&zip)];
        let result = repair_zip(truncated).expect("repairable");
        // The salvaged output is a valid, reopenable zip.
        let archive =
            ZipArchive::new(Cursor::new(result.files[0].bytes.clone())).expect("valid zip");
        assert_eq!(archive.len(), 2);
        // The loss manifest lists both as recovered, fully_recovered = true.
        assert!(result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 2);
        // A plain zip has no synthesized parts.
        assert!(result.loss.synthesized.is_empty());
    }

    #[test]
    fn an_unrecoverable_input_errors_rather_than_emitting_an_empty_zip() {
        // Random non-zip bytes routed here directly must not produce a "repaired" empty archive.
        let result = repair_zip(b"\x50\x4b\x03\x04 garbage that is not a real local header body");
        assert!(result.is_err());
    }

    #[test]
    fn repairing_an_ooxml_missing_content_types_reports_synthesized() {
        // A package with only word/document.xml — the OPC skeleton is absent.
        let zip = salvage_tests::build_zip(&[("word/document.xml", b"<w:document/>")]);
        let truncated = &zip[..salvage_tests::central_dir_offset(&zip)];
        let result = repair_zip(truncated).expect("repairable");
        // OPC reconstruction must have synthesized [Content_Types].xml.
        assert!(
            result
                .loss
                .synthesized
                .iter()
                .any(|n| n == "[Content_Types].xml"),
            "expected [Content_Types].xml in synthesized, got: {:?}",
            result.loss.synthesized
        );
    }
}

#[cfg(test)]
mod diagnose_tests {
    use super::*;
    use crate::model::{CorruptionKind, Recoverability};

    #[test]
    fn an_intact_zip_is_intact() {
        let zip = salvage_tests::build_zip(&[("a.txt", b"alpha")]);
        let (corruption, recoverability) = diagnose_zip(&zip);
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn a_central_directory_stripped_zip_is_repairable() {
        let zip = salvage_tests::build_zip(&[("a.txt", b"alpha"), ("b.txt", b"bravo")]);
        let truncated = &zip[..salvage_tests::central_dir_offset(&zip)];
        let (corruption, recoverability) = diagnose_zip(truncated);
        assert_eq!(recoverability, Recoverability::Repairable);
        assert!(corruption.contains(&CorruptionKind::MissingEndOfCentralDirectory));
    }
}
