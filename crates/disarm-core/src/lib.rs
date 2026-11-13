//! disarm-core: content disarm and reconstruction. Takes a document somebody else chose, and writes a
//! copy of it with everything that can act removed: scripts, macros, automatic actions, embedded
//! programs, links that reach out on open. What a person reads in the copy is what they would have
//! read in the original. The original is never touched; the caller keeps it, byte for byte, as the
//! evidence it is.
//!
//! Each format has its own module, and each module neutralizes rather than guesses: a surface this
//! crate does not understand is refused, never passed through. After writing, every format runs a
//! second pass over its own output that fails the whole call if anything it promised to remove is
//! still there.

pub mod limits;
mod ooxml;
mod pdf;
mod raster;
mod report;
mod rtf;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use limits::Limits;
pub use report::{DisarmReport, Removal, RemovalKind};

/// The kinds of document this crate disarms, decided from the leading bytes and the package's own
/// declared content type, never from a file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentKind {
    Pdf,
    /// A Word, Excel or PowerPoint package (with or without macros), or any other Open Packaging
    /// Conventions package Office reads.
    OfficePackage,
    Rtf,
    Jpeg,
    Png,
    Gif,
    Tiff,
    Bmp,
    Webp,
}

impl DocumentKind {
    /// The stable lower-case name crossing the WebAssembly edge and the container's response.
    pub fn code(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::OfficePackage => "officePackage",
            Self::Rtf => "rtf",
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Gif => "gif",
            Self::Tiff => "tiff",
            Self::Bmp => "bmp",
            Self::Webp => "webp",
        }
    }
}

/// What came out: the disarmed bytes, what was taken out of them, and the extension the copy should
/// carry. A macro-enabled `.docm` comes out as a `.docx`, because a file that can no longer hold
/// macros should not be named as one that can.
#[derive(Debug, Clone)]
pub struct Disarmed {
    pub bytes: Vec<u8>,
    pub kind: DocumentKind,
    pub report: DisarmReport,
    /// Lower case, without the dot. `None` when the copy keeps whatever extension the original had.
    pub output_extension: Option<&'static str>,
}

/// Why no copy was written. A variant never carries document content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisarmError {
    /// Not a format this crate disarms. Legacy binary Office files (`.doc`, `.xls`, `.ppt`) land here
    /// deliberately: they are converted to their package form first, and the package is disarmed.
    Unsupported,
    /// Locked with a password. Nothing inside can be read, so nothing inside can be judged.
    Encrypted,
    /// Over a size, count or expansion limit. The input may be a decompression bomb.
    LimitExceeded,
    /// The bytes do not parse as the format they claim to be.
    Malformed,
    /// The copy could not be written.
    Write,
    /// The copy was written, and the check over it found something that should have been removed. No
    /// bytes are returned: a copy that is only mostly disarmed is not offered.
    VerificationFailed,
}

impl DisarmError {
    /// The stable code crossing the WebAssembly edge and the container's response.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::Encrypted => "encrypted",
            Self::LimitExceeded => "limitExceeded",
            Self::Malformed => "malformed",
            Self::Write => "write",
            Self::VerificationFailed => "verificationFailed",
        }
    }
}

impl std::fmt::Display for DisarmError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for DisarmError {}

impl engine_host::wasm_edge::EdgeError for DisarmError {
    fn code(&self) -> &'static str {
        DisarmError::code(self)
    }
}

/// Identify what the bytes are, from their own content. `None` when this crate does not disarm them.
pub fn identify(bytes: &[u8]) -> Option<DocumentKind> {
    match engine_host::format::detect(bytes) {
        Some(engine_host::format::Format::Pdf) => return Some(DocumentKind::Pdf),
        Some(engine_host::format::Format::Zip) => {
            return ooxml::is_office_package(bytes).then_some(DocumentKind::OfficePackage)
        }
        Some(engine_host::format::Format::Ole2) => return None,
        None => {}
    }
    raster::identify(bytes).or_else(|| rtf::is_rtf(bytes).then_some(DocumentKind::Rtf))
}

/// Disarm with the default limits.
pub fn disarm(bytes: &[u8]) -> Result<Disarmed, DisarmError> {
    disarm_with(bytes, &Limits::default())
}

/// Disarm under the caller's limits.
pub fn disarm_with(bytes: &[u8], limits: &Limits) -> Result<Disarmed, DisarmError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(DisarmError::LimitExceeded);
    }
    let kind = identify(bytes).ok_or(DisarmError::Unsupported)?;
    match kind {
        DocumentKind::Pdf => pdf::disarm(bytes),
        DocumentKind::OfficePackage => ooxml::disarm(bytes, limits, 0),
        DocumentKind::Rtf => rtf::disarm(bytes, limits),
        DocumentKind::Jpeg
        | DocumentKind::Png
        | DocumentKind::Gif
        | DocumentKind::Tiff
        | DocumentKind::Bmp
        | DocumentKind::Webp => raster::disarm(bytes, kind, limits),
    }
}
