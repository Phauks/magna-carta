//! The PDF cross-reference rebuild pillar: scan the raw bytes for the indirect
//! objects still physically present, synthesize a fresh classic xref + trailer,
//! reload through lopdf, and re-emit a clean PDF — recording every object that
//! could not be re-parsed as lost. Diagnose PDF xref corruption.

/// One indirect-object header (`N G obj`) found by the raw scan, with the byte
/// offset of its first digit (the offset a cross-reference entry must point at).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScannedObject {
    pub number: u32,
    pub generation: u16,
    pub offset: usize,
}

/// Forward-scan `bytes` for every `N G obj` indirect-object header. A header is a
/// run of digits (the object number), PDF whitespace, a run of digits (the
/// generation), PDF whitespace, then the literal `obj`. Anything that does not
/// match is skipped (e.g. the `obj` inside `endobj`, or digits inside content).
/// Stops after `max_count` headers to bound work on pathological input.
pub fn scan_objects(bytes: &[u8], max_count: usize) -> Vec<ScannedObject> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        // A header only starts where a digit follows a delimiter/whitespace or the
        // file start — this avoids re-matching inside a longer digit run.
        let at_boundary =
            i == 0 || is_pdf_whitespace(bytes[i - 1]) || is_pdf_delimiter(bytes[i - 1]);
        if at_boundary && bytes[i].is_ascii_digit() {
            if let Some(parsed) = parse_header_at(bytes, i) {
                out.push(parsed);
                if out.len() >= max_count {
                    break;
                }
                // Continue scanning after the "obj" keyword.
                i = parsed.offset;
                // Advance past the digits we consumed; a simple +1 is enough since
                // the next boundary check re-anchors, but jump past the number to
                // avoid O(n^2) on huge digit runs.
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Try to parse `N G obj` starting at `start` (which must index a digit). Returns
/// the parsed header (with `offset == start`) or None if the shape does not hold.
fn parse_header_at(bytes: &[u8], start: usize) -> Option<ScannedObject> {
    let mut i = start;
    let (number, next) = parse_uint::<u32>(bytes, i)?;
    i = next;
    i = skip_whitespace(bytes, i)?;
    let (generation, next) = parse_uint::<u16>(bytes, i)?;
    i = next;
    i = skip_whitespace(bytes, i)?;
    if bytes.get(i..i + 3) != Some(b"obj") {
        return None;
    }
    // "obj" must end at a delimiter, whitespace, or EOF to be the keyword.
    match bytes.get(i + 3) {
        None => {}
        Some(&b) if is_pdf_whitespace(b) || is_pdf_delimiter(b) => {}
        Some(_) => return None,
    }
    Some(ScannedObject {
        number,
        generation,
        offset: start,
    })
}

/// Parse an unsigned integer, returning (value, index-after-digits). Fails on no
/// digits or on overflow of the target type.
fn parse_uint<T: TryFrom<u64>>(bytes: &[u8], start: usize) -> Option<(T, usize)> {
    let mut i = start;
    let mut value: u64 = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        value = value
            .checked_mul(10)?
            .checked_add((bytes[i] - b'0') as u64)?;
        i += 1;
    }
    if i == start {
        return None;
    }
    T::try_from(value).ok().map(|v| (v, i))
}

/// Advance over at least one PDF whitespace byte; None if there is not one.
fn skip_whitespace(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i < bytes.len() && is_pdf_whitespace(bytes[i]) {
        i += 1;
    }
    if i == start {
        None
    } else {
        Some(i)
    }
}

/// PDF whitespace: null, tab, line feed, form feed, carriage return, space.
fn is_pdf_whitespace(b: u8) -> bool {
    matches!(b, 0x00 | 0x09 | 0x0A | 0x0C | 0x0D | 0x20)
}

/// PDF delimiter characters.
fn is_pdf_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    fn finds_each_indirect_object_header() {
        let bytes = b"%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n12 3 obj\n(hi)\nendobj\n";
        let found = scan_objects(bytes, 1000);
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].number, found[0].generation), (1, 0));
        assert_eq!((found[1].number, found[1].generation), (12, 3));
        // The recorded offset points at the header's first digit.
        assert_eq!(&bytes[found[0].offset..found[0].offset + 5], b"1 0 o");
    }

    #[test]
    fn ignores_the_word_obj_that_is_not_a_header() {
        // "endobj" contains "obj" but is not preceded by "<uint> <uint> ".
        let bytes = b"1 0 obj\n<< >>\nendobj\n";
        let found = scan_objects(bytes, 1000);
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn respects_the_count_cap() {
        let bytes = b"1 0 obj\nendobj\n2 0 obj\nendobj\n3 0 obj\nendobj\n";
        assert_eq!(scan_objects(bytes, 2).len(), 2);
    }
}
