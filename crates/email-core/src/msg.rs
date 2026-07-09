//! The `.msg` lane's container gate: open the CFB/OLE2 compound file that an
//! Outlook `.msg` is wrapped in, mapping every structural fault to a single
//! opaque [`EmailError::Malformed`]. The MAPI property-stream decoding that reads
//! the sender, recipients, subject, body, and attachments out of the opened
//! container is built above this gate, with its own bounds.
//!
//! Why a dedicated open helper rather than calling `cfb` at each use site: the
//! bytes are attacker-controlled and legally privileged, and this engine runs in
//! an isolate that cannot unwind. Funneling every open through one point keeps the
//! error mapping uniform (no `cfb` message text, which could echo input, ever
//! reaches a caller) and gives the panic-safety regression tests below a single,
//! stable surface to hold `cfb` to.

use std::io::Cursor;

use cfb::CompoundFile;

use crate::error::EmailError;

/// The container-open seam for `.msg`: open a compound-file wrapper over an
/// in-memory cursor, without copying the input. Any structural fault `cfb`
/// reports while reading the header, DIFAT/FAT, directory, or MiniFAT
/// collapses to [`EmailError::Malformed`] — the underlying `io::Error` text is
/// dropped so no fragment of the input can ride out on an error path.
///
/// That collapse matters beyond tidiness: this parser ends up running in a
/// wasm isolate that cannot unwind, so a `cfb` panic on hostile input would
/// abort the whole isolate rather than hand the caller a recoverable result.
/// Mapping every fault to one plain, static-string error variant is what
/// keeps a malformed attachment a normal `Err` instead of a crash.
///
/// Kept `pub` (not crate-private) on purpose. Monomorphization is lazy: a
/// crate-private function whose only caller is test-only code is never
/// generated, and neither is anything it calls — so `cfb`'s open/read path
/// would silently go uncompiled on wasm, and a build that never touched it
/// would still look green. Being `pub` makes it an `rlib` export, which is a
/// codegen root, so the compiler really does generate `cfb`'s generic open
/// path for `Cursor<&[u8]>`.
///
/// That root comes from the `rlib` half of this crate's `crate-type`, not
/// from `pub` alone: a plain Rust function is not a `cdylib` export, so
/// trimming `crate-type` to `["cdylib"]` would drop `cfb` from the artifact
/// again (measurably — it nearly halves it). Once the MAPI decoder is
/// reachable from a `#[wasm_bindgen]` entry point, that export graph roots
/// this path directly and the `rlib` scaffold stops mattering.
pub fn open_compound_file(bytes: &[u8]) -> Result<CompoundFile<Cursor<&[u8]>>, EmailError> {
    CompoundFile::open(Cursor::new(bytes)).map_err(|_| EmailError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read as _, Write};

    /// Build a valid version-4 CFB carrying the given streams, the way a real
    /// `.msg` is structured (a compound file of property streams). Returned as
    /// owned bytes so tests can corrupt copies of it.
    fn valid_compound_file(streams: &[(&str, &[u8])]) -> Vec<u8> {
        let mut compound = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        for (path, content) in streams {
            compound
                .create_stream(path)
                .unwrap()
                .write_all(content)
                .unwrap();
        }
        compound.flush().unwrap();
        compound.into_inner().into_inner()
    }

    /// A well-formed container opens and its streams read back — the gate does
    /// not reject valid input.
    #[test]
    fn a_valid_compound_file_opens_and_reads() {
        let bytes = valid_compound_file(&[("/__substg1.0_0037001F", b"subject bytes")]);
        let mut compound = open_compound_file(&bytes).expect("valid container opens");
        assert!(compound.exists("/__substg1.0_0037001F"));
        // Walking every entry and reading every stream stays panic-free and bounded.
        let paths: Vec<_> = compound
            .walk()
            .filter(|entry| entry.is_stream())
            .map(|entry| entry.path().to_path_buf())
            .collect();
        for path in paths {
            let mut sink = Vec::new();
            std::io::copy(&mut compound.open_stream(&path).unwrap(), &mut sink).unwrap();
        }
    }

    /// Zero-length input carries no header. Must be a clean `Err`, never a panic.
    #[test]
    fn empty_input_is_malformed() {
        assert!(matches!(
            open_compound_file(&[]),
            Err(EmailError::Malformed)
        ));
    }

    /// Fewer bytes than a CFB header. The length pre-check must reject it.
    #[test]
    fn input_shorter_than_a_header_is_malformed() {
        assert!(matches!(
            open_compound_file(&[0u8; 16]),
            Err(EmailError::Malformed)
        ));
        // The CFB magic alone, with nothing behind it.
        let magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        assert!(matches!(
            open_compound_file(&magic),
            Err(EmailError::Malformed)
        ));
    }

    /// The correct magic followed by garbage where the header fields belong:
    /// wrong byte-order mark / version / sector shift are all rejected, not
    /// panicked on.
    #[test]
    fn valid_magic_then_garbage_header_is_malformed() {
        let mut bytes = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        bytes.extend(std::iter::repeat(0xFFu8).take(512 - 8));
        assert!(matches!(
            open_compound_file(&bytes),
            Err(EmailError::Malformed)
        ));
    }

    /// An absurd declared stream length in a directory entry must not become an
    /// allocation sized by that number, nor a panic — the read is bounded by the
    /// real chain, and an over-long declaration simply fails the read as `Err`.
    /// Here we corrupt the directory sector's stream-length field of a real file
    /// to `u64::MAX` and confirm the container still either opens-and-bounds or
    /// cleanly rejects, without aborting.
    #[test]
    fn an_absurd_declared_stream_length_does_not_panic() {
        let bytes = valid_compound_file(&[("/payload", &[7u8; 200])]);
        // Sweep the whole file writing 0xFF over each 8-byte window that could be
        // read as a length; opening (and walking, when it opens) must never panic.
        for offset in (512..bytes.len().saturating_sub(8)).step_by(8) {
            let mut corrupt = bytes.clone();
            for byte in &mut corrupt[offset..offset + 8] {
                *byte = 0xFF;
            }
            if let Ok(mut compound) = open_compound_file(&corrupt) {
                let paths: Vec<_> = compound
                    .walk()
                    .filter(|entry| entry.is_stream())
                    .map(|entry| entry.path().to_path_buf())
                    .collect();
                for path in paths {
                    // A bounded read: cap the copy so even a mis-declared length
                    // cannot pull unbounded bytes, and swallow read errors.
                    let mut sink = Vec::new();
                    if let Ok(stream) = compound.open_stream(&path) {
                        let _ = std::io::copy(&mut stream.take(1 << 20), &mut sink);
                    }
                }
            }
        }
    }

    /// Truncation sweep: every prefix of a valid container must open-or-`Err`,
    /// never panic. This is the single most productive shape for surfacing
    /// off-by-one slice reads in a container parser.
    #[test]
    fn every_truncated_prefix_is_handled_without_panicking() {
        let bytes = valid_compound_file(&[("/a", b"alpha"), ("/b", b"beta")]);
        for len in 0..bytes.len() {
            // The result is unimportant; the requirement is that it returns.
            let _ = open_compound_file(&bytes[..len]);
        }
    }

    /// Bit-flip sweep across the header and directory region: flipping any single
    /// bit must keep open (and a subsequent bounded walk/read) panic-free.
    #[test]
    fn single_bit_flips_across_the_structure_never_panic() {
        let bytes = valid_compound_file(&[("/a", b"alpha"), ("/b", &[0u8; 300])]);
        // The header is the first sector; the directory and FAT follow. Cover the
        // structural region generously without walking the entire payload.
        let region = bytes.len().min(2048);
        for byte_index in 0..region {
            for bit in 0..8u8 {
                let mut corrupt = bytes.clone();
                corrupt[byte_index] ^= 1 << bit;
                if let Ok(mut compound) = open_compound_file(&corrupt) {
                    let paths: Vec<_> = compound
                        .walk()
                        .filter(|entry| entry.is_stream())
                        .map(|entry| entry.path().to_path_buf())
                        .collect();
                    for path in paths {
                        let mut sink = Vec::new();
                        if let Ok(stream) = compound.open_stream(&path) {
                            let _ = std::io::copy(&mut stream.take(1 << 20), &mut sink);
                        }
                    }
                }
            }
        }
    }
}
