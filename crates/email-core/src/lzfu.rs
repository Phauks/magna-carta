//! LZFu decompression for a .msg's compressed RTF body (PidTagRtfCompressed),
//! per [MS-OXRTFCP]. A compression codec: compressed bytes in, RTF bytes out, with
//! no CFB or MAPI knowledge, so it is testable in isolation. It runs on
//! attacker-controlled bytes in an isolate that cannot unwind, so it never indexes
//! out of bounds, never trusts a declared length for allocation, and turns every
//! structural fault into an ordinary error instead of a panic.

use crate::error::EmailError;

const MAGIC_COMPRESSED: u32 = 0x7546_5a4c; // "LZFu"
const MAGIC_UNCOMPRESSED: u32 = 0x414c_454d; // "MELA"

const RING_SIZE: usize = 4096;

/// The ring buffer is preloaded with this fixed RTF preamble so back-references
/// save space from the first byte; the write cursor starts just past it. Exactly
/// 207 bytes. VERIFY against [MS-OXRTFCP] section 2.1.1 (the preset dictionary) —
/// one wrong byte corrupts every dictionary-referenced run, which the worked-example
/// test guards.
const DICTIONARY: &[u8] = b"{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

/// Decompress a `.msg` compressed-RTF stream into RTF text. `max_output` bounds the
/// decompressed size against a decompression bomb; the header's declared raw size is
/// never used to size an allocation.
pub(crate) fn decompress_rtf(bytes: &[u8], max_output: usize) -> Result<String, EmailError> {
    // 16-byte little-endian header: COMPSIZE, RAWSIZE, COMPTYPE, CRC.
    if bytes.len() < 16 {
        return Err(EmailError::Malformed);
    }
    let comp_size = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    // RAWSIZE (bytes[4..8]) is attacker-controlled and deliberately not used for allocation.
    let magic = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    // CRC (bytes[12..16]) is not validated: safety comes from bounding the output and
    // the end marker, not from the checksum.

    // COMPSIZE counts everything after itself, so the stream is COMPSIZE + 4 bytes.
    let declared_end = comp_size.checked_add(4).ok_or(EmailError::Malformed)?;
    if declared_end < 16 || declared_end > bytes.len() {
        return Err(EmailError::Malformed);
    }
    let contents = &bytes[16..declared_end];

    match magic {
        MAGIC_UNCOMPRESSED => {
            let end = contents.len().min(max_output);
            Ok(String::from_utf8_lossy(&contents[..end]).into_owned())
        }
        MAGIC_COMPRESSED => decompress_lzfu(contents, max_output),
        _ => Err(EmailError::Malformed),
    }
}

fn decompress_lzfu(contents: &[u8], max_output: usize) -> Result<String, EmailError> {
    let mut ring = [0u8; RING_SIZE];
    ring[..DICTIONARY.len()].copy_from_slice(DICTIONARY);
    let mut write = DICTIONARY.len() & (RING_SIZE - 1); // cursor, always masked
    let mut out: Vec<u8> = Vec::new();
    let mut pos = 0usize;

    // Emit one byte to both the output and the ring, enforcing the output cap.
    fn emit(
        byte: u8,
        out: &mut Vec<u8>,
        ring: &mut [u8; RING_SIZE],
        write: &mut usize,
        max_output: usize,
    ) -> Result<(), EmailError> {
        if out.len() >= max_output {
            return Err(EmailError::Malformed); // decompression bomb: stop, do not grow
        }
        out.push(byte);
        ring[*write] = byte;
        *write = (*write + 1) & (RING_SIZE - 1);
        Ok(())
    }

    loop {
        let Some(&control) = contents.get(pos) else {
            return Ok(String::from_utf8_lossy(&out).into_owned());
        };
        pos += 1;
        for bit in 0..8 {
            if (control >> bit) & 1 == 0 {
                // Literal.
                let Some(&literal) = contents.get(pos) else {
                    return Ok(String::from_utf8_lossy(&out).into_owned());
                };
                pos += 1;
                emit(literal, &mut out, &mut ring, &mut write, max_output)?;
            } else {
                // Two-byte reference: offset (12 bits) and length (low nibble + 2).
                let (Some(&b1), Some(&b2)) = (contents.get(pos), contents.get(pos + 1)) else {
                    return Ok(String::from_utf8_lossy(&out).into_owned());
                };
                pos += 2;
                let offset = ((b1 as usize) << 4) | ((b2 as usize) >> 4);
                let length = ((b2 as usize) & 0x0F) + 2;
                if offset == write {
                    // A reference to the current write cursor marks end of stream.
                    return Ok(String::from_utf8_lossy(&out).into_owned());
                }
                for i in 0..length {
                    let byte = ring[(offset + i) & (RING_SIZE - 1)];
                    emit(byte, &mut out, &mut ring, &mut write, max_output)?;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Build a 16-byte little-endian header for CONTENTS of the given length and magic.
    fn header(contents_len: usize, raw_size: u32, magic: u32) -> Vec<u8> {
        // COMPSIZE counts RAWSIZE(4) + COMPTYPE(4) + CRC(4) + contents.
        let comp_size = (12 + contents_len) as u32;
        let mut header = Vec::new();
        header.extend_from_slice(&comp_size.to_le_bytes());
        header.extend_from_slice(&raw_size.to_le_bytes());
        header.extend_from_slice(&magic.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes()); // CRC, ignored
        header
    }

    #[test]
    fn the_preset_dictionary_is_exactly_207_bytes() {
        assert_eq!(DICTIONARY.len(), 207);
    }

    #[test]
    fn stored_uncompressed_contents_are_returned_verbatim() {
        let contents = b"{\\rtf1 plain}";
        let mut stream = header(contents.len(), contents.len() as u32, MAGIC_UNCOMPRESSED);
        stream.extend_from_slice(contents);
        assert_eq!(decompress_rtf(&stream, 1 << 20).unwrap(), "{\\rtf1 plain}");
    }

    #[test]
    fn an_all_literal_compressed_stream_decodes_to_its_literal_bytes() {
        // Control byte 0x00 => the next 8 units are literals. Emit "ABCDEFGH", then a
        // second control byte 0x00 with the end handled by input exhaustion.
        let mut contents = vec![0x00u8];
        contents.extend_from_slice(b"ABCDEFGH");
        let mut stream = header(contents.len(), 8, MAGIC_COMPRESSED);
        stream.extend_from_slice(&contents);
        assert_eq!(decompress_rtf(&stream, 1 << 20).unwrap(), "ABCDEFGH");
    }

    #[test]
    fn a_header_shorter_than_16_bytes_is_malformed() {
        assert!(decompress_rtf(&[0x00; 8], 1 << 20).is_err());
    }

    #[test]
    fn an_unknown_magic_is_malformed() {
        let contents = b"x";
        let mut stream = header(contents.len(), 1, 0xDEAD_BEEF);
        stream.extend_from_slice(contents);
        assert!(decompress_rtf(&stream, 1 << 20).is_err());
    }

    #[test]
    fn a_comp_size_claiming_more_than_the_buffer_holds_is_malformed() {
        // COMPSIZE says there are 100 contents bytes, but none are present.
        let mut stream = 112u32.to_le_bytes().to_vec(); // comp_size = 12 + 100
        stream.extend_from_slice(&0u32.to_le_bytes()); // raw
        stream.extend_from_slice(&MAGIC_COMPRESSED.to_le_bytes());
        stream.extend_from_slice(&0u32.to_le_bytes()); // crc
        assert!(decompress_rtf(&stream, 1 << 20).is_err());
    }

    #[test]
    fn a_literal_stream_past_the_output_cap_is_refused_not_unbounded() {
        // 8 literals but max_output = 4 => the cap fires, no panic, bounded.
        let mut contents = vec![0x00u8];
        contents.extend_from_slice(b"ABCDEFGH");
        let mut stream = header(contents.len(), 8, MAGIC_COMPRESSED);
        stream.extend_from_slice(&contents);
        assert!(matches!(
            decompress_rtf(&stream, 4),
            Err(EmailError::Malformed)
        ));
    }

    #[test]
    fn truncated_mid_chunk_stops_gracefully_without_panic() {
        // Control byte says 8 literals, but only 3 bytes follow: finish with what we have.
        let mut contents = vec![0x00u8];
        contents.extend_from_slice(b"ABC");
        let mut stream = header(contents.len(), 8, MAGIC_COMPRESSED);
        stream.extend_from_slice(&contents);
        assert_eq!(decompress_rtf(&stream, 1 << 20).unwrap(), "ABC");
    }

    #[test]
    fn the_spec_worked_example_decompresses_correctly() {
        // Compressed bytes and expected output taken verbatim from the reference LZFu
        // implementation's own test suite (delimitry/compressed_rtf, tests/tests.py,
        // Test.test_decompress), which itself cites the [MS-OXRTFCP] compression
        // algorithm document. This vector exercises real dictionary back-references
        // (the header, "\\ansi", "\\pard" all come from ring positions inside
        // DICTIONARY, not literals), so a wrong dictionary byte fails this test.
        const COMPRESSED: &[u8] = &[
            0x2d, 0x00, 0x00, 0x00, 0x2b, 0x00, 0x00, 0x00, 0x4c, 0x5a, 0x46, 0x75, 0xf1, 0xc5,
            0xc7, 0xa7, 0x03, 0x00, 0x0a, 0x00, 0x72, 0x63, 0x70, 0x67, 0x31, 0x32, 0x35, 0x42,
            0x32, 0x0a, 0xf3, 0x20, 0x68, 0x65, 0x6c, 0x09, 0x00, 0x20, 0x62, 0x77, 0x05, 0xb0,
            0x6c, 0x64, 0x7d, 0x0a, 0x80, 0x0f, 0xa0,
        ];
        const EXPECTED: &str = "{\\rtf1\\ansi\\ansicpg1252\\pard hello world}\r\n";
        assert_eq!(decompress_rtf(COMPRESSED, 1 << 20).unwrap(), EXPECTED);
    }

    #[test]
    fn arbitrary_bytes_never_panic() {
        // A spread of hostile shapes: empty, sub-header, every magic, random-ish bodies.
        for len in 0..64usize {
            let filler: Vec<u8> = (0..len).map(|i| (i as u8).wrapping_mul(31)).collect();
            let _ = decompress_rtf(&filler, 1 << 16);
        }
        // Valid-looking headers with hostile contents.
        for magic in [MAGIC_COMPRESSED, MAGIC_UNCOMPRESSED, 0u32] {
            let mut stream = Vec::new();
            stream.extend_from_slice(&64u32.to_le_bytes());
            stream.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // absurd raw size
            stream.extend_from_slice(&magic.to_le_bytes());
            stream.extend_from_slice(&0u32.to_le_bytes());
            stream.extend(std::iter::repeat_n(0xFFu8, 52));
            let _ = decompress_rtf(&stream, 1 << 16);
        }
    }
}
