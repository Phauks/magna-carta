//! A raw content-stream tokenizer: locate each operator invocation and its byte span
//! without decoding operand values. It exists so surgery can rewrite a stream by
//! splicing only the operators it edits and copying every other byte verbatim —
//! inline images and exotic constructs never pass through a re-encode. Token order and
//! count match `lopdf::content::Content::decode` so the two can be zipped by index.
//!
//! The stream rewriter that consumes these tokens is built next in this feature; until
//! that lands the whole module is reachable only from its own tests, so the unused
//! warnings it would otherwise raise are silenced here rather than item by item.
#![allow(dead_code)]

/// One operator invocation located in a raw content stream.
#[derive(Debug, Clone)]
pub(crate) struct RawToken {
    /// Operator keyword bytes (e.g. `b"Tj"`, `b"TJ"`, `b"BT"`, `b"BI"`).
    pub operator: Vec<u8>,
    /// Byte offset of the invocation's first operand, or the operator keyword itself
    /// when it takes no operands. For `BI`, the offset of `BI`.
    pub start: usize,
    /// One past the operator keyword's last byte. For `BI`, one past the `EI` terminator.
    pub end: usize,
}

fn is_whitespace(b: u8) -> bool {
    matches!(b, b'\0' | b'\t' | b'\n' | b'\x0C' | b'\r' | b' ')
}

fn is_delimiter(b: u8) -> bool {
    matches!(b, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

fn is_regular(b: u8) -> bool {
    !is_whitespace(b) && !is_delimiter(b)
}

/// Advance past a literal string starting at `i` (which points at `(`). Returns the
/// index just past the closing `)`, or `None` if unterminated. Handles backslash
/// escapes and balanced interior parens.
fn skip_literal_string(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 0i32;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2, // skip the escaped byte
            b'(' => { depth += 1; i += 1; }
            b')' => { depth -= 1; i += 1; if depth == 0 { return Some(i); } }
            _ => i += 1,
        }
    }
    None
}

/// Advance past a hex string starting at `i` (which points at `<`, not `<<`). Returns
/// the index just past `>`, or `None` if unterminated.
fn skip_hex_string(bytes: &[u8], mut i: usize) -> Option<usize> {
    i += 1; // past '<'
    while i < bytes.len() {
        if bytes[i] == b'>' { return Some(i + 1); }
        i += 1;
    }
    None
}

/// Advance past a `<< … >>` dictionary starting at `i` (which points at the first `<`).
/// Handles nesting and interior strings. Returns the index just past the closing `>>`.
fn skip_dict(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 0i32;
    while i < bytes.len() {
        if bytes[i] == b'<' && bytes.get(i + 1) == Some(&b'<') { depth += 1; i += 2; }
        else if bytes[i] == b'>' && bytes.get(i + 1) == Some(&b'>') {
            depth -= 1; i += 2; if depth == 0 { return Some(i); }
        }
        else if bytes[i] == b'<' { i = skip_hex_string(bytes, i)?; }
        else if bytes[i] == b'(' { i = skip_literal_string(bytes, i)?; }
        else if bytes[i] == b'%' {
            // A comment runs to the next EOL and cannot itself contain a delimiter that
            // closes the dict — mirror the top-level `tokenize` loop's handling so a
            // stray '>' inside a comment never ends the dict early.
            while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' { i += 1; }
        }
        else { i += 1; }
    }
    None
}

/// Advance past a `[ … ]` array starting at `i` (which points at `[`). Handles interior
/// strings, hex, and nested arrays/dicts. Returns the index just past the closing `]`.
fn skip_array(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 0i32;
    while i < bytes.len() {
        match bytes[i] {
            b'[' => { depth += 1; i += 1; }
            b']' => { depth -= 1; i += 1; if depth == 0 { return Some(i); } }
            b'(' => i = skip_literal_string(bytes, i)?,
            b'<' if bytes.get(i + 1) == Some(&b'<') => i = skip_dict(bytes, i)?,
            b'<' => i = skip_hex_string(bytes, i)?,
            b'%' => {
                // Same comment handling as `skip_dict`: run to EOL so a stray ']' inside
                // a comment can't close the array early — parity with lopdf.
                while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' { i += 1; }
            }
            _ => i += 1,
        }
    }
    None
}

/// Advance past a `/Name` starting at `i` (which points at `/`). Returns the index of
/// the first byte that is not part of the name.
fn skip_name(bytes: &[u8], mut i: usize) -> usize {
    i += 1; // past '/'
    while i < bytes.len() && is_regular(bytes[i]) { i += 1; }
    i
}

/// Read a bareword (number, `true`/`false`/`null`, or operator keyword) starting at `i`.
/// Returns `(word, end)`.
fn read_bareword(bytes: &[u8], start: usize) -> (&[u8], usize) {
    let mut i = start;
    while i < bytes.len() && is_regular(bytes[i]) { i += 1; }
    (&bytes[start..i], i)
}

fn is_number(word: &[u8]) -> bool {
    !word.is_empty()
        && word.iter().all(|&b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.'))
        && word.iter().any(|b| b.is_ascii_digit())
}

/// One value parsed while scanning an inline-image dict's `/Key value` pairs between
/// `BI` and `ID`. Tagged by its exact PDF object kind because lopdf's own accessors
/// (`as_i64`, `as_bool`, `as_name`) are strict — a `2.0` Real is not a `2` Integer, and a
/// kind mismatch fails the whole lookup rather than coercing.
#[derive(Debug, Clone, Copy)]
enum InlineImageValue<'a> {
    Boolean(bool),
    Integer(i64),
    Name(&'a [u8]),
    Other,
}

/// Advance past whitespace and `%…eol` comments starting at `i`, mirroring lopdf's
/// `space` combinator (used between the inline-image dict's keys, values, and `BI`/`ID`).
fn skip_dict_space(bytes: &[u8], mut i: usize) -> usize {
    loop {
        while i < bytes.len() && is_whitespace(bytes[i]) { i += 1; }
        if i < bytes.len() && bytes[i] == b'%' {
            while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' { i += 1; }
        } else {
            return i;
        }
    }
}

/// Parse one PDF direct-object value starting at `i`, mirroring lopdf's `_direct_objects`
/// alternation closely enough to classify the Boolean/Integer/Name kinds the inline-image
/// keys below ever resolve to; anything else (string, hex string, array, dict, `null`) is
/// skipped by byte span without needing its value.
fn parse_inline_image_value(bytes: &[u8], i: usize) -> Option<(InlineImageValue<'_>, usize)> {
    if i >= bytes.len() { return None; }
    match bytes[i] {
        b'(' => Some((InlineImageValue::Other, skip_literal_string(bytes, i)?)),
        b'<' if bytes.get(i + 1) == Some(&b'<') => Some((InlineImageValue::Other, skip_dict(bytes, i)?)),
        b'<' => Some((InlineImageValue::Other, skip_hex_string(bytes, i)?)),
        b'[' => Some((InlineImageValue::Other, skip_array(bytes, i)?)),
        b'/' => {
            let end = skip_name(bytes, i);
            Some((InlineImageValue::Name(&bytes[i + 1..end]), end))
        }
        _ => {
            let (word, end) = read_bareword(bytes, i);
            if end == i { return None; }
            match word {
                b"null" => Some((InlineImageValue::Other, end)),
                b"true" => Some((InlineImageValue::Boolean(true), end)),
                b"false" => Some((InlineImageValue::Boolean(false), end)),
                _ if is_number(word) && !word.contains(&b'.') => std::str::from_utf8(word)
                    .ok()?
                    .parse::<i64>()
                    .ok()
                    .map(|n| (InlineImageValue::Integer(n), end)),
                _ if is_number(word) => Some((InlineImageValue::Other, end)), // a Real
                _ => None,
            }
        }
    }
}

/// Metadata resolved from an inline-image dict, one slot per lopdf key pair. Each slot
/// prefers the abbreviated spelling over the full one exactly as lopdf's own `get_abbr`
/// does: if the abbreviation key is present at all, the full-name key is never even
/// consulted, regardless of the abbreviation value's kind.
struct InlineImageMetadata<'a> {
    width: Option<InlineImageValue<'a>>,
    height: Option<InlineImageValue<'a>>,
    bits_per_component: Option<InlineImageValue<'a>>,
    image_mask: Option<InlineImageValue<'a>>,
    colorspace: Option<InlineImageValue<'a>>,
    has_filter: bool,
}

/// Scan the `/Key value` pairs between `BI` and `ID`, returning the resolved metadata
/// plus the byte index of `ID`'s `I`. Returns `None` when the dict portion never resolves
/// to a literal `ID` — the caller falls back to the whitespace-bounded scan rather than
/// guess, matching lopdf's own hard failure on such input.
fn scan_inline_image_dict(bytes: &[u8], after_bi: usize) -> Option<(InlineImageMetadata<'_>, usize)> {
    #[derive(Default, Clone, Copy)]
    struct Slot<'a> {
        abbrev: Option<InlineImageValue<'a>>,
        full: Option<InlineImageValue<'a>>,
    }
    impl<'a> Slot<'a> {
        fn resolved(self) -> Option<InlineImageValue<'a>> { self.abbrev.or(self.full) }
    }

    let mut width = Slot::default();
    let mut height = Slot::default();
    let mut bpc = Slot::default();
    let mut image_mask = Slot::default();
    let mut colorspace = Slot::default();
    let mut has_filter = false;

    let mut i = skip_dict_space(bytes, after_bi);
    loop {
        if bytes[i..].starts_with(b"ID") {
            return Some((
                InlineImageMetadata {
                    width: width.resolved(),
                    height: height.resolved(),
                    bits_per_component: bpc.resolved(),
                    image_mask: image_mask.resolved(),
                    colorspace: colorspace.resolved(),
                    has_filter,
                },
                i,
            ));
        }
        if i >= bytes.len() || bytes[i] != b'/' { return None; }
        let key_end = skip_name(bytes, i);
        let key = &bytes[i + 1..key_end];
        let value_start = skip_dict_space(bytes, key_end);
        let (value, value_end) = parse_inline_image_value(bytes, value_start)?;
        match key {
            b"W" => width.abbrev = Some(value),
            b"Width" => width.full = Some(value),
            b"H" => height.abbrev = Some(value),
            b"Height" => height.full = Some(value),
            b"BPC" => bpc.abbrev = Some(value),
            b"BitsPerComponent" => bpc.full = Some(value),
            b"IM" => image_mask.abbrev = Some(value),
            b"ImageMask" => image_mask.full = Some(value),
            b"CS" => colorspace.abbrev = Some(value),
            b"ColorSpace" => colorspace.full = Some(value),
            b"F" | b"Filter" => has_filter = true,
            _ => {}
        }
        i = skip_dict_space(bytes, value_end);
    }
}

/// Number of color components for a recognized inline-image colorspace name — exactly
/// lopdf's own recognized set. An unrecognized name (including `Pattern`, which lopdf
/// explicitly rejects) must fall through to the whitespace-bounded scan rather than be
/// guessed at, or this tokenizer would introduce a divergence of its own.
fn inline_image_num_colors(colorspace: &[u8]) -> Option<usize> {
    match colorspace {
        b"DeviceGray" | b"Gray" => Some(1),
        b"DeviceRGB" | b"RGB" => Some(3),
        b"DeviceRGBA" | b"RGBA" => Some(4),
        b"DeviceCMYK" | b"CMYK" => Some(4),
        _ => None,
    }
}

/// Compute the exact end of an inline image's data plus its `EI` terminator from the
/// dict's resolved metadata, mirroring lopdf's `image_data_stream`: `stride = ceil(W *
/// numColors * BPC / 8)`, `length = H * stride`, and only when no `/Filter` key is
/// present (lopdf treats *any* Filter value as unimplemented there and falls back to its
/// own whitespace scan). `data_start` is the index just past `ID` and its separating
/// whitespace. Returns `None` when the metadata doesn't support this path — one of
/// lopdf's own `Err` branches — so the caller falls back to the whitespace scan too.
fn exact_inline_image_end(bytes: &[u8], data_start: usize, meta: &InlineImageMetadata) -> Option<usize> {
    if meta.has_filter { return None; }
    let width = match meta.width { Some(InlineImageValue::Integer(n)) => n as usize, _ => return None };
    let height = match meta.height { Some(InlineImageValue::Integer(n)) => n as usize, _ => return None };
    let bpc = match meta.bits_per_component { Some(InlineImageValue::Integer(n)) => n as usize, _ => return None };
    let num_colors = if matches!(meta.image_mask, Some(InlineImageValue::Boolean(true))) {
        1usize
    } else {
        match meta.colorspace {
            Some(InlineImageValue::Name(name)) => inline_image_num_colors(name)?,
            _ => return None,
        }
    };
    let bits = width.checked_mul(num_colors)?.checked_mul(bpc)?;
    let stride = bits.checked_add(7)?.checked_div(8)?;
    let length = height.checked_mul(stride)?;
    let data_end = data_start.checked_add(length)?;
    if data_end > bytes.len() { return None; }
    let mut i = data_end;
    // lopdf's `content_space` immediately before `EI` recognizes only " \t\r\n" — no
    // comments, no NUL/FF — narrower than this module's general `is_whitespace`.
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\r' | b'\n') { i += 1; }
    if bytes[i..].starts_with(b"EI") { Some(i + 2) } else { None }
}

/// The whitespace-bounded `EI` scan: the `EI` must be whitespace-bounded on the left and
/// followed by whitespace or end-of-stream. This is lopdf's own fallback whenever it
/// cannot resolve an exact byte length for the inline-image data (metadata missing,
/// colorspace unrecognized, or a `/Filter` present).
fn whitespace_scan_inline_image_end(bytes: &[u8], after_bi: usize) -> Option<usize> {
    let mut i = after_bi;
    while i + 1 < bytes.len() {
        let at_boundary = i == 0 || is_whitespace(bytes[i - 1]);
        let is_ei = bytes[i] == b'E' && bytes[i + 1] == b'I';
        let followed_ok = i + 2 >= bytes.len() || is_whitespace(bytes[i + 2]);
        if at_boundary && is_ei && followed_ok {
            return Some(i + 2);
        }
        i += 1;
    }
    None
}

/// After `BI` (starting scan at `after_bi`), advance past the inline image to just after
/// its `EI` terminator. Mirrors lopdf's `image_data_stream`: when the dict between `BI`
/// and `ID` resolves W/H/BPC and a recognized colorspace (or `/ImageMask true`) with no
/// `/Filter`, the data span is computed as an exact byte length so an embedded `EI`-like
/// byte sequence in the pixel data can't end the image early; otherwise this falls back
/// to the whitespace-bounded `EI` scan, exactly as lopdf does on its own `Err` path.
fn skip_inline_image(bytes: &[u8], after_bi: usize) -> Option<usize> {
    if let Some((meta, id_start)) = scan_inline_image_dict(bytes, after_bi) {
        let mut data_start = id_start + 2; // past "ID"
        while data_start < bytes.len() && matches!(bytes[data_start], b' ' | b'\t' | b'\r' | b'\n') {
            data_start += 1;
        }
        if let Some(end) = exact_inline_image_end(bytes, data_start, &meta) {
            return Some(end);
        }
    }
    whitespace_scan_inline_image_end(bytes, after_bi)
}

pub(crate) fn tokenize(bytes: &[u8]) -> Option<Vec<RawToken>> {
    let mut tokens = Vec::new();
    let mut i = 0usize;
    let mut operand_start: Option<usize> = None;

    while i < bytes.len() {
        let b = bytes[i];
        if is_whitespace(b) { i += 1; continue; }
        if b == b'%' {
            while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' { i += 1; }
            continue;
        }
        match b {
            b'(' => { operand_start.get_or_insert(i); i = skip_literal_string(bytes, i)?; }
            b'<' if bytes.get(i + 1) == Some(&b'<') => { operand_start.get_or_insert(i); i = skip_dict(bytes, i)?; }
            b'<' => { operand_start.get_or_insert(i); i = skip_hex_string(bytes, i)?; }
            b'[' => { operand_start.get_or_insert(i); i = skip_array(bytes, i)?; }
            b'/' => { operand_start.get_or_insert(i); i = skip_name(bytes, i); }
            b')' | b'>' | b']' | b'}' | b'{' => return None, // unbalanced delimiter
            _ => {
                let word_start = i;
                let (word, end) = read_bareword(bytes, i);
                if end == word_start { return None; } // no progress: malformed byte
                if is_number(word) || word == b"true" || word == b"false" || word == b"null" {
                    operand_start.get_or_insert(word_start);
                    i = end;
                } else {
                    let start = operand_start.take().unwrap_or(word_start);
                    if word == b"BI" {
                        let ei_end = skip_inline_image(bytes, end)?;
                        tokens.push(RawToken { operator: b"BI".to_vec(), start, end: ei_end });
                        i = ei_end;
                    } else {
                        tokens.push(RawToken { operator: word.to_vec(), start, end });
                        i = end;
                    }
                }
            }
        }
    }
    Some(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ops(bytes: &[u8]) -> Vec<Vec<u8>> {
        tokenize(bytes).unwrap().into_iter().map(|t| t.operator).collect()
    }

    #[test]
    fn tokenizes_simple_text_show() {
        // Operators only, in order.
        assert_eq!(
            ops(b"BT /F1 12 Tf (Hello) Tj ET"),
            vec![b"BT".to_vec(), b"Tf".to_vec(), b"Tj".to_vec(), b"ET".to_vec()]
        );
    }

    #[test]
    fn tj_operator_span_covers_operand_array_through_operator() {
        let raw = b"BT [(Hi) -250 (lo)] TJ ET";
        let toks = tokenize(raw).unwrap();
        let tj = toks.iter().find(|t| t.operator == b"TJ").unwrap();
        // start at '[', end just past the 'J' of TJ.
        assert_eq!(&raw[tj.start..tj.end], b"[(Hi) -250 (lo)] TJ");
    }

    #[test]
    fn true_false_null_are_operands_not_operators() {
        // `true` is an operand of the operator `Tr`-like keyword here; ensure the only
        // operator emitted is the trailing bareword `BDC`, not `true`.
        assert_eq!(ops(b"/OC true BDC"), vec![b"BDC".to_vec()]);
    }

    #[test]
    fn string_with_escaped_and_balanced_parens_does_not_end_early() {
        // The literal contains an escaped ')' and a balanced '()' — the operator is Tj.
        assert_eq!(ops(b"(a\\)b (c) d) Tj"), vec![b"Tj".to_vec()]);
    }

    #[test]
    fn hex_string_is_not_confused_with_dict() {
        assert_eq!(ops(b"<48656C6C6F> Tj"), vec![b"Tj".to_vec()]);
        assert_eq!(ops(b"<< /A 1 >> BDC"), vec![b"BDC".to_vec()]);
    }

    #[test]
    fn comment_is_skipped() {
        assert_eq!(ops(b"BT % this is (not) a string\n(Hi) Tj ET"),
                   vec![b"BT".to_vec(), b"Tj".to_vec(), b"ET".to_vec()]);
    }

    #[test]
    fn comment_inside_array_is_skipped() {
        // A ']' inside a comment must not close the array early; parity with lopdf.
        let raw = b"BT [(a) 1 % ]not real\n (b)] TJ ET";
        let toks = tokenize(raw).unwrap();
        assert_eq!(toks.iter().map(|t| t.operator.clone()).collect::<Vec<_>>(),
                   vec![b"BT".to_vec(), b"TJ".to_vec(), b"ET".to_vec()]);
        // and count parity with lopdf on the same stream:
        assert_eq!(toks.len(), lopdf::content::Content::decode(raw).unwrap().operations.len());
    }

    #[test]
    fn comment_inside_dict_is_skipped() {
        // A '>' inside a comment must not close the dict early; parity with lopdf.
        let raw = b"<< /A 1 % >> not real\n /B 2 >> BDC";
        let toks = tokenize(raw).unwrap();
        assert_eq!(toks.iter().map(|t| t.operator.clone()).collect::<Vec<_>>(),
                   vec![b"BDC".to_vec()]);
        assert_eq!(toks.len(), lopdf::content::Content::decode(raw).unwrap().operations.len());
    }

    #[test]
    fn inline_image_is_one_opaque_bi_token_spanning_to_ei() {
        let raw = b"q BI /W 2 /H 2 /CS /G ID \x00\xFF\x10\x20 EI Q";
        let toks = tokenize(raw).unwrap();
        assert_eq!(toks.iter().map(|t| t.operator.clone()).collect::<Vec<_>>(),
                   vec![b"q".to_vec(), b"BI".to_vec(), b"Q".to_vec()]);
        let bi = toks.iter().find(|t| t.operator == b"BI").unwrap();
        assert_eq!(&raw[bi.start..bi.end], b"BI /W 2 /H 2 /CS /G ID \x00\xFF\x10\x20 EI");
    }

    #[test]
    fn inline_image_exact_length_skips_fake_ei_in_pixel_data() {
        // W=2 H=2 BPC=8 CS=RGB -> stride = ceil(2*3*8/8) = 6, length = 2*6 = 12 bytes.
        // The pixel data itself contains a whitespace-bounded "EI" that the old
        // whitespace-only heuristic would have stopped at; the exact-length path (lopdf's
        // own behavior for a recognized colorspace with no /Filter) must skip past it and
        // land on the real terminator instead.
        let data: &[u8] = b"\x01\x02\x03 EI \x04\x05\x06\x07\x08";
        assert_eq!(data.len(), 12);

        let mut raw = b"q ".to_vec();
        let bi_start = raw.len();
        raw.extend_from_slice(b"BI /W 2 /H 2 /BPC 8 /CS /RGB ID ");
        raw.extend_from_slice(data);
        raw.extend_from_slice(b" EI");
        let bi_end = raw.len();
        raw.extend_from_slice(b" Q");

        let toks = tokenize(&raw).unwrap();
        assert_eq!(toks.iter().map(|t| t.operator.clone()).collect::<Vec<_>>(),
                   vec![b"q".to_vec(), b"BI".to_vec(), b"Q".to_vec()]);

        let bi = toks.iter().find(|t| t.operator == b"BI").unwrap();
        assert_eq!(bi.start, bi_start);
        assert_eq!(bi.end, bi_end);
        assert_eq!(&raw[bi.start..bi.end], &raw[bi_start..bi_end]);

        assert_eq!(toks.len(), lopdf::content::Content::decode(&raw).unwrap().operations.len());
    }

    #[test]
    fn unterminated_string_returns_none() {
        assert!(tokenize(b"(oops").is_none());
    }

    #[test]
    fn matches_lopdf_operation_count_on_mixed_stream() {
        let raw = b"q 1 0 0 1 10 10 cm BT /F1 12 Tf (Hi) Tj [(a) -5 (b)] TJ ET Q";
        let lopdf_count = lopdf::content::Content::decode(raw).unwrap().operations.len();
        assert_eq!(tokenize(raw).unwrap().len(), lopdf_count);
    }
}
