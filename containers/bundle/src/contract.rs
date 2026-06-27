// The Rust⇄TS wire contract for the bundle container. The Worker POSTs a `BuildRequest` (a manifest —
// never bytes, only R2 keys plus optional inline bytes for a generated CONTENTS file) and receives a
// `BuildResponse` listing the R2 keys written. The encryption password lives in-memory only and is never
// logged or persisted. This must stay byte-compatible with the worker adapter's `BundleManifestEntry`
// (packages/file-manager/src/bundle-manifest.ts) — a change here is a change there.

/// The manifest the Worker POSTs to /build.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub job_id: String,
    pub format: Format,                 // "zip" | "sevenZip"
    pub compression: Compression,       // "store" | "normal" | "maximum"
    pub encryption: Option<Encryption>, // None = no encryption
    pub split: Option<Split>,           // None = single artifact; only valid for sevenZip
    pub entries: Vec<Entry>,            // already layout-resolved: archive_path is final
    pub output_key_prefix: String,      // volumes are written under this R2 key prefix
}

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    Zip,
    SevenZip,
}

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Compression {
    Store,
    Normal,
    Maximum,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Encryption {
    pub password: String,
    pub encrypt_file_names: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    pub max_part_bytes: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub archive_path: String, // the path inside the archive (already sanitized/wrapped/flattened)
    pub mtime_epoch_secs: Option<i64>, // original modified time; None → builder uses a fixed epoch
    #[serde(flatten)]
    pub source: EntrySource,
}

// GOLDEN wire shape (must stay byte-identical to the worker's `BundleManifestEntry` — the discriminator
// is FLATTENED onto the entry):
//   { "archivePath": "Pleadings/a.pdf", "mtimeEpochSecs": 1700000000, "source": "r2", "r2Key": "files/f1/v1" }
//   { "archivePath": "CONTENTS.txt",    "mtimeEpochSecs": null,       "source": "inline", "bytesBase64": "..." }
// NOT a nested `"source": { "source": "r2", ... }` object. `#[serde(flatten)]` over the internally-tagged
// enum produces exactly the flat form above.
// `rename_all` renames the variant tags (r2 / inline); `rename_all_fields` renames the fields inside the
// variants (r2_key → r2Key, bytes_base64 → bytesBase64) so both halves match the camelCase wire shape.
#[derive(serde::Deserialize)]
#[serde(
    tag = "source",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EntrySource {
    R2 { r2_key: String },           // fetched via GET {R2_BASE_URL}/{r2_key}
    Inline { bytes_base64: String }, // small generated content (e.g. the CONTENTS manifest)
}

/// The /build response. `volumes` are the R2 keys written, in order.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResponse {
    pub ok: bool,
    pub volumes: Vec<Volume>,
    pub error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub key: String,
    pub size_bytes: u64,
}
