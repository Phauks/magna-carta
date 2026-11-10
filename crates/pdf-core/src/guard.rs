//! Decompression-bomb defense shared by every pdf-core operation.
//!
//! PDF streams inflate without any size bound in lopdf and hayro, both at load
//! time (object streams) and at our explicit decode sites. `guard_input` runs a
//! raw-bytes pre-flight before either parser sees the document: an input-size cap
//! plus a scan that bounded-inflates every top-level `stream` blob and rejects on
//! per-stream or cumulative overflow. Because a PDF stream is always a top-level
//! indirect object, bounding the raw blobs transitively bounds everything either
//! parser can later inflate.

use std::io::Write;

const MIB: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GuardLimits {
    pub max_input_bytes: usize,
    pub max_stream_inflated: usize,
    pub max_total_inflated: u64,
}

impl Default for GuardLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 256 * MIB,
            max_stream_inflated: 256 * MIB,
            max_total_inflated: 1024 * MIB as u64, // 1 GiB
        }
    }
}

// The shared `TooLarge` suffix is intentional: every variant is a size-cap
// violation. Clarity beats clippy's distinct-name preference here.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BombError {
    InputTooLarge,
    StreamTooLarge,
    TotalTooLarge,
}

/// A `Write` sink that counts bytes and discards them, failing once it passes `cap`.
/// Lets us inflate a stream for measurement without ever holding the output.
struct CountingSink {
    count: u64,
    cap: u64,
    overflowed: bool,
}

impl CountingSink {
    fn new(cap: u64) -> Self {
        Self {
            count: 0,
            cap,
            overflowed: false,
        }
    }
}

impl Write for CountingSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.count += buf.len() as u64;
        if self.count > self.cap {
            self.overflowed = true;
            // Stop the decoder early; the variant is irrelevant, we read `overflowed`.
            return Err(std::io::Error::from(std::io::ErrorKind::Other));
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

enum Inflated {
    /// Produced more than the per-stream cap.
    Overflow,
    /// Decoded this many bytes (0 means the blob is not deflate).
    Bytes(u64),
}

/// Inflate `blob` as zlib, then (only if that produced nothing) as raw deflate,
/// discarding output. The first decoder that overflows or produces bytes wins; a
/// non-deflate blob yields `Bytes(0)`. Short-circuits so a bomb is inflated once.
fn inflate_deflate(blob: &[u8], cap: u64) -> Inflated {
    use flate2::read::{DeflateDecoder, ZlibDecoder};
    // zlib (RFC 1950)
    match copy_counted(ZlibDecoder::new(blob), cap) {
        Inflated::Overflow => return Inflated::Overflow,
        Inflated::Bytes(n) if n > 0 => return Inflated::Bytes(n),
        Inflated::Bytes(_) => {}
    }
    // raw deflate (RFC 1951) for streams stored without a zlib header
    copy_counted(DeflateDecoder::new(blob), cap)
}

fn copy_counted<R: std::io::Read>(mut reader: R, cap: u64) -> Inflated {
    let mut sink = CountingSink::new(cap);
    // Ignore the result: a decoder error (non-deflate / truncated) just ends the
    // copy; overflow is reported via `sink.overflowed`.
    let _ = std::io::copy(&mut reader, &mut sink);
    if sink.overflowed {
        Inflated::Overflow
    } else {
        Inflated::Bytes(sink.count)
    }
}

/// First index at or after `from` where `needle` occurs in `hay`.
fn find_from(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from >= hay.len() {
        return None;
    }
    let first = needle[0];
    let mut i = from;
    while i + needle.len() <= hay.len() {
        if hay[i] == first && &hay[i..i + needle.len()] == needle {
            return Some(i);
        }
        i += 1;
    }
    None
}

pub(crate) fn guard_input(bytes: &[u8], limits: &GuardLimits) -> Result<(), BombError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(BombError::InputTooLarge);
    }
    let per_stream = limits.max_stream_inflated as u64;
    let mut cumulative: u64 = 0;
    let mut cursor = 0usize;

    let mut endstream_absent = false;
    while let Some(kw) = find_from(bytes, b"stream", cursor) {
        // Stream data begins after the EOL that follows the `stream` keyword
        // (CRLF or LF), per the PDF spec. Be lenient about which.
        let mut start = kw + b"stream".len();
        if bytes.get(start) == Some(&b'\r') {
            start += 1;
        }
        if bytes.get(start) == Some(&b'\n') {
            start += 1;
        }
        if start >= bytes.len() {
            break;
        }

        match inflate_deflate(&bytes[start..], per_stream) {
            Inflated::Overflow => return Err(BombError::StreamTooLarge),
            Inflated::Bytes(n) => {
                cumulative += n;
                if cumulative > limits.max_total_inflated {
                    return Err(BombError::TotalTooLarge);
                }
            }
        }

        // Advance the scan cursor. `endstream` only skips ahead over a well-formed
        // stream body; it never bounds the inflate (deflate self-terminates). Once
        // `endstream` is absent from `start` to EOF it is absent from every later
        // suffix too, so stop searching for it — otherwise a crafted input of many
        // `stream` keywords with no `endstream` re-scans to EOF each iteration
        // (O(n^2)). Advancing to `start` keeps every `stream` keyword inflate-checked
        // and, because the outer search is forward-only, total work stays linear.
        if endstream_absent {
            cursor = start;
        } else {
            match find_from(bytes, b"endstream", start) {
                Some(e) => cursor = e + b"endstream".len(),
                None => {
                    endstream_absent = true;
                    cursor = start;
                }
            }
        }
    }
    Ok(())
}

/// Whether `doc` is still encrypted after loading: it needs a password that was not given.
///
/// The parser opens a file whose open password is empty by itself, and such a document is
/// plain by the time it is returned. One that needs a real password is returned with every
/// string and stream still enciphered. Work done on that is done on noise: pages merged
/// from it are unreadable, text drawn onto it is mixed with ciphertext, and the file written
/// back opens nowhere. Every operation asks this first and refuses.
pub(crate) fn is_locked(doc: &lopdf::Document) -> bool {
    doc.is_encrypted()
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::{DeflateEncoder, ZlibEncoder};
    use flate2::Compression;

    // Build a zlib stream that inflates to `inflated` zero bytes, using a small
    // working buffer so constructing a large bomb stays cheap on memory.
    fn zlib_bomb(inflated: u64) -> Vec<u8> {
        let mut e = ZlibEncoder::new(Vec::new(), Compression::best());
        let chunk = vec![0u8; 64 * 1024];
        let mut left = inflated;
        while left > 0 {
            let n = left.min(chunk.len() as u64) as usize;
            e.write_all(&chunk[..n]).unwrap();
            left -= n as u64;
        }
        e.finish().unwrap()
    }

    fn raw_deflate_bomb(inflated: u64) -> Vec<u8> {
        let mut e = DeflateEncoder::new(Vec::new(), Compression::best());
        let chunk = vec![0u8; 64 * 1024];
        let mut left = inflated;
        while left > 0 {
            let n = left.min(chunk.len() as u64) as usize;
            e.write_all(&chunk[..n]).unwrap();
            left -= n as u64;
        }
        e.finish().unwrap()
    }

    fn pdf_with_stream(blob: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"%PDF-1.5\n1 0 obj<</Length 0>>stream\n");
        v.extend_from_slice(blob);
        v.extend_from_slice(b"\nendstream endobj\n%%EOF");
        v
    }

    // Tight limits keep every test fast: nothing here inflates past ~4 MiB.
    fn small() -> GuardLimits {
        GuardLimits {
            max_input_bytes: 8 * MIB,
            max_stream_inflated: MIB,
            max_total_inflated: 3 * MIB as u64,
        }
    }

    #[test]
    fn rejects_oversize_input() {
        let big = vec![0u8; small().max_input_bytes + 1];
        assert_eq!(guard_input(&big, &small()), Err(BombError::InputTooLarge));
    }

    #[test]
    fn passes_a_benign_deflate_stream() {
        let blob = zlib_bomb(256 * 1024); // 256 KiB inflated < 1 MiB cap
        let pdf = pdf_with_stream(&blob);
        assert_eq!(guard_input(&pdf, &small()), Ok(()));
    }

    #[test]
    fn rejects_a_zlib_bomb_over_the_stream_cap() {
        let blob = zlib_bomb(2 * MIB as u64); // 2 MiB inflated > 1 MiB cap
        let pdf = pdf_with_stream(&blob);
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::StreamTooLarge));
    }

    #[test]
    fn rejects_a_raw_deflate_bomb() {
        let blob = raw_deflate_bomb(2 * MIB as u64);
        let pdf = pdf_with_stream(&blob);
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::StreamTooLarge));
    }

    #[test]
    fn rejects_cumulative_total_across_streams() {
        // Four streams, each under the 1 MiB per-stream cap but together summing
        // past the 3 MiB total cap (the cap trips during the fourth stream).
        let one = zlib_bomb(900 * 1024);
        let mut pdf = Vec::new();
        for _ in 0..4 {
            pdf.extend_from_slice(b"1 0 obj<</Length 0>>stream\n");
            pdf.extend_from_slice(&one);
            pdf.extend_from_slice(b"\nendstream endobj\n");
        }
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::TotalTooLarge));
    }

    #[test]
    fn self_terminates_without_an_endstream_keyword() {
        // No `endstream`, plus trailing garbage: the decoder still stops at the
        // deflate end and the bomb is still caught.
        let blob = zlib_bomb(2 * MIB as u64);
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n1 0 obj<</Length 0>>stream\n");
        pdf.extend_from_slice(&blob);
        pdf.extend_from_slice(b"\x00\x01\x02trailing-garbage-no-endstream");
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::StreamTooLarge));
    }

    #[test]
    fn ignores_non_deflate_and_streamless_input() {
        assert_eq!(guard_input(b"not a pdf at all", &small()), Ok(()));
        // An uncompressed (non-deflate) stream body is skipped, not rejected.
        let pdf = pdf_with_stream(b"plain uncompressed bytes, not deflate");
        assert_eq!(guard_input(&pdf, &small()), Ok(()));
    }

    #[test]
    fn many_stream_keywords_without_endstream_stay_linear() {
        // Crafted input: repeated `stream` keywords, no `endstream`. Quadratic
        // scanning would hang for minutes; linear scanning returns immediately.
        //
        // Each repeat unit appends 4 trailing 0xFF bytes after `stream` so every
        // occurrence's suffix begins with an invalid deflate block-type header
        // (fails the decoder on the first read, Bytes(0)) rather than the bare
        // `b"stream"` repeat, whose periodic bytes raw-deflate (headerless, so it
        // never rejects on a bad magic number) happens to decode as if they were
        // real compressed data — tripping the *cumulative* cap and masking the
        // O(n^2) check this test exists for.
        let mut unit = b"stream".to_vec();
        unit.extend_from_slice(&[0xFFu8; 4]);
        let spam = unit.repeat(100_000); // ~1 MiB, no deflate content
        assert_eq!(guard_input(&spam, &small()), Ok(()));
    }
}
