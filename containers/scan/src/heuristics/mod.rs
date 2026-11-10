use std::io::{Cursor, Read};

mod office;
mod pdf;

/// The reason a structural heuristic flags a file as suspicious — a structural attack on the scanner
/// (a zip bomb or pathological archive), not a content signature.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Reason {
    DecompressionBomb,
    ArchiveNesting,
    ArchiveEntryCount,
}

/// The structural-heuristic verdict for a file. `ActiveContent` is a clean-with-badge signal (PDF
/// JavaScript / Office macros are common in legitimate legal forms — the execution defense is the
/// safe-delivery sandbox, not quarantine); `Encrypted` means the content is locked and cannot be
/// inspected; `Suspicious` is a structural attack. The verdict layer combines this with clamd + yara.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Heuristic {
    Clean,
    ActiveContent,
    Suspicious(Reason),
    Encrypted,
}

/// The firm-tunable archive-expansion caps (mirrors the upload policy's `archiveCaps`): the guards that
/// bound archive walking so a zip bomb cannot exhaust the scanner.
#[derive(Debug, Clone, Copy)]
pub struct ArchiveCaps {
    pub max_depth: u32,
    pub max_entries: u32,
    pub max_uncompressed_bytes: u64,
    pub max_expansion_ratio: u64,
}

impl Default for ArchiveCaps {
    fn default() -> Self {
        ArchiveCaps {
            max_depth: 16,
            max_entries: 10_000,
            max_uncompressed_bytes: 4 * 1024 * 1024 * 1024,
            max_expansion_ratio: 100,
        }
    }
}

// A nested archive is materialized in memory to be re-parsed, and the recursion holds EVERY level's
// buffer live simultaneously (each call frame owns its `nested` Vec until it returns). The transient
// peak is therefore bounded by `max_depth * MAX_NESTED_BYTES`, NOT a single level — so this per-level
// bound is sized small enough that the full-depth product fits a 4 GiB instance with room for the rest
// of the resident set: 16 (the default `max_depth`) * 64 MiB = 1 GiB. The cumulative real-bytes check
// in `scan_archive` (which adds each nested entry's MATERIALIZED length, not its forgeable declared
// size) is the primary cap; this is the per-allocation backstop.
const MAX_NESTED_BYTES: u64 = 64 * 1024 * 1024;

fn starts_with(bytes: &[u8], magic: &[u8]) -> bool {
    bytes.len() >= magic.len() && &bytes[..magic.len()] == magic
}

fn is_pdf(bytes: &[u8]) -> bool {
    starts_with(bytes, b"%PDF")
}

fn is_ole(bytes: &[u8]) -> bool {
    starts_with(bytes, &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
}

fn is_zip(bytes: &[u8]) -> bool {
    starts_with(bytes, b"PK\x03\x04")
        || starts_with(bytes, b"PK\x05\x06")
        || starts_with(bytes, b"PK\x07\x08")
}

/// Inspects a file's structure for active content, encryption, or a structural attack. PDF and OLE are
/// dispatched by leading magic; ZIP inspection is attempted UNCONDITIONALLY (not gated on offset-0
/// magic), because the zip format is located by its tail end-of-central-directory record — a
/// self-extracting stub or polyglot prefix yields a still-valid, extractable archive that an offset-0
/// check would miss. `inspect_zip` is `Clean` for anything that is not a readable zip.
///
/// Known limitation: only PDF, OLE, and ZIP are structurally inspected. Other archive formats (7z, RAR,
/// gzip, bzip2, xz, tar) are not — clamd still scans their contents for signatures, but their archive
/// caps are not enforced and an ENCRYPTED non-ZIP archive serializes here as `Clean` rather than the
/// `unscanned`/encrypted a ZIP would get. Adding magic dispatch (or at least an uninspectable-container
/// classification) for those formats is a documented follow-up.
pub fn inspect(bytes: &[u8], _sniffed: Option<&str>, caps: &ArchiveCaps) -> Heuristic {
    if is_pdf(bytes) {
        pdf::inspect_pdf(bytes)
    } else if is_ole(bytes) {
        office::inspect_ole(bytes)
    } else {
        inspect_zip(bytes, caps)
    }
}

// Reads up to buf.len() bytes from the reader, returning how many were read (tolerates short reads, the
// common case for a decompressing stream). Used to peek an entry's leading bytes for an archive magic.
fn read_prefix(reader: &mut impl Read, buf: &mut [u8]) -> usize {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) | Err(_) => break,
            Ok(read) => filled += read,
        }
    }
    filled
}

#[derive(Default)]
struct ArchiveScan {
    total_entries: u64,
    total_uncompressed: u64,
    has_encrypted_entry: bool,
    has_macros: bool,
}

/// Inspects a zip for structural attacks (bomb / nesting / entry-count), OOXML macros, and encrypted
/// entries. Precedence within an archive: a structural `Suspicious` wins, then `Encrypted`, then
/// `ActiveContent`, then `Clean`.
fn inspect_zip(bytes: &[u8], caps: &ArchiveCaps) -> Heuristic {
    let mut scan = ArchiveScan::default();
    if let Some(reason) = scan_archive(bytes, caps, 0, &mut scan) {
        return Heuristic::Suspicious(reason);
    }
    if scan.has_encrypted_entry {
        Heuristic::Encrypted
    } else if scan.has_macros {
        Heuristic::ActiveContent
    } else {
        Heuristic::Clean
    }
}

/// Recursively walks an archive, accumulating into `scan` and returning the first cap breach.
///
/// Bomb defenses, in order of cost: the declared-metadata ratio/cumulative pre-filter is a cheap
/// early-out for a naively-declared bomb (a forged-size single-level bomb that lies in its headers is
/// left to the clamd decompression backstop). NESTING is detected by **content** — each non-encrypted
/// entry's leading bytes are peeked for an archive magic, so a nested archive renamed to anything is
/// still walked — and a detected nested archive is materialized **bounded** by `MAX_NESTED_BYTES`
/// (over-budget ⇒ `DecompressionBomb`), so a nested bomb cannot exhaust memory. A non-archive entry
/// costs only the leading-byte peek.
fn scan_archive(
    bytes: &[u8],
    caps: &ArchiveCaps,
    depth: u32,
    scan: &mut ArchiveScan,
) -> Option<Reason> {
    if depth > caps.max_depth {
        return Some(Reason::ArchiveNesting);
    }
    // Opens regardless of leading bytes — the zip crate locates entries via the tail EOCD record.
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    for index in 0..archive.len() {
        // Read metadata via `by_index_raw`: `by_index` returns an error for an encrypted entry (it
        // cannot set up decryption without a password), which would skip it before `.encrypted()` could
        // flag it — leaving an encrypted, uninspectable archive to serialize as `clean`. The raw
        // accessor reads name/size/encrypted without decrypting, so an encrypted entry is flagged here.
        let (is_dir, name, encrypted, declared, compressed) = match archive.by_index_raw(index) {
            Ok(entry) => (
                entry.is_dir(),
                entry
                    .name()
                    .map(|name| name.to_ascii_lowercase())
                    .unwrap_or_else(|_| {
                        String::from_utf8_lossy(entry.name_raw()).to_ascii_lowercase()
                    }),
                entry.encrypted(),
                entry.size(),
                entry.compressed_size(),
            ),
            Err(_) => continue,
        };
        scan.total_entries += 1;
        if scan.total_entries > caps.max_entries as u64 {
            return Some(Reason::ArchiveEntryCount);
        }
        if is_dir {
            continue;
        }
        // A */vbaProject.bin part marks a macro-enabled OOXML document.
        if name.ends_with("vbaproject.bin") {
            scan.has_macros = true;
        }
        // Encrypted entries cannot be read or descended — flag and move on (never decompressed).
        if encrypted {
            scan.has_encrypted_entry = true;
            continue;
        }

        // Cheap declared-metadata pre-filter: a naively-declared huge ratio, or a declared cumulative
        // size over the cap, is a bomb without any decompression.
        if compressed > 0 && declared / compressed > caps.max_expansion_ratio {
            return Some(Reason::DecompressionBomb);
        }
        scan.total_uncompressed = scan.total_uncompressed.saturating_add(declared);
        if scan.total_uncompressed > caps.max_uncompressed_bytes {
            return Some(Reason::DecompressionBomb);
        }

        // Detect a nested archive by CONTENT, not filename: the entry is not encrypted, so reopen it
        // decompressed and peek the leading bytes for an archive magic.
        let mut entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let mut head = [0u8; 4];
        let read = read_prefix(&mut entry, &mut head);
        if is_zip(&head[..read]) {
            let mut nested = head[..read].to_vec();
            // Materialize the nested archive bounded by MAX_NESTED_BYTES; a read past the bound means
            // the nested decompression is itself a bomb.
            let limit = MAX_NESTED_BYTES
                .saturating_add(1)
                .saturating_sub(read as u64);
            if entry.take(limit).read_to_end(&mut nested).is_ok() {
                if nested.len() as u64 > MAX_NESTED_BYTES {
                    return Some(Reason::DecompressionBomb);
                }
                // Correct the cumulative tally to the REAL materialized length. The declared size was
                // already added above; a bomb can forge a tiny declared size and zero-fill-deflate the
                // real payload, sliding past the declared-size cap, so add only the SHORTFALL (real minus
                // already-counted declared) — no double-count when the header is honest, full correction
                // when it lied. Re-check the cap against actual decompressed bytes before descending, so
                // the recursion's live heap (every level's buffer held at once) is bounded by the same
                // `max_uncompressed_bytes` budget, not just the per-level `MAX_NESTED_BYTES`.
                let real = nested.len() as u64;
                let shortfall = real.saturating_sub(declared);
                scan.total_uncompressed = scan.total_uncompressed.saturating_add(shortfall);
                if scan.total_uncompressed > caps.max_uncompressed_bytes {
                    return Some(Reason::DecompressionBomb);
                }
                if let Some(reason) = scan_archive(&nested, caps, depth + 1, scan) {
                    return Some(reason);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{inspect, ArchiveCaps, Heuristic, Reason};
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    // Wraps `payload` as the single stored entry of a new zip — one nesting level. `Deflated` keeps the
    // outer small when the payload is compressible (a chain of zeros), while the materialized inner is
    // the real size the heap-bound check must account.
    fn wrap_in_zip(payload: &[u8]) -> Vec<u8> {
        let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("inner.bin", options).unwrap();
        writer.write_all(payload).unwrap();
        writer.finish().unwrap().into_inner()
    }

    // Wraps `payload` as a nested zip AND adds a sibling filler of `filler` zero-bytes at this level, so
    // every descended level contributes real materialized bytes to the cumulative tally (not just the
    // innermost). Models the realistic case where each archive layer also holds bulky decompressible data.
    fn wrap_with_filler(payload: &[u8], filler: usize) -> Vec<u8> {
        let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("inner.bin", options).unwrap();
        writer.write_all(payload).unwrap();
        writer.start_file("filler.bin", options).unwrap();
        writer.write_all(&vec![0u8; filler]).unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn a_deep_near_cap_nested_chain_is_flagged_with_a_bounded_peak() {
        // A 30-level nested-zip chain whose innermost level alone materializes ~1 MiB. The walk
        // materializes ONE level at a time and bails the moment a cap trips — either the nesting-depth
        // cap or the cumulative real-bytes cap — so it is flagged `Suspicious` (a bounded structural
        // attack) without ever holding the whole chain's expansion live. The peak transient heap is
        // bounded by the levels actually descended times the per-level buffer, not the full chain.
        let mut data = vec![0u8; 1024 * 1024];
        for _ in 0..30 {
            data = wrap_in_zip(&data);
        }
        let caps = ArchiveCaps {
            max_uncompressed_bytes: 4 * 1024 * 1024,
            ..ArchiveCaps::default()
        };
        assert!(matches!(
            inspect(&data, None, &caps),
            Heuristic::Suspicious(_)
        ));
    }

    #[test]
    fn cumulative_real_bytes_across_a_chain_trip_the_decompression_bomb_cap() {
        // A short chain where EVERY level also carries a ~512 KiB filler, so the cumulative materialized
        // bytes sum past the cap within a couple of descended levels. `max_depth` is raised so depth
        // cannot be what trips — the cumulative real-bytes accounting added for each descended level is
        // what flags the bomb. With a 1 MiB cap, the second descended level crosses it.
        let mut data = vec![0u8; 512 * 1024];
        for _ in 0..6 {
            data = wrap_with_filler(&data, 512 * 1024);
        }
        let caps = ArchiveCaps {
            max_depth: 1000,
            max_uncompressed_bytes: 1024 * 1024,
            ..ArchiveCaps::default()
        };
        assert_eq!(
            inspect(&data, None, &caps),
            Heuristic::Suspicious(Reason::DecompressionBomb)
        );
    }

    #[test]
    fn a_modest_nested_chain_within_the_cap_is_clean() {
        // A shallow chain whose total real bytes stay under the cap must not false-positive.
        let mut data = vec![0u8; 1024];
        for _ in 0..3 {
            data = wrap_in_zip(&data);
        }
        let caps = ArchiveCaps::default();
        assert_eq!(inspect(&data, None, &caps), Heuristic::Clean);
    }

    #[test]
    fn inspect_never_panics_on_malformed_or_pathological_input() {
        // Hostile/garbage bytes through the full dispatch (PDF / OLE / ZIP). Each must return a verdict,
        // never panic or abort — `inspect` returning at all is the assertion.
        let caps = ArchiveCaps::default();
        let deep_pdf = {
            let mut bytes = b"%PDF-1.7\n".to_vec();
            bytes.extend(std::iter::repeat_n(b'[', 100_000));
            bytes
        };
        let truncated_ole = {
            // The OLE/CFB magic followed by garbage — the parser must reject it without panicking.
            let mut bytes = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
            bytes.extend_from_slice(&[0xff; 64]);
            bytes
        };
        let truncated_zip = b"PK\x03\x04 not really a zip".to_vec();
        for input in [
            &b""[..],
            &b"%PDF"[..],
            &deep_pdf[..],
            &truncated_ole[..],
            &truncated_zip[..],
            &[0u8; 0][..],
            &[0xff; 256][..],
        ] {
            let _ = inspect(input, None, &caps);
        }
    }
}
