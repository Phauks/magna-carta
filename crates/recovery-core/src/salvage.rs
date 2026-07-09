//! Format-agnostic salvage primitives (compression-stream partial decode).

use zune_inflate::DeflateDecoder;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeflateWrapper {
    Raw,
    Zlib,
    Gzip,
}

#[derive(Debug, Clone)]
pub struct SalvageOutput {
    pub bytes: Vec<u8>,
    pub complete: bool,
}

/// Decode a DEFLATE/zlib/gzip stream as far as possible.
///
/// On a clean stream returns the full decompressed bytes with `complete = true`.
/// On a truncated or corrupt stream returns the best-effort decoded bytes with
/// `complete = false`: the bulk is a valid prefix of the original, but the final
/// partial block may be corrupt (the decoder cannot report how many trailing
/// bytes are valid), so the caller must treat an incomplete result as lossy — it
/// feeds the loss manifest — never as byte-exact.
///
/// Note: zune-inflate applies a default maximum-output size limit, so a
/// legitimately large stream that exceeds it is returned with `complete = false`
/// (a capped-but-valid stream, not corruption); a consumer decoding large valid
/// entries may need to raise the limit.
pub fn inflate_salvage(data: &[u8], wrapper: DeflateWrapper) -> SalvageOutput {
    let mut decoder = DeflateDecoder::new(data);
    let result = match wrapper {
        DeflateWrapper::Raw => decoder.decode_deflate(),
        DeflateWrapper::Zlib => decoder.decode_zlib(),
        DeflateWrapper::Gzip => decoder.decode_gzip(),
    };
    match result {
        Ok(bytes) => SalvageOutput {
            bytes,
            complete: true,
        },
        // On a truncated/corrupt stream zune-inflate returns the prefix it
        // decoded alongside the error in the public `data` field.
        Err(errors) => SalvageOutput {
            bytes: errors.data,
            complete: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::{DeflateEncoder, GzEncoder, ZlibEncoder};
    use flate2::Compression;
    use std::io::Write;

    fn zlib_compress(input: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(input).unwrap();
        encoder.finish().unwrap()
    }

    fn deflate_compress(input: &[u8]) -> Vec<u8> {
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(input).unwrap();
        encoder.finish().unwrap()
    }

    fn gzip_compress(input: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(input).unwrap();
        encoder.finish().unwrap()
    }

    fn long_input() -> Vec<u8> {
        // Compressible, multi-block input so truncation loses only the tail.
        "The quick brown fox jumps over the lazy dog. "
            .repeat(500)
            .into_bytes()
    }

    #[test]
    fn a_clean_zlib_stream_decodes_complete() {
        let input = long_input();
        let compressed = zlib_compress(&input);
        let out = inflate_salvage(&compressed, DeflateWrapper::Zlib);
        assert!(out.complete);
        assert_eq!(out.bytes, input);
    }

    #[test]
    fn a_truncated_zlib_stream_yields_a_substantial_recoverable_prefix() {
        let input = long_input();
        let mut compressed = zlib_compress(&input);
        // Drop the tail to corrupt the stream.
        compressed.truncate(compressed.len() - 20);
        let out = inflate_salvage(&compressed, DeflateWrapper::Zlib);
        assert!(!out.complete, "a truncated stream must not report complete");
        // zune-inflate returns the bytes it decoded before the error. The bulk is a
        // valid prefix of the original; only the final partial block may be corrupt,
        // and the decoder does not report how many trailing bytes are valid — so we
        // assert substantial recovery and that a clear leading half is a genuine
        // prefix, never that the whole buffer is byte-exact.
        assert!(
            out.bytes.len() > input.len() / 2,
            "expected substantial recovery"
        );
        let leading = out.bytes.len() / 2;
        assert!(
            input.starts_with(&out.bytes[..leading]),
            "the leading half of the salvaged bytes must be a genuine prefix of the original"
        );
    }

    #[test]
    fn a_clean_raw_deflate_stream_decodes_complete() {
        let input = long_input();
        let compressed = deflate_compress(&input);
        let out = inflate_salvage(&compressed, DeflateWrapper::Raw);
        assert!(out.complete);
        assert_eq!(out.bytes, input);
    }

    #[test]
    fn a_truncated_raw_deflate_stream_yields_a_substantial_recoverable_prefix() {
        let input = long_input();
        let mut compressed = deflate_compress(&input);
        // Drop the tail to corrupt the stream.
        compressed.truncate(compressed.len() - 20);
        let out = inflate_salvage(&compressed, DeflateWrapper::Raw);
        assert!(!out.complete, "a truncated stream must not report complete");
        // The decoder returns the prefix it decoded before the error; only the
        // final partial block may be corrupt — assert substantial recovery and
        // that a clear leading half is a genuine prefix, never byte-exact.
        assert!(
            out.bytes.len() > input.len() / 2,
            "expected substantial recovery"
        );
        let leading = out.bytes.len() / 2;
        assert!(
            input.starts_with(&out.bytes[..leading]),
            "the leading half of the salvaged bytes must be a genuine prefix of the original"
        );
    }

    #[test]
    fn a_clean_gzip_stream_decodes_complete() {
        let input = long_input();
        let compressed = gzip_compress(&input);
        let out = inflate_salvage(&compressed, DeflateWrapper::Gzip);
        assert!(out.complete);
        assert_eq!(out.bytes, input);
    }
}
