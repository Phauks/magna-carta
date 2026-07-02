//! The CFB/OLE2 repair pillar: open a compound file, best-effort read each
//! stream, re-emit a fresh compound file. Diagnose CFB corruption.

use std::io::{Cursor, Read};
use std::path::PathBuf;

use cfb::CompoundFile;

use crate::error::RepairError;
use crate::limits::{MAX_ENTRY_COUNT, MAX_ENTRY_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES};

#[derive(Debug, Clone)]
pub struct SalvagedStream {
    pub path: String,
    pub data: Option<Vec<u8>>,
    pub recovered: bool,
    pub detail: String,
}

/// Open the compound file and best-effort read every stream. A stream that
/// errors on read, or whose size exceeds the per-stream cap, is recorded lost
/// (never partially kept). Returns Err only when the file cannot be opened at
/// all (the header/FAT/directory is too damaged) — manual sector-scan
/// reconstruction of that case is a separate, deeper effort.
pub fn salvage_streams(bytes: &[u8]) -> Result<Vec<SalvagedStream>, RepairError> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut compound = CompoundFile::open(cursor).map_err(|_| RepairError::Unrepairable)?;

    // Collect stream paths first; `walk` borrows the compound file immutably while
    // `open_stream` needs a mutable borrow.
    let paths: Vec<PathBuf> = compound
        .walk()
        .filter(|entry| entry.is_stream())
        .take(MAX_ENTRY_COUNT)
        .map(|entry| entry.path().to_path_buf())
        .collect();

    let mut out = Vec::new();
    let mut total: u64 = 0;
    for path in paths {
        let display = path.to_string_lossy().into_owned();
        if total >= MAX_TOTAL_UNCOMPRESSED_BYTES {
            out.push(SalvagedStream {
                path: display,
                data: None,
                recovered: false,
                detail: "file exceeds the total size cap".into(),
            });
            continue;
        }
        let read = read_capped(&mut compound, &path);
        match read {
            Ok(data) => {
                total = total.saturating_add(data.len() as u64);
                out.push(SalvagedStream {
                    path: display,
                    data: Some(data),
                    recovered: true,
                    detail: String::new(),
                });
            }
            Err(detail) => out.push(SalvagedStream {
                path: display,
                data: None,
                recovered: false,
                detail,
            }),
        }
    }
    Ok(out)
}

/// Read one stream with a per-stream byte cap. Over-cap or a read error → the
/// stream is lost (no partial bytes kept). The error string is a fixed reason,
/// never stream content.
fn read_capped(
    compound: &mut CompoundFile<Cursor<Vec<u8>>>,
    path: &std::path::Path,
) -> Result<Vec<u8>, String> {
    let mut stream = compound
        .open_stream(path)
        .map_err(|_| "stream could not be opened".to_string())?;
    let cap = MAX_ENTRY_UNCOMPRESSED_BYTES.saturating_add(1);
    let mut data = Vec::new();
    Read::take(&mut stream, cap)
        .read_to_end(&mut data)
        .map_err(|_| "stream truncated or corrupt".to_string())?;
    if data.len() as u64 > MAX_ENTRY_UNCOMPRESSED_BYTES {
        return Err("stream exceeds the per-stream size cap".to_string());
    }
    Ok(data)
}

#[cfg(test)]
mod salvage_tests {
    use super::*;
    use std::io::Write;

    /// Build a valid version-3 CFB with the given (path, content) streams. Paths are
    /// absolute, e.g. "/WordDocument". Parent storages are created as needed.
    pub(super) fn build_cfb(streams: &[(&str, &[u8])]) -> Vec<u8> {
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

    #[test]
    fn salvages_all_streams_from_a_healthy_cfb() {
        let cfb = build_cfb(&[
            ("/WordDocument", b"body text"),
            ("/\x01CompObj", b"compobj"),
        ]);
        let streams = salvage_streams(&cfb).expect("opens");
        assert_eq!(streams.len(), 2);
        assert!(streams.iter().all(|s| s.recovered));
        let wd = streams
            .iter()
            .find(|s| s.path.contains("WordDocument"))
            .unwrap();
        assert_eq!(wd.data.as_deref(), Some(&b"body text"[..]));
    }

    #[test]
    fn a_non_cfb_input_cannot_be_opened() {
        let result = salvage_streams(b"not a compound file at all, just bytes");
        assert!(result.is_err());
    }
}
