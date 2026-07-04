//! The carving signature table: header/footer magic + extraction bounds per file
//! type. A standalone, dependency-free data module — kept separable so it can be
//! lifted into a shared home once a second consumer (e.g. discovery extraction)
//! needs it. `header` anchors a candidate; `footer` (when present) delimits its
//! end; `max_len` bounds a candidate whose footer is missing or far away.
//!
//! Every type here is one the carver can *validate* by actually parsing/decoding
//! a carved run (see `validate_run`), so a recovered fragment is a real file, not
//! a coincidental header+footer. A type with no reliable, validatable footer is
//! deliberately omitted — e.g. GIF, whose 1-byte `0x3B` trailer occurs constantly
//! inside pixel data and cannot delimit a file; adding it needs a real GIF decoder
//! or block-structure parser (a deferred enhancement).

/// One carvable file type: how to recognize its start and end, and its bounds.
pub struct Signature {
    pub media_type: &'static str,
    pub extension: &'static str,
    /// The leading magic bytes that anchor a candidate.
    pub header: &'static [u8],
    /// The trailing bytes that delimit the end (inclusive), if the type has a
    /// reliable terminator. `None` means bound by `max_len`.
    pub footer: Option<&'static [u8]>,
    /// Maximum bytes to extract for one candidate (bounds a missing footer).
    pub max_len: usize,
}

/// The v1 carvable types. Each has a recognizable header, a terminator, and a
/// validator that parses/decodes a carved run to confirm it is a real file.
pub const SIGNATURES: &[Signature] = &[
    Signature {
        media_type: "image/jpeg",
        extension: "jpg",
        header: &[0xFF, 0xD8, 0xFF],
        footer: Some(&[0xFF, 0xD9]),
        max_len: 64 * 1024 * 1024,
    },
    Signature {
        media_type: "image/png",
        extension: "png",
        header: &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
        // PNG ends with the IEND chunk: length(0) + "IEND" + CRC.
        footer: Some(&[0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]),
        max_len: 64 * 1024 * 1024,
    },
    Signature {
        media_type: "application/pdf",
        extension: "pdf",
        header: b"%PDF-",
        footer: Some(b"%%EOF"),
        max_len: 256 * 1024 * 1024,
    },
    Signature {
        media_type: "application/zip",
        extension: "zip",
        header: &[b'P', b'K', 0x03, 0x04],
        // ZIP's end-of-central-directory record signature.
        footer: Some(&[b'P', b'K', 0x05, 0x06]),
        max_len: 256 * 1024 * 1024,
    },
];
