use crate::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};
use sha1::Sha1;
use sha2::{Digest, Sha512};
use std::io::{Cursor, Read};

/// hashcat mode for ECMA-376 agile-encrypted Office 2013+ documents (`$office$*2013*…`).
const HASHCAT_MODE_OFFICE_AGILE: u32 = 9600;

/// Upper bound on `spinCount` accepted from untrusted OOXML input. The ECMA-376 default
/// is 100 000; values above this constant are rejected before the iterative SHA-512 loop
/// to prevent an attacker from inducing CPU-exhaustion via a crafted large spin count.
const MAX_SPIN_COUNT: u32 = 10_000_000;

/// Upper bound on the `EncryptionInfo` stream accepted from an untrusted OOXML container.
///
/// The agile descriptor is XML, and every scan this module performs over it — locating an
/// element, then reading each attribute off it — is linear in the descriptor's length. That is
/// cheap at any plausible size, but "cheap per byte" still scales with the uploaded file when
/// the size is unbounded, and this parser sits directly on attacker-supplied bytes. Capping the
/// stream makes the cost of reading a descriptor a constant of this module rather than a
/// function of what someone chose to upload.
///
/// A real ECMA-376 agile descriptor is one to two kilobytes; even a certificate-bearing
/// `keyEncryptor` list stays far below this cap. 64 KiB therefore accepts every legitimate
/// document while keeping descriptor parsing bounded at well under a millisecond.
///
/// This is the same defensive-perimeter pattern as the `EncryptedPackage` size-prefix and
/// stream-length guards in `strip_with_key`: establish that the untrusted structure is within
/// bounds before spending work proportional to what it claims about itself.
const MAX_ENCRYPTION_INFO_BYTES: u64 = 64 * 1024;

/// Fixed block keys from MS-OFFCRYPTO §2.3.4.13. Each is concatenated onto the iterative
/// password hash before a final SHA-512 to derive the AES key for one of the two verifier
/// blobs — `Hblock = SHA512(H ‖ blockKey)`, first `key_bits/8` bytes taken as the key.
const BLOCK_KEY_VERIFIER_HASH_INPUT: [u8; 8] = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_KEY_VERIFIER_HASH_VALUE: [u8; 8] = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];

/// The third documented block key, used the same way to derive the AES key that unwraps
/// `encryptedKeyValue` into the session key the package itself is encrypted under.
const BLOCK_KEY_ENCRYPTED_KEY_VALUE: [u8; 8] = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];

/// MS-OFFCRYPTO agile encryption splits the package into fixed 4096-byte plaintext segments,
/// each encrypted under the session key with its own initialization vector derived from the
/// segment index. The final segment is short whenever the plaintext is not a whole multiple.
const SEGMENT_LENGTH: usize = 4096;

/// The AES block size in bytes — the unit every ciphertext length here must be a multiple of,
/// and the length of a derived initialization vector.
const AES_BLOCK_BYTES: usize = 16;

/// The `EncryptedPackage` stream begins with a 64-bit little-endian plaintext length, followed
/// by the ciphertext.
const PACKAGE_SIZE_PREFIX_BYTES: usize = 8;

/// ECMA-376 standard encryption fixes the iteration count of its SHA-1 password hash at 50 000;
/// unlike agile encryption there is no `spinCount` to read, so nothing here is attacker-chosen.
const STANDARD_SPIN_COUNT: u32 = 50_000;

/// `AlgID` values from the standard-encryption header. The AES identifiers select the key
/// length; the RC4 identifier marks the legacy CryptoAPI cipher this module refuses.
const ALGORITHM_IDENTIFIER_UNSPECIFIED: u32 = 0x0000_0000;
const ALGORITHM_IDENTIFIER_AES_128: u32 = 0x0000_660e;
const ALGORITHM_IDENTIFIER_AES_192: u32 = 0x0000_660f;
const ALGORITHM_IDENTIFIER_AES_256: u32 = 0x0000_6610;
const ALGORITHM_IDENTIFIER_RC4: u32 = 0x0000_6801;

/// `AlgIDHash` for SHA-1, the only hash ECMA-376 standard encryption uses.
const HASH_IDENTIFIER_SHA1: u32 = 0x0000_8004;

/// The SHA-1 digest length, which is also the standard-encryption `VerifierHashSize`.
const SHA1_DIGEST_BYTES: usize = 20;

/// Adapter for password-protected OOXML documents (Word, Excel, PowerPoint — `.docx`,
/// `.xlsx`, `.pptx`). An encrypted OOXML file is an OLE2/CFB compound document whose
/// `EncryptedPackage` stream wraps the real inner ZIP archive.
pub struct OoxmlAdapter;

impl OoxmlAdapter {
    /// Decrypt a password-protected OOXML document and return the inner ZIP bytes.
    ///
    /// Two ECMA-376 encryption schemes are accepted:
    ///
    /// * **Agile encryption** (`EncryptionInfo` version 4.4) — AES-CBC under a session key,
    ///   SHA-512 password hash, package split into independently chained segments. Every
    ///   Office release since 2010 writes this.
    /// * **Standard encryption** (version 2.2, 3.2, or 4.2) — AES-ECB directly under the
    ///   password-derived key, SHA-1 password hash. Written by Office 2007.
    ///
    /// Anything else is refused as `DecryptError::Unsupported` with the variant named. That
    /// includes standard encryption's RC4 CryptoAPI cipher: a legacy 40-to-128-bit stream
    /// cipher no supported Office version writes, deliberately not implemented here rather
    /// than quietly presenting weak encryption as a supported format.
    ///
    /// # Password verification
    ///
    /// Both schemes carry a password verifier, and both are checked before a single package
    /// byte is decrypted, so a wrong password costs one key derivation and returns
    /// `DecryptError::WrongPassword`. The decrypted package is additionally required to begin
    /// with the ZIP local-file-header signature `PK\x03\x04`; a package that verifies but does
    /// not decrypt to an archive is a corrupt container, reported as `DecryptError::Malformed`
    /// so that corruption is never reported to a caller as a bad password.
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        let mut compound_file = cfb::CompoundFile::open(Cursor::new(bytes)).map_err(|error| {
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

        // Bound the descriptor before it is parsed — see MAX_ENCRYPTION_INFO_BYTES. The
        // directory-entry length is the authoritative bound: the stream read below is sized
        // from the same field, so a stream that passes here cannot expand afterwards.
        let encryption_info_length = stream_length(&mut compound_file, "/EncryptionInfo")?;
        if encryption_info_length > MAX_ENCRYPTION_INFO_BYTES {
            return Err(DecryptError::Malformed(format!(
                "EncryptionInfo stream is {encryption_info_length} bytes, above the \
                 {MAX_ENCRYPTION_INFO_BYTES}-byte limit for an agile descriptor"
            )));
        }

        // A stream lives inside the compound file, so its declared length can never exceed the
        // file's own. Checking that before reading stops a crafted directory entry from
        // driving a multi-gigabyte allocation out of a few-kilobyte upload.
        let package_length = stream_length(&mut compound_file, "/EncryptedPackage")?;
        if package_length > bytes.len() as u64 {
            return Err(DecryptError::Malformed(format!(
                "EncryptedPackage stream declares {package_length} bytes, more than the {}-byte \
                 file that contains it",
                bytes.len()
            )));
        }

        let encryption_info = read_stream(&mut compound_file, "/EncryptionInfo")?;
        let encrypted_package = read_stream(&mut compound_file, "/EncryptedPackage")?;

        // The size prefix is the one attacker-controlled number every later bound is expressed
        // against, so it is read and sanity-checked before anything expensive happens.
        let prefix = encrypted_package
            .get(..PACKAGE_SIZE_PREFIX_BYTES)
            .and_then(|slice| <[u8; 8]>::try_from(slice).ok())
            .ok_or_else(|| {
                DecryptError::Malformed(
                    "EncryptedPackage stream is too short to contain a valid size prefix"
                        .to_owned(),
                )
            })?;
        let declared_size = u64::from_le_bytes(prefix);
        // usize is 32-bit on the wasm32 target, so a 64-bit length is converted, never cast.
        let total_size = usize::try_from(declared_size).map_err(|_| {
            DecryptError::Malformed(format!(
                "EncryptedPackage declares a {declared_size}-byte package, larger than this \
                 platform can address"
            ))
        })?;

        // A valid Office package is a ZIP holding at minimum a content-types part and one
        // document part, which always exceeds a single segment. A prefix below that cannot be
        // describing a package this module is looking at, and rejecting it here means every
        // downstream length calculation starts from a value already known to be sane.
        if total_size < SEGMENT_LENGTH {
            return Err(DecryptError::Malformed(
                "EncryptedPackage total_size is smaller than one decryption segment \
                 (4096 bytes) and cannot represent a valid agile-encrypted package"
                    .to_owned(),
            ));
        }

        let ciphertext = encrypted_package
            .get(PACKAGE_SIZE_PREFIX_BYTES..)
            .unwrap_or_default();
        if !ciphertext.len().is_multiple_of(AES_BLOCK_BYTES) {
            return Err(DecryptError::Malformed(format!(
                "EncryptedPackage ciphertext is {} bytes, not a whole number of \
                 {AES_BLOCK_BYTES}-byte cipher blocks",
                ciphertext.len()
            )));
        }
        // The size prefix is a claim; the stream length is the fact. A prefix promising more
        // plaintext than there is ciphertext to produce it is a truncated or crafted package,
        // refused before a single segment is decrypted.
        if total_size > ciphertext.len() {
            return Err(DecryptError::Malformed(format!(
                "EncryptedPackage declares {total_size} plaintext bytes but carries only {} \
                 bytes of ciphertext",
                ciphertext.len()
            )));
        }

        // Header: version major (2) + minor (2) + reserved flags (4) = 8 bytes.
        let header = encryption_info.get(..8).ok_or_else(|| {
            DecryptError::Malformed("EncryptionInfo is shorter than 8 bytes".to_owned())
        })?;
        let version_major = u16::from_le_bytes([header[0], header[1]]);
        let version_minor = u16::from_le_bytes([header[2], header[3]]);

        let plaintext = match (version_major, version_minor) {
            (4, 4) => decrypt_agile_package(&encryption_info, ciphertext, total_size, password),
            (2..=4, 2) => {
                decrypt_standard_package(&encryption_info, ciphertext, total_size, password)
            }
            _ => Err(DecryptError::Unsupported(format!(
                "EncryptionInfo version {version_major}.{version_minor} is neither agile (4.4) \
                 nor standard (2.2, 3.2, 4.2) encryption"
            ))),
        }?;

        if !plaintext.starts_with(b"PK\x03\x04") {
            // The password already verified, so this is not a wrong-password signal: the
            // container decrypted to something that is not an archive, i.e. it is corrupt.
            return Err(DecryptError::Malformed(
                "the decrypted package does not begin with the ZIP local-file-header signature"
                    .to_owned(),
            ));
        }

        Ok(DecryptedFile {
            bytes: plaintext,
            filename_hint: None,
        })
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
    /// - `ExtractError::Unsupported` — the `EncryptionInfo` is not agile (version 4.4), or its
    ///   password hash is not SHA-512, which the `$office$*2013*` format cannot express.
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

        // The `$office$*2013*` string encodes a SHA-512 iterative hash and nothing else, so a
        // descriptor using another hash cannot be represented by it. Emitting the string anyway
        // would hand a cracker parameters that can never match.
        let hash_algorithm = attr("hashAlgorithm")?;
        if hash_algorithm != "SHA512" {
            return Err(ExtractError::Unsupported(format!(
                "agile password hash {hash_algorithm} is not SHA-512"
            )));
        }

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
    /// blocks, or a key length no AES variant accepts) — a failed guess and an unusable job
    /// are both "not a match" to the caller's cracking loop. Never panics.
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

/// The declared byte length of a stream, read from its compound-file directory entry.
fn stream_length(
    compound_file: &mut cfb::CompoundFile<Cursor<&[u8]>>,
    path: &str,
) -> Result<u64, DecryptError> {
    Ok(compound_file
        .entry(path)
        .map_err(|error| {
            DecryptError::Malformed(format!("cannot read the {path} directory entry: {error}"))
        })?
        .len())
}

/// Read a whole stream out of the compound file. Callers bound the declared length first, so
/// the allocation here is already known to be proportional to the input file.
fn read_stream(
    compound_file: &mut cfb::CompoundFile<Cursor<&[u8]>>,
    path: &str,
) -> Result<Vec<u8>, DecryptError> {
    let mut contents = Vec::new();
    compound_file
        .open_stream(path)
        .map_err(|error| DecryptError::Malformed(format!("cannot open {path} stream: {error}")))?
        .read_to_end(&mut contents)
        .map_err(|error| DecryptError::Malformed(format!("cannot read {path} stream: {error}")))?;
    Ok(contents)
}

/// The parts of an ECMA-376 agile descriptor the decryption path needs: the `keyData` element
/// describes how the package itself is encrypted, the password `encryptedKey` element
/// describes how the session key is wrapped.
struct AgileDescriptor {
    key_data_salt: Vec<u8>,
    password_salt: Vec<u8>,
    spin_count: u32,
    key_bytes: usize,
    encrypted_verifier_hash_input: Vec<u8>,
    encrypted_verifier_hash_value: Vec<u8>,
    encrypted_key_value: Vec<u8>,
}

/// Read the agile descriptor — the UTF-8 XML following the `EncryptionInfo` 8-byte header —
/// into the fields the decryption path needs, refusing by name every cipher/hash combination
/// this module does not implement rather than proceeding on a wrong assumption.
fn parse_agile_descriptor(encryption_info: &[u8]) -> Result<AgileDescriptor, DecryptError> {
    let xml = encryption_info
        .get(8..)
        .and_then(|tail| std::str::from_utf8(tail).ok())
        .ok_or_else(|| DecryptError::Malformed("agile descriptor is not valid UTF-8".to_owned()))?;

    let key_data = element_named(xml, "keyData").ok_or_else(|| {
        DecryptError::Malformed("EncryptionInfo has no keyData element".to_owned())
    })?;
    let encrypted_key = encrypted_key_element(xml).ok_or_else(|| {
        DecryptError::Malformed("EncryptionInfo has no password encryptedKey element".to_owned())
    })?;

    let required = |element: &str, name: &str| -> Result<String, DecryptError> {
        attribute_value(element, name)
            .map(str::to_owned)
            .ok_or_else(|| DecryptError::Malformed(format!("agile descriptor lacks {name}")))
    };
    let required_number = |element: &str, name: &str| -> Result<u32, DecryptError> {
        required(element, name)?
            .parse::<u32>()
            .map_err(|_| DecryptError::Malformed(format!("{name} is not an integer")))
    };
    let required_base64 = |element: &str, name: &str| -> Result<Vec<u8>, DecryptError> {
        base64_decode(&required(element, name)?)
            .ok_or_else(|| DecryptError::Malformed(format!("invalid base64 in {name}")))
    };

    // Both halves of the scheme must be the AES-CBC / SHA-512 combination Office writes.
    // Anything else is a document this module cannot decrypt, and saying so is the only honest
    // answer — running it under the wrong primitive would yield plausible-looking garbage.
    for (element, label) in [(key_data, "keyData"), (encrypted_key, "encryptedKey")] {
        let cipher = required(element, "cipherAlgorithm")?;
        if cipher != "AES" {
            return Err(DecryptError::Unsupported(format!(
                "agile {label} cipher {cipher} is not AES"
            )));
        }
        let chaining = required(element, "cipherChaining")?;
        if chaining != "ChainingModeCBC" {
            return Err(DecryptError::Unsupported(format!(
                "agile {label} chaining mode {chaining} is not CBC"
            )));
        }
        let hash_algorithm = required(element, "hashAlgorithm")?;
        if hash_algorithm != "SHA512" {
            return Err(DecryptError::Unsupported(format!(
                "agile {label} hash {hash_algorithm} is not SHA-512"
            )));
        }
    }

    let block_size = required_number(key_data, "blockSize")? as usize;
    if block_size != AES_BLOCK_BYTES {
        return Err(DecryptError::Unsupported(format!(
            "agile keyData blockSize {block_size} is not the {AES_BLOCK_BYTES}-byte AES block"
        )));
    }

    let key_bits = required_number(encrypted_key, "keyBits")?;
    let key_bytes = match key_bits {
        128 => 16,
        192 => 24,
        256 => 32,
        other => {
            return Err(DecryptError::Unsupported(format!(
                "agile keyBits {other} is not an AES key length"
            )))
        }
    };

    let spin_count = required_number(encrypted_key, "spinCount")?;
    if spin_count > MAX_SPIN_COUNT {
        return Err(DecryptError::Unsupported(format!(
            "spinCount {spin_count} exceeds maximum {MAX_SPIN_COUNT}"
        )));
    }

    let password_salt = required_base64(encrypted_key, "saltValue")?;
    if password_salt.len() < AES_BLOCK_BYTES {
        return Err(DecryptError::Malformed(format!(
            "agile encryptedKey saltValue is {} bytes, too short to supply a \
             {AES_BLOCK_BYTES}-byte initialization vector",
            password_salt.len()
        )));
    }

    Ok(AgileDescriptor {
        key_data_salt: required_base64(key_data, "saltValue")?,
        password_salt,
        spin_count,
        key_bytes,
        encrypted_verifier_hash_input: required_base64(
            encrypted_key,
            "encryptedVerifierHashInput",
        )?,
        encrypted_verifier_hash_value: required_base64(
            encrypted_key,
            "encryptedVerifierHashValue",
        )?,
        encrypted_key_value: required_base64(encrypted_key, "encryptedKeyValue")?,
    })
}

/// Decrypt an agile-encrypted package: verify the password, unwrap the session key, then walk
/// the ciphertext one 4096-byte segment at a time.
///
/// Each segment is an independent CBC chain whose initialization vector comes from the
/// `keyData` salt and the segment's own index — `SHA512(salt ‖ LE_u32(index))` truncated to the
/// cipher block size — so a segment must be decrypted at its true index, and the bytes of two
/// segments can never be run together as one chain. `ciphertext` has already been shown to be
/// a whole number of cipher blocks and at least `total_size` bytes long.
fn decrypt_agile_package(
    encryption_info: &[u8],
    ciphertext: &[u8],
    total_size: usize,
    password: &str,
) -> Result<Vec<u8>, DecryptError> {
    let descriptor = parse_agile_descriptor(encryption_info)?;

    if !verify_agile(
        descriptor.spin_count,
        (descriptor.key_bytes * 8) as u32,
        &descriptor.password_salt,
        &descriptor.encrypted_verifier_hash_input,
        &descriptor.encrypted_verifier_hash_value,
        password,
    ) {
        return Err(DecryptError::WrongPassword);
    }

    // The password only ever unwraps the session key; the package is encrypted under that key,
    // which is why changing a document's password does not re-encrypt the document.
    let base = iterative_hash(&descriptor.password_salt, password, descriptor.spin_count);
    let wrapping_key =
        derive_block_key(&base, &BLOCK_KEY_ENCRYPTED_KEY_VALUE, descriptor.key_bytes);
    let initialization_vector =
        descriptor
            .password_salt
            .get(..AES_BLOCK_BYTES)
            .ok_or_else(|| {
                DecryptError::Malformed("agile encryptedKey saltValue is too short".to_owned())
            })?;
    let mut session_key = aes_cbc_decrypt(
        &wrapping_key,
        initialization_vector,
        &descriptor.encrypted_key_value,
    )
    .ok_or_else(|| {
        DecryptError::Malformed("agile encryptedKeyValue is not a decryptable key blob".to_owned())
    })?;
    if session_key.len() < descriptor.key_bytes {
        return Err(DecryptError::Malformed(format!(
            "agile encryptedKeyValue unwrapped to {} bytes, short of the {}-byte session key",
            session_key.len(),
            descriptor.key_bytes
        )));
    }
    session_key.truncate(descriptor.key_bytes);

    let mut plaintext = Vec::with_capacity(total_size);
    let mut segment_index: u32 = 0;
    while plaintext.len() < total_size {
        let offset = (segment_index as usize)
            .checked_mul(SEGMENT_LENGTH)
            .ok_or_else(|| {
                DecryptError::Malformed("EncryptedPackage segment offset overflowed".to_owned())
            })?;
        let plaintext_wanted = (total_size - plaintext.len()).min(SEGMENT_LENGTH);
        // Take only the cipher blocks this segment's plaintext needs. Reading further would
        // pull the next segment's bytes into this segment's CBC chain, decrypting them under
        // an initialization vector that was never theirs.
        let blocks_wanted = plaintext_wanted
            .div_ceil(AES_BLOCK_BYTES)
            .saturating_mul(AES_BLOCK_BYTES);
        let segment = ciphertext
            .get(offset..offset.saturating_add(blocks_wanted))
            .ok_or_else(|| {
                DecryptError::Malformed(
                    "EncryptedPackage ends before the plaintext length it declares".to_owned(),
                )
            })?;

        let mut hasher = Sha512::new();
        hasher.update(&descriptor.key_data_salt);
        hasher.update(segment_index.to_le_bytes());
        let derived = hasher.finalize();
        let segment_initialization_vector = derived.get(..AES_BLOCK_BYTES).ok_or_else(|| {
            DecryptError::Malformed("cannot derive a segment initialization vector".to_owned())
        })?;

        let decrypted = aes_cbc_decrypt(&session_key, segment_initialization_vector, segment)
            .ok_or_else(|| {
                DecryptError::Malformed(
                    "EncryptedPackage segment is not a decryptable cipher-block sequence"
                        .to_owned(),
                )
            })?;
        plaintext.extend_from_slice(decrypted.get(..plaintext_wanted).ok_or_else(|| {
            DecryptError::Malformed("EncryptedPackage segment decrypted short".to_owned())
        })?);

        segment_index = segment_index.checked_add(1).ok_or_else(|| {
            DecryptError::Malformed(
                "EncryptedPackage has more segments than are addressable".to_owned(),
            )
        })?;
    }

    Ok(plaintext)
}

/// The parts of an ECMA-376 standard-encryption `EncryptionInfo` the decryption path needs.
struct StandardDescriptor {
    key_bytes: usize,
    salt: Vec<u8>,
    encrypted_verifier: Vec<u8>,
    encrypted_verifier_hash: Vec<u8>,
}

/// Read the fixed-layout standard-encryption header and verifier. Unlike the agile descriptor
/// this is a binary structure: a version/flags prologue, a length-prefixed `EncryptionHeader`,
/// then an `EncryptionVerifier`. Every field is read through a checked slice, so a truncated
/// or crafted stream produces `Malformed` rather than a panic.
fn parse_standard_descriptor(encryption_info: &[u8]) -> Result<StandardDescriptor, DecryptError> {
    let short = || DecryptError::Malformed("EncryptionInfo ends inside its header".to_owned());
    let read_u32 = |source: &[u8], at: usize| -> Result<u32, DecryptError> {
        source
            .get(at..at.saturating_add(4))
            .and_then(|slice| <[u8; 4]>::try_from(slice).ok())
            .map(u32::from_le_bytes)
            .ok_or_else(short)
    };

    // Bytes 0..4 are the version, 4..8 the flags, 8..12 the length of the header that follows.
    let header_size = read_u32(encryption_info, 8)? as usize;
    let header_start = 12usize;
    let header_end = header_start.checked_add(header_size).ok_or_else(short)?;
    let header = encryption_info
        .get(header_start..header_end)
        .ok_or_else(short)?;

    // EncryptionHeader: Flags, SizeExtra, AlgID, AlgIDHash, KeySize, ProviderType, two reserved
    // words, then the CSP name as null-terminated UTF-16 (which nothing here reads).
    let algorithm_identifier = read_u32(header, 8)?;
    let hash_identifier = read_u32(header, 12)?;
    let key_size_bits = read_u32(header, 16)?;

    if hash_identifier != HASH_IDENTIFIER_SHA1 {
        return Err(DecryptError::Unsupported(format!(
            "standard encryption AlgIDHash {hash_identifier:#x} is not SHA-1"
        )));
    }

    let key_bytes = match algorithm_identifier {
        ALGORITHM_IDENTIFIER_RC4 => {
            return Err(DecryptError::Unsupported(
                "ECMA-376 standard encryption with the RC4 CryptoAPI cipher is not supported"
                    .to_owned(),
            ))
        }
        ALGORITHM_IDENTIFIER_AES_128 => 16,
        ALGORITHM_IDENTIFIER_AES_192 => 24,
        ALGORITHM_IDENTIFIER_AES_256 => 32,
        // AlgID may be left unspecified, in which case KeySize alone selects the AES variant.
        ALGORITHM_IDENTIFIER_UNSPECIFIED => match key_size_bits {
            128 => 16,
            192 => 24,
            256 => 32,
            other => {
                return Err(DecryptError::Unsupported(format!(
                    "standard encryption KeySize {other} is not an AES key length"
                )))
            }
        },
        other => {
            return Err(DecryptError::Unsupported(format!(
                "standard encryption AlgID {other:#x} is not an AES cipher"
            )))
        }
    };
    // When both fields are populated they must agree; a header naming AES-128 and then asking
    // for a 256-bit key is not a document any Office release wrote.
    if key_size_bits != 0 && key_size_bits as usize != key_bytes * 8 {
        return Err(DecryptError::Malformed(format!(
            "standard encryption KeySize {key_size_bits} disagrees with its AlgID"
        )));
    }

    // EncryptionVerifier: SaltSize, Salt, EncryptedVerifier (one cipher block), VerifierHashSize,
    // EncryptedVerifierHash (the SHA-1 digest padded out to whole cipher blocks).
    let verifier = encryption_info.get(header_end..).ok_or_else(short)?;
    let salt_size = read_u32(verifier, 0)? as usize;
    if salt_size != AES_BLOCK_BYTES {
        return Err(DecryptError::Malformed(format!(
            "standard encryption SaltSize is {salt_size}, not {AES_BLOCK_BYTES}"
        )));
    }
    let salt = verifier.get(4..4 + salt_size).ok_or_else(short)?.to_vec();
    let encrypted_verifier = verifier
        .get(4 + salt_size..4 + salt_size + AES_BLOCK_BYTES)
        .ok_or_else(short)?
        .to_vec();

    let hash_size_field = 4 + salt_size + AES_BLOCK_BYTES;
    let verifier_hash_size = read_u32(verifier, hash_size_field)? as usize;
    if verifier_hash_size != SHA1_DIGEST_BYTES {
        return Err(DecryptError::Unsupported(format!(
            "standard encryption VerifierHashSize {verifier_hash_size} is not the \
             {SHA1_DIGEST_BYTES}-byte SHA-1 digest this module implements"
        )));
    }
    // The stored hash is padded up to a whole number of cipher blocks: 20 bytes becomes 32.
    let stored_hash_bytes = SHA1_DIGEST_BYTES
        .div_ceil(AES_BLOCK_BYTES)
        .saturating_mul(AES_BLOCK_BYTES);
    let encrypted_verifier_hash = verifier
        .get(hash_size_field + 4..hash_size_field + 4 + stored_hash_bytes)
        .ok_or_else(short)?
        .to_vec();

    Ok(StandardDescriptor {
        key_bytes,
        salt,
        encrypted_verifier,
        encrypted_verifier_hash,
    })
}

/// Decrypt a standard-encrypted package. There is no session key and no segmenting here: the
/// password-derived key encrypts the whole package in ECB mode, one independent block at a
/// time — which is exactly why the scheme was superseded by agile encryption.
fn decrypt_standard_package(
    encryption_info: &[u8],
    ciphertext: &[u8],
    total_size: usize,
    password: &str,
) -> Result<Vec<u8>, DecryptError> {
    let descriptor = parse_standard_descriptor(encryption_info)?;
    let key = derive_standard_key(&descriptor.salt, password, descriptor.key_bytes);

    // Verifier check: the stored blob decrypts to a nonce whose SHA-1 is the stored hash.
    // Wrong password, wrong key, mismatched digest — refused before any package byte.
    let verifier = aes_ecb_decrypt(&key, &descriptor.encrypted_verifier).ok_or_else(|| {
        DecryptError::Malformed(
            "standard encryption verifier is not a whole cipher block".to_owned(),
        )
    })?;
    let stored_hash =
        aes_ecb_decrypt(&key, &descriptor.encrypted_verifier_hash).ok_or_else(|| {
            DecryptError::Malformed(
                "standard encryption verifier hash is not a whole number of cipher blocks"
                    .to_owned(),
            )
        })?;
    let computed_hash = Sha1::digest(&verifier);
    if stored_hash.get(..SHA1_DIGEST_BYTES) != Some(computed_hash.as_slice()) {
        return Err(DecryptError::WrongPassword);
    }

    let mut plaintext = aes_ecb_decrypt(&key, ciphertext).ok_or_else(|| {
        DecryptError::Malformed(
            "EncryptedPackage is not a whole number of cipher blocks".to_owned(),
        )
    })?;
    // ECB decrypts whole blocks; the declared plaintext length trims the final padding. The
    // caller has already established that the ciphertext is at least that long.
    plaintext.truncate(total_size);
    Ok(plaintext)
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

/// Slice out the first element whose local name is `local_name`, ignoring whatever namespace
/// prefix the writer chose. The element runs from its `<` to the next `>`; XML forbids a raw
/// `<` or `>` inside an attribute value, so both bounds are exact. Returns `None` rather than
/// panicking on any malformed shape.
fn element_named<'a>(xml: &'a str, local_name: &str) -> Option<&'a str> {
    let mut from = 0usize;
    loop {
        let relative_open = xml.get(from..)?.find('<')?;
        let open = from.checked_add(relative_open)?;
        let after_open = open.checked_add(1)?;
        let rest = xml.get(after_open..)?;
        let name_end = rest.find(|character: char| {
            character.is_whitespace() || character == '/' || character == '>'
        })?;
        let name = rest.get(..name_end)?;
        if name.rsplit(':').next() == Some(local_name) {
            let relative_close = rest.find('>')?;
            return xml.get(open..after_open.checked_add(relative_close)?.checked_add(1)?);
        }
        from = after_open;
    }
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

/// Encode a string as little-endian UTF-16, the password form MS-OFFCRYPTO feeds into both
/// iterative hashes.
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

/// The standard-encryption key derivation: a fixed 50 000-round SHA-1 chain over the salt and
/// the UTF-16LE password, a final round mixing in the block number (always zero for the single
/// key this scheme uses), then the two-pass 0x36/0x5c expansion that widens the 20-byte digest
/// to as much key material as the cipher needs.
fn derive_standard_key(salt: &[u8], password: &str, key_bytes: usize) -> Vec<u8> {
    let mut digest = {
        let mut hasher = Sha1::new();
        hasher.update(salt);
        hasher.update(utf16le(password));
        hasher.finalize()
    };
    for round in 0..STANDARD_SPIN_COUNT {
        let mut hasher = Sha1::new();
        hasher.update(round.to_le_bytes());
        hasher.update(digest);
        digest = hasher.finalize();
    }
    let final_digest = {
        let mut hasher = Sha1::new();
        hasher.update(digest);
        hasher.update(0u32.to_le_bytes());
        hasher.finalize()
    };

    let expand = |pad: u8| -> Vec<u8> {
        let mut buffer = [pad; 64];
        for (slot, byte) in buffer.iter_mut().zip(final_digest.iter()) {
            *slot ^= *byte;
        }
        Sha1::digest(buffer).to_vec()
    };
    let mut key = expand(0x36);
    key.extend_from_slice(&expand(0x5c));
    key.truncate(key_bytes);
    key
}

/// AES-CBC decrypt with no padding, for any AES key length. Returns `None` on a wrong key or
/// IV length, or a ciphertext that is not a whole number of cipher blocks — never panics.
fn aes_cbc_decrypt(key: &[u8], initialization_vector: &[u8], ciphertext: &[u8]) -> Option<Vec<u8>> {
    use cbc::cipher::{block_padding::NoPadding, BlockModeDecrypt, KeyIvInit};

    if ciphertext.is_empty() || !ciphertext.len().is_multiple_of(AES_BLOCK_BYTES) {
        return None;
    }
    let mut buffer = ciphertext.to_vec();
    let length = match key.len() {
        16 => cbc::Decryptor::<aes::Aes128>::new_from_slices(key, initialization_vector)
            .ok()?
            .decrypt_padded::<NoPadding>(&mut buffer)
            .ok()?
            .len(),
        24 => cbc::Decryptor::<aes::Aes192>::new_from_slices(key, initialization_vector)
            .ok()?
            .decrypt_padded::<NoPadding>(&mut buffer)
            .ok()?
            .len(),
        32 => cbc::Decryptor::<aes::Aes256>::new_from_slices(key, initialization_vector)
            .ok()?
            .decrypt_padded::<NoPadding>(&mut buffer)
            .ok()?
            .len(),
        _ => return None,
    };
    buffer.truncate(length);
    Some(buffer)
}

/// AES-ECB decrypt, for any AES key length: every block decrypted independently under the same
/// key, the mode ECMA-376 standard encryption uses. Returns `None` on a wrong key length or a
/// ciphertext that is not a whole number of cipher blocks — never panics.
fn aes_ecb_decrypt(key: &[u8], ciphertext: &[u8]) -> Option<Vec<u8>> {
    use aes::cipher::{typenum::U16, Block, BlockCipherDecrypt, BlockSizeUser, KeyInit};

    fn decrypt_blocks<C>(key: &[u8], buffer: &mut [u8]) -> Option<()>
    where
        C: BlockCipherDecrypt + KeyInit + BlockSizeUser<BlockSize = U16>,
    {
        let cipher = C::new_from_slice(key).ok()?;
        for block in buffer.chunks_exact_mut(AES_BLOCK_BYTES) {
            let block: &mut Block<C> = block.try_into().ok()?;
            cipher.decrypt_block(block);
        }
        Some(())
    }

    if ciphertext.is_empty() || !ciphertext.len().is_multiple_of(AES_BLOCK_BYTES) {
        return None;
    }
    let mut buffer = ciphertext.to_vec();
    match key.len() {
        16 => decrypt_blocks::<aes::Aes128>(key, &mut buffer)?,
        24 => decrypt_blocks::<aes::Aes192>(key, &mut buffer)?,
        32 => decrypt_blocks::<aes::Aes256>(key, &mut buffer)?,
        _ => return None,
    }
    Some(buffer)
}

/// The full ECMA-376 agile verifier check: derive the two block keys from the iterative
/// hash, AES-CBC-decrypt both verifier blobs with the salt as IV, and confirm the
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
    let Some(initialization_vector) = salt.get(..AES_BLOCK_BYTES) else {
        return false;
    };

    let base = iterative_hash(salt, password, spin_count);
    let key_input = derive_block_key(&base, &BLOCK_KEY_VERIFIER_HASH_INPUT, key_bytes);
    let key_value = derive_block_key(&base, &BLOCK_KEY_VERIFIER_HASH_VALUE, key_bytes);

    let Some(decrypted_input) =
        aes_cbc_decrypt(&key_input, initialization_vector, enc_verifier_hash_input)
    else {
        return false;
    };
    let Some(decrypted_value) =
        aes_cbc_decrypt(&key_value, initialization_vector, enc_verifier_hash_value)
    else {
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
    use aes::cipher::{BlockCipherEncrypt, KeyInit};
    use ms_offcrypto_writer::Ecma376AgileWriter;
    use rand::{rngs::StdRng, SeedableRng};
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// A seeded generator, so every fixture in this module is byte-for-byte reproducible from
    /// run to run. The encryption writer wants randomness for its salts; seeding it means a
    /// failure here is a failure every time rather than one run in a hundred.
    fn seeded_rng(seed: u64) -> StdRng {
        StdRng::seed_from_u64(seed)
    }

    /// Deterministic filler that does not compress, so a payload of a requested length stays
    /// that length through a stored ZIP entry. A small multiplicative generator is plenty —
    /// the bytes only need to be non-constant and reproducible.
    fn filler(length: usize) -> Vec<u8> {
        let mut state = 0x2545_f491_4f6c_dd1du64;
        (0..length)
            .map(|_| {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1);
                (state >> 33) as u8
            })
            .collect()
    }

    /// Wrap `payload` in an ECMA-376 agile-encrypted OLE2/CFB container using a third-party
    /// writer. This is the independent cross-check: a document this module never had a hand in
    /// producing. It costs a full 100 000-round key derivation, so it is used for the round-trip
    /// proofs and not for the adversarial sweeps.
    fn encrypt_agile(password: &str, payload: &[u8]) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        {
            let mut writer =
                Ecma376AgileWriter::create(&mut seeded_rng(0x000f_f1ce), password, &mut output)
                    .expect("ooxml: create writer");
            writer.write_all(payload).expect("ooxml: write payload");
            writer.finalize().expect("ooxml: finalize");
        }
        output.into_inner()
    }

    /// Standard base64, the encoding every binary field of an agile descriptor carries. Only
    /// the fixture builder needs it; the adapter itself only ever decodes.
    fn base64_encode(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let triple = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let packed =
                (u32::from(triple[0]) << 16) | (u32::from(triple[1]) << 8) | u32::from(triple[2]);
            let symbol = |shift: u32| char::from(ALPHABET[(packed >> shift) as usize & 63]);
            encoded.push(symbol(18));
            encoded.push(symbol(12));
            encoded.push(if chunk.len() > 1 { symbol(6) } else { '=' });
            encoded.push(if chunk.len() > 2 { symbol(0) } else { '=' });
        }
        encoded
    }

    /// AES-CBC encryption with no padding, the inverse of `aes_cbc_decrypt`. Fixture-only —
    /// the adapter has no encryption path.
    fn aes_cbc_encrypt(key: &[u8], initialization_vector: &[u8], plaintext: &[u8]) -> Vec<u8> {
        use cbc::cipher::{block_padding::NoPadding, BlockModeEncrypt, KeyIvInit};

        let mut buffer = plaintext.to_vec();
        let length = buffer.len();
        cbc::Encryptor::<aes::Aes256>::new_from_slices(key, initialization_vector)
            .expect("aes: 256-bit key and 16-byte IV")
            .encrypt_padded::<NoPadding>(&mut buffer, length)
            .expect("aes: block-aligned plaintext");
        buffer
    }

    /// Build an agile-encrypted document with a chosen `spin_count`.
    ///
    /// Every fixture the third-party writer produces costs a 100 000-round SHA-512 chain to
    /// create and another to open, which is the right price for a handful of round-trip proofs
    /// and the wrong one for a sweep of a hundred adversarial inputs. Writing the container
    /// here lets those sweeps run at a spin count of fifty — the loop, the guards and the
    /// verifier are identical either way, only the deliberate work factor changes. It also
    /// exercises the descriptor parser against XML this module did not itself emit.
    fn encrypt_agile_with_spin_count(password: &str, payload: &[u8], spin_count: u32) -> Vec<u8> {
        // Three distinct values. Sharing one would let a confusion between the package salt
        // and the password salt pass unnoticed, which is exactly the mistake worth catching.
        let entropy = filler(64);
        let key_data_salt = entropy[..16].to_vec();
        let password_salt = entropy[16..32].to_vec();
        let session_key = entropy[32..64].to_vec();

        let base = iterative_hash(&password_salt, password, spin_count);
        let verifier_input = [0x3cu8; 16];
        let encrypted_verifier_hash_input = aes_cbc_encrypt(
            &derive_block_key(&base, &BLOCK_KEY_VERIFIER_HASH_INPUT, 32),
            &password_salt,
            &verifier_input,
        );
        let encrypted_verifier_hash_value = aes_cbc_encrypt(
            &derive_block_key(&base, &BLOCK_KEY_VERIFIER_HASH_VALUE, 32),
            &password_salt,
            &Sha512::digest(verifier_input),
        );
        let encrypted_key_value = aes_cbc_encrypt(
            &derive_block_key(&base, &BLOCK_KEY_ENCRYPTED_KEY_VALUE, 32),
            &password_salt,
            &session_key,
        );

        let descriptor = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <encryption>\
             <keyData saltSize=\"16\" blockSize=\"16\" keyBits=\"256\" hashSize=\"64\" \
             cipherAlgorithm=\"AES\" cipherChaining=\"ChainingModeCBC\" hashAlgorithm=\"SHA512\" \
             saltValue=\"{key_data_salt}\"/>\
             <keyEncryptors><keyEncryptor uri=\"password\">\
             <p:encryptedKey spinCount=\"{spin_count}\" saltSize=\"16\" blockSize=\"16\" \
             keyBits=\"256\" hashSize=\"64\" cipherAlgorithm=\"AES\" \
             cipherChaining=\"ChainingModeCBC\" hashAlgorithm=\"SHA512\" saltValue=\"{salt}\" \
             encryptedVerifierHashInput=\"{input}\" encryptedVerifierHashValue=\"{value}\" \
             encryptedKeyValue=\"{key}\"/>\
             </keyEncryptor></keyEncryptors></encryption>",
            key_data_salt = base64_encode(&key_data_salt),
            salt = base64_encode(&password_salt),
            input = base64_encode(&encrypted_verifier_hash_input),
            value = base64_encode(&encrypted_verifier_hash_value),
            key = base64_encode(&encrypted_key_value),
        );
        let mut encryption_info = vec![0x04, 0x00, 0x04, 0x00, 0x40, 0x00, 0x00, 0x00];
        encryption_info.extend_from_slice(descriptor.as_bytes());

        let mut package = (payload.len() as u64).to_le_bytes().to_vec();
        for (index, chunk) in payload.chunks(SEGMENT_LENGTH).enumerate() {
            let mut hasher = Sha512::new();
            hasher.update(&key_data_salt);
            hasher.update((index as u32).to_le_bytes());
            let derived = hasher.finalize();
            let mut padded = chunk.to_vec();
            while !padded.len().is_multiple_of(AES_BLOCK_BYTES) {
                padded.push(0);
            }
            package.extend_from_slice(&aes_cbc_encrypt(
                &session_key,
                &derived[..AES_BLOCK_BYTES],
                &padded,
            ));
        }

        compound_document(&encryption_info, &package)
    }

    /// The work factor every fixture this module builds itself uses: enough rounds to prove the
    /// derivation runs, few enough that a hundred of them cost nothing.
    const FAST_SPIN_COUNT: u32 = 50;

    /// A payload that passes the adapter's ZIP-magic check and is exactly `length` bytes long,
    /// for exercising the segment loop at chosen plaintext sizes.
    fn zip_shaped_payload(length: usize) -> Vec<u8> {
        let mut payload = b"PK\x03\x04".to_vec();
        payload.extend_from_slice(&filler(length.saturating_sub(4)));
        payload.truncate(length);
        payload
    }

    /// Read one stream out of a compound document.
    fn stream_of(container: &[u8], path: &str) -> Vec<u8> {
        let mut compound_file =
            cfb::CompoundFile::open(Cursor::new(container)).expect("cfb: open container");
        let mut contents = Vec::new();
        compound_file
            .open_stream(path)
            .expect("cfb: open stream")
            .read_to_end(&mut contents)
            .expect("cfb: read stream");
        contents
    }

    /// Assemble a compound document from the two streams an encrypted OOXML file carries.
    fn compound_document(encryption_info: &[u8], encrypted_package: &[u8]) -> Vec<u8> {
        let mut compound_file =
            cfb::CompoundFile::create(Cursor::new(Vec::new())).expect("cfb: create");
        compound_file
            .create_stream("/EncryptionInfo")
            .expect("cfb: create EncryptionInfo")
            .write_all(encryption_info)
            .expect("cfb: write EncryptionInfo");
        compound_file
            .create_stream("/EncryptedPackage")
            .expect("cfb: create EncryptedPackage")
            .write_all(encrypted_package)
            .expect("cfb: write EncryptedPackage");
        compound_file.into_inner().into_inner()
    }

    /// Rebuild a document, keeping its real `EncryptionInfo` descriptor and replacing the
    /// `EncryptedPackage` stream with arbitrary bytes. This is how the adversarial cases below
    /// reach the package guards: the descriptor still parses and the password still verifies,
    /// so nothing short-circuits before the loop's own bounds are tested.
    fn with_encrypted_package(original: &[u8], package: &[u8]) -> Vec<u8> {
        compound_document(&stream_of(original, "/EncryptionInfo"), package)
    }

    /// AES-ECB encryption, the inverse of `aes_ecb_decrypt`, used only to build the
    /// standard-encryption fixtures below. The adapter itself has no encryption path.
    fn aes_ecb_encrypt(key: &[u8], plaintext: &[u8]) -> Vec<u8> {
        let cipher = aes::Aes128::new_from_slice(key).expect("aes: 128-bit key");
        let mut buffer = plaintext.to_vec();
        for block in buffer.chunks_exact_mut(AES_BLOCK_BYTES) {
            cipher.encrypt_block(block.try_into().expect("aes: 16-byte block"));
        }
        buffer
    }

    /// Build an ECMA-376 **standard**-encrypted (AES-128-ECB / SHA-1) compound document. No
    /// maintained crate writes this legacy scheme, so the fixture is assembled here from the
    /// same primitives the adapter reads it back with.
    fn encrypt_standard(password: &str, payload: &[u8], algorithm_identifier: u32) -> Vec<u8> {
        let salt = [0x5au8; 16];
        let key = derive_standard_key(&salt, password, 16);

        let verifier = [0xa5u8; 16];
        let encrypted_verifier = aes_ecb_encrypt(&key, &verifier);
        let mut verifier_hash = [0u8; 32];
        verifier_hash[..SHA1_DIGEST_BYTES].copy_from_slice(&Sha1::digest(verifier));
        let encrypted_verifier_hash = aes_ecb_encrypt(&key, &verifier_hash);

        // EncryptionHeader: Flags, SizeExtra, AlgID, AlgIDHash, KeySize, ProviderType, two
        // reserved words, then the CSP name as null-terminated UTF-16LE.
        let mut header = Vec::new();
        header.extend_from_slice(&0x24u32.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes());
        header.extend_from_slice(&algorithm_identifier.to_le_bytes());
        header.extend_from_slice(&HASH_IDENTIFIER_SHA1.to_le_bytes());
        header.extend_from_slice(&128u32.to_le_bytes());
        header.extend_from_slice(&0x0000_0018u32.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes());
        header.extend_from_slice(&utf16le(
            "Microsoft Enhanced RSA and AES Cryptographic Provider\0",
        ));

        let mut encryption_info = Vec::new();
        encryption_info.extend_from_slice(&3u16.to_le_bytes()); // version major
        encryption_info.extend_from_slice(&2u16.to_le_bytes()); // version minor (standard)
        encryption_info.extend_from_slice(&0x24u32.to_le_bytes()); // flags
        encryption_info.extend_from_slice(&(header.len() as u32).to_le_bytes());
        encryption_info.extend_from_slice(&header);
        encryption_info.extend_from_slice(&(salt.len() as u32).to_le_bytes());
        encryption_info.extend_from_slice(&salt);
        encryption_info.extend_from_slice(&encrypted_verifier);
        encryption_info.extend_from_slice(&(SHA1_DIGEST_BYTES as u32).to_le_bytes());
        encryption_info.extend_from_slice(&encrypted_verifier_hash);

        let mut padded = payload.to_vec();
        while !padded.len().is_multiple_of(AES_BLOCK_BYTES) {
            padded.push(0);
        }
        let mut package = (payload.len() as u64).to_le_bytes().to_vec();
        package.extend_from_slice(&aes_ecb_encrypt(&key, &padded));

        compound_document(&encryption_info, &package)
    }

    /// Build a plaintext OOXML-compatible ZIP in memory, then encrypt it with ECMA-376 agile
    /// encryption. The result is an OLE2/CFB compound document suitable for round-tripping.
    fn make_encrypted_ooxml(password: &str) -> Vec<u8> {
        // Inner ZIP: [Content_Types].xml plus a stored (uncompressed) padding entry, so the
        // archive is a realistic size rather than a few hundred bytes. STORED mode is required
        // because Deflate would shrink the padding away again.
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

            writer
                .start_file(
                    "pad.bin",
                    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
                )
                .expect("zip: start pad");
            writer.write_all(&[0u8; 8192]).expect("zip: write pad");

            writer.finish().expect("zip: finish").into_inner()
        };

        encrypt_agile(password, &inner_zip)
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

    /// The decrypted package must equal the plaintext byte for byte — not merely start with
    /// the ZIP magic. A segment loop that used the wrong initialization vector, or mis-sized
    /// its final segment, still produces a correct first block.
    #[test]
    fn agile_round_trip_is_byte_identical() {
        // A length that is neither a whole number of segments nor of cipher blocks, so the
        // final short segment and its padding are both exercised by a document produced
        // entirely outside this module.
        let payload = zip_shaped_payload(20_005);
        let encrypted = encrypt_agile("test", &payload);
        let out = OoxmlAdapter::strip_with_key(&encrypted, "test").expect("decrypts");
        assert_eq!(out.bytes, payload, "the package must round-trip exactly");
        assert!(out.filename_hint.is_none());
    }

    /// Every interesting position relative to the 4096-byte segment boundary and the 16-byte
    /// cipher block: exact multiples, one byte either side, and the one-to-eight-byte tail a
    /// segment loop that compares offsets against the wrong base decrypts incorrectly.
    #[test]
    fn agile_round_trip_across_segment_boundaries() {
        for length in [
            4096, 4097, 4100, 4111, 4112, 4113, 8188, 8191, 8192, 8193, 8194, 8200, 8201, 8208,
            12_287, 12_288, 12_289,
        ] {
            let payload = zip_shaped_payload(length);
            let encrypted = encrypt_agile_with_spin_count("test", &payload, FAST_SPIN_COUNT);
            let out = OoxmlAdapter::strip_with_key(&encrypted, "test")
                .unwrap_or_else(|error| panic!("length {length} must decrypt: {error}"));
            assert_eq!(
                out.bytes, payload,
                "length {length} must round-trip byte-identically"
            );
        }
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

    /// A wrong password is refused by the ECMA-376 verifier, so the refusal does not depend on
    /// the decrypted bytes happening to lack the ZIP magic.
    #[test]
    fn rejects_wrong_password_without_decrypting_the_package() {
        let encrypted = encrypt_agile_with_spin_count(
            "correct-horse",
            &zip_shaped_payload(9000),
            FAST_SPIN_COUNT,
        );
        for candidate in ["", "correct-hors", "correct-horse ", "CORRECT-HORSE"] {
            assert!(
                matches!(
                    OoxmlAdapter::strip_with_key(&encrypted, candidate).unwrap_err(),
                    crate::DecryptError::WrongPassword
                ),
                "candidate {candidate:?} must be refused as WrongPassword"
            );
        }
    }

    /// Regression test: a crafted OLE2/CFB file with a tiny EncryptedPackage total_size must
    /// be rejected as `Malformed` without panicking.
    ///
    /// A size prefix below one segment cannot describe a real Office package, and every later
    /// length calculation is expressed against it, so it is refused before any of them run.
    #[test]
    fn rejects_tiny_encrypted_package_without_panicking() {
        let malicious_bytes = {
            let buffer = Cursor::new(Vec::new());
            let mut compound_file =
                cfb::CompoundFile::create(buffer).expect("cfb: create compound file");

            {
                let mut stream = compound_file
                    .create_stream("/EncryptionInfo")
                    .expect("cfb: create EncryptionInfo stream");
                // Minimal placeholder — the guard checks that this stream exists and is within
                // the descriptor size cap, never its content, so any short string will do.
                stream
                    .write_all(b"\x04\x00\x04\x00placeholder")
                    .expect("cfb: write EncryptionInfo");
            }

            {
                let mut stream = compound_file
                    .create_stream("/EncryptedPackage")
                    .expect("cfb: create EncryptedPackage stream");
                // An 8-byte prefix declaring a 16-byte package, far below the segment boundary.
                let mut prefix = [0u8; 24];
                prefix[0..4].copy_from_slice(&16u32.to_le_bytes());
                stream
                    .write_all(&prefix)
                    .expect("cfb: write EncryptedPackage");
            }

            compound_file.into_inner().into_inner()
        };

        let error = OoxmlAdapter::strip_with_key(&malicious_bytes, "test")
            .expect_err("a tiny EncryptedPackage total_size must be rejected");
        match error {
            crate::DecryptError::Malformed(message) => assert!(
                message.contains("smaller than one decryption segment"),
                "the rejection must name the segment bound, got: {message}"
            ),
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    /// Regression: an `EncryptionInfo` stream larger than the descriptor cap must be rejected
    /// as `Malformed` before the descriptor is parsed at all.
    ///
    /// Capping the descriptor is what keeps the cost of reading one a constant of this module
    /// rather than a function of the uploaded file. This fixture uses one oversized
    /// attribute-shaped payload to prove the size gate fires.
    #[test]
    fn rejects_oversized_encryption_info_descriptor() {
        let malicious_bytes = {
            let buffer = Cursor::new(Vec::new());
            let mut compound_file =
                cfb::CompoundFile::create(buffer).expect("cfb: create compound file");

            {
                let mut stream = compound_file
                    .create_stream("/EncryptionInfo")
                    .expect("cfb: create EncryptionInfo stream");
                // Version 4.4 header followed by a start tag padded past the cap with distinct
                // attribute names.
                stream
                    .write_all(b"\x04\x00\x04\x00\x40\x00\x00\x00<keyData")
                    .expect("cfb: write EncryptionInfo header");
                for index in 0..(MAX_ENCRYPTION_INFO_BYTES / 8 + 1) {
                    stream
                        .write_all(format!(" a{index}=\"1\"").as_bytes())
                        .expect("cfb: write EncryptionInfo attribute");
                }
                stream
                    .write_all(b"/>")
                    .expect("cfb: close EncryptionInfo tag");
            }

            {
                let mut stream = compound_file
                    .create_stream("/EncryptedPackage")
                    .expect("cfb: create EncryptedPackage stream");
                // A total_size above the segment boundary, so the reject can only come from
                // the descriptor cap and not the tiny-package guard.
                let mut prefix = [0u8; 24];
                prefix[0..4].copy_from_slice(&8192u32.to_le_bytes());
                stream
                    .write_all(&prefix)
                    .expect("cfb: write EncryptedPackage");
            }

            compound_file.into_inner().into_inner()
        };

        let error = OoxmlAdapter::strip_with_key(&malicious_bytes, "test")
            .expect_err("an oversized EncryptionInfo descriptor must be rejected");
        match error {
            crate::DecryptError::Malformed(message) => assert!(
                message.contains("EncryptionInfo stream is"),
                "the rejection must name the descriptor size cap, got: {message}"
            ),
            other => panic!("expected Malformed, got {other:?}"),
        }
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

    /// The same cap must bind on the decryption path, which reads `spinCount` straight off an
    /// uploaded document: a descriptor asking for four billion SHA-512 rounds is refused
    /// before the hash runs, not after it finishes some hours later.
    #[test]
    fn rejects_excessive_spin_count_in_the_descriptor() {
        let genuine =
            encrypt_agile_with_spin_count("test", &zip_shaped_payload(8192), FAST_SPIN_COUNT);
        let encryption_info = stream_of(&genuine, "/EncryptionInfo");
        let package = stream_of(&genuine, "/EncryptedPackage");

        let descriptor = String::from_utf8(encryption_info[8..].to_vec()).expect("utf-8");
        let spin_count = attribute_value(&descriptor, "spinCount")
            .expect("descriptor carries spinCount")
            .to_owned();
        let attacked = descriptor.replace(
            &format!("spinCount=\"{spin_count}\""),
            "spinCount=\"4000000000\"",
        );
        let mut rewritten = encryption_info[..8].to_vec();
        rewritten.extend_from_slice(attacked.as_bytes());

        assert!(
            matches!(
                OoxmlAdapter::strip_with_key(&compound_document(&rewritten, &package), "test"),
                Err(crate::DecryptError::Unsupported(_))
            ),
            "a four-billion-round spinCount must be refused, not run"
        );
    }

    /// The package guards, exercised with the correct password so nothing short-circuits
    /// before them: a size prefix promising more plaintext than there is ciphertext, two
    /// truncations, a ragged ciphertext, and a stream with no room for the prefix at all.
    /// Every one must be `Malformed`, and none may panic.
    #[test]
    fn rejects_malformed_encrypted_package_shapes() {
        let genuine =
            encrypt_agile_with_spin_count("test", &zip_shaped_payload(8192), FAST_SPIN_COUNT);

        let size_prefix = |plaintext_length: u64, ciphertext_length: usize| {
            let mut package = plaintext_length.to_le_bytes().to_vec();
            package.extend_from_slice(&filler(ciphertext_length));
            package
        };

        let cases: [(&str, Vec<u8>); 6] = [
            // The prefix claims a package far larger than the ciphertext can produce.
            ("size prefix lies upward", size_prefix(1_000_000, 8192)),
            // One segment short of what the prefix promises.
            ("truncated by a segment", size_prefix(8192, 4096)),
            // One cipher block short of what the prefix promises.
            ("truncated by a block", size_prefix(8192, 8176)),
            // Ciphertext that is not a whole number of cipher blocks.
            ("ragged ciphertext", size_prefix(8192, 8190)),
            // No room for the eight-byte size prefix.
            ("no size prefix", vec![0u8; 4]),
            // A prefix whose high word is set: larger than any addressable package.
            ("size prefix beyond addressable memory", {
                let mut package = u64::MAX.to_le_bytes().to_vec();
                package.extend_from_slice(&filler(8192));
                package
            }),
        ];

        for (label, package) in cases {
            let malicious_bytes = with_encrypted_package(&genuine, &package);
            let error = match OoxmlAdapter::strip_with_key(&malicious_bytes, "test") {
                Ok(_) => panic!("{label} must be rejected"),
                Err(error) => error,
            };
            assert!(
                matches!(error, crate::DecryptError::Malformed(_)),
                "{label} must be Malformed, got {error:?}"
            );
        }
    }

    /// A package whose ciphertext is well-formed but is not this document's — the password
    /// verifies, the loop runs to completion, and the result is not an archive. That is a
    /// corrupt container, not a wrong password, and the two must not be reported alike.
    #[test]
    fn rejects_a_package_that_decrypts_to_something_that_is_not_a_zip() {
        let genuine =
            encrypt_agile_with_spin_count("test", &zip_shaped_payload(8192), FAST_SPIN_COUNT);
        let mut package = 8192u64.to_le_bytes().to_vec();
        package.extend_from_slice(&filler(8192));

        let error =
            OoxmlAdapter::strip_with_key(&with_encrypted_package(&genuine, &package), "test")
                .expect_err("a package of noise must be rejected");
        match error {
            crate::DecryptError::Malformed(message) => assert!(
                message.contains("ZIP local-file-header"),
                "the rejection must name the missing archive signature, got: {message}"
            ),
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    /// A deterministic sweep of mutations over a genuine encrypted document: truncations at
    /// every eighth of the file, and single-byte flips at a fixed stride. None may panic, and
    /// none may yield anything that is not an archive.
    #[test]
    fn mutated_containers_never_panic() {
        let genuine =
            encrypt_agile_with_spin_count("test", &zip_shaped_payload(8192), FAST_SPIN_COUNT);

        let mut mutations: Vec<Vec<u8>> = Vec::new();
        for eighth in 1..8usize {
            mutations.push(genuine[..genuine.len() * eighth / 8].to_vec());
        }
        for offset in (0..genuine.len()).step_by(97) {
            let mut mutated = genuine.clone();
            mutated[offset] ^= 0xff;
            mutations.push(mutated);
        }

        for (index, mutated) in mutations.iter().enumerate() {
            for password in ["test", "wrong"] {
                match OoxmlAdapter::strip_with_key(mutated, password) {
                    Ok(file) => assert!(
                        file.bytes.starts_with(b"PK\x03\x04"),
                        "mutation {index} produced a non-archive result"
                    ),
                    Err(
                        crate::DecryptError::Malformed(_)
                        | crate::DecryptError::WrongPassword
                        | crate::DecryptError::NotEncrypted
                        | crate::DecryptError::Unsupported(_),
                    ) => {}
                }
            }
        }
    }

    /// ECMA-376 standard encryption (Office 2007): AES-128-ECB under a SHA-1-derived key. The
    /// scheme predates agile encryption and is still accepted for documents that carry it.
    #[test]
    fn strips_standard_encryption_with_correct_password() {
        let payload = zip_shaped_payload(9001);
        let encrypted = encrypt_standard("test", &payload, ALGORITHM_IDENTIFIER_AES_128);
        let out = OoxmlAdapter::strip_with_key(&encrypted, "test").expect("decrypts");
        assert_eq!(
            out.bytes, payload,
            "a standard-encrypted package must round-trip exactly"
        );
    }

    #[test]
    fn rejects_wrong_password_on_standard_encryption() {
        let encrypted = encrypt_standard(
            "test",
            &zip_shaped_payload(8192),
            ALGORITHM_IDENTIFIER_AES_128,
        );
        assert!(
            matches!(
                OoxmlAdapter::strip_with_key(&encrypted, "nope").unwrap_err(),
                crate::DecryptError::WrongPassword
            ),
            "the standard-encryption verifier must refuse a wrong password"
        );
    }

    /// The legacy RC4 CryptoAPI cipher is refused by name rather than attempted. It is the one
    /// scheme deliberately not implemented here, so the refusal must be unmistakable.
    #[test]
    fn refuses_standard_encryption_with_rc4() {
        let encrypted =
            encrypt_standard("test", &zip_shaped_payload(8192), ALGORITHM_IDENTIFIER_RC4);
        let error = OoxmlAdapter::strip_with_key(&encrypted, "test")
            .expect_err("RC4 standard encryption must be refused");
        match error {
            crate::DecryptError::Unsupported(message) => assert!(
                message.contains("RC4"),
                "the refusal must name RC4, got: {message}"
            ),
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    /// An `EncryptionInfo` version neither half of this module implements must be refused by
    /// name — never decrypted under a guessed scheme.
    #[test]
    fn refuses_unknown_encryption_info_version() {
        let genuine =
            encrypt_agile_with_spin_count("test", &zip_shaped_payload(8192), FAST_SPIN_COUNT);
        let mut encryption_info = stream_of(&genuine, "/EncryptionInfo");
        let package = stream_of(&genuine, "/EncryptedPackage");

        // Version 5.0 — extensible encryption, which this module does not implement.
        encryption_info[..4].copy_from_slice(&[5, 0, 0, 0]);

        assert!(
            matches!(
                OoxmlAdapter::strip_with_key(
                    &compound_document(&encryption_info, &package),
                    "test"
                ),
                Err(crate::DecryptError::Unsupported(_))
            ),
            "an unimplemented EncryptionInfo version must be Unsupported"
        );
    }

    /// A compound document with no `EncryptionInfo` stream is not encrypted — the shape a
    /// legacy Word 97 binary document takes, which this adapter reports rather than parses.
    #[test]
    fn reports_a_compound_file_without_encryption_info_as_not_encrypted() {
        let mut compound_file =
            cfb::CompoundFile::create(Cursor::new(Vec::new())).expect("cfb: create");
        compound_file
            .create_stream("/WordDocument")
            .expect("cfb: create WordDocument")
            .write_all(b"not encrypted at all")
            .expect("cfb: write WordDocument");
        let bytes = compound_file.into_inner().into_inner();

        assert!(matches!(
            OoxmlAdapter::strip_with_key(&bytes, "test"),
            Err(crate::DecryptError::NotEncrypted)
        ));
    }

    #[test]
    fn element_named_ignores_namespace_prefixes() {
        let xml = r#"<encryption><keyData saltValue="AA=="/><p:encryptedKey spinCount="1"/></encryption>"#;
        assert_eq!(
            element_named(xml, "keyData"),
            Some(r#"<keyData saltValue="AA=="/>"#)
        );
        assert_eq!(
            element_named(xml, "encryptedKey"),
            Some(r#"<p:encryptedKey spinCount="1"/>"#)
        );
        assert_eq!(element_named(xml, "absent"), None);
        assert_eq!(element_named("no elements here", "keyData"), None);
        assert_eq!(element_named("<unterminated", "unterminated"), None);
    }

    #[test]
    fn aes_helpers_refuse_bad_lengths_without_panicking() {
        assert!(aes_cbc_decrypt(&[0u8; 32], &[0u8; 16], &[0u8; 15]).is_none());
        assert!(aes_cbc_decrypt(&[0u8; 31], &[0u8; 16], &[0u8; 16]).is_none());
        assert!(aes_cbc_decrypt(&[0u8; 32], &[0u8; 15], &[0u8; 16]).is_none());
        assert!(aes_cbc_decrypt(&[0u8; 32], &[0u8; 16], &[]).is_none());
        assert!(aes_ecb_decrypt(&[0u8; 16], &[0u8; 17]).is_none());
        assert!(aes_ecb_decrypt(&[0u8; 17], &[0u8; 16]).is_none());
        assert!(aes_ecb_decrypt(&[0u8; 16], &[]).is_none());
        assert!(aes_ecb_decrypt(&[0u8; 24], &[0u8; 32]).is_some());
        assert!(aes_ecb_decrypt(&[0u8; 32], &[0u8; 32]).is_some());
    }
}
