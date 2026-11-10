use std::fmt;

/// Why a transcode did not produce a rendition. The HTTP layer maps each kind to a status code, and
/// the message is safe to log: it names formats, codecs and limits, never the media's content.
#[derive(Debug)]
pub enum TranscodeError {
    /// The container, codec or request is outside what this engine converts. Not a fault in the file:
    /// the file stays download-only until a decoder for it exists.
    Unsupported(String),
    /// The file claims a supported format but its structure or bitstream is broken.
    Malformed(String),
    /// The file is over one of the engine's resource ceilings (dimensions, duration, sample count).
    TooLarge(String),
    /// The engine itself failed while writing the rendition.
    Internal(String),
}

impl TranscodeError {
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::Unsupported(message.into())
    }

    pub fn malformed(message: impl Into<String>) -> Self {
        Self::Malformed(message.into())
    }

    pub fn too_large(message: impl Into<String>) -> Self {
        Self::TooLarge(message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }
}

impl fmt::Display for TranscodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported(message) => write!(formatter, "unsupported: {message}"),
            Self::Malformed(message) => write!(formatter, "malformed: {message}"),
            Self::TooLarge(message) => write!(formatter, "too large: {message}"),
            Self::Internal(message) => write!(formatter, "internal: {message}"),
        }
    }
}

impl std::error::Error for TranscodeError {}

impl From<std::io::Error> for TranscodeError {
    fn from(error: std::io::Error) -> Self {
        // An unexpected end of file while reading a sample the index promised is a truncated file,
        // not an engine fault.
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            Self::Malformed("the file ends before a sample its index points at".into())
        } else {
            Self::Internal(format!("input/output: {error}"))
        }
    }
}

pub type Result<T> = std::result::Result<T, TranscodeError>;
