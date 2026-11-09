//! Archive enumeration and guarded expansion.
//!
//! The File Manager stores an uploaded archive opaque and never opens it, on the sound reasoning
//! that code you do not write is a zip-bomb read path you do not have to defend. That reasoning
//! holds there and does not survive contact with discovery, because a production received from an
//! opposing party ARRIVES as a zip: a discovery subsystem that cannot open one cannot ingest an
//! external production at all, which is half of what discovery is for. So expansion exists, it
//! exists only here, and it is guarded.
//!
//! FIVE GUARDS, EVERY ONE CHECKED BEFORE A DECOMPRESSED BYTE IS RETAINED:
//!
//! 1. **Nesting depth.** Past the ceiling an archive is recorded, not opened.
//! 2. **Total expanded bytes**, across every entry at every depth.
//! 3. **Expansion ratio**, so a small archive that inflates enormously is refused on the shape of
//!    the attack rather than on the size of the result.
//! 4. **Entry count**, read from the central directory before anything is inflated.
//! 5. **Path traversal** — an absolute path or a `..` segment is rejected unconditionally, always,
//!    with no ceiling to raise and no option to turn it off.
//!
//! And two rules that are not guards but matter as much: an ENCRYPTED entry is reported and its
//! siblings still load (one locked file must not cost a firm the other nine thousand), and the
//! archive itself is never modified — expansion produces new bytes beside it, and the as-received
//! original stays the evidence copy.
//!
//! This module hands back bytes. It does not decide that an entry is safe: every expanded entry
//! re-enters the ordinary ingest gate — magic-byte sniff, hash, malware scan — because an archive is
//! a transport, not a trust boundary.

use std::io::{Cursor, Read};

use crate::error::DiscoveryError;
use crate::limits::Limits;

/// What one entry's central-directory record says, with nothing decompressed to learn it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    /// The path as the archive declares it, verbatim. Never used to open anything — it is reported,
    /// and [`ArchiveEntry::is_traversal`] is what decides whether it may be written anywhere.
    pub path: String,
    pub compressed_size: u64,
    /// What the archive CLAIMS the entry expands to. Attacker-controlled, so it is used for
    /// reporting and for a cheap pre-check, and never to size an allocation.
    pub declared_size: u64,
    pub encrypted: bool,
    pub is_directory: bool,
}

impl ArchiveEntry {
    /// Does this path try to escape the extraction root? An absolute path, a Windows drive letter, a
    /// `..` segment, or a backslash-separated variant of any of them.
    pub fn is_traversal(&self) -> bool {
        is_traversal_path(&self.path)
    }
}

fn is_traversal_path(path: &str) -> bool {
    if path.starts_with('/') || path.starts_with('\\') {
        return true;
    }
    // A drive-letter prefix (`C:\`) is absolute on the platform that wrote it.
    if path.len() >= 2 && path.as_bytes()[1] == b':' {
        return true;
    }
    path.split(['/', '\\']).any(|segment| segment == "..")
}

/// Why an entry was described rather than expanded. Every one of these is a sentence in the
/// exception report, which is why they are named rather than collapsed into a boolean.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// The entry is encrypted. Reported, never fatal to the archive.
    Encrypted,
    /// The path tried to escape the extraction root.
    PathTraversal,
    /// The entry is itself an archive, and expanding it would pass the nesting ceiling.
    NestedTooDeep,
    /// This one entry alone is over the per-entry ceiling.
    EntryOversize,
    /// The entry's own bytes could not be read.
    Unreadable,
}

impl SkipReason {
    pub fn label(&self) -> &'static str {
        match self {
            SkipReason::Encrypted => "encrypted",
            SkipReason::PathTraversal => "pathTraversal",
            SkipReason::NestedTooDeep => "nestedTooDeep",
            SkipReason::EntryOversize => "entryOversize",
            SkipReason::Unreadable => "unreadable",
        }
    }
}

/// One entry that came out with its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpandedEntry {
    /// The path components joined with `/`, with the parent archive's path prefixed for a nested
    /// entry, so an entry's provenance inside the container tree is readable from its name alone.
    pub path: String,
    pub bytes: Vec<u8>,
    /// How deep in the container tree this entry sits. Zero for a direct child of the archive.
    pub depth: usize,
}

/// One entry that did not, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedEntry {
    pub path: String,
    pub reason: SkipReason,
    pub depth: usize,
}

/// The whole result of expanding one archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expansion {
    pub entries: Vec<ExpandedEntry>,
    pub skipped: Vec<SkippedEntry>,
    pub total_expanded_bytes: u64,
}

/// List an archive's entries WITHOUT decompressing any of them. This is what makes an unexpanded
/// archive describable rather than opaque: even where expansion is refused, the load can say exactly
/// what was inside, which is the difference between an honest exception and a shrug.
pub fn enumerate(bytes: &[u8], limits: &Limits) -> Result<Vec<ArchiveEntry>, DiscoveryError> {
    let mut archive =
        zip::read::ZipArchive::new(Cursor::new(bytes)).map_err(|_| DiscoveryError::Corrupt)?;
    if archive.len() > limits.max_archive_entries {
        return Err(DiscoveryError::ContainerGuardTripped);
    }
    let mut entries = Vec::with_capacity(archive.len().min(4096));
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|_| DiscoveryError::Corrupt)?;
        entries.push(ArchiveEntry {
            path: entry
                .name()
                .map(std::borrow::Cow::into_owned)
                .unwrap_or_else(|_| String::from_utf8_lossy(entry.name_raw()).into_owned()),
            compressed_size: entry.compressed_size(),
            declared_size: entry.size(),
            encrypted: entry.encrypted(),
            is_directory: entry.is_dir(),
        });
    }
    Ok(entries)
}

/// Expand an archive under every guard. Returns what came out and what did not, and errors only when
/// the ARCHIVE as a whole trips a guard — a single bad entry is never allowed to fail its siblings.
pub fn expand(bytes: &[u8], limits: &Limits) -> Result<Expansion, DiscoveryError> {
    let mut expansion = Expansion {
        entries: Vec::new(),
        skipped: Vec::new(),
        total_expanded_bytes: 0,
    };
    let mut budget = Budget {
        compressed_seen: bytes.len() as u64,
        expanded: 0,
    };
    expand_into(bytes, "", 0, limits, &mut expansion, &mut budget)?;
    expansion.total_expanded_bytes = budget.expanded;
    Ok(expansion)
}

/// The running totals the ratio and total-bytes guards are computed from. Held across the whole
/// container tree rather than per archive, because a bomb split across a hundred nested archives is
/// still one bomb.
struct Budget {
    compressed_seen: u64,
    expanded: u64,
}

fn expand_into(
    bytes: &[u8],
    prefix: &str,
    depth: usize,
    limits: &Limits,
    expansion: &mut Expansion,
    budget: &mut Budget,
) -> Result<(), DiscoveryError> {
    let mut archive =
        zip::read::ZipArchive::new(Cursor::new(bytes)).map_err(|_| DiscoveryError::Corrupt)?;
    // Guard 4, from the central directory, before a single byte is inflated.
    if archive.len() > limits.max_archive_entries {
        return Err(DiscoveryError::ContainerGuardTripped);
    }
    for index in 0..archive.len() {
        let (path, encrypted, is_directory, declared_size) = {
            let entry = archive
                .by_index_raw(index)
                .map_err(|_| DiscoveryError::Corrupt)?;
            (
                entry
                    .name()
                    .map(std::borrow::Cow::into_owned)
                    .unwrap_or_else(|_| String::from_utf8_lossy(entry.name_raw()).into_owned()),
                entry.encrypted(),
                entry.is_dir(),
                entry.size(),
            )
        };
        let full_path = if prefix.is_empty() {
            path.clone()
        } else {
            format!("{prefix}/{path}")
        };
        if is_directory {
            continue;
        }
        // Guard 5. Unconditional, and checked before anything else about the entry, because a
        // traversal path must never reach a code path that could act on it.
        if is_traversal_path(&path) {
            expansion.skipped.push(SkippedEntry {
                path: full_path,
                reason: SkipReason::PathTraversal,
                depth,
            });
            continue;
        }
        if encrypted {
            expansion.skipped.push(SkippedEntry {
                path: full_path,
                reason: SkipReason::Encrypted,
                depth,
            });
            continue;
        }
        // The cheap pre-check on the DECLARED size: a claim over the ceiling is refused without
        // inflating, and a lying claim is caught by the real read below.
        if declared_size > limits.max_entry_bytes {
            expansion.skipped.push(SkippedEntry {
                path: full_path,
                reason: SkipReason::EntryOversize,
                depth,
            });
            continue;
        }
        // Read one byte past the tightest remaining ceiling. Reading past it is how the ceiling is
        // detected without ever holding more than the ceiling plus one byte — a declared length
        // never sizes the buffer.
        let remaining_total = limits.max_expanded_bytes.saturating_sub(budget.expanded);
        let ceiling = limits.max_entry_bytes.min(remaining_total);
        let mut entry = archive
            .by_index(index)
            .map_err(|_| DiscoveryError::Corrupt)?;
        let mut buffer = Vec::new();
        if (&mut entry)
            .take(ceiling.saturating_add(1))
            .read_to_end(&mut buffer)
            .is_err()
        {
            expansion.skipped.push(SkippedEntry {
                path: full_path,
                reason: SkipReason::Unreadable,
                depth,
            });
            continue;
        }
        let produced = buffer.len() as u64;
        if produced > ceiling {
            // Guard 2 and guard 3's raw material. Whether this entry alone was too big or the
            // archive's running total was, the archive is over budget and expansion stops: a bomb
            // that is only detected on its ten-thousandth entry has already been paid for.
            if produced > limits.max_entry_bytes {
                expansion.skipped.push(SkippedEntry {
                    path: full_path,
                    reason: SkipReason::EntryOversize,
                    depth,
                });
                continue;
            }
            return Err(DiscoveryError::ContainerGuardTripped);
        }
        budget.expanded = budget.expanded.saturating_add(produced);
        // Guard 3, evaluated on the running totals so a bomb cannot hide behind a large first entry.
        if budget.compressed_seen > 0
            && budget.expanded / budget.compressed_seen.max(1) > limits.max_expansion_ratio
        {
            return Err(DiscoveryError::ContainerGuardTripped);
        }
        // Guard 1. A nested archive past the ceiling is RECORDED — its bytes come out as an entry
        // and its unexpanded status is reported — rather than silently opened or silently dropped.
        let nested = engine_host::format::detect(&buffer) == Some(engine_host::format::Format::Zip);
        if nested && depth + 1 >= limits.max_archive_nesting_depth {
            expansion.skipped.push(SkippedEntry {
                path: full_path.clone(),
                reason: SkipReason::NestedTooDeep,
                depth,
            });
            expansion.entries.push(ExpandedEntry {
                path: full_path,
                bytes: buffer,
                depth,
            });
            continue;
        }
        if nested {
            let nested_bytes = buffer.clone();
            expansion.entries.push(ExpandedEntry {
                path: full_path.clone(),
                bytes: buffer,
                depth,
            });
            budget.compressed_seen = budget
                .compressed_seen
                .saturating_add(nested_bytes.len() as u64);
            expand_into(
                &nested_bytes,
                &full_path,
                depth + 1,
                limits,
                expansion,
                budget,
            )?;
            continue;
        }
        expansion.entries.push(ExpandedEntry {
            path: full_path,
            bytes: buffer,
            depth,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{nested_zip_archive, zip_bomb, zip_from, zip_with_traversal_entry};

    #[test]
    fn enumeration_lists_entries_without_decompressing_them() {
        let archive = zip_from(&[
            ("PLTF000001.txt", b"first exhibit"),
            ("folder/PLTF000002.txt", b"second exhibit"),
        ]);
        let entries = enumerate(&archive, &Limits::default()).unwrap();
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
        assert_eq!(paths, vec!["PLTF000001.txt", "folder/PLTF000002.txt"]);
        assert_eq!(entries[0].declared_size, 13);
        assert!(!entries[0].encrypted);
    }

    #[test]
    fn a_zip_bomb_trips_the_ratio_guard_rather_than_exhausting_memory() {
        // Highly compressible content: a small archive that would expand thousands of times over.
        let bomb = zip_bomb();
        let limits = Limits {
            max_expansion_ratio: 10,
            ..Limits::default()
        };
        assert_eq!(
            expand(&bomb, &limits),
            Err(DiscoveryError::ContainerGuardTripped)
        );
    }

    #[test]
    fn the_total_expanded_bytes_ceiling_stops_an_archive_that_is_merely_enormous() {
        // Not a bomb — the ratio is ordinary — but more bytes than the budget allows.
        let archive = zip_from(&[
            ("a.bin", &vec![b'a'; 4096]),
            ("b.bin", &vec![b'b'; 4096]),
            ("c.bin", &vec![b'c'; 4096]),
        ]);
        let limits = Limits {
            max_expanded_bytes: 5_000,
            max_expansion_ratio: u64::MAX,
            ..Limits::default()
        };
        assert_eq!(
            expand(&archive, &limits),
            Err(DiscoveryError::ContainerGuardTripped)
        );
    }

    #[test]
    fn a_traversal_entry_is_rejected_unconditionally_and_its_siblings_still_load() {
        let archive = zip_with_traversal_entry();
        let expansion = expand(&archive, &Limits::default()).unwrap();
        assert!(expansion
            .skipped
            .iter()
            .any(|entry| entry.reason == SkipReason::PathTraversal));
        assert!(
            expansion
                .entries
                .iter()
                .any(|entry| entry.path == "innocent.txt"),
            "a traversal entry cost its sibling"
        );
        // Nothing that escaped the root came out with bytes.
        assert!(!expansion
            .entries
            .iter()
            .any(|entry| is_traversal_path(&entry.path)));
    }

    #[test]
    fn a_nested_archive_past_the_depth_ceiling_is_recorded_rather_than_expanded() {
        let archive = nested_zip_archive(4);
        let limits = Limits {
            max_archive_nesting_depth: 2,
            ..Limits::default()
        };
        let expansion = expand(&archive, &limits).unwrap();
        assert!(expansion
            .skipped
            .iter()
            .any(|entry| entry.reason == SkipReason::NestedTooDeep));
        // The deepest payload never came out, because the archive holding it was never opened.
        assert!(!expansion
            .entries
            .iter()
            .any(|entry| entry.bytes == b"the deepest exhibit"));
        // And the archive that was refused is still present as bytes, so it can be recorded.
        assert!(expansion
            .entries
            .iter()
            .any(|entry| entry.depth == 1 && !entry.bytes.is_empty()));
    }

    #[test]
    fn an_entry_count_over_the_ceiling_refuses_the_archive_before_any_inflation() {
        let files: Vec<(String, Vec<u8>)> = (0..50)
            .map(|index| (format!("f{index}.txt"), b"x".to_vec()))
            .collect();
        let borrowed: Vec<(&str, &[u8])> = files
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect();
        let archive = zip_from(&borrowed);
        let limits = Limits {
            max_archive_entries: 10,
            ..Limits::default()
        };
        assert_eq!(
            expand(&archive, &limits),
            Err(DiscoveryError::ContainerGuardTripped)
        );
        assert_eq!(
            enumerate(&archive, &limits),
            Err(DiscoveryError::ContainerGuardTripped)
        );
    }

    #[test]
    fn an_entry_over_the_per_entry_ceiling_is_skipped_while_its_siblings_load() {
        let archive = zip_from(&[("small.txt", b"small"), ("large.bin", &vec![b'x'; 20_000])]);
        let limits = Limits {
            max_entry_bytes: 1_000,
            max_expansion_ratio: u64::MAX,
            ..Limits::default()
        };
        let expansion = expand(&archive, &limits).unwrap();
        assert!(expansion
            .skipped
            .iter()
            .any(|entry| entry.reason == SkipReason::EntryOversize));
        assert!(expansion
            .entries
            .iter()
            .any(|entry| entry.path == "small.txt"));
    }

    #[test]
    fn a_nested_archive_inside_the_ceiling_expands_and_its_entries_carry_their_provenance() {
        let archive = nested_zip_archive(2);
        let expansion = expand(&archive, &Limits::default()).unwrap();
        let deepest = expansion
            .entries
            .iter()
            .find(|entry| entry.bytes == b"the deepest exhibit")
            .expect("the innermost payload");
        assert_eq!(deepest.path, "level0.zip/level1.zip/deepest.txt");
        assert_eq!(deepest.depth, 2);
    }

    #[test]
    fn a_damaged_archive_is_corrupt_rather_than_a_panic() {
        let mut archive = zip_from(&[("a.txt", b"one")]);
        archive.truncate(archive.len() / 2);
        assert_eq!(
            expand(&archive, &Limits::default()),
            Err(DiscoveryError::Corrupt)
        );
    }

    #[test]
    fn every_traversal_shape_is_recognized() {
        for path in [
            "/etc/passwd",
            "..",
            "../secrets",
            "a/../../b",
            "C:\\Windows\\system32",
            "..\\..\\b",
            "\\\\server\\share",
        ] {
            assert!(is_traversal_path(path), "{path} was not caught");
        }
        for path in ["a.txt", "folder/a.txt", "a..b/c.txt", "...hidden"] {
            assert!(!is_traversal_path(path), "{path} was wrongly caught");
        }
    }
}
