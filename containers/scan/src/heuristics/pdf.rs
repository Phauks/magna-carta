use super::Heuristic;
use lopdf::{Document, Object};

// The maximum structural nesting (`[` arrays and `<<` dictionaries) we let reach the PDF parser. lopdf
// 0.41 parses nested objects by unbounded recursion, so a crafted PDF of deeply nested arrays/dicts
// drives a STACK OVERFLOW — a SIGABRT that `catch_unwind` cannot catch and that would abort the process
// (PID 1), orphaning clamd. This bound is far above any legitimate document (real PDFs nest a handful of
// levels — a page tree, an annotation array, a form-field hierarchy) yet far below the ~thousands of
// frames that overflow a normal thread stack, so it bails a malicious file without false-positiving a
// real one. Over the bound, the structured parse is skipped entirely and we fall back to the raw token
// scan (which is iterative and cannot recurse).
const MAX_PDF_NESTING_DEPTH: usize = 200;

/// Inspects a PDF for active content (JavaScript, auto-actions, launch actions, embedded files) or
/// password-encryption that blocks inspection. `load_mem` auto-decrypts empty-password PDFs (the common
/// owner-restricted case), so only a genuinely password-locked PDF — a load error naming a password /
/// unsupported security handler — is `Encrypted`. An otherwise-unparseable PDF is `Clean` here (clamd
/// and yara still scan the bytes).
pub fn inspect_pdf(bytes: &[u8]) -> Heuristic {
    // STRUCTURAL ABORT GUARD: a too-deeply-nested PDF would overflow lopdf's recursive parser and abort
    // the process. Detect it cheaply (iteratively) on the raw bytes and skip the structured parse — the
    // raw token scan still catches active-content markers a viewer would execute, so the file is not
    // silently cleared, and the process survives to return a verdict.
    if exceeds_nesting_depth(bytes, MAX_PDF_NESTING_DEPTH) {
        return byte_scan_fallback(bytes);
    }
    // The raw-byte pre-check above only sees the file's OUTER bytes. lopdf also DECOMPRESSES and
    // recursively parses `/Type /ObjStm` object streams (PDF 1.5+), so deeply-nested arrays/dictionaries
    // hidden inside a FlateDecode object stream are invisible to that check yet still overflow the same
    // recursive parser to an uncatchable SIGABRT. We cannot soundly re-derive every object-stream body by
    // hand (a crafted file can make a textual scan disagree with lopdf's `/Length`+xref-driven extraction,
    // and a body that slips our scan still reaches the parser), so the only guaranteed defense is to never
    // hand an object-stream-bearing file to `load_mem` at all: if the bytes carry an object stream, skip
    // the structured parse and inflate-then-scan its decompressed content for active-content markers
    // instead. clamd and yara still scan the raw bytes; the structured walk is a detection aid, not the
    // safety net, so trading it for abort-safety on these files is the correct call.
    if contains_object_stream(bytes) {
        return object_stream_fallback(bytes);
    }
    let doc = match Document::load_mem(bytes) {
        Ok(doc) => doc,
        Err(lopdf::Error::InvalidPassword) | Err(lopdf::Error::UnsupportedSecurityHandler(_)) => {
            return Heuristic::Encrypted;
        }
        // lopdf is stricter than production viewers; a malformed-but-renderable PDF is a known evasion
        // vector. On a parse failure, do not assume Clean — fall back to a raw token scan so an active-
        // content marker a viewer would still execute is not silently dropped.
        Err(_) => return byte_scan_fallback(bytes),
    };
    if has_active_content(&doc) {
        Heuristic::ActiveContent
    } else {
        Heuristic::Clean
    }
}

// Cheap, iterative pre-scan of the raw PDF bytes: returns true if array (`[`) or dictionary (`<<`)
// nesting ever exceeds `limit`. It tracks only structural depth, deliberately approximate but
// CONSERVATIVE — it never under-counts genuine structural nesting, so it cannot let a stack-overflow
// payload through. Literal strings `( ... )` (which may hold unbalanced brackets and stray `<`/`>`) are
// skipped with PDF backslash-escape handling, so their contents never inflate or deflate the depth.
// `<<`/`>>` are matched as pairs; a lone `<`/`>` (a hex string, or a comparison inside content) does not
// change dictionary depth. This walks the bytes once with O(1) state — no allocation, no recursion.
fn exceeds_nesting_depth(bytes: &[u8], limit: usize) -> bool {
    let mut depth: usize = 0;
    let mut index = 0;
    // Nesting of `(...)` literal strings: brackets/angles inside a string are data, not structure.
    let mut string_depth: usize = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if string_depth > 0 {
            match byte {
                // A backslash escapes the next byte (incl. an escaped paren) — skip both.
                b'\\' => index += 2,
                b'(' => {
                    string_depth += 1;
                    index += 1;
                }
                b')' => {
                    string_depth -= 1;
                    index += 1;
                }
                _ => index += 1,
            }
            continue;
        }
        match byte {
            b'(' => string_depth += 1,
            b'[' => {
                depth += 1;
                if depth > limit {
                    return true;
                }
            }
            b']' => depth = depth.saturating_sub(1),
            b'<' if bytes.get(index + 1) == Some(&b'<') => {
                depth += 1;
                if depth > limit {
                    return true;
                }
                index += 2;
                continue;
            }
            b'>' if bytes.get(index + 1) == Some(&b'>') => {
                depth = depth.saturating_sub(1);
                index += 2;
                continue;
            }
            _ => {}
        }
        index += 1;
    }
    false
}

// The most decompressed object-stream bytes the fallback inflates per stream before marker-scanning. A
// `take`-limited inflate, so a decompression bomb inside an object stream cannot exhaust memory here; the
// structural-archive heuristics and clamd cover the bomb itself.
const MAX_OBJSTM_INFLATE_BYTES: u64 = 8 * 1024 * 1024;

// True if the raw bytes carry a `/Type /ObjStm` object stream. Only the stream DICTIONARY is checked
// (it is never itself compressed — only the stream body is), so this reliably detects the PDF 1.5+
// object-stream feature without parsing. Used to keep object-stream-bearing files away from lopdf's
// recursive parser entirely (the only guaranteed defense against its uncatchable stack overflow).
fn contains_object_stream(bytes: &[u8]) -> bool {
    find_subslice(bytes, b"/ObjStm").is_some()
}

// Active-content scan for an object-stream-bearing PDF, which never reaches lopdf's structured parser.
// The raw `byte_scan_fallback` alone would miss markers that live INSIDE a compressed object stream (the
// document catalog, with its `/OpenAction` / `/JavaScript`, is commonly stored there), so additionally
// inflate each object stream's body (bounded) and scan the decompressed bytes for the same markers. A
// non-deflate or truncated body simply yields nothing — conservative, never a panic.
fn object_stream_fallback(bytes: &[u8]) -> Heuristic {
    use flate2::read::ZlibDecoder;
    use std::io::Read as _;

    if byte_scan_fallback(bytes) == Heuristic::ActiveContent {
        return Heuristic::ActiveContent;
    }

    // Walk every `/ObjStm` occurrence — a file may carry several — and scan each inflated body.
    let mut search_from = 0;
    while let Some(relative) = find_subslice(&bytes[search_from..], b"/ObjStm") {
        let marker = search_from + relative;
        search_from = marker + b"/ObjStm".len();

        // The body is the bytes between this object's `stream` keyword and its `endstream`.
        let after_marker = &bytes[marker..];
        let Some(stream_rel) = find_subslice(after_marker, b"stream") else {
            continue;
        };
        // Body begins after `stream` and its trailing EOL (CRLF, LF, or CR per the PDF spec).
        let mut body_start = marker + stream_rel + b"stream".len();
        match bytes.get(body_start) {
            Some(b'\r') => {
                body_start += 1;
                if bytes.get(body_start) == Some(&b'\n') {
                    body_start += 1;
                }
            }
            Some(b'\n') => body_start += 1,
            _ => {}
        }
        let body_end =
            find_subslice(&bytes[body_start..], b"endstream").unwrap_or(bytes.len() - body_start);
        let body = &bytes[body_start..body_start + body_end];

        let mut inflated = Vec::new();
        // The read result is intentionally ignored: a partial inflate still scans whatever decompressed.
        let _ = ZlibDecoder::new(body)
            .take(MAX_OBJSTM_INFLATE_BYTES)
            .read_to_end(&mut inflated);
        if byte_scan_fallback(&inflated) == Heuristic::ActiveContent {
            return Heuristic::ActiveContent;
        }
    }
    Heuristic::Clean
}

// First index of `needle` within `haystack`, or `None`. A tiny window scan — object streams are few.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

// Raw token scan for PDF active-content markers, used when the structured parse fails. Hex-escaped name
// forms (e.g. /J#61vaScript) are a residual evasion this literal scan does not cover.
fn byte_scan_fallback(bytes: &[u8]) -> Heuristic {
    const MARKERS: [&[u8]; 6] = [
        b"/JavaScript",
        b"/JS",
        b"/OpenAction",
        b"/AA",
        b"/Launch",
        b"/EmbeddedFile",
    ];
    if MARKERS
        .iter()
        .any(|marker| bytes.windows(marker.len()).any(|window| window == *marker))
    {
        Heuristic::ActiveContent
    } else {
        Heuristic::Clean
    }
}

// PDF dictionary keys and name values are byte strings, not text — match with byte literals. Active
// content surfaces as a dictionary KEY (/OpenAction, /AA auto-actions; /JavaScript, /JS) or as a name
// VALUE (/S /Launch; /Type /EmbeddedFile). Stream objects carry a dictionary too (/JS, /EmbeddedFile
// payloads are streams), so descend into those.
fn has_active_content(doc: &Document) -> bool {
    for object in doc.objects.values() {
        let dict = match object {
            Object::Dictionary(dictionary) => dictionary,
            Object::Stream(stream) => &stream.dict,
            _ => continue,
        };
        if dict.has(b"OpenAction") || dict.has(b"AA") || dict.has(b"JavaScript") || dict.has(b"JS")
        {
            return true;
        }
        let has_launch_or_embedded = dict.iter().any(|(_key, value)| {
            value
                .as_name()
                .map(|name| name == b"Launch" || name == b"EmbeddedFile")
                .unwrap_or(false)
        });
        if has_launch_or_embedded {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{exceeds_nesting_depth, inspect_pdf, Heuristic, MAX_PDF_NESTING_DEPTH};

    #[test]
    fn shallow_nesting_is_within_the_bound() {
        // A handful of levels — a normal document — is not flagged.
        assert!(!exceeds_nesting_depth(
            b"[[[ /Type /Page ]]]",
            MAX_PDF_NESTING_DEPTH
        ));
        assert!(!exceeds_nesting_depth(
            b"<< /A << /B 1 >> >>",
            MAX_PDF_NESTING_DEPTH
        ));
    }

    #[test]
    fn deeply_nested_arrays_exceed_the_bound() {
        let payload = "[".repeat(MAX_PDF_NESTING_DEPTH + 5);
        assert!(exceeds_nesting_depth(
            payload.as_bytes(),
            MAX_PDF_NESTING_DEPTH
        ));
    }

    #[test]
    fn deeply_nested_dictionaries_exceed_the_bound() {
        let payload = "<<".repeat(MAX_PDF_NESTING_DEPTH + 5);
        assert!(exceeds_nesting_depth(
            payload.as_bytes(),
            MAX_PDF_NESTING_DEPTH
        ));
    }

    #[test]
    fn brackets_inside_a_literal_string_do_not_count() {
        // A string literal full of brackets is data, not structure — it must not inflate the depth.
        let payload = format!("({})", "[".repeat(MAX_PDF_NESTING_DEPTH + 50));
        assert!(!exceeds_nesting_depth(
            payload.as_bytes(),
            MAX_PDF_NESTING_DEPTH
        ));
    }

    #[test]
    fn escaped_paren_in_a_string_does_not_unbalance_the_scan() {
        // An escaped close-paren keeps the string open; trailing brackets are still string data.
        let payload = format!("(a\\){})", "[".repeat(MAX_PDF_NESTING_DEPTH + 50));
        assert!(!exceeds_nesting_depth(
            payload.as_bytes(),
            MAX_PDF_NESTING_DEPTH
        ));
    }

    #[test]
    fn a_deeply_nested_pdf_does_not_panic_or_abort_and_falls_back() {
        // The crux of the abort guard: a crafted deep-nesting PDF that would overflow lopdf's recursive
        // parser is detected structurally and routed to the iterative fallback BEFORE `Document::load_mem`
        // — so `inspect_pdf` returns a verdict instead of aborting the process. The fallback still sees
        // the active-content marker in the bytes.
        let mut payload = b"%PDF-1.7\n".to_vec();
        payload.extend(std::iter::repeat_n(b'[', MAX_PDF_NESTING_DEPTH + 100));
        payload.extend_from_slice(b"/JavaScript");
        assert_eq!(inspect_pdf(&payload), Heuristic::ActiveContent);
    }

    #[test]
    fn deeply_nested_pdf_without_markers_is_clean_not_a_crash() {
        let mut payload = b"%PDF-1.7\n".to_vec();
        payload.extend(std::iter::repeat_n(b'<', (MAX_PDF_NESTING_DEPTH + 100) * 2));
        // No active-content marker; the guard returns the fallback's Clean, never a panic/abort.
        assert_eq!(inspect_pdf(&payload), Heuristic::Clean);
    }

    // Builds a minimal, structurally-valid PDF whose deep array nesting lives INSIDE a FlateDecode
    // `/Type /ObjStm` object stream — so the nesting is invisible to a raw-byte pre-scan but lopdf
    // decompresses and recursively parses it on `load_mem`. `depth` is the array-nesting level the
    // decompressed object carries.
    fn pdf_with_deeply_nested_objstm(depth: usize) -> Vec<u8> {
        let nested = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        pdf_with_objstm_payload(nested.as_bytes())
    }

    // Builds a minimal, structurally-valid PDF whose single compressed `/Type /ObjStm` object stream
    // carries `payload` as object number 2 — so `payload` only materializes after FlateDecode, invisible
    // to a raw-byte scan of the file.
    fn pdf_with_objstm_payload(payload: &[u8]) -> Vec<u8> {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write as _;

        // The compressed object's body: object number 2, offset 0 in the stream, then the payload.
        let index = b"2 0 ";
        let mut objstm_plain = Vec::new();
        objstm_plain.extend_from_slice(index);
        objstm_plain.extend_from_slice(payload);
        let first = index.len();

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&objstm_plain).unwrap();
        let compressed = encoder.finish().unwrap();

        // Assemble the file, tracking byte offsets for the xref table.
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n");

        let obj1_offset = pdf.len();
        let objstm_header = format!(
            "1 0 obj\n<< /Type /ObjStm /N 1 /First {first} /Length {len} /Filter /FlateDecode >>\nstream\n",
            len = compressed.len()
        );
        pdf.extend_from_slice(objstm_header.as_bytes());
        pdf.extend_from_slice(&compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");

        let xref_offset = pdf.len();
        // A classic xref table referencing object 1 (the ObjStm) as a Normal entry — enough for
        // `load_objects_raw` to read it, recognize `/Type /ObjStm`, and decompress+parse it.
        let xref = format!(
            "xref\n0 2\n0000000000 65535 f \n{obj1:010} 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            obj1 = obj1_offset,
        );
        pdf.extend_from_slice(xref.as_bytes());
        pdf
    }

    #[test]
    fn a_deeply_nested_object_stream_does_not_abort() {
        // REGRESSION: the raw-byte depth pre-check only sees the OUTER bytes. A PDF that hides its
        // deeply-nested arrays inside a FlateDecode `/Type /ObjStm` slips past the pre-check (the
        // compressed bytes carry few literal `[`), yet lopdf decompresses and recursively parses the
        // object stream on `load_mem` — an unbounded recursion that overflows the stack to a SIGABRT
        // `catch_unwind` cannot catch. The guard keeps object-stream-bearing files away from `load_mem`
        // entirely, so `inspect_pdf` returns a verdict rather than aborting. Returning at all is the
        // assertion — before the guard this overflowed the stack.
        let pdf = pdf_with_deeply_nested_objstm(50_000);
        // The pre-check on the raw bytes must NOT catch this (otherwise the test would prove nothing
        // about the object-stream path).
        assert!(
            !exceeds_nesting_depth(&pdf, MAX_PDF_NESTING_DEPTH),
            "the compressed nesting must be invisible to the raw-byte pre-check for this to be a real test"
        );
        let _ = inspect_pdf(&pdf);
    }

    #[test]
    fn an_object_stream_bearing_pdf_never_reaches_the_structured_parser() {
        // The guarantee the abort-safety rests on: any `/ObjStm` in the bytes routes around `load_mem`.
        let pdf = pdf_with_deeply_nested_objstm(3);
        assert!(super::contains_object_stream(&pdf));
    }

    #[test]
    fn active_content_inside_a_compressed_object_stream_is_still_detected() {
        // The object-stream fallback inflates each stream body and scans it, so a marker that lives only
        // inside the compressed object stream (where the raw-byte scan cannot see it) is still flagged —
        // detection is preserved even though the structured parse is skipped for these files.
        let pdf = pdf_with_objstm_payload(
            b"<< /Type /Catalog /OpenAction << /S /JavaScript /JS (x) >> >>",
        );
        assert!(!exceeds_nesting_depth(&pdf, MAX_PDF_NESTING_DEPTH));
        assert_eq!(inspect_pdf(&pdf), Heuristic::ActiveContent);
    }

    #[test]
    fn a_clean_compressed_object_stream_is_clean() {
        // A shallow, marker-free object stream must serialize Clean — not a false ActiveContent and not
        // a crash.
        let pdf = pdf_with_objstm_payload(b"<< /Type /Catalog /Pages 3 0 R >>");
        assert_eq!(inspect_pdf(&pdf), Heuristic::Clean);
    }

    #[test]
    fn truncated_and_garbage_pdfs_never_panic() {
        // A grab-bag of malformed inputs through the full PDF path: each must return a verdict, never
        // panic. (`inspect_pdf` returning at all is the assertion — a panic would unwind the test.)
        for input in [
            &b"%PDF-1.7"[..],
            &b"%PDF-1.7\n<<"[..],
            &b"%PDF-1.7\n1 0 obj\n<< /Type"[..],
            &b"%PDF"[..],
            &[0xff; 64][..],
        ] {
            let _ = inspect_pdf(input);
        }
    }
}
