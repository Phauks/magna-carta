//! The container transport: the scan service writes the request body to a clamd-readable scratch file as
//! it arrives — never buffering the whole body in the heap — then memory-maps the file read-only so the
//! in-process engines (yara, the structural heuristics) read the same bytes with no second copy, while
//! clamd scans the file directly by path. Linux only; the Windows dev/test build buffers and streams
//! over INSTREAM instead. The peak resident set drops from roughly twice the file size (a heap `Bytes`
//! copy plus clamd's own read) toward the touched-page working set, which the kernel can evict under
//! pressure — that is what lets the instance be sized for ~1x the inspectable-size cap, not ~2x.

use axum::body::Body;
use futures_util::StreamExt;
use memmap2::Mmap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use tokio::io::AsyncWriteExt;

// A clamd-readable scratch directory the entrypoint creates and sweeps on boot. clamd opens the path
// itself, so it must live on a filesystem both processes share (it does — the same container).
// `SCAN_SCRATCH_DIR` overrides it so an integration test driving the real router — on any host that is
// not the container, where /scan does not exist — can spool into a writable temp dir; production never
// sets it. Resolved once, before the server takes traffic.
static SCAN_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
    std::env::var_os("SCAN_SCRATCH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/scan"))
});
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Why spooling the body failed.
#[derive(Debug)]
pub enum SpoolError {
    /// The body exceeded the inspectable-size cap mid-stream — the raw `Body` stream bypasses axum's
    /// extractor body limit, so the cap is enforced here. The partial file is discarded.
    TooLarge,
    /// A disk or request-stream I/O error.
    Io(std::io::Error),
}

/// A spooled request body: the scratch file and its read-only memory map. `Drop` removes the file; the
/// entrypoint's boot-time sweep of `SCAN_DIR` covers a SIGKILL/crash where `Drop` never runs. The map
/// keeps the file's pages valid even after the `File` handle is closed, so the handle is not retained.
pub struct Spooled {
    path: PathBuf,
    // `None` for a zero-length body: memmap2 refuses to map an empty file, and an empty buffer scans the
    // same — clamd reads the (empty) path and the engines see `&[]`.
    map: Option<Mmap>,
}

impl Spooled {
    /// The mapped body, for the in-process engines.
    pub fn bytes(&self) -> &[u8] {
        self.map.as_deref().unwrap_or(&[])
    }

    /// The scratch path clamd scans directly (`SCAN <path>`).
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Spooled {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Streams the request body to a fresh scratch file under `SCAN_DIR`, enforcing `max_bytes` as the bytes
/// arrive, then maps the file read-only. The file is written mode 0644 so the `clamav` user clamd drops
/// to can read it. On any error before success the partially-written file is removed.
pub async fn spool_body(body: Body, max_bytes: usize) -> Result<Spooled, SpoolError> {
    spool_body_in(SCAN_DIR.as_path(), body, max_bytes).await
}

/// `spool_body` parameterized on the scratch directory so tests can target a temp dir instead of the
/// container's `/scan`. Production always passes `SCAN_DIR`.
pub async fn spool_body_in(
    dir: &Path,
    body: Body,
    max_bytes: usize,
) -> Result<Spooled, SpoolError> {
    // A process-unique name; the boot sweep clears any leftover from a prior run, so no collision.
    let name = format!(
        "{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let path = dir.join(name);

    // Guard the partially-written file from the first byte: any early return below removes it. On
    // success its `Drop` is suppressed and ownership of cleanup passes to the returned `Spooled`.
    struct PartialFile(PathBuf);
    impl Drop for PartialFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let partial = PartialFile(path.clone());

    // `create_new` (O_EXCL): a name collision is a hard error, never a silent reuse of an existing file
    // — which would violate the single-writer precondition the read-only mmap relies on. The boot sweep
    // plus the process-unique name make a collision a should-never-happen, so failing loud is correct.
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(SpoolError::Io)?;
    let mut written: usize = 0;
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| SpoolError::Io(std::io::Error::other(error)))?;
        written = written.saturating_add(chunk.len());
        if written > max_bytes {
            return Err(SpoolError::TooLarge);
        }
        file.write_all(&chunk).await.map_err(SpoolError::Io)?;
    }
    file.flush().await.map_err(SpoolError::Io)?;
    // clamd drops to the `clamav` user; it must be able to read the scratch file.
    file.set_permissions(std::fs::Permissions::from_mode(0o644))
        .await
        .map_err(SpoolError::Io)?;
    drop(file);

    let map = if written == 0 {
        None
    } else {
        let std_file = std::fs::File::open(&path).map_err(SpoolError::Io)?;
        // SAFETY: memmap2's undefined-behavior condition is the backing file being mutated or truncated
        // while mapped. It cannot arise here: the file is written once above and is read-only from this
        // point — this process never writes it again, the boot-swept `/scan` is ours alone, and clamd
        // only reads it — so a page can never be invalidated under the map and no SIGBUS is possible.
        Some(unsafe { Mmap::map(&std_file) }.map_err(SpoolError::Io)?)
    };

    // Writing succeeded — suppress the partial-file guard; `Spooled`'s `Drop` now owns the cleanup.
    std::mem::forget(partial);
    Ok(Spooled { path, map })
}

#[cfg(test)]
mod tests {
    use super::{spool_body_in, SpoolError};
    use axum::body::Body;
    use futures_util::stream;
    use std::io::Read;

    // A fresh, empty temp directory under the OS temp root, removed when the returned guard drops. Keeps
    // the tests off the real `/scan` and lets each assert on the directory's file count directly.
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new() -> TempDir {
            let path = std::env::temp_dir().join(format!(
                "scan-spool-test-{}-{}",
                std::process::id(),
                super::SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
        fn file_count(&self) -> usize {
            std::fs::read_dir(&self.0).unwrap().count()
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn an_oversize_body_returns_too_large_and_leaves_zero_files() {
        let dir = TempDir::new();
        // Two 4-byte chunks against a 6-byte cap: the second pushes over, so it must abort and remove the
        // partial file (the PartialFile Drop fires on the early return).
        let body = Body::from_stream(stream::iter(vec![
            Ok::<_, std::io::Error>(vec![1u8, 2, 3, 4]),
            Ok::<_, std::io::Error>(vec![5u8, 6, 7, 8]),
        ]));
        let result = spool_body_in(&dir.0, body, 6).await;
        assert!(matches!(result, Err(SpoolError::TooLarge)));
        assert_eq!(
            dir.file_count(),
            0,
            "the partial scratch file must be removed"
        );
    }

    #[tokio::test]
    async fn a_mid_stream_error_leaves_zero_files() {
        let dir = TempDir::new();
        // A first good chunk, then a stream error — spool must surface Io and leave no scratch file.
        let body = Body::from_stream(stream::iter(vec![
            Ok::<_, std::io::Error>(vec![1u8, 2, 3]),
            Err(std::io::Error::other("boom")),
        ]));
        let result = spool_body_in(&dir.0, body, 1024).await;
        assert!(matches!(result, Err(SpoolError::Io(_))));
        assert_eq!(
            dir.file_count(),
            0,
            "the partial scratch file must be removed"
        );
    }

    #[tokio::test]
    async fn a_successful_spool_removes_its_scratch_file_on_drop() {
        let dir = TempDir::new();
        {
            let body = Body::from(vec![0xAAu8; 32]);
            let spooled = spool_body_in(&dir.0, body, 1024).await.expect("spool");
            assert_eq!(spooled.bytes().len(), 32);
            // Read the scratch file back to confirm it exists and matches while the Spooled is live.
            let mut on_disk = Vec::new();
            std::fs::File::open(spooled.path())
                .unwrap()
                .read_to_end(&mut on_disk)
                .unwrap();
            assert_eq!(on_disk, vec![0xAAu8; 32]);
            assert_eq!(dir.file_count(), 1);
        }
        // The Spooled dropped at the block end; its Drop removed the scratch file.
        assert_eq!(dir.file_count(), 0, "Drop must remove the scratch file");
    }

    #[tokio::test]
    async fn an_empty_body_maps_to_none_and_scans_as_empty_bytes() {
        let dir = TempDir::new();
        let spooled = spool_body_in(&dir.0, Body::from(Vec::<u8>::new()), 1024)
            .await
            .expect("spool");
        // memmap2 refuses to map an empty file, so the map is None and `bytes()` lends `&[]` — the
        // engines scan an empty buffer, never a panic on an empty mmap.
        assert!(spooled.map.is_none());
        assert_eq!(spooled.bytes(), &[] as &[u8]);
    }
}
