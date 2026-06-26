use crate::Format;

const OLE2_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

pub fn detect(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"%PDF") {
        return Some(Format::Pdf);
    }
    if bytes.starts_with(&OLE2_MAGIC) {
        // Encrypted OOXML wraps the zip inside an OLE2/CFB compound file.
        return Some(Format::Ooxml);
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(Format::Zip);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Format;
    #[test]
    fn detects_by_magic() {
        assert_eq!(detect(b"%PDF-1.7\n..."), Some(Format::Pdf));
        assert_eq!(
            detect(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]),
            Some(Format::Ooxml)
        );
        assert_eq!(detect(b"PK\x03\x04rest"), Some(Format::Zip));
        assert_eq!(detect(b"not a known file"), None);
    }
}
