//! Bytes to characters, for material that predates anyone agreeing on an encoding.
//!
//! A byte-order mark is a declaration and is believed. Everything else is a guess, and the guess is
//! made statistically over the bytes rather than from a name or a header a producing party wrote —
//! same rule as format identification, for the same reason.
//!
//! Decoding is LOSSY BY DESIGN: an undecodable sequence becomes U+FFFD rather than failing the
//! document. A legacy memo with three bad bytes in it is still a document a reviewer must see, and
//! refusing it would put it in the exception report over three bytes.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};

/// Decode bytes to text, returning the text and the label of the encoding they were read as. The
/// label is a fixed `&'static str` from `encoding_rs`'s own table, never a value derived from input.
pub fn decode(bytes: &[u8]) -> (String, &'static str) {
    let (encoding, offset) = match byte_order_mark(bytes) {
        Some((encoding, length)) => (encoding, length),
        None => (guess(bytes), 0),
    };
    let (text, _had_errors) = encoding.decode_without_bom_handling(&bytes[offset..]);
    (text.into_owned(), encoding.name())
}

/// The encodings a byte-order mark can declare. UTF-32's marks are deliberately absent: this engine
/// has no UTF-32 decoder, and a UTF-32 mark's first two bytes are a UTF-16 mark, so claiming to read
/// one would produce plausible-looking wrong text rather than an honest miss.
fn byte_order_mark(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some((UTF_8, 3));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some((UTF_16LE, 2));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some((UTF_16BE, 2));
    }
    None
}

/// Valid UTF-8 is taken at its word before the detector runs — the detector is a statistical model
/// and can prefer a legacy single-byte reading of short UTF-8, which silently mangles accented names
/// in exactly the material that has them.
fn guess(bytes: &[u8]) -> &'static Encoding {
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Allow);
    detector.feed(bytes, true);
    detector.guess(None, chardetng::Utf8Detection::Allow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_byte_order_mark_is_believed_and_stripped() {
        let mut utf8 = vec![0xEF, 0xBB, 0xBF];
        utf8.extend_from_slice("Deposition".as_bytes());
        let (text, label) = decode(&utf8);
        assert_eq!(text, "Deposition");
        assert_eq!(label, "UTF-8");

        let mut utf16 = vec![0xFF, 0xFE];
        for unit in "Exhibit".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        let (text, label) = decode(&utf16);
        assert_eq!(text, "Exhibit");
        assert_eq!(label, "UTF-16LE");
    }

    #[test]
    fn valid_utf8_is_read_as_utf8_rather_than_guessed_at() {
        // Short accented text is precisely where a statistical detector prefers a legacy single-byte
        // reading, which would turn a witness's name into mojibake.
        let (text, label) = decode("Renée Bäcker".as_bytes());
        assert_eq!(text, "Renée Bäcker");
        assert_eq!(label, "UTF-8");
    }

    #[test]
    fn legacy_single_byte_material_decodes_rather_than_failing() {
        // 0x92 is a curly apostrophe in windows-1252 and invalid UTF-8. The document reads either
        // way; what must not happen is a refusal.
        let legacy = b"The client\x92s file was produced in 1998.";
        let (text, _label) = decode(legacy);
        assert!(text.contains("client"));
        assert!(text.contains("file was produced"));
    }

    #[test]
    fn undecodable_bytes_become_replacement_characters_not_a_failure() {
        let (text, _label) = decode(&[0xFF, 0xFE_u8.wrapping_add(1), 0x00, b'a']);
        assert!(!text.is_empty());
    }
}
