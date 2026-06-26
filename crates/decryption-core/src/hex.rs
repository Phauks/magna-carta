/// Decode a lowercase/uppercase hex string into bytes.
///
/// Returns `None` on any malformed input — odd length, non-hex digit, or non-ASCII
/// byte — rather than panicking. Operating on `text.as_bytes()` instead of byte-offset
/// `&str` slices avoids char-boundary panics when the input contains multi-byte UTF-8
/// characters (e.g. `"€€"` has even byte length 6 but `text[0..2]` panics).
pub(crate) fn decode(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let nibble = |byte: u8| -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            // Rejects '+'/'-' (accepted by `u8::from_str_radix`), all non-ASCII bytes
            // (which include every byte of a multi-byte UTF-8 sequence), and all other
            // non-hex ASCII characters.
            _ => None,
        }
    };
    let mut output = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks(2) {
        let high = nibble(chunk[0])?;
        let low = nibble(chunk[1])?;
        output.push((high << 4) | low);
    }
    Some(output)
}

/// Encode bytes as a lowercase hex string.
pub(crate) fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_round_trips_valid_hex() {
        assert_eq!(decode(""), Some(vec![]));
        assert_eq!(decode("00"), Some(vec![0x00]));
        assert_eq!(decode("ff"), Some(vec![0xff]));
        assert_eq!(decode("FF"), Some(vec![0xff]));
        assert_eq!(decode("deadbeef"), Some(vec![0xde, 0xad, 0xbe, 0xef]));
        assert_eq!(decode("DEADBEEF"), Some(vec![0xde, 0xad, 0xbe, 0xef]));
        // Encode then decode round-trip.
        let original = vec![0x01u8, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        assert_eq!(decode(&encode(&original)), Some(original));
    }

    #[test]
    fn decode_rejects_odd_length() {
        assert_eq!(decode("a"), None);
        assert_eq!(decode("abc"), None);
        assert_eq!(decode("f"), None);
    }

    #[test]
    fn decode_rejects_non_hex_digits() {
        assert_eq!(decode("gg"), None);
        assert_eq!(decode("0x"), None);
        assert_eq!(decode("zz"), None);
        // from_str_radix accepted a leading '+'; decode must not.
        assert_eq!(decode("+1"), None);
        assert_eq!(decode("-1"), None);
    }

    #[test]
    fn decode_rejects_non_ascii_without_panicking() {
        // "€" is U+20AC, encoded as three bytes 0xE2 0x82 0xAC.
        // "€€" is six bytes (even byte count) — the old &str byte-offset slice
        // panicked here because text[0..2] split a char boundary; decode must
        // return None cleanly.
        assert_eq!(decode("€€"), None);
        // Single "€" (3 bytes, odd) must also return None.
        assert_eq!(decode("€"), None);
        // Multi-char sequence whose total byte count is even.
        assert_eq!(decode("€€€"), None);
    }
}
