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

/// After `BI` (starting scan at `after_bi`), advance past the inline image to just after
/// its `EI` terminator. The `EI` must be whitespace-bounded on the left and followed by
/// whitespace or end-of-stream. Returns `None` if no such `EI` is found.
fn skip_inline_image(bytes: &[u8], after_bi: usize) -> Option<usize> {
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
    fn inline_image_is_one_opaque_bi_token_spanning_to_ei() {
        let raw = b"q BI /W 2 /H 2 /CS /G ID \x00\xFF\x10\x20 EI Q";
        let toks = tokenize(raw).unwrap();
        assert_eq!(toks.iter().map(|t| t.operator.clone()).collect::<Vec<_>>(),
                   vec![b"q".to_vec(), b"BI".to_vec(), b"Q".to_vec()]);
        let bi = toks.iter().find(|t| t.operator == b"BI").unwrap();
        assert_eq!(&raw[bi.start..bi.end], b"BI /W 2 /H 2 /CS /G ID \x00\xFF\x10\x20 EI");
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
