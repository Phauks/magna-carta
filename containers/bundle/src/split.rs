use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Cuts `path` into `<path>.NNN` volumes of at most `max_part_bytes` each (1-based, zero-padded to 3
/// digits, more digits only if needed). The parts concatenated in order reproduce the file byte-for-byte
/// — which is exactly how a 7z multi-volume archive reassembles. A file at/under the limit yields one
/// `.001` part (the 7z volume convention; recipients always point their tool at `.001`). ZIP never reaches
/// this code — the build handler rejects `format:"zip"` carrying `split`.
pub fn split_file_into_volumes(
    path: &Path,
    max_part_bytes: u64,
) -> Result<Vec<PathBuf>, std::io::Error> {
    assert!(
        max_part_bytes > 0,
        "max_part_bytes must be positive (validated upstream)"
    );
    let mut input = std::fs::File::open(path)?;
    let mut parts = Vec::new();
    let mut index = 1usize;
    let mut buf = vec![0u8; 64 * 1024];
    let mut remaining_in_part = 0u64;
    let mut current: Option<std::fs::File> = None;
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let mut written = 0usize;
        while written < n {
            if remaining_in_part == 0 {
                let part_path = volume_path(path, index);
                current = Some(std::fs::File::create(&part_path)?);
                parts.push(part_path);
                index += 1;
                remaining_in_part = max_part_bytes;
            }
            let take = std::cmp::min((n - written) as u64, remaining_in_part) as usize;
            current
                .as_mut()
                .unwrap()
                .write_all(&buf[written..written + take])?;
            written += take;
            remaining_in_part -= take as u64;
        }
    }
    if parts.is_empty() {
        // An empty input still gets one (empty) .001 so the volume set is never zero-length.
        let part_path = volume_path(path, 1);
        std::fs::File::create(&part_path)?;
        parts.push(part_path);
    }
    Ok(parts)
}

fn volume_path(path: &Path, index: usize) -> PathBuf {
    let width = 3.max(((index as f64).log10().floor() as usize) + 1);
    PathBuf::from(format!(
        "{}.{:0width$}",
        path.display(),
        index,
        width = width
    ))
}
