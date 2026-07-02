//! The PDF cross-reference rebuild pillar: scan the raw bytes for the indirect
//! objects still physically present, synthesize a fresh classic xref + trailer,
//! reload through lopdf, and re-emit a clean PDF — recording every object that
//! could not be re-parsed as lost. Diagnose PDF xref corruption.

use std::collections::BTreeMap;

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

/// Locate the document catalog by scanning each object's body for a `/Type`
/// dictionary entry naming `/Catalog`. Best-effort — the object's byte span runs
/// from its header offset to the next object's offset (or end of file). The
/// trailer's `/Root` reference ultimately validates the choice when the file
/// reloads; a false positive simply fails that reload and is caught upstream.
pub fn find_root(bytes: &[u8], scanned: &[ScannedObject]) -> Option<(u32, u16)> {
    for (index, object) in scanned.iter().enumerate() {
        let end = scanned
            .get(index + 1)
            .map(|next| next.offset)
            .unwrap_or(bytes.len());
        let body = &bytes[object.offset..end];
        if contains(body, b"/Type") && contains(body, b"/Catalog") {
            return Some((object.number, object.generation));
        }
    }
    None
}

/// True if `haystack` contains `needle` (small, non-allocating substring search).
fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return needle.is_empty();
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Append a fresh classic cross-reference table + trailer + `startxref` to a copy
/// of `bytes`, indexing every scanned object at its original offset. The original
/// object bytes are untouched (so their offsets stay valid); lopdf reads the last
/// `startxref` (this one) and loads through it. Object 0 is the mandatory free
/// head; object number 0 is never a real object and is ignored if scanned. When an
/// object number appears more than once, the physically-latest offset wins.
pub fn rebuild_with_xref(bytes: &[u8], scanned: &[ScannedObject], root: (u32, u16)) -> Vec<u8> {
    // number -> (generation, offset); insertion order is file order, so a later
    // duplicate overwrites an earlier one (latest revision wins).
    let mut by_number: BTreeMap<u32, (u16, usize)> = BTreeMap::new();
    for object in scanned {
        if object.number == 0 {
            continue;
        }
        by_number.insert(object.number, (object.generation, object.offset));
    }

    let size = by_number.keys().copied().max().map(|n| n + 1).unwrap_or(1);

    let mut out = bytes.to_vec();
    // The xref keyword must begin its own line.
    if !out.is_empty() && *out.last().unwrap() != b'\n' {
        out.push(b'\n');
    }
    let xref_offset = out.len();

    out.extend_from_slice(b"xref\n");
    // Free-list head: object 0.
    out.extend_from_slice(b"0 1\n");
    out.extend_from_slice(b"0000000000 65535 f \n");

    // Group present object numbers into contiguous runs (xref subsections). Each
    // in-use entry is exactly 20 bytes: 10-digit offset, gen, type, 2-byte EOL.
    let numbers: Vec<u32> = by_number.keys().copied().collect();
    let mut i = 0;
    while i < numbers.len() {
        let mut j = i;
        while j + 1 < numbers.len() && numbers[j + 1] == numbers[j] + 1 {
            j += 1;
        }
        let start = numbers[i];
        let count = (j - i + 1) as u32;
        out.extend_from_slice(format!("{start} {count}\n").as_bytes());
        for number in &numbers[i..=j] {
            let (generation, offset) = by_number[number];
            out.extend_from_slice(format!("{offset:010} {generation:05} n \n").as_bytes());
        }
        i = j + 1;
    }

    out.extend_from_slice(b"trailer\n");
    out.extend_from_slice(format!("<< /Size {size} /Root {} {} R >>\n", root.0, root.1).as_bytes());
    out.extend_from_slice(b"startxref\n");
    out.extend_from_slice(format!("{xref_offset}\n").as_bytes());
    out.extend_from_slice(b"%%EOF\n");
    out
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

#[cfg(test)]
mod root_tests {
    use super::*;

    #[test]
    fn locates_the_catalog_object() {
        let bytes = b"1 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\n2 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), Some((2, 0)));
    }

    #[test]
    fn returns_none_when_no_catalog_is_present() {
        let bytes = b"1 0 obj\n<< /Type /Pages >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), None);
    }
}

#[cfg(test)]
mod xref_tests {
    use super::*;
    use lopdf::Document;

    #[test]
    fn appended_xref_makes_a_headerless_body_loadable() {
        // A PDF body with objects but NO xref/trailer (as if truncated before them).
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let scanned = scan_objects(body, 1000);
        let root = find_root(body, &scanned).expect("catalog present");
        let patched = rebuild_with_xref(body, &scanned, root);
        let doc = Document::load_mem(&patched).expect("loads via the synthesized xref");
        // All three objects are present and the catalog is the trailer Root.
        assert!(doc.objects.contains_key(&(1, 0)));
        assert!(doc.objects.contains_key(&(2, 0)));
        assert!(doc.objects.contains_key(&(3, 0)));
    }
}
