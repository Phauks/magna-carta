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
use tokio::io::AsyncWriteExt;

// A clamd-readable scratch directory the entrypoint creates and sweeps on boot. clamd opens the path
// itself, so it must live on a filesystem both processes share (it does — the same container).
const SCAN_DIR: &str = "/scan";
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Why spooling the body failed.
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

/// Streams the request body to a fresh scratch file, enforcing `max_bytes` as the bytes arrive, then
/// maps the file read-only. The file is written mode 0644 so the `clamav` user clamd drops to can read
/// it. On any error before success the partially-written file is removed.
pub async fn spool_body(body: Body, max_bytes: usize) -> Result<Spooled, SpoolError> {
    // A process-unique name; the boot sweep clears any leftover from a prior run, so no collision.
    let name = format!(
        "{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let path = PathBuf::from(SCAN_DIR).join(name);

    // Guard the partially-written file from the first byte: any early return below removes it. On
    // success its `Drop` is suppressed and ownership of cleanup passes to the returned `Spooled`.
    struct PartialFile(PathBuf);
    impl Drop for PartialFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let partial = PartialFile(path.clone());

    let mut file = tokio::fs::File::create(&path)
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
