// The POST /build handler: turn a manifest into archive volumes. Two lanes, selected by the `stream`
// query flag:
//   - buffered (default): encode → optionally 7z-split → PUT each volume to R2 → return a BuildResponse.
//   - streaming (`?stream=1`): encode a single archive and stream it straight back in the response body
//     — never split, never written to R2 (this is the encrypted lane; the archive is never persisted).
// In both lanes inputs are spilled to ephemeral disk (R2 GET or inline base64) and the encoded archive
// lives on disk, so the whole archive never sits in memory. The CPU-bound encode (and the split) run on
// the blocking pool so the async runtime stays free to serve /ready. The encryption password (in
// `req.encryption`) is used only for encoding and is never logged or persisted.
use crate::contract::{
    BuildRequest, BuildResponse, Compression, Encryption, EntrySource, Format, Volume,
};
use crate::encode::{encode_7z, encode_zip, LocalEntry};
use crate::{r2, split, AppState};
use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use futures_util::Stream;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::task::{Context, Poll};

/// Upper bound on the number of 7z volumes a single build may produce. A defense against a tiny
/// `maxPartBytes` exploding the part count (and the R2 PUT loop); far above any legitimate split.
const MAX_VOLUMES: u64 = 100_000;

/// A build failure, carrying the right HTTP status so the caller can tell a bad manifest (permanent,
/// don't retry) from a transient R2/upstream hiccup (retryable) from an internal fault.
enum BuildError {
    /// The request is wrong (bad manifest, unsafe key, undecodable inline bytes) — HTTP 422.
    Client(String),
    /// An R2 read/write failed transiently (transport error or R2 5xx) — HTTP 502. The message is
    /// generic on purpose so the internal R2 URL/key never leaks into the response.
    Upstream,
    /// An internal fault (disk, encoder, blocking-task join) — HTTP 500.
    Server(String),
}

impl BuildError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            BuildError::Client(message) => (StatusCode::UNPROCESSABLE_ENTITY, message),
            BuildError::Upstream => (
                StatusCode::BAD_GATEWAY,
                "an R2 read or write failed".to_string(),
            ),
            BuildError::Server(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
        };
        (
            status,
            Json(BuildResponse {
                ok: false,
                volumes: vec![],
                error: Some(message),
            }),
        )
            .into_response()
    }
}

// Map an R2 transport result to the right build error: a 4xx (e.g. a missing input key) is the caller's
// fault and permanent (422); a transport error or 5xx is transient and retryable (502); a local disk
// error during the transfer is an internal fault (500). Never echoes the reqwest error (which embeds the
// URL) for the upstream case.
fn from_r2(error: r2::R2Error) -> BuildError {
    match error {
        r2::R2Error::Status(status) if status.is_client_error() => {
            BuildError::Client(format!("an R2 object request failed with status {status}"))
        }
        r2::R2Error::Io(io_error) => {
            BuildError::Server(format!("disk error during an R2 transfer: {io_error}"))
        }
        r2::R2Error::Http(_) | r2::R2Error::Status(_) => BuildError::Upstream,
    }
}

/// The `/build` query string. `stream=1` selects the streaming (no-persist) lane.
#[derive(serde::Deserialize)]
pub struct BuildQuery {
    stream: Option<String>,
}

/// A spill-file reader that opens its file on first read instead of at construction, so the handler can
/// build a reader per entry without holding every input file's descriptor open at once.
struct LazyFile {
    path: PathBuf,
    file: Option<std::fs::File>,
}
impl LazyFile {
    fn new(path: PathBuf) -> Self {
        LazyFile { path, file: None }
    }
}
impl Read for LazyFile {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.file.is_none() {
            self.file = Some(std::fs::File::open(&self.path)?);
        }
        self.file.as_mut().unwrap().read(buf)
    }
}

/// Streams the encoded archive back while keeping its temp directory alive: the response body reads from
/// the file, and the `TempDir` must not be dropped (which would delete the file) until the body is fully
/// sent. Holding it here ties the directory's lifetime to the stream.
struct TempFileStream {
    _scratch: tempfile::TempDir,
    inner: tokio_util::io::ReaderStream<tokio::fs::File>,
}
impl Stream for TempFileStream {
    type Item = std::io::Result<Bytes>;
    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        // Both fields are Unpin (tokio File + ReaderStream), so projecting through get_mut is sound.
        let this = self.get_mut();
        Pin::new(&mut this.inner).poll_next(cx)
    }
}

pub async fn build_handler(
    State(state): State<AppState>,
    Query(query): Query<BuildQuery>,
    Json(req): Json<BuildRequest>,
) -> Response {
    let result = if query.stream.as_deref() == Some("1") {
        build_stream(&state, req).await
    } else {
        build(&state, req).await.map(|volumes| {
            Json(BuildResponse {
                ok: true,
                volumes,
                error: None,
            })
            .into_response()
        })
    };
    match result {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

/// Defense in depth at the last hop before R2: reject any key/prefix that could escape the intended
/// scope or rewrite the request host (a scheme, an absolute path, or a `..` segment). The TS layer
/// sanitizes upstream; this is the container refusing to be steered by a forged manifest.
fn reject_unsafe_key(key: &str) -> Result<(), BuildError> {
    if key.contains("://")
        || key.starts_with('/')
        || key.starts_with('\\')
        || key.split(['/', '\\']).any(|segment| segment == "..")
    {
        return Err(BuildError::Client(
            "rejected an unsafe R2 key or output prefix".into(),
        ));
    }
    Ok(())
}

fn validate_keys(req: &BuildRequest) -> Result<(), BuildError> {
    reject_unsafe_key(&req.output_key_prefix)?;
    for entry in &req.entries {
        if let EntrySource::R2 { r2_key } = &entry.source {
            reject_unsafe_key(r2_key)?;
        }
    }
    Ok(())
}

/// Spills every input to a temp file under `scratch` (R2 GET streamed to disk, or inline base64 decoded),
/// returning a lazy reader per entry and the spill paths (so the caller can free them once encoding has
/// consumed them). R2 bodies never fully buffer; the inline path is the small generated CONTENTS file
/// (bounded by the request body limit).
async fn spill_inputs(
    state: &AppState,
    req: &BuildRequest,
    scratch: &Path,
) -> Result<(Vec<LocalEntry>, Vec<PathBuf>), BuildError> {
    let mut locals: Vec<LocalEntry> = Vec::with_capacity(req.entries.len());
    let mut spill_paths: Vec<PathBuf> = Vec::with_capacity(req.entries.len());
    for (i, entry) in req.entries.iter().enumerate() {
        let spill = scratch.join(format!("in-{i}"));
        let mut file =
            std::fs::File::create(&spill).map_err(|e| BuildError::Server(e.to_string()))?;
        match &entry.source {
            EntrySource::R2 { r2_key } => {
                r2::get_to_writer(&state.http, &state.r2_base_url, r2_key, &mut file)
                    .await
                    .map_err(from_r2)?;
            }
            EntrySource::Inline { bytes_base64 } => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(bytes_base64)
                    .map_err(|e| BuildError::Client(format!("invalid inline base64: {e}")))?;
                std::io::Write::write_all(&mut file, &bytes)
                    .map_err(|e| BuildError::Server(e.to_string()))?;
            }
        }
        drop(file);
        locals.push(LocalEntry {
            archive_path: entry.archive_path.clone(),
            mtime_epoch_secs: entry.mtime_epoch_secs,
            reader: Box::new(LazyFile::new(spill.clone())),
        });
        spill_paths.push(spill);
    }
    Ok((locals, spill_paths))
}

/// The CPU-bound encode, run on the blocking pool. Writes the archive to `out_path` (a seekable file),
/// then deletes the now-consumed input spill files so peak disk during split/PUT is bounded by the
/// archive, not the archive plus every input.
fn encode_to_file(
    format: Format,
    compression: Compression,
    encryption: Option<Encryption>,
    locals: Vec<LocalEntry>,
    spill_paths: &[PathBuf],
    out_path: &Path,
) -> Result<(), BuildError> {
    let mut out = std::fs::File::create(out_path).map_err(|e| BuildError::Server(e.to_string()))?;
    let enc = encryption.as_ref();
    match format {
        Format::Zip => encode_zip(locals.into_iter(), compression, enc, &mut out),
        Format::SevenZip => encode_7z(locals.into_iter(), compression, enc, &mut out),
    }
    .map_err(|e| BuildError::Server(e.to_string()))?;
    out.sync_all()
        .map_err(|e| BuildError::Server(e.to_string()))?;
    for path in spill_paths {
        let _ = std::fs::remove_file(path); // best-effort; the temp dir is removed regardless on drop
    }
    Ok(())
}

async fn build(state: &AppState, req: BuildRequest) -> Result<Vec<Volume>, BuildError> {
    // ZIP has no format-native multi-volume splitting (the TS layer rejects it too).
    if matches!(req.format, Format::Zip) && req.split.is_some() {
        return Err(BuildError::Client(
            "zip does not support multi-volume splitting".into(),
        ));
    }
    if let Some(split) = &req.split {
        if split.max_part_bytes == 0 {
            return Err(BuildError::Client("maxPartBytes must be positive".into()));
        }
    }
    validate_keys(&req)?;

    let scratch = tempfile::tempdir().map_err(|e| BuildError::Server(e.to_string()))?;
    let (locals, spill_paths) = spill_inputs(state, &req, scratch.path()).await?;
    let out_path = scratch.path().join("archive.out");

    // Encode (and split) off the async worker thread so /ready stays responsive during a long build.
    let format = req.format;
    let compression = req.compression;
    let encryption = req.encryption.clone();
    let split_max = req.split.as_ref().map(|s| s.max_part_bytes);
    let encode_out = out_path.clone();
    let parts: Vec<PathBuf> =
        tokio::task::spawn_blocking(move || -> Result<Vec<PathBuf>, BuildError> {
            encode_to_file(
                format,
                compression,
                encryption,
                locals,
                &spill_paths,
                &encode_out,
            )?;
            match split_max {
                Some(max) => {
                    // Cap the volume count before cutting: a pathologically small maxPartBytes (e.g. 1)
                    // would otherwise explode into millions of part files and R2 PUTs. Bounds the blast
                    // radius regardless of the requested part size.
                    let size = std::fs::metadata(&encode_out)
                        .map_err(|e| BuildError::Server(e.to_string()))?
                        .len();
                    if size.div_ceil(max) > MAX_VOLUMES {
                        return Err(BuildError::Client(format!(
                            "maxPartBytes too small: would produce more than {MAX_VOLUMES} volumes"
                        )));
                    }
                    split::split_file_into_volumes(&encode_out, max)
                        .map_err(|e| BuildError::Server(e.to_string()))
                }
                None => Ok(vec![encode_out.clone()]),
            }
        })
        .await
        .map_err(|e| BuildError::Server(format!("encode task failed: {e}")))??;

    // PUT each volume to R2. A single (unsplit) artifact keeps the bare prefix; split volumes get the
    // 7z `.NNN` suffix.
    let mut volumes = Vec::with_capacity(parts.len());
    for (i, part) in parts.iter().enumerate() {
        let key = if req.split.is_some() {
            format!("{}.{:03}", req.output_key_prefix, i + 1)
        } else {
            req.output_key_prefix.clone()
        };
        let len = std::fs::metadata(part)
            .map_err(|e| BuildError::Server(e.to_string()))?
            .len();
        let file = tokio::fs::File::open(part)
            .await
            .map_err(|e| BuildError::Server(e.to_string()))?;
        r2::put_file(&state.http, &state.r2_base_url, &key, file, len)
            .await
            .map_err(from_r2)?;
        volumes.push(Volume {
            key,
            size_bytes: len,
        });
    }
    Ok(volumes)
}

/// The streaming lane: encode a single archive and stream it straight back, never split and never
/// written to R2. This is the encrypted lane — the archive (and its password) exist only in flight.
async fn build_stream(state: &AppState, req: BuildRequest) -> Result<Response, BuildError> {
    // The streaming lane is single-file: splitting needs persisted, individually addressable volumes.
    // (encryption+split is already rejected upstream; this rejects split defensively here too.)
    if req.split.is_some() {
        return Err(BuildError::Client(
            "the streaming lane does not support multi-volume splitting".into(),
        ));
    }
    validate_keys(&req)?;

    let scratch = tempfile::tempdir().map_err(|e| BuildError::Server(e.to_string()))?;
    let (locals, spill_paths) = spill_inputs(state, &req, scratch.path()).await?;
    let out_path = scratch.path().join("archive.out");

    let format = req.format;
    let compression = req.compression;
    let encryption = req.encryption.clone();
    let encode_out = out_path.clone();
    tokio::task::spawn_blocking(move || {
        encode_to_file(
            format,
            compression,
            encryption,
            locals,
            &spill_paths,
            &encode_out,
        )
    })
    .await
    .map_err(|e| BuildError::Server(format!("encode task failed: {e}")))??;

    // Stream the encoded file as the response body. The TempDir rides along in the stream so it is not
    // dropped (which would delete the file) until the body is fully sent. The worker sets the
    // user-facing content-type; the container emits a generic octet-stream.
    let file = tokio::fs::File::open(&out_path)
        .await
        .map_err(|e| BuildError::Server(e.to_string()))?;
    let stream = TempFileStream {
        _scratch: scratch,
        inner: tokio_util::io::ReaderStream::new(file),
    };
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/octet-stream")],
        Body::from_stream(stream),
    )
        .into_response())
}
