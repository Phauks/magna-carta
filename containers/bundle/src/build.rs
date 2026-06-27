// The POST /build handler: turn a manifest into one or more archive volumes written to R2. Inputs are
// spilled to ephemeral disk (R2 GET or inline base64), encoded (ZIP or 7z) into an output temp file,
// optionally split into 7z volumes, then streamed to R2 — the whole archive never lives fully in memory.
// The encryption password (in `req.encryption`) is used only for encoding and is never logged.
use crate::contract::{BuildRequest, BuildResponse, EntrySource, Format, Volume};
use crate::encode::{encode_7z, encode_zip, LocalEntry};
use crate::{r2, split, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;

pub async fn build_handler(
    State(state): State<AppState>,
    Json(req): Json<BuildRequest>,
) -> Response {
    match build(&state, req).await {
        Ok(volumes) => Json(BuildResponse {
            ok: true,
            volumes,
            error: None,
        })
        .into_response(),
        Err(message) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(BuildResponse {
                ok: false,
                volumes: vec![],
                error: Some(message),
            }),
        )
            .into_response(),
    }
}

async fn build(state: &AppState, req: BuildRequest) -> Result<Vec<Volume>, String> {
    // Defense in depth: ZIP has no format-native multi-volume splitting (the TS layer rejects it too).
    if matches!(req.format, Format::Zip) && req.split.is_some() {
        return Err("zip does not support multi-volume splitting".into());
    }

    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;

    // 1. Spill every input to a temp file (R2 GET or inline base64), then open a reader over each.
    let mut locals: Vec<LocalEntry> = Vec::with_capacity(req.entries.len());
    for (i, entry) in req.entries.iter().enumerate() {
        let spill = scratch.path().join(format!("in-{i}"));
        let mut file = std::fs::File::create(&spill).map_err(|e| e.to_string())?;
        match &entry.source {
            EntrySource::R2 { r2_key } => {
                r2::get_to_writer(&state.http, &state.r2_base_url, r2_key, &mut file)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            EntrySource::Inline { bytes_base64 } => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(bytes_base64)
                    .map_err(|e| e.to_string())?;
                std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
            }
        }
        drop(file);
        locals.push(LocalEntry {
            archive_path: entry.archive_path.clone(),
            mtime_epoch_secs: entry.mtime_epoch_secs,
            reader: Box::new(std::fs::File::open(&spill).map_err(|e| e.to_string())?),
        });
    }

    // 2. Encode into a seekable output temp file.
    let out_path = scratch.path().join("archive.out");
    {
        let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        let enc = req.encryption.as_ref();
        match req.format {
            Format::Zip => encode_zip(locals.into_iter(), req.compression, enc, &mut out),
            Format::SevenZip => encode_7z(locals.into_iter(), req.compression, enc, &mut out),
        }
        .map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
    }

    // 3. Split (7z only) or keep single; PUT each volume to R2.
    let parts: Vec<std::path::PathBuf> = match &req.split {
        Some(split) => split::split_file_into_volumes(&out_path, split.max_part_bytes)
            .map_err(|e| e.to_string())?,
        None => vec![out_path.clone()],
    };
    let mut volumes = Vec::with_capacity(parts.len());
    for (i, part) in parts.iter().enumerate() {
        // A single (unsplit) artifact keeps the bare prefix; split volumes get the 7z `.NNN` suffix.
        let key = if req.split.is_some() {
            format!("{}.{:03}", req.output_key_prefix, i + 1)
        } else {
            req.output_key_prefix.clone()
        };
        let len = std::fs::metadata(part).map_err(|e| e.to_string())?.len();
        let file = tokio::fs::File::open(part)
            .await
            .map_err(|e| e.to_string())?;
        r2::put_file(&state.http, &state.r2_base_url, &key, file, len)
            .await
            .map_err(|e| e.to_string())?;
        volumes.push(Volume {
            key,
            size_bytes: len,
        });
    }
    Ok(volumes)
}
