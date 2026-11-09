use crate::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};
use pbkdf2::pbkdf2_hmac;
use sha1::Sha1;
use std::io::{Cursor, Read};
use zip::result::ZipError;
use zip::{CompressionMethod, ZipArchive};

/// WinZip-AES derives its keys with PBKDF2-HMAC-SHA1 at a fixed 1000 iterations.
const AES_PBKDF2_ROUNDS: u32 = 1000;

/// hashcat mode for WinZip-AES (`$zip2$`).
const HASHCAT_MODE_WINZIP_AES: u32 = 13600;
/// hashcat mode for ZipCrypto where the entry payload is deflate-compressed (`$pkzip2$`).
const HASHCAT_MODE_PKZIP_COMPRESSED: u32 = 17200;
/// hashcat mode for ZipCrypto where the entry payload is stored uncompressed.
const HASHCAT_MODE_PKZIP_STORED: u32 = 17210;

pub struct ZipAdapter;

impl ZipAdapter {
    /// Decrypt the first entry of a password-protected ZIP archive and return the plaintext bytes.
    ///
    /// Supports both WinZip-AES (AES-128 and AES-256) and legacy ZipCrypto encryption. For a
    /// single-entry archive the decrypted entry bytes are returned directly along with the entry
    /// name. Only the first entry is processed.
    ///
    /// Errors:
    /// - `DecryptError::WrongPassword` — the supplied password does not authenticate.
    /// - `DecryptError::Malformed`     — the bytes cannot be parsed as a ZIP archive.
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        let cursor = Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|error| DecryptError::Malformed(error.to_string()))?;

        let mut entry = archive
            .by_index_decrypt(0, password.as_bytes())
            .map_err(|error| match error {
                ZipError::InvalidPassword => DecryptError::WrongPassword,
                other => DecryptError::Malformed(other.to_string()),
            })?;

        let filename_hint = Some(
            entry
                .name()
                .map(std::borrow::Cow::into_owned)
                .unwrap_or_else(|_| String::from_utf8_lossy(entry.name_raw()).into_owned()),
        );
        let mut plaintext = Vec::new();
        entry
            .read_to_end(&mut plaintext)
            .map_err(|error| DecryptError::Malformed(error.to_string()))?;

        Ok(DecryptedFile {
            bytes: plaintext,
            filename_hint,
        })
    }

    /// Parse a `$zip2$` WinZip-AES hash string back into `KdfParams::ZipAes`, the inverse
    /// of the string built by `extract_hash`, so a caller holding only the hash can still
    /// drive `verify_guess`.
    ///
    /// The legacy ZipCrypto `$pkzip2$` string is not reversible to the 12-byte encryption
    /// header through these fields, so only `$zip2$` is accepted here; a ZipCrypto job is
    /// driven from the `KdfParams` that `extract_hash` returns directly.
    ///
    /// Errors with `ExtractError::Malformed` on any structural problem (too few fields,
    /// non-numeric mode, bad hex, or a salt/verifier whose length is wrong for the mode),
    /// and `ExtractError::Unsupported` for a non-`$zip2$` prefix or an AES mode outside 1-3.
    pub fn parse_hash(hash: &str) -> Result<KdfParams, ExtractError> {
        let inner = hash
            .strip_prefix("$zip2$")
            .and_then(|rest| rest.strip_suffix("$/zip2$"))
            .ok_or_else(|| {
                ExtractError::Unsupported("only the $zip2$ (WinZip-AES) hash is parseable".into())
            })?;

        // Layout: Ty*Mo*Ma*Sa*Va*Le*DF*Au. Only the mode, salt, and 2-byte verifier are
        // needed to test a password; the ciphertext, length, and HMAC are ignored.
        let fields: Vec<&str> = inner.trim_matches('*').split('*').collect();
        if fields.len() < 5 {
            return Err(ExtractError::Malformed("too few $zip2$ fields".into()));
        }

        let strength = fields[1]
            .parse::<u8>()
            .map_err(|_| ExtractError::Malformed("mode field is not an integer".into()))?;
        let key_len = aes_key_len(strength)
            .ok_or_else(|| ExtractError::Unsupported(format!("AES mode {strength}")))?;

        let salt = crate::hex::decode(fields[3])
            .ok_or_else(|| ExtractError::Malformed("invalid hex field".into()))?;
        if salt.len() != key_len / 2 {
            return Err(ExtractError::Malformed(format!(
                "salt is {} bytes, expected {} for AES mode {strength}",
                salt.len(),
                key_len / 2
            )));
        }

        let verifier_bytes = crate::hex::decode(fields[4])
            .ok_or_else(|| ExtractError::Malformed("invalid hex field".into()))?;
        let verifier: [u8; 2] = verifier_bytes
            .as_slice()
            .try_into()
            .map_err(|_| ExtractError::Malformed("verifier must be 2 bytes".into()))?;

        Ok(KdfParams::ZipAes {
            strength,
            salt,
            verifier,
        })
    }

    /// Read the first encrypted entry of a ZIP archive and emit the John/hashcat hash
    /// string plus the matching hashcat mode and parsed key-derivation parameters.
    ///
    /// WinZip-AES entries produce a `$zip2$` string (hashcat mode 13600); legacy ZipCrypto
    /// entries produce a `$pkzip2$` string (modes 17200/17210). The `zip` crate locates the
    /// entry through the central directory, but the crypto header (AES salt and verifier,
    /// or the 12-byte ZipCrypto header) is read straight from the raw bytes — the crate
    /// does not expose it.
    ///
    /// Errors:
    /// - `ExtractError::NotEncrypted` — no entry is encrypted.
    /// - `ExtractError::Unsupported` — an AES strength byte outside 1-3.
    /// - `ExtractError::Malformed`   — the bytes are not a ZIP, or a header field runs past
    ///   the end of the buffer.
    pub fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| ExtractError::Malformed(error.to_string()))?;

        // Walk the central directory for the first encrypted entry, capturing the
        // authoritative metadata (CRC and sizes) that a local header leaves zeroed when a
        // data descriptor is used. The raw accessor never attempts decryption.
        let mut found: Option<EntryMeta> = None;
        for index in 0..archive.len() {
            let entry = archive
                .by_index_raw(index)
                .map_err(|error| ExtractError::Malformed(error.to_string()))?;
            if entry.encrypted() {
                let header_start = usize::try_from(entry.header_start()).map_err(|_| {
                    ExtractError::Malformed("local header offset out of range".into())
                })?;
                found = Some(EntryMeta {
                    header_start,
                    crc32: entry.crc32(),
                    compressed_size: entry.compressed_size(),
                    stored: entry.compression() == CompressionMethod::Stored,
                });
                break;
            }
        }

        let meta = found.ok_or(ExtractError::NotEncrypted)?;
        parse_encrypted_entry(bytes, &meta)
    }

    /// Test a single candidate password against a ZIP recovery job without touching the
    /// original archive. Returns `true` when the candidate authenticates.
    ///
    /// Returns `false` for any non-ZIP job, an unmodelled AES strength, or a malformed
    /// salt length — a failed guess and an unusable job are both "not a match" to the
    /// caller's cracking loop. ZipCrypto's check carries an inherent ~1-in-256 false-accept
    /// rate; a full decrypt confirms a survivor.
    pub fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool {
        match &job.params {
            KdfParams::ZipAes {
                strength,
                salt,
                verifier,
            } => verify_aes(*strength, salt, verifier, candidate.as_bytes()),
            KdfParams::ZipCrypto { header12, crc_high } => {
                verify_zipcrypto(header12, *crc_high, candidate.as_bytes())
            }
            _ => false,
        }
    }
}

/// Central-directory metadata for the first encrypted entry, gathered before the raw
/// local-header parse.
struct EntryMeta {
    header_start: usize,
    crc32: u32,
    compressed_size: u64,
    stored: bool,
}

/// AES key length in bytes for a WinZip strength byte (1/2/3 select 16/24/32); the PBKDF2
/// salt is half this length. Returns `None` for any other strength.
fn aes_key_len(strength: u8) -> Option<usize> {
    match strength {
        1 => Some(16),
        2 => Some(24),
        3 => Some(32),
        _ => None,
    }
}

/// Validate a candidate against a WinZip-AES job: derive `2*key_len + 2` bytes with
/// PBKDF2-HMAC-SHA1 and compare the trailing two bytes against the stored verifier.
fn verify_aes(strength: u8, salt: &[u8], verifier: &[u8; 2], password: &[u8]) -> bool {
    let Some(key_len) = aes_key_len(strength) else {
        return false;
    };
    // A salt that is not half the key length is a malformed job that can never match.
    if salt.len() != key_len / 2 {
        return false;
    }
    // Derived bytes: encryption key (key_len) || MAC key (key_len) || 2-byte verifier.
    let mut derived = vec![0u8; key_len * 2 + 2];
    pbkdf2_hmac::<Sha1>(password, salt, AES_PBKDF2_ROUNDS, &mut derived);
    &derived[key_len * 2..] == verifier.as_slice()
}

/// IEEE CRC-32 lookup table (polynomial 0xEDB88320), built at compile time. The ZipCrypto
/// key schedule advances two of its three key words by a single CRC-32 step.
const CRC32_TABLE: [u32; 256] = build_crc32_table();

const fn build_crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut index = 0usize;
    while index < 256 {
        let mut crc = index as u32;
        let mut bit = 0;
        while bit < 8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
            bit += 1;
        }
        table[index] = crc;
        index += 1;
    }
    table
}

/// One CRC-32 update step: `crc = (crc >> 8) ^ table[(crc ^ byte) & 0xff]`.
fn crc32_step(crc: u32, byte: u8) -> u32 {
    (crc >> 8) ^ CRC32_TABLE[((crc ^ u32::from(byte)) & 0xff) as usize]
}

/// The three 32-bit words of the ZipCrypto key state (PKWARE APPNOTE `update_keys`).
struct ZipCryptoKeys {
    key0: u32,
    key1: u32,
    key2: u32,
}

impl ZipCryptoKeys {
    fn new() -> Self {
        Self {
            key0: 0x1234_5678,
            key1: 0x2345_6789,
            key2: 0x3456_7890,
        }
    }

    fn update(&mut self, byte: u8) {
        self.key0 = crc32_step(self.key0, byte);
        self.key1 = self
            .key1
            .wrapping_add(self.key0 & 0xff)
            .wrapping_mul(134_775_813)
            .wrapping_add(1);
        self.key2 = crc32_step(self.key2, (self.key1 >> 24) as u8);
    }

    /// The next keystream byte. The 16-bit `temp` is widened to 32 bits before the
    /// multiply so bits 8..15 of the full product are taken — the product always fits in
    /// 32 bits, matching the PKWARE reference's `(temp * (temp ^ 1)) >> 8`.
    fn keystream_byte(&self) -> u8 {
        let temp = u32::from((self.key2 as u16) | 2);
        (temp.wrapping_mul(temp ^ 1) >> 8) as u8
    }
}

/// Validate a candidate against a ZipCrypto job: run the key schedule over the password,
/// decrypt the stored 12-byte header, and compare the final decrypted byte to the expected
/// check byte.
fn verify_zipcrypto(header12: &[u8; 12], crc_high: u8, password: &[u8]) -> bool {
    let mut keys = ZipCryptoKeys::new();
    for &byte in password {
        keys.update(byte);
    }
    let mut last = 0u8;
    for &cipher in header12 {
        let plain = cipher ^ keys.keystream_byte();
        keys.update(plain);
        last = plain;
    }
    last == crc_high
}

/// Read a little-endian `u16`/`u32` at `offset`, returning `None` if it would run past the
/// end of the buffer — every header field on attacker-controlled bytes goes through these.
fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    let slice = bytes.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Parse the local file header at `meta.header_start` and dispatch to the AES or ZipCrypto
/// builder. The 30-byte fixed header plus the two length fields are always present even
/// when a data descriptor zeroes the CRC and sizes, so the data offset is computed from
/// them directly.
fn parse_encrypted_entry(bytes: &[u8], meta: &EntryMeta) -> Result<RecoveryJob, ExtractError> {
    let header_start = meta.header_start;

    // The local file header signature guards every offset that follows it.
    if read_u32_le(bytes, header_start) != Some(0x0403_4b50) {
        return Err(ExtractError::Malformed(
            "local file header signature missing".into(),
        ));
    }
    let truncated = || ExtractError::Malformed("truncated local header".into());
    let general_purpose = read_u16_le(bytes, header_start + 6).ok_or_else(truncated)?;
    let dos_time = read_u16_le(bytes, header_start + 10).ok_or_else(truncated)?;
    let dos_date = read_u16_le(bytes, header_start + 12).ok_or_else(truncated)?;
    let name_len = usize::from(read_u16_le(bytes, header_start + 26).ok_or_else(truncated)?);
    let extra_len = usize::from(read_u16_le(bytes, header_start + 28).ok_or_else(truncated)?);

    let overflow = || ExtractError::Malformed("local header length overflow".into());
    let extra_start = header_start
        .checked_add(30)
        .and_then(|value| value.checked_add(name_len))
        .ok_or_else(overflow)?;
    let data_start = extra_start.checked_add(extra_len).ok_or_else(overflow)?;

    let extra = bytes
        .get(extra_start..data_start)
        .ok_or_else(|| ExtractError::Malformed("extra field out of bounds".into()))?;

    // A `0x9901` extra field marks WinZip-AES and carries the strength byte; its absence on
    // an encrypted entry means legacy ZipCrypto.
    if let Some(strength) = aes_strength_from_extra(extra) {
        build_aes_job(bytes, meta, data_start, strength)
    } else {
        build_zipcrypto_job(bytes, meta, data_start, general_purpose, dos_time, dos_date)
    }
}

/// Walk the extra-field TLV list for the WinZip-AES header (id `0x9901`) and return its AES
/// strength byte. The 7-byte payload is vendor version (2) || "AE" (2) || strength (1) ||
/// real compression method (2).
fn aes_strength_from_extra(extra: &[u8]) -> Option<u8> {
    let mut offset = 0usize;
    while offset + 4 <= extra.len() {
        let id = u16::from_le_bytes([extra[offset], extra[offset + 1]]);
        let size = usize::from(u16::from_le_bytes([extra[offset + 2], extra[offset + 3]]));
        let payload_start = offset + 4;
        let payload_end = payload_start.checked_add(size)?;
        if payload_end > extra.len() {
            break;
        }
        if id == 0x9901 {
            // The strength byte sits after the 2-byte vendor version and 2-byte "AE" id.
            return extra.get(payload_start + 4).copied();
        }
        offset = payload_end;
    }
    None
}

/// Build a `$zip2$` job from a WinZip-AES entry: the data is salt || 2-byte verifier ||
/// AES-CTR ciphertext || 10-byte HMAC-SHA1.
fn build_aes_job(
    bytes: &[u8],
    meta: &EntryMeta,
    data_start: usize,
    strength: u8,
) -> Result<RecoveryJob, ExtractError> {
    let key_len = aes_key_len(strength)
        .ok_or_else(|| ExtractError::Unsupported(format!("AES strength {strength}")))?;
    let salt_len = key_len / 2;

    let salt = bytes
        .get(data_start..data_start.saturating_add(salt_len))
        .filter(|slice| slice.len() == salt_len)
        .ok_or_else(|| ExtractError::Malformed("salt out of bounds".into()))?
        .to_vec();

    let verifier_start = data_start + salt_len;
    let verifier: [u8; 2] = bytes
        .get(verifier_start..verifier_start.saturating_add(2))
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| ExtractError::Malformed("verifier out of bounds".into()))?;

    let compressed = usize::try_from(meta.compressed_size)
        .map_err(|_| ExtractError::Malformed("compressed size out of range".into()))?;
    let data_end = data_start
        .checked_add(compressed)
        .ok_or_else(|| ExtractError::Malformed("entry length overflow".into()))?;
    let cipher_start = verifier_start + 2;
    if data_end > bytes.len() || data_end < cipher_start + 10 {
        return Err(ExtractError::Malformed(
            "encrypted entry is truncated".into(),
        ));
    }
    let ciphertext = &bytes[cipher_start..data_end - 10];
    let auth = &bytes[data_end - 10..data_end];

    let hash = format!(
        "$zip2$*0*{strength}*0*{}*{}*{:x}*{}*{}*$/zip2$",
        crate::hex::encode(&salt),
        crate::hex::encode(&verifier),
        ciphertext.len(),
        crate::hex::encode(ciphertext),
        crate::hex::encode(auth),
    );

    Ok(RecoveryJob {
        format: Format::Zip,
        hash,
        hashcat_mode: HASHCAT_MODE_WINZIP_AES,
        params: KdfParams::ZipAes {
            strength,
            salt,
            verifier,
        },
    })
}

/// Build a `$pkzip2$` job from a legacy ZipCrypto entry. The 12-byte encryption header
/// drives `verify_guess`; the check byte is the high byte of the CRC-32, except an entry
/// written with a data descriptor (general-purpose bit 3) checks against the high byte of
/// the DOS modification time instead, because its CRC is unknown when the header is built.
fn build_zipcrypto_job(
    bytes: &[u8],
    meta: &EntryMeta,
    data_start: usize,
    general_purpose: u16,
    dos_time: u16,
    dos_date: u16,
) -> Result<RecoveryJob, ExtractError> {
    let header12: [u8; 12] = bytes
        .get(data_start..data_start.saturating_add(12))
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| ExtractError::Malformed("encryption header out of bounds".into()))?;

    let uses_data_descriptor = general_purpose & 0x0008 != 0;
    let crc_high = if uses_data_descriptor {
        (dos_time >> 8) as u8
    } else {
        (meta.crc32 >> 24) as u8
    };

    let hashcat_mode = if meta.stored {
        HASHCAT_MODE_PKZIP_STORED
    } else {
        HASHCAT_MODE_PKZIP_COMPRESSED
    };
    let hash = format_pkzip2(bytes, meta, data_start, dos_date)?;

    Ok(RecoveryJob {
        format: Format::Zip,
        hash,
        hashcat_mode,
        params: KdfParams::ZipCrypto { header12, crc_high },
    })
}

/// Build the hashcat `$pkzip2$` token for a single ZipCrypto entry, following hashcat's
/// documented single-file layout (count, checksum size, data/magic enums, compressed and
/// uncompressed lengths, CRC, offsets, compression type, data length, the CRC-derived and
/// timestamp-derived 2-byte magics, and the inline encrypted data). The recovery path that
/// actually tests passwords is `verify_guess` over `KdfParams::ZipCrypto`.
fn format_pkzip2(
    bytes: &[u8],
    meta: &EntryMeta,
    data_start: usize,
    dos_date: u16,
) -> Result<String, ExtractError> {
    let compressed = usize::try_from(meta.compressed_size)
        .map_err(|_| ExtractError::Malformed("compressed size out of range".into()))?;
    let data_end = data_start
        .checked_add(compressed)
        .ok_or_else(|| ExtractError::Malformed("entry length overflow".into()))?;
    let data = bytes
        .get(data_start..data_end)
        .ok_or_else(|| ExtractError::Malformed("encrypted entry is truncated".into()))?;

    let compression_type = if meta.stored { 0 } else { 8 };
    let crc_magic = (meta.crc32 >> 16) & 0xffff;
    let timestamp_magic = u32::from(dos_date);

    Ok(format!(
        "$pkzip2$1*1*2*0*{:x}*{:x}*{:08x}*0*0*{}*{:x}*{:04x}*{:04x}*{}*$/pkzip2$",
        data.len(),
        data.len(),
        meta.crc32,
        compression_type,
        data.len(),
        crc_magic,
        timestamp_magic,
        crate::hex::encode(data),
    ))
}

impl FormatAdapter for ZipAdapter {
    fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        ZipAdapter::strip_with_key(bytes, password)
    }

    fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
        ZipAdapter::extract_hash(bytes)
    }

    fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool {
        ZipAdapter::verify_guess(job, candidate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::unstable::write::FileOptionsExt;
    use zip::write::SimpleFileOptions;
    use zip::{AesMode, ZipWriter};

    /// Build an in-memory AES-256-encrypted ZIP with one entry `hello.txt` = `b"hello\n"`.
    fn make_aes_zip(password: &str) -> Vec<u8> {
        let buffer = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(buffer);
        let options = SimpleFileOptions::default().with_aes_encryption(AesMode::Aes256, password);
        writer.start_file("hello.txt", options).expect("start_file");
        writer.write_all(b"hello\n").expect("write");
        writer.finish().expect("finish").into_inner()
    }

    /// Build an in-memory ZipCrypto-encrypted ZIP with one entry `hello.txt` = `b"hello\n"`.
    fn make_zipcrypto_zip(password: &[u8]) -> Vec<u8> {
        let buffer = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(buffer);
        let options = SimpleFileOptions::default()
            .with_deprecated_encryption(password)
            .expect("zipcrypto options");
        writer.start_file("hello.txt", options).expect("start_file");
        writer.write_all(b"hello\n").expect("write");
        writer.finish().expect("finish").into_inner()
    }

    #[test]
    fn strips_aes_with_correct_password() {
        let zip_bytes = make_aes_zip("test");
        let out = ZipAdapter::strip_with_key(&zip_bytes, "test").expect("decrypts");
        assert_eq!(out.bytes, b"hello\n");
        assert_eq!(out.filename_hint.as_deref(), Some("hello.txt"));
    }

    #[test]
    fn strips_zipcrypto_with_correct_password() {
        let zip_bytes = make_zipcrypto_zip(b"test");
        let out = ZipAdapter::strip_with_key(&zip_bytes, "test").expect("decrypts");
        assert_eq!(out.bytes, b"hello\n");
        assert_eq!(out.filename_hint.as_deref(), Some("hello.txt"));
    }

    #[test]
    fn rejects_wrong_password_aes() {
        let zip_bytes = make_aes_zip("test");
        assert!(
            matches!(
                ZipAdapter::strip_with_key(&zip_bytes, "wrong").unwrap_err(),
                crate::DecryptError::WrongPassword
            ),
            "expected WrongPassword for bad AES password"
        );
    }

    // hashcat `example_hashes` mode 13600 (WinZip-AES, `$zip2$`); the password for every
    // hashcat example vector is "hashcat". Mode field 3 selects AES-256, so the salt is
    // 16 bytes and the 2-byte verifier is the published "1320".
    const ZIP2_EXAMPLE: &str = "$zip2$*0*3*0*e3222d3b65b5a2785b192d31e39ff9de*1320*e*19648c3e063c82a9ad3ef08ed833*3135c79ecb86cd6f48fc*$/zip2$";

    #[test]
    fn verifies_known_winzip_aes_password() {
        let params = ZipAdapter::parse_hash(ZIP2_EXAMPLE).expect("parses the example hash");
        let job = crate::RecoveryJob {
            format: crate::Format::Zip,
            hash: ZIP2_EXAMPLE.into(),
            hashcat_mode: 13600,
            params,
        };
        assert!(
            ZipAdapter::verify_guess(&job, "hashcat"),
            "PBKDF2-HMAC-SHA1 must accept the published WinZip-AES password"
        );
        assert!(
            !ZipAdapter::verify_guess(&job, "nope"),
            "a wrong guess must not authenticate"
        );
    }

    #[test]
    fn parse_hash_reads_zip2_layout() {
        let KdfParams::ZipAes {
            strength,
            salt,
            verifier,
        } = ZipAdapter::parse_hash(ZIP2_EXAMPLE).expect("parses")
        else {
            panic!("expected a WinZip-AES variant");
        };
        assert_eq!(strength, 3, "mode field 3 is AES-256");
        assert_eq!(salt.len(), 16, "AES-256 carries a 16-byte salt");
        assert_eq!(verifier, [0x13, 0x20]);
    }

    #[test]
    fn extract_hash_round_trips_aes() {
        let zip_bytes = make_aes_zip("test");
        let job = ZipAdapter::extract_hash(&zip_bytes).expect("extracts");
        assert_eq!(job.hashcat_mode, 13600);
        assert!(job.hash.starts_with("$zip2$"));
        assert!(
            ZipAdapter::verify_guess(&job, "test"),
            "the fixture password must verify on the WinZip-AES path"
        );
        assert!(!ZipAdapter::verify_guess(&job, "no"));
    }

    #[test]
    fn extract_hash_round_trips_zipcrypto() {
        let zip_bytes = make_zipcrypto_zip(b"test");
        let job = ZipAdapter::extract_hash(&zip_bytes).expect("extracts");
        assert!(
            ZipAdapter::verify_guess(&job, "test"),
            "the fixture password must verify on the ZipCrypto path"
        );
        assert!(!ZipAdapter::verify_guess(&job, "no"));
    }

    #[test]
    fn extract_hash_rejects_unencrypted_zip() {
        let buffer = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(buffer);
        writer
            .start_file("plain.txt", SimpleFileOptions::default())
            .expect("start_file");
        writer.write_all(b"hello\n").expect("write");
        let zip_bytes = writer.finish().expect("finish").into_inner();
        assert!(matches!(
            ZipAdapter::extract_hash(&zip_bytes),
            Err(ExtractError::NotEncrypted)
        ));
    }

    #[test]
    fn parse_hash_rejects_non_ascii_hex_field_without_panicking() {
        // The salt field receives "€€" (U+20AC twice = 6 UTF-8 bytes, even byte count).
        // The former byte-offset &str slice `text[0..2]` panicked on char-boundary
        // violation; hex::decode operates on raw bytes and returns None → Err, no panic.
        let hash = "$zip2$*0*3*0*€€*1320*e*aa*bb*$/zip2$";
        assert!(
            ZipAdapter::parse_hash(hash).is_err(),
            "parse_hash must return Err, not panic, on non-ASCII in the salt field"
        );
    }

    #[test]
    fn parse_hash_rejects_malformed_without_panicking() {
        // Truncated, wrong-prefix, bad-hex, and inconsistent-length strings must all
        // return an error rather than panic on attacker-controlled input.
        for bad in [
            "",
            "$pdf$nope",
            "$zip2$*0*3*0*$/zip2$",
            "$zip2$*0*9*0*e3222d3b*1320*e*aa*bb*$/zip2$", // strength 9 is invalid
            "$zip2$*0*3*0*zz*1320*e*aa*bb*$/zip2$",       // non-hex salt
            "$zip2$*0*3*0*e3222d3b65b5a2785b192d31e39ff9de*13*e*aa*bb*$/zip2$", // 1-byte verifier
        ] {
            assert!(
                ZipAdapter::parse_hash(bad).is_err(),
                "parse_hash must reject {bad:?}"
            );
        }
    }

    #[test]
    fn verify_guess_is_false_for_garbage_and_short_buffers() {
        // A directly constructed job with an out-of-range strength or an empty salt must
        // make verify_guess return false, never panic.
        let job = crate::RecoveryJob {
            format: crate::Format::Zip,
            hash: String::new(),
            hashcat_mode: 13600,
            params: KdfParams::ZipAes {
                strength: 9,
                salt: Vec::new(),
                verifier: [0, 0],
            },
        };
        assert!(!ZipAdapter::verify_guess(&job, "any"));

        let placeholder = crate::RecoveryJob {
            format: crate::Format::Zip,
            hash: String::new(),
            hashcat_mode: 0,
            params: KdfParams::Placeholder,
        };
        assert!(!ZipAdapter::verify_guess(&placeholder, "any"));
    }

    #[test]
    fn extract_hash_rejects_non_zip_bytes() {
        assert!(matches!(
            ZipAdapter::extract_hash(b"not a zip at all"),
            Err(ExtractError::Malformed(_))
        ));
    }
}
