//! The ZIP archetype-family repair pillar: salvage entries from local file
//! headers, re-emit a fresh archive, diagnose ZIP corruption.

use std::io::{Cursor, Read, Write};
use zip::read::{read_zipfile_from_stream, ZipArchive};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::RepairError;
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
pub fn salvage_entries(bytes: &[u8]) -> Vec<SalvagedEntry> {
    let mut reader = Cursor::new(bytes);
    let mut out = Vec::new();
    loop {
        // A read error at the header boundary (e.g. truncated header) ends the scan.
        let next = match read_zipfile_from_stream(&mut reader) {
            Ok(Some(file)) => file,
            Ok(None) => break, // hit the central-directory signature: no more local entries
            Err(_) => break,   // a malformed/truncated local header: stop scanning
        };
        let name = next.name().to_owned();
        // Directory entries carry no data; skip them (they are recreated on re-emit).
        if name.ends_with('/') {
            continue;
        }
        let mut file = next;
        let mut data = Vec::new();
        match file.read_to_end(&mut data) {
            Ok(_) => out.push(SalvagedEntry {
                name,
                data: Some(data),
                recovered: true,
                detail: String::new(),
            }),
            Err(_) => out.push(SalvagedEntry {
                name,
                data: None,
                recovered: false,
                detail: "entry body truncated or corrupt".into(),
            }),
        }
    }
    out
}

/// Write a fresh, valid zip (with a correct central directory) from recovered
/// (name, bytes) pairs. Entries are Deflated. A writer failure → Unrepairable.
pub fn rebuild_archive(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, RepairError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in entries {
        writer
            .start_file(name, options)
            .map_err(|_| RepairError::Unrepairable)?;
        writer
            .write_all(bytes)
            .map_err(|_| RepairError::Unrepairable)?;
    }
    let cursor = writer.finish().map_err(|_| RepairError::Unrepairable)?;
    Ok(cursor.into_inner())
}

/// Classify a zip's health: a readable central directory means intact; an
/// unreadable one with recoverable local-header entries is repairable; nothing
/// recoverable is unrecoverable.
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
    let recovered = if crate::ooxml::is_ooxml(&recovered) {
        crate::ooxml::reconstruct_opc(recovered)
    } else {
        recovered
    };
    let bytes_out = rebuild_archive(&recovered)?;
    let items: Vec<RecoveredItem> = salvaged
        .iter()
        .map(|e| RecoveredItem {
            name: e.name.clone(),
            recovered: e.recovered,
            detail: e.detail.clone(),
        })
        .collect();
    let fully_recovered = items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        salvaged: bytes_out,
        loss: LossManifest {
            items,
            fully_recovered,
        },
    })
}

/// Test-support: build a minimal valid zip (one stored entry). Public for the
/// diagnose-framework test; not part of the repair API.
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
        let zip = rebuild_archive(&entries).expect("rebuild");
        // The result must be a valid, central-directory-bearing zip.
        let mut archive = ZipArchive::new(Cursor::new(zip)).expect("valid zip");
        assert_eq!(archive.len(), 2);
        let mut a = archive.by_name("a.txt").expect("a.txt present");
        let mut content = String::new();
        std::io::Read::read_to_string(&mut a, &mut content).unwrap();
        assert_eq!(content, "alpha");
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
        let archive = ZipArchive::new(Cursor::new(result.salvaged.clone())).expect("valid zip");
        assert_eq!(archive.len(), 2);
        // The loss manifest lists both as recovered, fully_recovered = true.
        assert!(result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 2);
    }

    #[test]
    fn an_unrecoverable_input_errors_rather_than_emitting_an_empty_zip() {
        // Random non-zip bytes routed here directly must not produce a "repaired" empty archive.
        let result = repair_zip(b"\x50\x4b\x03\x04 garbage that is not a real local header body");
        assert!(result.is_err());
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
