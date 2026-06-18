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
/// bound archive walking so a zip bomb cannot exhaust the scanner. Checked from entry metadata where
/// possible (no decompression), so a bomb is caught before it is expanded.
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

/// Inspects a file's structure for active content, encryption, or a structural attack. Dispatch is by
/// magic bytes (the sniffed content-type is a hint only). A type we do not structurally inspect is
/// `Clean` here — clamd and yara still scan it in the verdict layer.
pub fn inspect(bytes: &[u8], _sniffed: Option<&str>, caps: &ArchiveCaps) -> Heuristic {
    if is_pdf(bytes) {
        pdf::inspect_pdf(bytes)
    } else if is_ole(bytes) {
        office::inspect_ole(bytes)
    } else if is_zip(bytes) {
        inspect_zip(bytes, caps)
    } else {
        Heuristic::Clean
    }
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

/// Recursively walks an archive, accumulating into `scan` and returning the first cap breach. Size and
/// ratio checks read entry METADATA only (no decompression), so a bomb is detected before expansion;
/// nested archives are descended within `max_depth` and the cumulative size cap.
fn scan_archive(
    bytes: &[u8],
    caps: &ArchiveCaps,
    depth: u32,
    scan: &mut ArchiveScan,
) -> Option<Reason> {
    if depth > caps.max_depth {
        return Some(Reason::ArchiveNesting);
    }
    let mut archive = match zip::ZipArchive::new(Cursor::new(bytes)) {
        Ok(archive) => archive,
        // Not a readable zip at this level — stop descending; not a flagged structural attack.
        Err(_) => return None,
    };
    for index in 0..archive.len() {
        let mut entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        scan.total_entries += 1;
        if scan.total_entries > caps.max_entries as u64 {
            return Some(Reason::ArchiveEntryCount);
        }
        if entry.is_dir() {
            continue;
        }
        if entry.encrypted() {
            scan.has_encrypted_entry = true;
        }
        let uncompressed = entry.size();
        let compressed = entry.compressed_size();
        // Per-entry expansion ratio (metadata only — no decompression needed to catch the bomb).
        if compressed > 0 && uncompressed / compressed > caps.max_expansion_ratio {
            return Some(Reason::DecompressionBomb);
        }
        scan.total_uncompressed = scan.total_uncompressed.saturating_add(uncompressed);
        if scan.total_uncompressed > caps.max_uncompressed_bytes {
            return Some(Reason::DecompressionBomb);
        }
        let name_lower = entry.name().to_ascii_lowercase();
        // A */vbaProject.bin part marks a macro-enabled OOXML document.
        if name_lower.ends_with("vbaproject.bin") {
            scan.has_macros = true;
        }
        // Descend into a nested zip (bounded by depth above and the size caps already applied).
        if name_lower.ends_with(".zip") && !entry.encrypted() {
            let mut nested = Vec::new();
            if entry.read_to_end(&mut nested).is_ok() {
                if let Some(reason) = scan_archive(&nested, caps, depth + 1, scan) {
                    return Some(reason);
                }
            }
        }
    }
    None
}
