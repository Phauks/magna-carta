use crate::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};
use sha2::{Digest, Sha512};
use std::io::{Cursor, Read};

/// hashcat mode for ECMA-376 agile-encrypted Office 2013+ documents (`$office$*2013*…`).
const HASHCAT_MODE_OFFICE_AGILE: u32 = 9600;

/// Upper bound on `spinCount` accepted from untrusted OOXML input. The ECMA-376 default
/// is 100 000; values above this constant are rejected before the iterative SHA-512 loop
/// to prevent an attacker from inducing CPU-exhaustion via a crafted large spin count.
const MAX_SPIN_COUNT: u32 = 10_000_000;

/// Fixed block keys from MS-OFFCRYPTO §2.3.4.13. Each is concatenated onto the iterative
/// password hash before a final SHA-512 to derive the AES key for one of the two verifier
/// blobs — `Hblock = SHA512(H ‖ blockKey)`, first `key_bits/8` bytes taken as the key.
const BLOCK_KEY_VERIFIER_HASH_INPUT: [u8; 8] = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_KEY_VERIFIER_HASH_VALUE: [u8; 8] = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];

/// Adapter for password-protected OOXML documents (Word, Excel, PowerPoint — `.docx`,
/// `.xlsx`, `.pptx`). An encrypted OOXML file is an OLE2/CFB compound document whose
/// `EncryptedPackage` stream wraps the real inner ZIP archive.
pub struct OoxmlAdapter;

impl OoxmlAdapter {
    /// Decrypt a password-protected OOXML document and return the inner ZIP bytes.
    ///
    /// Supported cipher: ECMA-376 Agile Encryption (AES-256-CBC / SHA-512), the scheme
    /// used by all modern Office files. Standard-encryption variants (AES-ECB / SHA-1)
    /// are forwarded as `DecryptError::Unsupported`.
    ///
    /// # Password verification
    ///
    /// `office-crypto` derives the session key from the supplied password and decrypts
    /// the package without first running the ECMA-376 password verifier. A wrong password
    /// therefore produces garbage bytes rather than an explicit error. This implementation
    /// detects the condition post-decryption: every valid OOXML file is a ZIP archive and
    /// starts with the `PK\x03\x04` local-file-header signature. Absent that signature,
    /// the result is treated as a wrong-password signal and `DecryptError::WrongPassword`
    /// is returned.
    ///
    /// A known limitation is that a genuinely corrupt ciphertext that nonetheless omits
    /// the ZIP magic is indistinguishable from a wrong password at this level. A planned
    /// improvement is to implement the ECMA-376 verifier hash check directly so that the
    /// error is raised before decryption rather than after.
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        // Guard against office-crypto 0.2's unsigned-subtraction underflow.
        //
        // office-crypto's AgileEncryptionInfo::decrypt reads a 4-byte little-endian
        // total_size from the start of the EncryptedPackage stream content and then
        // evaluates `total_size - SEGMENT_LENGTH` (SEGMENT_LENGTH = 4096) as usize
        // arithmetic with no prior bounds check. When total_size < 4096 the subtraction
        // underflows: in debug builds this panics immediately; in release builds it wraps
        // to a near-maximal usize and the ensuing loop reads far beyond the buffer, which
        // also panics. An attacker who uploads a syntactically valid OLE2/CFB file with a
        // tiny EncryptedPackage stream can crash the process on demand.
        //
        // The airtight fix is to replace office-crypto with an implementation that uses
        // checked or saturating arithmetic. This guard is the defensive perimeter until
        // that replacement is made: it opens the compound file independently with the
        // `cfb` crate, verifies that both required streams are present, reads the 4-byte
        // total_size prefix from EncryptedPackage, and rejects any value below 4096
        // before office-crypto ever sees the bytes.
        {
            let cursor = Cursor::new(bytes);
            let mut compound_file = cfb::CompoundFile::open(cursor).map_err(|error| {
                DecryptError::Malformed(format!("not a valid OLE2/CFB compound file: {error}"))
            })?;

            if !compound_file.is_stream("/EncryptionInfo") {
                return Err(DecryptError::NotEncrypted);
            }
            if !compound_file.is_stream("/EncryptedPackage") {
                return Err(DecryptError::Malformed(
                    "OLE2 compound file is missing the required EncryptedPackage stream".to_owned(),
                ));
            }

            // Read the 8-byte header of the EncryptedPackage stream. Bytes [0..4]
            // hold the plaintext total_size as a u32 little-endian integer — the
            // exact quantity that office-crypto subtracts 4096 from without a
            // bounds check.
            let mut prefix = [0u8; 8];
            let bytes_read = compound_file
                .open_stream("/EncryptedPackage")
                .map_err(|error| {
                    DecryptError::Malformed(format!("cannot open EncryptedPackage stream: {error}"))
                })?
                .read(&mut prefix)
                .map_err(|error| {
                    DecryptError::Malformed(format!(
                        "cannot read EncryptedPackage stream prefix: {error}"
                    ))
                })?;

            if bytes_read < 4 {
                return Err(DecryptError::Malformed(
                    "EncryptedPackage stream is too short to contain a valid size prefix"
                        .to_owned(),
                ));
            }

            let total_size =
                u32::from_le_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;

            // 4096 matches SEGMENT_LENGTH in office-crypto's AgileEncryptionInfo::decrypt.
            if total_size < 4096 {
                return Err(DecryptError::Malformed(
                    "EncryptedPackage total_size is smaller than one decryption segment \
                     (4096 bytes) and cannot represent a valid agile-encrypted package"
                        .to_owned(),
                ));
            }
        }

        match office_crypto::decrypt_from_bytes(bytes.to_vec(), password) {
            Ok(plain) if plain.starts_with(b"PK\x03\x04") => Ok(DecryptedFile {
                bytes: plain,
                filename_hint: None,
            }),
            Ok(_) => {
                // office-crypto skips the ECMA-376 password-verifier step, so a wrong
                // password produces garbage output without signalling an error. The
                // absent ZIP magic is the distinguishing signal.
                Err(DecryptError::WrongPassword)
            }
            Err(office_crypto::DecryptError::Unimplemented(message)) => {
                Err(DecryptError::Unsupported(message))
            }
            Err(error) => Err(DecryptError::Malformed(error.to_string())),
        }
    }

    /// Parse a hashcat `$office$*2013*…` agile hash back into `KdfParams::OoxmlAgile`, the
    /// inverse of the string built by `extract_hash`, so a caller holding only the hash can
    /// still drive `verify_guess`.
    ///
    /// Layout: `$office$*2013*<spinCount>*<keyBits>*<saltSize>*<salt>*<encVerifierHashInput>*
    /// <encVerifierHashValue>`, the last three hex-encoded.
    ///
    /// Errors with `ExtractError::Unsupported` for a non-`$office$` prefix or a non-`2013`
    /// version tag, and `ExtractError::Malformed` for any structural problem (too few fields,
    /// non-numeric counts, bad hex, or a salt whose length disagrees with the size field).
    pub fn parse_hash(hash: &str) -> Result<KdfParams, ExtractError> {
        let inner = hash.strip_prefix("$office$*").ok_or_else(|| {
            ExtractError::Unsupported("only the $office$ (agile) hash is parseable".into())
        })?;

        let fields: Vec<&str> = inner.split('*').collect();
        if fields.len() < 7 {
            return Err(ExtractError::Malformed("too few $office$ fields".into()));
        }
        if fields[0] != "2013" {
            return Err(ExtractError::Unsupported(format!(
                "$office$ version {} is not agile (2013)",
                fields[0]
            )));
        }

        let spin_count = fields[1]
            .parse::<u32>()
            .map_err(|_| ExtractError::Malformed("spin count is not an integer".into()))?;
        if spin_count > MAX_SPIN_COUNT {
            return Err(ExtractError::Unsupported(format!(
                "spinCount {spin_count} exceeds maximum {MAX_SPIN_COUNT}"
            )));
        }
        let key_bits = fields[2]
            .parse::<u32>()
            .map_err(|_| ExtractError::Malformed("key bits is not an integer".into()))?;
        let salt_size = fields[3]
            .parse::<usize>()
            .map_err(|_| ExtractError::Malformed("salt size is not an integer".into()))?;

        let salt = crate::hex::decode(fields[4])
            .ok_or_else(|| ExtractError::Malformed("invalid hex in salt".into()))?;
        if salt.len() != salt_size {
            return Err(ExtractError::Malformed(format!(
                "salt is {} bytes, size field declares {salt_size}",
                salt.len()
            )));
        }
        let enc_verifier_hash_input = crate::hex::decode(fields[5])
            .ok_or_else(|| ExtractError::Malformed("invalid hex in verifier hash input".into()))?;
        let enc_verifier_hash_value = crate::hex::decode(fields[6])
            .ok_or_else(|| ExtractError::Malformed("invalid hex in verifier hash value".into()))?;

        Ok(KdfParams::OoxmlAgile {
            spin_count,
            key_bits,
            salt,
            enc_verifier_hash_input,
            enc_verifier_hash_value,
        })
    }

    /// Read the `EncryptionInfo` stream of an encrypted OOXML document and emit the hashcat
    /// `$office$*2013*…` hash string plus the matching mode and parsed agile key-derivation
    /// parameters.
    ///
    /// The compound document is opened with `cfb`; the agile descriptor is the UTF-8 XML that
    /// follows the 8-byte version/flags header. The `spinCount`, `keyBits`, `saltValue`,
    /// `encryptedVerifierHashInput`, and `encryptedVerifierHashValue` are read off the
    /// password `encryptedKey` element — never the separate `keyData` element, whose
    /// `saltValue` belongs to the package cipher.
    ///
    /// Errors:
    /// - `ExtractError::NotEncrypted` — the file has no `EncryptionInfo` stream.
    /// - `ExtractError::Unsupported` — the `EncryptionInfo` is not agile (version 4.4).
    /// - `ExtractError::Malformed`   — the bytes are not an OLE2/CFB file, or the descriptor
    ///   is structurally broken (short header, non-UTF-8, missing element/attribute, bad
    ///   base64).
    pub fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
        let cursor = Cursor::new(bytes);
        let mut compound_file = cfb::CompoundFile::open(cursor).map_err(|error| {
            ExtractError::Malformed(format!("not a valid OLE2/CFB file: {error}"))
        })?;

        if !compound_file.is_stream("/EncryptionInfo") {
            return Err(ExtractError::NotEncrypted);
        }

        let mut raw = Vec::new();
        compound_file
            .open_stream("/EncryptionInfo")
            .map_err(|error| {
                ExtractError::Malformed(format!("cannot open EncryptionInfo stream: {error}"))
            })?
            .read_to_end(&mut raw)
            .map_err(|error| {
                ExtractError::Malformed(format!("cannot read EncryptionInfo stream: {error}"))
            })?;

        // Header: version major (2) + minor (2) + reserved flags (4) = 8 bytes. Agile
        // encryption is version 4.4; the descriptor XML follows the header.
        let header = raw.get(..8).ok_or_else(|| {
            ExtractError::Malformed("EncryptionInfo is shorter than 8 bytes".into())
        })?;
        let version_major = u16::from_le_bytes([header[0], header[1]]);
        let version_minor = u16::from_le_bytes([header[2], header[3]]);
        if (version_major, version_minor) != (4, 4) {
            return Err(ExtractError::Unsupported(format!(
                "EncryptionInfo version {version_major}.{version_minor} is not agile (4.4)"
            )));
        }

        let xml = std::str::from_utf8(&raw[8..])
            .map_err(|_| ExtractError::Malformed("agile descriptor is not valid UTF-8".into()))?;
        let element = encrypted_key_element(xml).ok_or_else(|| {
            ExtractError::Malformed("EncryptionInfo has no password encryptedKey element".into())
        })?;

        let attr = |name: &str| -> Result<&str, ExtractError> {
            attribute_value(element, name)
                .ok_or_else(|| ExtractError::Malformed(format!("encryptedKey lacks {name}")))
        };
        let parse_u32 = |name: &str, text: &str| -> Result<u32, ExtractError> {
            text.parse::<u32>()
                .map_err(|_| ExtractError::Malformed(format!("{name} is not an integer")))
        };

        let spin_count = parse_u32("spinCount", attr("spinCount")?)?;
        if spin_count > MAX_SPIN_COUNT {
            return Err(ExtractError::Unsupported(format!(
                "spinCount {spin_count} exceeds maximum {MAX_SPIN_COUNT}"
            )));
        }
        let key_bits = parse_u32("keyBits", attr("keyBits")?)?;
        let salt = base64_decode(attr("saltValue")?)
            .ok_or_else(|| ExtractError::Malformed("invalid base64 in saltValue".into()))?;
        let enc_verifier_hash_input = base64_decode(attr("encryptedVerifierHashInput")?)
            .ok_or_else(|| {
                ExtractError::Malformed("invalid base64 in encryptedVerifierHashInput".into())
            })?;
        let enc_verifier_hash_value = base64_decode(attr("encryptedVerifierHashValue")?)
            .ok_or_else(|| {
                ExtractError::Malformed("invalid base64 in encryptedVerifierHashValue".into())
            })?;

        let hash = format!(
            "$office$*2013*{spin_count}*{key_bits}*{}*{}*{}*{}",
            salt.len(),
            crate::hex::encode(&salt),
            crate::hex::encode(&enc_verifier_hash_input),
            crate::hex::encode(&enc_verifier_hash_value),
        );

        Ok(RecoveryJob {
            format: Format::Ooxml,
            hash,
            hashcat_mode: HASHCAT_MODE_OFFICE_AGILE,
            params: KdfParams::OoxmlAgile {
                spin_count,
                key_bits,
                salt,
                enc_verifier_hash_input,
                enc_verifier_hash_value,
            },
        })
    }

    /// Test a single candidate password against an agile recovery job without touching the
    /// original document. Returns `true` when the candidate authenticates.
    ///
    /// Returns `false` for any non-agile job or malformed parameters (a salt too short to
    /// supply the 16-byte IV, a verifier blob whose length is not a whole number of AES
    /// blocks, or a key length the AES-256 path cannot accept) — a failed guess and an
    /// unusable job are both "not a match" to the caller's cracking loop. Never panics.
    pub fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool {
        match &job.params {
            KdfParams::OoxmlAgile {
                spin_count,
                key_bits,
                salt,
                enc_verifier_hash_input,
                enc_verifier_hash_value,
            } => verify_agile(
                *spin_count,
                *key_bits,
                salt,
                enc_verifier_hash_input,
                enc_verifier_hash_value,
                candidate,
            ),
            _ => false,
        }
    }
}

impl FormatAdapter for OoxmlAdapter {
    fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        OoxmlAdapter::strip_with_key(bytes, password)
    }

    fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
        OoxmlAdapter::extract_hash(bytes)
    }

    fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool {
        OoxmlAdapter::verify_guess(job, candidate)
    }
}

/// Slice out the password `encryptedKey` element from the agile descriptor XML.
///
/// The `encryptedVerifierHashValue` attribute appears only on the password `encryptedKey`,
/// so it anchors the element unambiguously — scanning for `saltValue` directly would risk
/// matching the unrelated `keyData` salt. The element runs from the `<` before the anchor to
/// the next `>`; attribute values never contain `>`, so the bound is exact.
fn encrypted_key_element(xml: &str) -> Option<&str> {
    let anchor = xml.find("encryptedVerifierHashValue")?;
    let start = xml.get(..anchor)?.rfind('<')?;
    let relative_end = xml.get(anchor..)?.find('>')?;
    let end = anchor.checked_add(relative_end)?.checked_add(1)?;
    xml.get(start..end)
}

/// Read the value of attribute `name` from a single XML element, e.g. `name="value"`.
///
/// A leading-boundary check (the character before the match must not be alphanumeric)
/// prevents a shorter name from matching inside a longer one. Returns `None` if the
/// attribute is absent or its quoted value is unterminated — never panics.
fn attribute_value<'a>(element: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let mut from = 0usize;
    loop {
        let position = element.get(from..)?.find(&needle)?.checked_add(from)?;
        let boundary_ok = position == 0
            || !element
                .as_bytes()
                .get(position - 1)
                .is_some_and(u8::is_ascii_alphanumeric);
        if boundary_ok {
            let value_start = position.checked_add(needle.len())?;
            let rest = element.get(value_start..)?;
            let value_end = rest.find('"')?;
            return rest.get(..value_end);
        }
        from = position.checked_add(needle.len())?;
    }
}

/// Decode standard base64 (alphabet `A–Za–z0–9+/`, optional `=` padding), ignoring ASCII
/// whitespace. Returns `None` on any character outside the alphabet so malformed,
/// attacker-controlled descriptors fail cleanly rather than panicking. Hand-rolled to avoid
/// promoting the transitive `base64` crate to a direct dependency.
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let sextet = |byte: u8| -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some(u32::from(byte - b'A')),
            b'a'..=b'z' => Some(u32::from(byte - b'a' + 26)),
            b'0'..=b'9' => Some(u32::from(byte - b'0' + 52)),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };

    let mut output = Vec::with_capacity(input.len() / 4 * 3);
    let mut accumulator = 0u32;
    let mut bits = 0u32;
    for byte in input.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        accumulator = (accumulator << 6) | sextet(byte)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
        }
    }
    Some(output)
}

/// Encode a string as little-endian UTF-16, the password form MS-OFFCRYPTO feeds into the
/// iterative hash.
fn utf16le(text: &str) -> Vec<u8> {
    let mut output = Vec::with_capacity(text.len() * 2);
    for unit in text.encode_utf16() {
        output.extend_from_slice(&unit.to_le_bytes());
    }
    output
}

/// The MS-OFFCRYPTO iterative password hash: `H0 = SHA512(salt ‖ UTF16LE(password))`, then
/// `Hn = SHA512(LE_u32(n) ‖ H(n-1))` for `spin_count` rounds. Returns the 64-byte digest.
fn iterative_hash(salt: &[u8], password: &str, spin_count: u32) -> Vec<u8> {
    let mut digest = {
        let mut hasher = Sha512::new();
        hasher.update(salt);
        hasher.update(utf16le(password));
        hasher.finalize()
    };
    for round in 0..spin_count {
        let mut hasher = Sha512::new();
        hasher.update(round.to_le_bytes());
        hasher.update(digest);
        digest = hasher.finalize();
    }
    digest.to_vec()
}

/// Derive one AES key: `SHA512(base ‖ blockKey)` truncated to `key_bytes`.
fn derive_block_key(base: &[u8], block_key: &[u8], key_bytes: usize) -> Vec<u8> {
    let mut hasher = Sha512::new();
    hasher.update(base);
    hasher.update(block_key);
    let digest = hasher.finalize();
    digest
        .get(..key_bytes)
        .map(<[u8]>::to_vec)
        .unwrap_or_default()
}

/// AES-256-CBC decrypt with no padding. Returns `None` on a wrong key/IV length or a
/// ciphertext that is not a whole number of 16-byte blocks — never panics.
fn aes256_cbc_decrypt(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Option<Vec<u8>> {
    use cbc::cipher::{block_padding::NoPadding, BlockDecryptMut, KeyIvInit};

    if ciphertext.is_empty() || !ciphertext.len().is_multiple_of(16) {
        return None;
    }
    let decryptor = cbc::Decryptor::<aes::Aes256>::new_from_slices(key, iv).ok()?;
    let mut buffer = ciphertext.to_vec();
    let plaintext = decryptor
        .decrypt_padded_mut::<NoPadding>(&mut buffer)
        .ok()?;
    let length = plaintext.len();
    buffer.truncate(length);
    Some(buffer)
}

/// The full ECMA-376 agile verifier check: derive the two block keys from the iterative
/// hash, AES-256-CBC-decrypt both verifier blobs with the salt as IV, and confirm the
/// SHA-512 of the decrypted input equals the decrypted value over the value's length.
fn verify_agile(
    spin_count: u32,
    key_bits: u32,
    salt: &[u8],
    enc_verifier_hash_input: &[u8],
    enc_verifier_hash_value: &[u8],
    password: &str,
) -> bool {
    let key_bytes = (key_bits / 8) as usize;
    let Some(iv) = salt.get(..16) else {
        return false;
    };

    let base = iterative_hash(salt, password, spin_count);
    let key_input = derive_block_key(&base, &BLOCK_KEY_VERIFIER_HASH_INPUT, key_bytes);
    let key_value = derive_block_key(&base, &BLOCK_KEY_VERIFIER_HASH_VALUE, key_bytes);

    let Some(decrypted_input) = aes256_cbc_decrypt(&key_input, iv, enc_verifier_hash_input) else {
        return false;
    };
    let Some(decrypted_value) = aes256_cbc_decrypt(&key_value, iv, enc_verifier_hash_value) else {
        return false;
    };

    let computed = {
        let mut hasher = Sha512::new();
        hasher.update(&decrypted_input);
        hasher.finalize()
    };

    // The stored verifier hash value is the SHA-512 of the verifier input, truncated by
    // hashcat's format to 32 bytes or carried full at 64. Compare over its length; a value
    // longer than one SHA-512 digest cannot be a match.
    match computed.get(..decrypted_value.len()) {
        Some(prefix) => prefix == decrypted_value.as_slice(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ms_offcrypto_writer::Ecma376AgileWriter;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// Build a plaintext OOXML-compatible ZIP in memory, then encrypt it with
    /// ECMA-376 Agile encryption (password `password`). The result is an OLE2/CFB
    /// compound document suitable for round-trip testing.
    ///
    /// The inner ZIP must exceed one encryption segment (4 096 bytes) because
    /// office-crypto 0.2 contains an unsigned subtraction that panics in debug
    /// builds when `total_size` < `SEGMENT_LENGTH`. A large padding entry is
    /// included to guarantee the threshold is met.
    fn make_encrypted_ooxml(password: &str) -> Vec<u8> {
        // Inner ZIP: [Content_Types].xml + a stored (uncompressed) padding entry to
        // push the ZIP byte size over 4096 bytes. STORED mode is required because
        // Deflate would shrink the padding to a few bytes, leaving total_size < 4096.
        let inner_zip = {
            let buffer = Cursor::new(Vec::new());
            let mut writer = ZipWriter::new(buffer);

            writer
                .start_file("[Content_Types].xml", SimpleFileOptions::default())
                .expect("zip: start_file");
            writer
                .write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                    <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>")
                .expect("zip: write_all");

            // 8 192 bytes STORED so the ZIP byte size >= 8 192 + overhead.
            // This guarantees total_size > 4096 (office-crypto 0.2 panics on
            // an unsigned underflow when the plaintext is smaller than one 4096-byte
            // decryption segment).
            writer
                .start_file(
                    "pad.bin",
                    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
                )
                .expect("zip: start pad");
            writer.write_all(&[0u8; 8192]).expect("zip: write pad");

            writer.finish().expect("zip: finish").into_inner()
        };

        // Encrypt the inner ZIP with ECMA-376 Agile (AES-256 / SHA-512).
        let mut output = Cursor::new(Vec::new());
        {
            let mut writer = Ecma376AgileWriter::create(&mut rand::rng(), password, &mut output)
                .expect("ooxml: create writer");
            writer
                .write_all(&inner_zip)
                .expect("ooxml: write inner zip");
            writer.finalize().expect("ooxml: finalize");
        }
        output.into_inner()
    }

    // hashcat `example_hashes` mode 9600 (MS Office 2013 agile, `$office$`); the password
    // for every hashcat example vector is "hashcat". Layout:
    // $office$*2013*spinCount*keyBits*saltSize*salt*encVerifierHashInput*encVerifierHashValue.
    // Source: https://hashcat.net/wiki/doku.php?id=example_hashes
    const OFFICE_2013_EXAMPLE: &str = "$office$*2013*100000*256*16*7dd611d7eb4c899f74816d1dec817b3b*948dc0b2c2c6c32f14b5995a543ad037*0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895";

    #[test]
    fn verifies_known_agile_password() {
        let params =
            OoxmlAdapter::parse_hash(OFFICE_2013_EXAMPLE).expect("parses the example hash");
        let job = crate::RecoveryJob {
            format: crate::Format::Ooxml,
            hash: OFFICE_2013_EXAMPLE.into(),
            hashcat_mode: 9600,
            params,
        };
        assert!(
            OoxmlAdapter::verify_guess(&job, "hashcat"),
            "the ECMA-376 agile verifier must accept the published password"
        );
        assert!(
            !OoxmlAdapter::verify_guess(&job, "nope"),
            "a wrong guess must not authenticate"
        );
    }

    #[test]
    fn parse_hash_reads_office_layout() {
        let KdfParams::OoxmlAgile {
            spin_count,
            key_bits,
            salt,
            enc_verifier_hash_input,
            enc_verifier_hash_value,
        } = OoxmlAdapter::parse_hash(OFFICE_2013_EXAMPLE).expect("parses")
        else {
            panic!("expected an OoxmlAgile variant");
        };
        assert_eq!(spin_count, 100_000);
        assert_eq!(key_bits, 256);
        assert_eq!(salt.len(), 16);
        assert_eq!(enc_verifier_hash_input.len(), 16);
        assert_eq!(enc_verifier_hash_value.len(), 32);
    }

    #[test]
    fn parse_hash_rejects_malformed_without_panicking() {
        for bad in [
            "",
            "$pdf$nope",
            "$office$*2013*100000*256*16",            // too few fields
            "$office$*2007*100000*256*16*aa*bb*cc",   // unsupported version
            "$office$*2013*x*256*16*aa*bb*cc",        // non-numeric spin count
            "$office$*2013*100000*256*16*zz*bb*cc",   // non-hex salt
            "$office$*2013*100000*256*99*aabb*bb*cc", // salt size disagrees with salt
        ] {
            assert!(
                OoxmlAdapter::parse_hash(bad).is_err(),
                "parse_hash must reject {bad:?}"
            );
        }
    }

    #[test]
    fn extract_hash_round_trips() {
        let encrypted = make_encrypted_ooxml("test");
        let job = OoxmlAdapter::extract_hash(&encrypted).expect("extracts");
        assert_eq!(job.hashcat_mode, 9600);
        assert!(job.hash.starts_with("$office$*2013*"));
        assert!(
            OoxmlAdapter::verify_guess(&job, "test"),
            "the fixture password must verify on the agile path"
        );
        assert!(
            !OoxmlAdapter::verify_guess(&job, "no"),
            "a wrong guess must not authenticate"
        );
    }

    #[test]
    fn verify_guess_is_false_for_garbage_params() {
        let job = crate::RecoveryJob {
            format: crate::Format::Ooxml,
            hash: String::new(),
            hashcat_mode: 9600,
            params: KdfParams::OoxmlAgile {
                spin_count: 1,
                key_bits: 256,
                salt: Vec::new(),
                enc_verifier_hash_input: Vec::new(),
                enc_verifier_hash_value: Vec::new(),
            },
        };
        assert!(!OoxmlAdapter::verify_guess(&job, "any"));

        let placeholder = crate::RecoveryJob {
            format: crate::Format::Ooxml,
            hash: String::new(),
            hashcat_mode: 0,
            params: KdfParams::Placeholder,
        };
        assert!(!OoxmlAdapter::verify_guess(&placeholder, "any"));
    }

    #[test]
    fn extract_hash_rejects_non_ole2_bytes() {
        assert!(matches!(
            OoxmlAdapter::extract_hash(b"not an OLE2 file at all"),
            Err(ExtractError::Malformed(_))
        ));
    }

    #[test]
    fn strips_agile_with_correct_password() {
        let encrypted = make_encrypted_ooxml("test");
        // Sanity: the writer produced a real OLE2 container.
        assert_eq!(
            crate::detect(&encrypted),
            Some(crate::Format::Ooxml),
            "encrypted file must be detected as Ooxml (OLE2 magic)"
        );
        let out = OoxmlAdapter::strip_with_key(&encrypted, "test").expect("decrypts");
        assert!(
            out.bytes.starts_with(b"PK\x03\x04"),
            "decrypted output must start with ZIP local-file-header magic"
        );
    }

    #[test]
    fn rejects_wrong_password() {
        let encrypted = make_encrypted_ooxml("test");
        assert!(
            matches!(
                OoxmlAdapter::strip_with_key(&encrypted, "x").unwrap_err(),
                crate::DecryptError::WrongPassword
            ),
            "wrong password must yield DecryptError::WrongPassword"
        );
    }

    /// Regression test: a crafted OLE2/CFB file with a tiny EncryptedPackage
    /// total_size must be rejected as `Malformed` without panicking.
    ///
    /// office-crypto 0.2 evaluates `total_size - 4096` as usize arithmetic with
    /// no bounds check. When total_size < 4096 the subtraction underflows and
    /// panics in debug builds. This test verifies the guard catches such inputs
    /// before they reach office-crypto.
    #[test]
    fn rejects_tiny_encrypted_package_without_panicking() {
        // Build a minimal OLE2/CFB compound file containing both required streams
        // but with an EncryptedPackage whose 4-byte total_size prefix declares
        // only 16 bytes — far below the 4096-byte segment boundary.
        let malicious_bytes = {
            let buffer = Cursor::new(Vec::new());
            let mut compound_file =
                cfb::CompoundFile::create(buffer).expect("cfb: create compound file");

            {
                let mut stream = compound_file
                    .create_stream("/EncryptionInfo")
                    .expect("cfb: create EncryptionInfo stream");
                // Minimal placeholder — the guard only checks stream presence,
                // not content, so any bytes will do here.
                stream
                    .write_all(b"\x04\x00\x04\x00placeholder")
                    .expect("cfb: write EncryptionInfo");
            }

            {
                let mut stream = compound_file
                    .create_stream("/EncryptedPackage")
                    .expect("cfb: create EncryptedPackage stream");
                // 8-byte prefix: bytes [0..4] = total_size = 16 as u32 LE,
                // bytes [4..8] = zero extension. office-crypto reads total_size
                // from [0..4] and computes `16usize - 4096usize`, which panics
                // in debug mode. The guard must catch this before that happens.
                let mut prefix = [0u8; 24];
                prefix[0..4].copy_from_slice(&16u32.to_le_bytes());
                stream
                    .write_all(&prefix)
                    .expect("cfb: write EncryptedPackage");
            }

            compound_file.into_inner().into_inner()
        };

        assert!(
            matches!(
                OoxmlAdapter::strip_with_key(&malicious_bytes, "test").unwrap_err(),
                crate::DecryptError::Malformed(_)
            ),
            "a tiny EncryptedPackage total_size must be rejected as Malformed, not panic"
        );
    }

    /// Regression: a `$office$` hash string with an absurdly large spinCount must be
    /// rejected as `ExtractError::Unsupported` rather than feeding the iterative SHA-512
    /// loop with billions of rounds (CPU-exhaustion DoS on untrusted input).
    #[test]
    fn parse_hash_rejects_excessive_spin_count() {
        // Reuse the known-good layout from OFFICE_2013_EXAMPLE but replace the
        // spinCount field (100 000) with 100 000 000 — ten times the MAX_SPIN_COUNT cap.
        let excessive = "$office$*2013*100000000*256*16*7dd611d7eb4c899f74816d1dec817b3b*948dc0b2c2c6c32f14b5995a543ad037*0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895";
        assert!(
            matches!(
                OoxmlAdapter::parse_hash(excessive),
                Err(ExtractError::Unsupported(_))
            ),
            "parse_hash must reject spinCount=100_000_000 as Unsupported (DoS guard)"
        );
    }
}
