//! Cheap, growable magic-byte file-type identification shared across engines.
//! Owns ONLY the leading-bytes layer; an engine that needs a richer check
//! composes on top.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Pdf,
    Zip,
    Ole2,
}

const OLE2_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// Identify a file by its leading magic bytes. Returns `None` when the leading
/// bytes match no known container/document magic (the engine then decides what,
/// if anything, to attempt). This is intentionally the cheap layer only.
pub fn detect(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"%PDF") {
        return Some(Format::Pdf);
    }
    if bytes.starts_with(&OLE2_MAGIC) {
        return Some(Format::Ole2);
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(Format::Zip);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_pdf_by_magic() {
        assert_eq!(detect(b"%PDF-1.7\nrest"), Some(Format::Pdf));
    }

    #[test]
    fn detects_zip_by_local_header_magic() {
        assert_eq!(detect(b"PK\x03\x04rest"), Some(Format::Zip));
    }

    #[test]
    fn detects_ole2_compound_file_by_magic() {
        let ole2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x00];
        assert_eq!(detect(&ole2), Some(Format::Ole2));
    }

    #[test]
    fn returns_none_for_unknown_bytes() {
        assert_eq!(detect(b"not a known file"), None);
    }

    #[test]
    fn returns_none_for_too_short_input() {
        assert_eq!(detect(b"PK"), None);
    }
}
