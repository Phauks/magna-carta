//! The carving signature table: header/footer magic + extraction bounds per file
//! type. A standalone, dependency-free data module — kept separable so it can be
//! lifted into a shared home once a second consumer (e.g. discovery extraction)
//! needs it. `header` anchors a candidate; `footer` (when present) delimits its
//! end; `max_len` bounds a candidate whose footer is missing or far away.

/// One carvable file type: how to recognize its start and end, and its bounds.
pub struct Signature {
    pub media_type: &'static str,
    pub extension: &'static str,
    /// The leading magic bytes that anchor a candidate.
    pub header: &'static [u8],
    /// The trailing bytes that delimit the end (inclusive), if the type has a
    /// reliable terminator. `None` means bound by `max_len` / the next candidate.
    pub footer: Option<&'static [u8]>,
    /// Maximum bytes to extract for one candidate (bounds a missing footer).
    pub max_len: usize,
    /// Whether a decode-based validation applies (images).
    pub image: bool,
}

/// The v1 carvable types. Each has a recognizable header; JPEG/PNG/GIF/PDF/ZIP
/// also have a terminator so the extent is well-defined.
pub const SIGNATURES: &[Signature] = &[
    Signature {
        media_type: "image/jpeg",
        extension: "jpg",
        header: &[0xFF, 0xD8, 0xFF],
        footer: Some(&[0xFF, 0xD9]),
        max_len: 64 * 1024 * 1024,
        image: true,
    },
    Signature {
        media_type: "image/png",
        extension: "png",
        header: &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
        // PNG ends with the IEND chunk: length(0) + "IEND" + CRC.
        footer: Some(&[0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]),
        max_len: 64 * 1024 * 1024,
        image: true,
    },
    Signature {
        media_type: "image/gif",
        extension: "gif",
        header: b"GIF8",
        footer: Some(&[0x3B]),
        max_len: 32 * 1024 * 1024,
        image: false,
    },
    Signature {
        media_type: "application/pdf",
        extension: "pdf",
        header: b"%PDF-",
        footer: Some(b"%%EOF"),
        max_len: 256 * 1024 * 1024,
        image: false,
    },
    Signature {
        media_type: "application/zip",
        extension: "zip",
        header: &[b'P', b'K', 0x03, 0x04],
        // ZIP's end-of-central-directory record signature.
        footer: Some(&[b'P', b'K', 0x05, 0x06]),
        max_len: 256 * 1024 * 1024,
        image: false,
    },
];
