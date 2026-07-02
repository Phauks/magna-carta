//! The CFB/OLE2 repair pillar: open a compound file, best-effort read each
//! stream, and re-emit a *faithful* compound file — stream content plus the
//! storage hierarchy (including empty storages) and its identity metadata
//! (root and per-storage CLSIDs and state bits). Diagnose CFB corruption.
//!
//! Fidelity scope: a fully-recovered file carries every stream's bytes, the
//! complete storage tree, and its CLSID/state-bit identity. Serialization-level
//! attributes with no public setter in the `cfb` writer — directory timestamps
//! and the physical sector layout — are regenerated, not byte-preserved; a fresh
//! archive is emitted, exactly as the ZIP pillar re-emits a fresh archive.

use std::collections::HashSet;
use std::io::{Cursor, Read, Write};
use std::path::PathBuf;

use cfb::CompoundFile;
use uuid::Uuid;

use crate::error::RepairError;
use crate::limits::{MAX_ENTRY_COUNT, MAX_ENTRY_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES};
use crate::model::{CorruptionKind, LossManifest, Recoverability, RecoveredItem, RepairResult};

/// One stream read (or attempted) from a compound file.
#[derive(Debug, Clone)]
pub struct SalvagedStream {
    pub path: String,
    pub data: Option<Vec<u8>>,
    pub recovered: bool,
    pub detail: String,
}

/// One storage (directory) node and the identity metadata a faithful rebuild
/// must carry so it is never silently dropped — including empty storages, which
/// hold no streams yet are part of the document's structure.
#[derive(Debug, Clone)]
pub struct SalvagedStorage {
    pub path: String,
    pub clsid: Uuid,
    pub state_bits: u32,
}

/// Everything walked out of a compound file: its streams, its full storage
/// hierarchy, and the root's identity metadata. `count_capped` is set when the
/// directory held more entries than the count cap allowed us to process — the
/// excess is not represented here and the caller must record it as loss rather
/// than let a "fully recovered" claim absorb it.
#[derive(Debug, Clone)]
pub struct Salvage {
    pub streams: Vec<SalvagedStream>,
    pub storages: Vec<SalvagedStorage>,
    pub root_clsid: Uuid,
    pub root_state_bits: u32,
    pub count_capped: bool,
}

/// Open the compound file and walk its directory at the production caps.
pub fn salvage(bytes: &[u8]) -> Result<Salvage, RepairError> {
    salvage_capped(
        bytes,
        MAX_ENTRY_UNCOMPRESSED_BYTES,
        MAX_TOTAL_UNCOMPRESSED_BYTES,
        MAX_ENTRY_COUNT,
    )
}

/// Walk the directory capturing the storage hierarchy and best-effort reading
/// every stream, bounded by explicit caps (a per-stream byte cap, an aggregate
/// byte cap, and a directory-entry count cap — parameterized so the caps are
/// exercisable in tests without gigabyte inputs). A stream that errors on read
/// or exceeds the per-stream cap is recorded lost (never partially kept). Returns
/// Err only when the file cannot be opened at all (header/FAT/directory too
/// damaged) — manual sector-scan reconstruction of that case is a separate,
/// deeper effort.
fn salvage_capped(
    bytes: &[u8],
    max_entry_bytes: u64,
    max_total_bytes: u64,
    max_count: usize,
) -> Result<Salvage, RepairError> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut compound = CompoundFile::open(cursor).map_err(|_| RepairError::Unrepairable)?;

    // `walk` borrows the compound immutably while `open_stream` needs a mutable
    // borrow, so capture every entry's metadata first. Non-root entries are
    // counted against the cap; hitting it stops the walk and flags the
    // truncation so it is recorded as loss rather than silently dropped.
    let mut root_clsid = Uuid::nil();
    let mut root_state_bits = 0u32;
    let mut storages: Vec<SalvagedStorage> = Vec::new();
    let mut stream_paths: Vec<PathBuf> = Vec::new();
    let mut count_capped = false;
    let mut seen = 0usize;
    for entry in compound.walk() {
        if entry.is_root() {
            root_clsid = *entry.clsid();
            root_state_bits = entry.state_bits();
            continue;
        }
        if seen >= max_count {
            count_capped = true;
            break;
        }
        seen += 1;
        if entry.is_storage() {
            storages.push(SalvagedStorage {
                path: entry.path().to_string_lossy().into_owned(),
                clsid: *entry.clsid(),
                state_bits: entry.state_bits(),
            });
        } else if entry.is_stream() {
            stream_paths.push(entry.path().to_path_buf());
        }
    }

    let mut streams = Vec::new();
    let mut total: u64 = 0;
    for path in stream_paths {
        let display = path.to_string_lossy().into_owned();
        if total >= max_total_bytes {
            streams.push(SalvagedStream {
                path: display,
                data: None,
                recovered: false,
                detail: "file exceeds the total size cap".into(),
            });
            continue;
        }
        match read_capped(&mut compound, &path, max_entry_bytes) {
            Ok(data) => {
                total = total.saturating_add(data.len() as u64);
                streams.push(SalvagedStream {
                    path: display,
                    data: Some(data),
                    recovered: true,
                    detail: String::new(),
                });
            }
            Err(detail) => streams.push(SalvagedStream {
                path: display,
                data: None,
                recovered: false,
                detail,
            }),
        }
    }

    Ok(Salvage {
        streams,
        storages,
        root_clsid,
        root_state_bits,
        count_capped,
    })
}

/// Read one stream with a per-stream byte cap. Over-cap or a read error → the
/// stream is lost (no partial bytes kept). The error string is a fixed reason,
/// never stream content.
fn read_capped(
    compound: &mut CompoundFile<Cursor<Vec<u8>>>,
    path: &std::path::Path,
    max_entry_bytes: u64,
) -> Result<Vec<u8>, String> {
    let mut stream = compound
        .open_stream(path)
        .map_err(|_| "stream could not be opened".to_string())?;
    // Read one byte past the cap so an over-cap stream is detected without
    // loading its full payload into memory first.
    let cap = max_entry_bytes.saturating_add(1);
    let mut data = Vec::new();
    Read::take(&mut stream, cap)
        .read_to_end(&mut data)
        .map_err(|_| "stream truncated or corrupt".to_string())?;
    if data.len() as u64 > max_entry_bytes {
        return Err("stream exceeds the per-stream size cap".to_string());
    }
    Ok(data)
}

/// Write a fresh compound file that faithfully carries the storage hierarchy —
/// including empty storages and each storage's CLSID and state bits, plus the
/// root's — and then the recovered streams. A node the writer rejects is skipped
/// and its path returned, so one bad node never discards the rest. A flush
/// failure, or every node being skipped when there were nodes, → Unrepairable.
pub fn rebuild_cfb(
    storages: &[SalvagedStorage],
    streams: &[(String, Vec<u8>)],
    root_clsid: Uuid,
    root_state_bits: u32,
) -> Result<RebuildOutput, RepairError> {
    let mut compound =
        CompoundFile::create(Cursor::new(Vec::new())).map_err(|_| RepairError::Unrepairable)?;

    // Root identity first. A failure is non-fatal to the re-emit (the nil default
    // remains), but it IS a loss — reported back so the manifest can never claim
    // full recovery while root identity was silently dropped. Both calls run
    // (no short-circuit) so state bits are attempted even if the CLSID set fails.
    let clsid_set = compound.set_storage_clsid("/", root_clsid).is_ok();
    let state_bits_set = compound.set_state_bits("/", root_state_bits).is_ok();
    let root_identity_preserved = clsid_set && state_bits_set;

    let mut skipped: Vec<String> = Vec::new();

    // Storages before streams, shallow before deep, so every parent exists before
    // its children. A parent path is always a proper (shorter) prefix of its
    // descendants, so ordering by path length is a sufficient depth order.
    let mut ordered: Vec<&SalvagedStorage> = storages.iter().collect();
    ordered.sort_by_key(|storage| storage.path.len());
    for storage in ordered {
        if write_one_storage(&mut compound, storage).is_err() {
            skipped.push(storage.path.clone());
        }
    }

    for (path, data) in streams {
        if write_one_stream(&mut compound, path, data).is_err() {
            skipped.push(path.clone());
        }
    }

    let node_count = storages.len() + streams.len();
    if node_count > 0 && skipped.len() == node_count {
        return Err(RepairError::Unrepairable);
    }
    compound.flush().map_err(|_| RepairError::Unrepairable)?;
    Ok(RebuildOutput {
        bytes: compound.into_inner().into_inner(),
        skipped,
        root_identity_preserved,
    })
}

/// The product of a rebuild: the fresh compound-file bytes, the paths of any
/// nodes the writer rejected (so the caller can mark them lost), and whether the
/// root's identity metadata was carried over (a dropped root identity is a loss,
/// not a silent reset).
pub struct RebuildOutput {
    pub bytes: Vec<u8>,
    pub skipped: Vec<String>,
    pub root_identity_preserved: bool,
}

/// Create a storage (and any missing parents) and stamp its identity metadata.
fn write_one_storage(
    compound: &mut CompoundFile<Cursor<Vec<u8>>>,
    storage: &SalvagedStorage,
) -> std::io::Result<()> {
    let path = std::path::Path::new(&storage.path);
    if !compound.exists(path) {
        compound.create_storage_all(path)?;
    }
    compound.set_storage_clsid(path, storage.clsid)?;
    compound.set_state_bits(path, storage.state_bits)?;
    Ok(())
}

/// Create a stream (and any missing parent storages) and write its bytes.
fn write_one_stream(
    compound: &mut CompoundFile<Cursor<Vec<u8>>>,
    path: &str,
    data: &[u8],
) -> std::io::Result<()> {
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        if parent != std::path::Path::new("/") && !compound.exists(parent) {
            compound.create_storage_all(parent)?;
        }
    }
    compound.create_stream(path)?.write_all(data)
}

/// Classify a salvage result's health. Every stream readable and no directory
/// truncation → intact; any lost stream or a count-capped directory → partial;
/// (an unopenable file never reaches here — see [`diagnose_cfb`]).
fn classify(salvage: &Salvage) -> (Vec<CorruptionKind>, Recoverability) {
    let all_streams_readable = salvage.streams.iter().all(|s| s.recovered);
    if all_streams_readable && !salvage.count_capped {
        (Vec::new(), Recoverability::Intact)
    } else {
        (vec![CorruptionKind::Truncated], Recoverability::Partial)
    }
}

/// Classify a compound file's health by opening it and reading every stream.
/// All readable → intact; opens but some streams lost (or the directory exceeded
/// the count cap) → partial; cannot open at all → unrecoverable by this pillar
/// (manual reconstruction is a deeper effort).
pub fn diagnose_cfb(bytes: &[u8]) -> (Vec<CorruptionKind>, Recoverability) {
    match salvage(bytes) {
        Err(_) => (vec![CorruptionKind::Other], Recoverability::Unrecoverable),
        Ok(salvage) => classify(&salvage),
    }
}

/// Test-support: build a minimal valid compound file (one stream). Public for
/// the diagnose-framework test; not part of the repair API.
#[doc(hidden)]
pub fn tests_build_minimal_cfb() -> Vec<u8> {
    let mut compound = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    compound
        .create_stream("/WordDocument")
        .unwrap()
        .write_all(b"alpha")
        .unwrap();
    compound.flush().unwrap();
    compound.into_inner().into_inner()
}

/// Repair a damaged compound file: salvage every readable stream and the storage
/// hierarchy, re-emit a faithful CFB, and record an honest loss manifest.
pub fn repair_cfb(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    build_result(salvage(bytes)?)
}

/// Turn a salvage result into a repaired file plus its loss manifest. Errors
/// (rather than emitting a hollow file) only when the file HELD streams yet none
/// survived; a stream-less-but-valid container is faithfully re-emitted.
fn build_result(salvage: Salvage) -> Result<RepairResult, RepairError> {
    let recovered: Vec<(String, Vec<u8>)> = salvage
        .streams
        .iter()
        .filter_map(|s| s.data.clone().map(|d| (s.path.clone(), d)))
        .collect();

    if !salvage.streams.is_empty() && recovered.is_empty() {
        return Err(RepairError::Unrepairable);
    }

    let rebuilt = rebuild_cfb(
        &salvage.storages,
        &recovered,
        salvage.root_clsid,
        salvage.root_state_bits,
    )?;
    let bytes_out = rebuilt.bytes;
    // Set membership (not first-match) so every same-named node is reconciled —
    // the safe reconciliation pattern for pillars where names can repeat.
    let skipped: HashSet<&str> = rebuilt.skipped.iter().map(String::as_str).collect();

    // One manifest item per stream (the content units). A stream lost at re-emit
    // flips to lost.
    let mut items: Vec<RecoveredItem> = salvage
        .streams
        .iter()
        .map(|s| {
            let lost_on_rebuild = s.recovered && skipped.contains(s.path.as_str());
            RecoveredItem {
                name: s.path.clone(),
                recovered: s.recovered && !lost_on_rebuild,
                detail: if lost_on_rebuild {
                    "stream lost during rebuild".to_string()
                } else {
                    s.detail.clone()
                },
            }
        })
        .collect();

    // A storage dropped at re-emit is a structural loss.
    for storage in &salvage.storages {
        if skipped.contains(storage.path.as_str()) {
            items.push(RecoveredItem {
                name: storage.path.clone(),
                recovered: false,
                detail: "storage lost during rebuild".to_string(),
            });
        }
    }

    // Directory entries beyond the count cap were never processed — record the
    // truncation rather than let `fully_recovered` overclaim.
    if salvage.count_capped {
        items.push(RecoveredItem {
            name: "(entries beyond the processing cap)".to_string(),
            recovered: false,
            detail:
                "additional directory entries exceeded the processing cap and were not recovered"
                    .to_string(),
        });
    }

    // Root identity dropped at re-emit is a loss — recorded so full recovery is
    // never claimed while it was silently reset. (Infallible against the current
    // writer, but enforced by code, not assumption.)
    if !rebuilt.root_identity_preserved {
        items.push(RecoveredItem {
            name: "(root identity)".to_string(),
            recovered: false,
            detail: "root identity metadata was not preserved".to_string(),
        });
    }

    let fully_recovered = items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        files: vec![crate::model::SalvagedFile {
            name: "repaired".to_string(),
            bytes: bytes_out,
            media_type: Some("application/x-ole-storage".to_string()),
        }],
        loss: LossManifest {
            // CFB fabricates nothing — the hierarchy is preserved or recorded lost.
            items,
            fully_recovered,
            synthesized: Vec::new(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a valid version-3 CFB with the given (path, content) streams. Paths
    /// are absolute, e.g. "/WordDocument". Parent storages are created as needed.
    fn build_cfb(streams: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cfb = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        for (path, content) in streams {
            let p = std::path::Path::new(path);
            if let Some(parent) = p.parent() {
                if parent != std::path::Path::new("/") && !cfb.exists(parent) {
                    cfb.create_storage_all(parent).unwrap();
                }
            }
            cfb.create_stream(path).unwrap().write_all(content).unwrap();
        }
        cfb.flush().unwrap();
        cfb.into_inner().into_inner()
    }

    // ── salvage ──────────────────────────────────────────────────────────────

    #[test]
    fn salvages_all_streams_from_a_healthy_cfb() {
        let cfb = build_cfb(&[
            ("/WordDocument", b"body text"),
            ("/\x01CompObj", b"compobj"),
        ]);
        let salvage = salvage(&cfb).expect("opens");
        assert_eq!(salvage.streams.len(), 2);
        assert!(salvage.streams.iter().all(|s| s.recovered));
        assert!(!salvage.count_capped);
        let wd = salvage
            .streams
            .iter()
            .find(|s| s.path.contains("WordDocument"))
            .unwrap();
        assert_eq!(wd.data.as_deref(), Some(&b"body text"[..]));
    }

    #[test]
    fn a_non_cfb_input_cannot_be_opened() {
        assert!(salvage(b"not a compound file at all, just bytes").is_err());
    }

    #[test]
    fn a_stream_over_the_per_stream_cap_is_recorded_lost() {
        // A 200-byte stream against a 100-byte per-stream cap: opens fine, but the
        // stream is over-cap → recorded lost, never partially kept.
        let cfb = build_cfb(&[("/Big", &[b'x'; 200]), ("/Small", b"ok")]);
        let salvage = salvage_capped(&cfb, 100, MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_ENTRY_COUNT)
            .expect("opens");
        let big = salvage
            .streams
            .iter()
            .find(|s| s.path.contains("Big"))
            .unwrap();
        assert!(!big.recovered);
        assert!(big.data.is_none());
        assert_eq!(big.detail, "stream exceeds the per-stream size cap");
        let small = salvage
            .streams
            .iter()
            .find(|s| s.path.contains("Small"))
            .unwrap();
        assert!(small.recovered);
    }

    #[test]
    fn a_directory_over_the_count_cap_flags_truncation() {
        let cfb = build_cfb(&[("/A", b"a"), ("/B", b"b"), ("/C", b"c")]);
        // Only the first entry is processed; the rest are dropped and flagged.
        let salvage = salvage_capped(
            &cfb,
            MAX_ENTRY_UNCOMPRESSED_BYTES,
            MAX_TOTAL_UNCOMPRESSED_BYTES,
            1,
        )
        .expect("opens");
        assert!(salvage.count_capped);
        assert_eq!(salvage.streams.len(), 1);
    }

    #[test]
    fn salvage_captures_empty_storages_and_clsids() {
        let clsid = Uuid::from_u128(0x0102_0304_0506_0708_090a_0b0c_0d0e_0f10);
        let mut cfb = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        cfb.create_storage("/EmptyStore").unwrap();
        cfb.set_storage_clsid("/EmptyStore", clsid).unwrap();
        cfb.create_stream("/WordDocument")
            .unwrap()
            .write_all(b"x")
            .unwrap();
        cfb.flush().unwrap();
        let bytes = cfb.into_inner().into_inner();

        let salvage = salvage(&bytes).expect("opens");
        let store = salvage
            .storages
            .iter()
            .find(|s| s.path.contains("EmptyStore"))
            .expect("empty storage captured");
        assert_eq!(store.clsid, clsid);
    }

    // ── classify / diagnose ──────────────────────────────────────────────────

    #[test]
    fn classify_reports_intact_for_a_healthy_salvage() {
        let cfb = build_cfb(&[("/WordDocument", b"text")]);
        let (corruption, recoverability) = classify(&salvage(&cfb).unwrap());
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn classify_reports_partial_when_a_stream_is_lost() {
        let cfb = build_cfb(&[("/Big", &[b'x'; 200])]);
        let salvage =
            salvage_capped(&cfb, 100, MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_ENTRY_COUNT).unwrap();
        let (corruption, recoverability) = classify(&salvage);
        assert_eq!(recoverability, Recoverability::Partial);
        assert_eq!(corruption, vec![CorruptionKind::Truncated]);
    }

    #[test]
    fn diagnose_reports_intact_for_a_healthy_cfb() {
        let cfb = build_cfb(&[("/WordDocument", b"text")]);
        let (corruption, recoverability) = diagnose_cfb(&cfb);
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn diagnose_reports_unrecoverable_for_a_non_cfb() {
        let (_corruption, recoverability) = diagnose_cfb(b"not a compound file");
        assert_eq!(recoverability, Recoverability::Unrecoverable);
    }

    // ── rebuild ──────────────────────────────────────────────────────────────

    #[test]
    fn rebuilt_cfb_reopens_with_the_same_streams() {
        let streams = vec![
            ("/WordDocument".to_string(), b"recovered body".to_vec()),
            ("/ObjectPool/item".to_string(), b"nested".to_vec()),
        ];
        let rebuilt = rebuild_cfb(&[], &streams, Uuid::nil(), 0).expect("rebuild");
        assert!(rebuilt.skipped.is_empty());
        let mut reopened = CompoundFile::open(Cursor::new(rebuilt.bytes)).expect("valid cfb");
        let mut data = Vec::new();
        reopened
            .open_stream("/WordDocument")
            .unwrap()
            .read_to_end(&mut data)
            .unwrap();
        assert_eq!(data, b"recovered body");
        assert!(reopened.exists("/ObjectPool/item"));
    }

    #[test]
    fn rebuild_preserves_empty_storages_and_identity() {
        let clsid = Uuid::from_u128(0x1111_2222_3333_4444_5555_6666_7777_8888);
        let root_clsid = Uuid::from_u128(0xaaaa_bbbb_cccc_dddd_eeee_ffff_0000_1111);
        let storages = vec![SalvagedStorage {
            path: "/EmptyStore".to_string(),
            clsid,
            state_bits: 0,
        }];
        let rebuilt = rebuild_cfb(&storages, &[], root_clsid, 0).expect("rebuild");
        assert!(rebuilt.skipped.is_empty());
        assert!(rebuilt.root_identity_preserved);
        let reopened = CompoundFile::open(Cursor::new(rebuilt.bytes)).expect("valid cfb");
        // The empty storage and both CLSIDs survive the round-trip.
        assert!(reopened.exists("/EmptyStore"));
        assert_eq!(reopened.entry("/EmptyStore").unwrap().clsid(), &clsid);
        assert_eq!(reopened.root_entry().clsid(), &root_clsid);
    }

    // ── repair / manifest ────────────────────────────────────────────────────

    #[test]
    fn repairs_a_healthy_cfb_and_reopens() {
        let cfb = build_cfb(&[("/WordDocument", b"body"), ("/\x01CompObj", b"co")]);
        let result = repair_cfb(&cfb).expect("repairable");
        let reopened =
            CompoundFile::open(Cursor::new(result.files[0].bytes.clone())).expect("valid cfb");
        assert!(reopened.exists("/WordDocument"));
        assert!(result.loss.fully_recovered);
        assert!(result.loss.synthesized.is_empty());
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 2);
    }

    #[test]
    fn repair_records_a_lost_stream_and_is_not_fully_recovered() {
        // One stream over the per-stream cap: it is reported lost, the other is
        // recovered, and the re-emitted file reopens carrying only the survivor.
        let cfb = build_cfb(&[("/Big", &[b'x'; 200]), ("/Small", b"ok")]);
        let salvage =
            salvage_capped(&cfb, 100, MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_ENTRY_COUNT).unwrap();
        let result = build_result(salvage).expect("repairable");
        assert!(!result.loss.fully_recovered);
        let big = result
            .loss
            .items
            .iter()
            .find(|i| i.name.contains("Big"))
            .unwrap();
        assert!(!big.recovered);
        let mut reopened =
            CompoundFile::open(Cursor::new(result.files[0].bytes.clone())).expect("valid cfb");
        assert!(!reopened.exists("/Big"));
        let mut data = Vec::new();
        reopened
            .open_stream("/Small")
            .unwrap()
            .read_to_end(&mut data)
            .unwrap();
        assert_eq!(data, b"ok");
    }

    #[test]
    fn repair_records_the_count_cap_truncation() {
        let cfb = build_cfb(&[("/A", b"a"), ("/B", b"b"), ("/C", b"c")]);
        let salvage = salvage_capped(
            &cfb,
            MAX_ENTRY_UNCOMPRESSED_BYTES,
            MAX_TOTAL_UNCOMPRESSED_BYTES,
            1,
        )
        .unwrap();
        let result = build_result(salvage).expect("repairable");
        assert!(!result.loss.fully_recovered);
        assert!(result
            .loss
            .items
            .iter()
            .any(|i| !i.recovered && i.name.contains("processing cap")));
    }

    #[test]
    fn an_empty_but_valid_cfb_repairs_rather_than_erroring() {
        let mut cfb = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        cfb.flush().unwrap();
        let bytes = cfb.into_inner().into_inner();
        // diagnose and repair must agree: a stream-less valid container is intact
        // and faithfully re-emitted, not reported unrepairable.
        assert_eq!(diagnose_cfb(&bytes).1, Recoverability::Intact);
        let result = repair_cfb(&bytes).expect("repairable");
        assert!(result.loss.fully_recovered);
        assert!(CompoundFile::open(Cursor::new(result.files[0].bytes.clone())).is_ok());
    }

    #[test]
    fn an_unopenable_input_errors() {
        assert!(repair_cfb(b"\xD0\xCF\x11\xE0 garbage after the magic, not a real cfb").is_err());
    }
}
