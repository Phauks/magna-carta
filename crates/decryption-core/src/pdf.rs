use crate::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};
use aes::cipher::block_padding::NoPadding;
use aes::cipher::{BlockModeEncrypt, KeyIvInit};
use lopdf::{Document, Object};
use md5::Md5;
use sha2::{Digest, Sha256, Sha384, Sha512};

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

/// The 32-byte padding string from ISO 32000-1 Algorithm 2, used to pad short
/// passwords for the revision 2-4 key derivation.
const PASSWORD_PAD: [u8; 32] = [
    0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
    0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
];

pub struct PdfAdapter;

impl PdfAdapter {
    /// Decrypt a password-protected PDF and return the plaintext bytes.
    ///
    /// The returned bytes are a valid, unencrypted PDF that can be re-opened without a
    /// password. The caller supplies either the user or the owner password; lopdf tries
    /// both.
    ///
    /// Errors:
    /// - `DecryptError::NotEncrypted`  — the file has no /Encrypt dictionary.
    /// - `DecryptError::WrongPassword` — the supplied password does not authenticate.
    /// - `DecryptError::Malformed`     — lopdf cannot parse the bytes as a PDF.
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        let mut doc = Document::load_mem(bytes)
            .map_err(|error| DecryptError::Malformed(error.to_string()))?;

        if !doc.is_encrypted() {
            return Err(DecryptError::NotEncrypted);
        }

        // `Document::decrypt` tries the user password then the owner password and removes
        // the /Encrypt dictionary from the in-memory document on success, so a subsequent
        // `save_to` writes a fully de-encrypted PDF.
        //
        // A failed authentication surfaces as `Error::Decryption(DecryptionError::IncorrectPassword)`
        // or `Error::Decryption(DecryptionError::Padding)` (AES bad-padding when the key is wrong).
        // `Error::InvalidPassword` is used only by the streaming reader, not by `decrypt()`.
        doc.decrypt(password).map_err(|error| match &error {
            lopdf::Error::InvalidPassword
            | lopdf::Error::Decryption(lopdf::encryption::DecryptionError::IncorrectPassword)
            | lopdf::Error::Decryption(lopdf::encryption::DecryptionError::Padding) => {
                DecryptError::WrongPassword
            }
            lopdf::Error::NotEncrypted => DecryptError::NotEncrypted,
            _ => DecryptError::Malformed(error.to_string()),
        })?;

        let mut output = Vec::new();
        doc.save_to(&mut output)
            .map_err(|error| DecryptError::Malformed(error.to_string()))?;

        Ok(DecryptedFile {
            bytes: output,
            filename_hint: None,
        })
    }

    /// Read the `/Encrypt` dictionary and trailer `/ID`, and emit the John/hashcat
    /// `$pdf$` hash string plus the matching hashcat mode and parsed parameters.
    ///
    /// The hash is consumable directly by hashcat (modes 10400/10500/10600/10700 by
    /// revision) and by the in-house `verify_guess` light rung.
    ///
    /// Errors:
    /// - `ExtractError::NotEncrypted` — the file has no `/Encrypt` dictionary.
    /// - `ExtractError::Unsupported` — an encryption version/revision we do not model.
    /// - `ExtractError::Malformed`   — lopdf cannot parse the bytes, or a required
    ///   `/Encrypt` field is missing or the wrong type.
    pub fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
        let doc = Document::load_mem(bytes)
            .map_err(|error| ExtractError::Malformed(error.to_string()))?;

        if !doc.is_encrypted() {
            return Err(ExtractError::NotEncrypted);
        }

        let encrypt = doc
            .get_encrypted()
            .map_err(|error| ExtractError::Malformed(error.to_string()))?;

        let dict_i64 = |key: &[u8]| -> Result<i64, ExtractError> {
            encrypt
                .get(key)
                .and_then(Object::as_i64)
                .map_err(|_| ExtractError::Malformed(format!("/Encrypt missing /{}", as_str(key))))
        };

        let v = u8::try_from(dict_i64(b"V")?)
            .map_err(|_| ExtractError::Unsupported("encryption version out of range".into()))?;
        let r = u8::try_from(dict_i64(b"R")?)
            .map_err(|_| ExtractError::Unsupported("encryption revision out of range".into()))?;

        // The standard security handler we model spans V1/V2 (RC4), V4 (crypt
        // filters), and V5 (AES-256). Anything else is an unhandled handler.
        if !matches!(v, 1 | 2 | 4 | 5) {
            return Err(ExtractError::Unsupported(format!("/V {v}")));
        }

        // hashcat mode is keyed off the revision: R2 RC4-40, R3/R4 RC4/AESV2,
        // R5 the deprecated single-SHA-256 AES-256, R6 the hardened AES-256.
        let hashcat_mode = match r {
            2 => 10400,
            3 | 4 => 10500,
            5 => 10600,
            6 => 10700,
            _ => return Err(ExtractError::Unsupported(format!("/R {r}"))),
        };

        // /Length is the file-encryption-key length in bits (default 40 for the
        // legacy handler); V5 always uses a 256-bit key regardless of /Length.
        let key_bits = if r >= 5 {
            256
        } else {
            u32::try_from(dict_i64(b"Length").unwrap_or(40))
                .map_err(|_| ExtractError::Malformed("/Length out of range".into()))?
        };

        // The legacy RC4 handler (R2-R4) accepts key lengths of 40-128 bits (5-16 bytes).
        // A /Length above 128 would require slicing past the 16-byte MD5 output in the key
        // derivation, and /Length 0 would produce an empty RC4 key where i % 0 is undefined.
        // Reject the document rather than carrying a value that panics in the crypto path.
        if r <= 4 && !(40..=128).contains(&key_bits) {
            return Err(ExtractError::Unsupported(format!(
                "/Length {key_bits} is outside the valid 40-128 bit range for /R {r}"
            )));
        }

        // /P is stored as a 32-bit signed integer, often written as its unsigned
        // bit pattern; fold it back to signed 32-bit for the hash string.
        let p = dict_i64(b"P")? as i32;

        let encrypt_metadata = encrypt
            .get(b"EncryptMetadata")
            .and_then(Object::as_bool)
            .unwrap_or(true);

        let dict_bytes = |key: &[u8]| -> Result<Vec<u8>, ExtractError> {
            encrypt
                .get(key)
                .and_then(Object::as_str)
                .map(<[u8]>::to_vec)
                .map_err(|_| ExtractError::Malformed(format!("/Encrypt missing /{}", as_str(key))))
        };

        let u = dict_bytes(b"U")?;
        let o = dict_bytes(b"O")?;
        let (ue, oe) = if r >= 5 {
            (dict_bytes(b"UE")?, dict_bytes(b"OE")?)
        } else {
            (Vec::new(), Vec::new())
        };

        // The first element of the trailer /ID feeds the legacy key derivation;
        // a missing /ID is treated as an empty identifier (some producers omit it).
        let id = doc
            .trailer
            .get(b"ID")
            .and_then(Object::as_array)
            .ok()
            .and_then(|array| array.first())
            .and_then(|object| object.as_str().ok())
            .map(<[u8]>::to_vec)
            .unwrap_or_default();

        let params = KdfParams::Pdf {
            v,
            r,
            key_bits,
            p,
            encrypt_metadata,
            id,
            u,
            o,
            ue,
            oe,
        };
        let hash = format_pdf_hash(&params);

        Ok(RecoveryJob {
            format: Format::Pdf,
            hash,
            hashcat_mode,
            params,
        })
    }

    /// Parse a `$pdf$` hash string back into `KdfParams::Pdf`. The inverse of the
    /// string built by `extract_hash`, so a caller holding only the hash can still
    /// drive `verify_guess`.
    ///
    /// Errors with `ExtractError::Malformed` on any structural problem (wrong prefix,
    /// too few fields, non-numeric counts, bad hex, or a declared length that does
    /// not match the decoded bytes).
    pub fn parse_hash(hash: &str) -> Result<KdfParams, ExtractError> {
        let body = hash
            .strip_prefix("$pdf$")
            .ok_or_else(|| ExtractError::Unsupported("only the $pdf$ hash is parseable".into()))?;
        let fields: Vec<&str> = body.split('*').collect();
        if fields.len() < 11 {
            return Err(ExtractError::Malformed("too few $pdf$ fields".into()));
        }

        let num = |index: usize| -> Result<i64, ExtractError> {
            fields[index]
                .parse::<i64>()
                .map_err(|_| ExtractError::Malformed(format!("field {index} is not an integer")))
        };
        // A length-prefixed hex field: the count at `index` must equal the decoded
        // byte length at `index + 1`.
        let sized = |index: usize| -> Result<Vec<u8>, ExtractError> {
            let declared = usize::try_from(num(index)?).map_err(|_| {
                ExtractError::Malformed(format!("field {index} length out of range"))
            })?;
            let bytes = crate::hex::decode(fields[index + 1])
                .ok_or_else(|| ExtractError::Malformed("invalid hex field".into()))?;
            if bytes.len() != declared {
                return Err(ExtractError::Malformed(format!(
                    "field {} length {} does not match {} bytes",
                    index,
                    declared,
                    bytes.len()
                )));
            }
            Ok(bytes)
        };

        let v =
            u8::try_from(num(0)?).map_err(|_| ExtractError::Malformed("/V out of range".into()))?;
        let r =
            u8::try_from(num(1)?).map_err(|_| ExtractError::Malformed("/R out of range".into()))?;
        let key_bits = u32::try_from(num(2)?)
            .map_err(|_| ExtractError::Malformed("key length out of range".into()))?;

        // The legacy RC4 handler (R2-R4) accepts key lengths of 40-128 bits (5-16 bytes).
        // A key length above 128 would slice past the 16-byte MD5 output in the key
        // derivation, and 0 bits would produce an empty RC4 key where i % 0 is undefined.
        if r <= 4 && !(40..=128).contains(&key_bits) {
            return Err(ExtractError::Unsupported(format!(
                "key length {key_bits} is outside the valid 40-128 bit range for revision {r}"
            )));
        }

        let p = num(3)? as i32;
        let encrypt_metadata = num(4)? != 0;
        let id = sized(5)?;
        let u = sized(7)?;
        let o = sized(9)?;

        // UE/OE are the intermediate-key blobs needed to recover the file key, but not
        // to validate a password. A full container extraction carries them (15 fields);
        // a hashcat-style password-only `$pdf$` for R5/R6 omits them (11 fields). Accept
        // both — `verify_guess` authenticates from the U/O salts alone.
        let (ue, oe) = if r >= 5 && fields.len() >= 15 {
            (sized(11)?, sized(13)?)
        } else {
            (Vec::new(), Vec::new())
        };

        Ok(KdfParams::Pdf {
            v,
            r,
            key_bits,
            p,
            encrypt_metadata,
            id,
            u,
            o,
            ue,
            oe,
        })
    }

    /// Test a single candidate password against a PDF recovery job without touching
    /// the original file.
    ///
    /// For R5/R6, returns `true` when the candidate authenticates as either the user
    /// or the owner password (both are tested per ISO 32000-2 Algorithm 2.A/2.B). For
    /// legacy R2-R4, only the user password is validated (Algorithms 4 and 5); the
    /// owner-password recovery path (Algorithm 3 reversal) is not implemented on this
    /// rung.
    ///
    /// Returns `false` for any non-PDF job, an unmodelled revision, or a structurally
    /// short password string — a failed guess and an unusable job are both "not a
    /// match" to the caller's cracking loop.
    pub fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool {
        let KdfParams::Pdf {
            r,
            key_bits,
            p,
            encrypt_metadata,
            id,
            u,
            o,
            ..
        } = &job.params
        else {
            return false;
        };

        let password = candidate.as_bytes();
        match r {
            6 => verify_r6(password, u, o),
            5 => verify_r5(password, u, o),
            2..=4 => verify_legacy(password, *r, *key_bits, *p, *encrypt_metadata, id, u, o),
            _ => false,
        }
    }
}

/// Format a `KdfParams::Pdf` as the John/hashcat `$pdf$` string. UE/OE are appended
/// only for R5/R6, matching hashcat modes 10600/10700.
fn format_pdf_hash(params: &KdfParams) -> String {
    let KdfParams::Pdf {
        v,
        r,
        key_bits,
        p,
        encrypt_metadata,
        id,
        u,
        o,
        ue,
        oe,
    } = params
    else {
        return String::new();
    };

    let mut hash = format!(
        "$pdf${v}*{r}*{key_bits}*{p}*{}*{}*{}*{}*{}*{}*{}",
        u8::from(*encrypt_metadata),
        id.len(),
        crate::hex::encode(id),
        u.len(),
        crate::hex::encode(u),
        o.len(),
        crate::hex::encode(o),
    );
    if *r >= 5 {
        hash.push_str(&format!(
            "*{}*{}*{}*{}",
            ue.len(),
            crate::hex::encode(ue),
            oe.len(),
            crate::hex::encode(oe),
        ));
    }
    hash
}

/// ISO 32000-2 Algorithm 2.A validation for R6: the candidate is the user password
/// when `Hash2B(pwd, U-validation-salt, [])` equals `U[0..32]`, or the owner password
/// when `Hash2B(pwd, O-validation-salt, U[0..48])` equals `O[0..32]`.
fn verify_r6(password: &[u8], u: &[u8], o: &[u8]) -> bool {
    if u.len() >= 48 && hash_2b(password, &u[32..40], &[]) == u[0..32] {
        return true;
    }
    if o.len() >= 48 && u.len() >= 48 && hash_2b(password, &o[32..40], &u[0..48]) == o[0..32] {
        return true;
    }
    false
}

/// Deprecated R5 validation: the same salt layout as R6 but a single SHA-256 rather
/// than the hardened Algorithm 2.B loop.
fn verify_r5(password: &[u8], u: &[u8], o: &[u8]) -> bool {
    let sha = |parts: &[&[u8]]| -> [u8; 32] {
        let mut hasher = Sha256::new();
        for part in parts {
            hasher.update(part);
        }
        hasher.finalize().into()
    };
    if u.len() >= 48 && sha(&[password, &u[32..40]]) == u[0..32] {
        return true;
    }
    if o.len() >= 48 && u.len() >= 48 && sha(&[password, &o[32..40], &u[0..48]]) == o[0..32] {
        return true;
    }
    false
}

/// ISO 32000-2 Algorithm 2.B — the hardened hash that backs R6 password validation:
/// seed with SHA-256, then loop AES-128-CBC over `(pwd || K || udata) x 64` and re-hash
/// with SHA-256/384/512 selected by the running byte sum mod 3, terminating once at
/// least 64 rounds have run and the last ciphertext byte has fallen to `round - 32`.
fn hash_2b(password: &[u8], salt: &[u8], udata: &[u8]) -> [u8; 32] {
    let mut k: Vec<u8> = {
        let mut hasher = Sha256::new();
        hasher.update(password);
        hasher.update(salt);
        hasher.update(udata);
        hasher.finalize().to_vec()
    };

    let mut round: usize = 0;
    loop {
        // K1 = (pwd || K || udata) repeated 64 times. The total length is a multiple
        // of 64, hence always AES-block-aligned, so no padding is ever applied.
        let unit_len = password.len() + k.len() + udata.len();
        let mut buffer = Vec::with_capacity(unit_len * 64);
        for _ in 0..64 {
            buffer.extend_from_slice(password);
            buffer.extend_from_slice(&k);
            buffer.extend_from_slice(udata);
        }

        let length = buffer.len();
        Aes128CbcEnc::new_from_slices(&k[0..16], &k[16..32])
            .expect("16-byte AES-128 key and IV")
            .encrypt_padded::<NoPadding>(&mut buffer, length)
            .expect("buffer is block-aligned");
        let e = buffer;

        let sum: u32 = e[0..16].iter().map(|&byte| u32::from(byte)).sum();
        k = match sum % 3 {
            0 => Sha256::digest(&e).to_vec(),
            1 => Sha384::digest(&e).to_vec(),
            _ => Sha512::digest(&e).to_vec(),
        };

        round += 1;
        let last = *e.last().expect("non-empty ciphertext");
        if round >= 64 && usize::from(last) <= round - 32 {
            break;
        }
    }

    let mut out = [0u8; 32];
    out.copy_from_slice(&k[0..32]);
    out
}

/// Validate a candidate against the R2-R4 user key: derive the file-encryption key
/// (Algorithm 2), recompute the `/U` value (Algorithm 4 for R2, Algorithm 5 for R3+),
/// and compare against the stored `/U`.
#[allow(clippy::too_many_arguments)] // the standard handler's key derivation genuinely
                                     // takes the full set of /Encrypt inputs (password, R, key length, P, the metadata flag,
                                     // the file id, and U/O); bundling them into a struct would only hide that.
fn verify_legacy(
    password: &[u8],
    r: u8,
    key_bits: u32,
    p: i32,
    encrypt_metadata: bool,
    id: &[u8],
    u: &[u8],
    o: &[u8],
) -> bool {
    let key = legacy_file_key(password, r, key_bits, p, encrypt_metadata, id, o);

    if r == 2 {
        // Algorithm 4: U is RC4(key, padding).
        let mut computed = PASSWORD_PAD.to_vec();
        rc4_apply(&key, &mut computed);
        return u.len() >= 32 && computed[..] == u[0..32];
    }

    // Algorithm 5: MD5(padding || id), then 20 RC4 passes with the key XORed by the
    // pass index; only the first 16 bytes of /U are defined for R3+.
    let mut computed = {
        let mut hasher = Md5::new();
        hasher.update(PASSWORD_PAD);
        hasher.update(id);
        hasher.finalize().to_vec()
    };
    rc4_apply(&key, &mut computed);
    for i in 1u8..=19 {
        let xored: Vec<u8> = key.iter().map(|&byte| byte ^ i).collect();
        rc4_apply(&xored, &mut computed);
    }
    u.len() >= 16 && computed[..16] == u[0..16]
}

/// ISO 32000-1 Algorithm 2: derive the file-encryption key from the padded password,
/// the `/O` value, `/P`, and the file id (with the R4 metadata tweak), iterated 50x
/// for R3+.
fn legacy_file_key(
    password: &[u8],
    r: u8,
    key_bits: u32,
    p: i32,
    encrypt_metadata: bool,
    id: &[u8],
    o: &[u8],
) -> Vec<u8> {
    // R2 uses a fixed 5-byte key per the spec. R3/R4 derive the length from /Length,
    // which is validated to 40-128 bits (5-16 bytes) at extraction time. The clamp here
    // is a secondary guard: MD5 output is 16 bytes, so key_len above 16 would produce an
    // out-of-bounds slice in the 50-round iteration; key_len=0 makes rc4_apply's keystream
    // modulo undefined.
    let key_len = if r == 2 {
        5
    } else {
        ((key_bits / 8) as usize).clamp(5, 16)
    };

    let mut hasher = Md5::new();
    hasher.update(pad_password(password));
    let owner = if o.len() >= 32 { &o[0..32] } else { o };
    hasher.update(owner);
    hasher.update((p as u32).to_le_bytes());
    hasher.update(id);
    if r >= 4 && !encrypt_metadata {
        hasher.update([0xff, 0xff, 0xff, 0xff]);
    }
    let mut hash = hasher.finalize().to_vec();

    if r >= 3 {
        for _ in 0..50 {
            hash = Md5::digest(&hash[..key_len]).to_vec();
        }
    }
    hash.truncate(key_len);
    hash
}

/// Pad or truncate a password to 32 bytes using the Algorithm 2 padding string.
fn pad_password(password: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let take = password.len().min(32);
    out[..take].copy_from_slice(&password[..take]);
    out[take..].copy_from_slice(&PASSWORD_PAD[..32 - take]);
    out
}

/// Standard RC4 keystream applied in place. The PDF legacy handler uses runtime-variable
/// key lengths (5-16 bytes), which the type-level `rc4` crate key size does not express,
/// so the cipher is kept here as the small, self-contained primitive it is.
fn rc4_apply(key: &[u8], data: &mut [u8]) {
    // An empty key makes the key-scheduling `i % key.len()` undefined (remainder by zero).
    // An empty key is never a valid RC4 key; leave data unchanged so the caller sees a mismatch.
    if key.is_empty() {
        return;
    }
    let mut state: [u8; 256] = core::array::from_fn(|i| i as u8);
    let mut j = 0usize;
    for i in 0..256 {
        j = (j + state[i] as usize + key[i % key.len()] as usize) & 0xff;
        state.swap(i, j);
    }
    let (mut i, mut j) = (0usize, 0usize);
    for byte in data.iter_mut() {
        i = (i + 1) & 0xff;
        j = (j + state[i] as usize) & 0xff;
        state.swap(i, j);
        let k = state[(state[i] as usize + state[j] as usize) & 0xff];
        *byte ^= k;
    }
}

/// Render a dictionary key for diagnostics; keys are ASCII PDF names.
fn as_str(key: &[u8]) -> String {
    String::from_utf8_lossy(key).into_owned()
}

impl FormatAdapter for PdfAdapter {
    fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        PdfAdapter::strip_with_key(bytes, password)
    }

    fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
        PdfAdapter::extract_hash(bytes)
    }

    fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool {
        PdfAdapter::verify_guess(job, candidate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENCRYPTED: &[u8] = include_bytes!("../tests/fixtures/pdf_userpw_test.pdf");
    const ENCRYPTED_AES256: &[u8] = include_bytes!("../tests/fixtures/pdf_aes256_test.pdf");

    // hashcat `example_hashes` mode 10700 (PDF 1.7 Level 8 / R6, AES-256); the
    // password for every hashcat example vector is "hashcat". A password-only
    // `$pdf$` for R6 carries the 48-byte U and O (32-byte hash + 8-byte validation
    // salt + 8-byte key salt) and omits UE/OE, which are needed only to recover the
    // file key, not to validate the password.
    const PDF_R6_EXAMPLE: &str = "$pdf$5*6*256*-4*1*16*381692e488413f5502fa7314a78c25db*48*e5bf81a2a23c88f3dccb44bc7da68bb5606b653b733bcf9adaa5eb2c8ccf53abba66539044eb1957eda68469b1d0b9b5*48*b222df06deb308bf919d13447e688775fdcab972faed2c866dc023a126cb4cd4bbffab3683ecde243cf8d88967184680";

    #[test]
    fn verifies_known_r6_password() {
        let job = RecoveryJob {
            format: Format::Pdf,
            hash: PDF_R6_EXAMPLE.into(),
            hashcat_mode: 10700,
            params: PdfAdapter::parse_hash(PDF_R6_EXAMPLE).expect("parses the example hash"),
        };
        assert!(
            PdfAdapter::verify_guess(&job, "hashcat"),
            "R6 Algorithm 2.A/2.B must accept the published password"
        );
        assert!(
            !PdfAdapter::verify_guess(&job, "wrong"),
            "a wrong guess must not authenticate"
        );
    }

    #[test]
    fn parse_hash_reads_r6_layout() {
        let KdfParams::Pdf {
            v,
            r,
            key_bits,
            u,
            o,
            ..
        } = PdfAdapter::parse_hash(PDF_R6_EXAMPLE).expect("parses")
        else {
            panic!("expected a PDF variant");
        };
        assert_eq!((v, r, key_bits), (5, 6, 256));
        assert_eq!(u.len(), 48);
        assert_eq!(o.len(), 48);
    }

    #[test]
    fn extract_hash_round_trips_rc4_legacy() {
        let job = PdfAdapter::extract_hash(ENCRYPTED).expect("extracts");
        assert!(job.hash.starts_with("$pdf$"));
        assert_eq!(job.hashcat_mode, 10500, "V2/R3 maps to hashcat mode 10500");
        assert!(
            PdfAdapter::verify_guess(&job, "test"),
            "the fixture user password must verify on the legacy path"
        );
        assert!(!PdfAdapter::verify_guess(&job, "nope"));
    }

    #[test]
    fn extract_hash_round_trips_aes256_r6() {
        let job = PdfAdapter::extract_hash(ENCRYPTED_AES256).expect("extracts");
        assert!(job.hash.starts_with("$pdf$"));
        assert_eq!(job.hashcat_mode, 10700, "V5/R6 maps to hashcat mode 10700");
        assert!(
            PdfAdapter::verify_guess(&job, "test"),
            "the fixture password must verify on the R6 path"
        );
        assert!(!PdfAdapter::verify_guess(&job, "nope"));
    }

    #[test]
    fn extract_hash_string_re_parses_to_same_fields() {
        let job = PdfAdapter::extract_hash(ENCRYPTED_AES256).expect("extracts");
        let reparsed = PdfAdapter::parse_hash(&job.hash).expect("re-parses");
        let (KdfParams::Pdf { u: a, o: b, .. }, KdfParams::Pdf { u: c, o: d, .. }) =
            (&job.params, &reparsed)
        else {
            panic!("expected PDF variants");
        };
        assert_eq!(a, c);
        assert_eq!(b, d);
    }

    #[test]
    fn extract_hash_rejects_plain_pdf() {
        let plain = PdfAdapter::strip_with_key(ENCRYPTED, "test").unwrap();
        let err = PdfAdapter::extract_hash(&plain.bytes).unwrap_err();
        assert!(matches!(err, ExtractError::NotEncrypted));
    }

    #[test]
    fn strips_with_correct_password() {
        let out = PdfAdapter::strip_with_key(ENCRYPTED, "test").expect("decrypts");
        assert!(out.bytes.starts_with(b"%PDF"));
        // A decrypted PDF carries no /Encrypt dictionary: re-opening needs no password.
        assert!(lopdf::Document::load_mem(&out.bytes).is_ok());
    }

    #[test]
    fn rejects_wrong_password() {
        let err = PdfAdapter::strip_with_key(ENCRYPTED, "wrong").unwrap_err();
        assert!(matches!(err, crate::DecryptError::WrongPassword));
    }

    #[test]
    fn legacy_malformed_key_bits_rejected_or_verify_safe() {
        // Previously, R3 (and R4) with key_bits=256 caused legacy_file_key to slice
        // hash[..32] on a 16-byte MD5 output (panic: index out of range), and key_bits=0
        // produced an empty RC4 key causing i % 0 in rc4_apply (panic: remainder by zero).
        //
        // Both are now rejected at parse_hash time as Unsupported. A directly constructed
        // RecoveryJob with a malformed key length must also not panic — verify_guess must
        // return false.
        let id_hex = "00".repeat(16);
        let u_hex = "00".repeat(32);
        let o_hex = "00".repeat(32);

        for &key_bits in &[256u32, 0u32] {
            let hash = format!("$pdf$2*3*{key_bits}*-4*1*16*{id_hex}*32*{u_hex}*32*{o_hex}");
            assert!(
                matches!(
                    PdfAdapter::parse_hash(&hash),
                    Err(ExtractError::Unsupported(_))
                ),
                "parse_hash must reject key_bits={key_bits} for R3 as Unsupported"
            );
        }

        // Belt-and-suspenders: a RecoveryJob constructed directly with out-of-range
        // key_bits must not panic; the secondary guards in legacy_file_key and rc4_apply
        // must make verify_guess return false.
        for &key_bits in &[256u32, 0u32] {
            let job = RecoveryJob {
                format: Format::Pdf,
                hash: String::new(),
                hashcat_mode: 10500,
                params: KdfParams::Pdf {
                    v: 2,
                    r: 3,
                    key_bits,
                    p: -4,
                    encrypt_metadata: true,
                    id: vec![0u8; 16],
                    u: vec![0u8; 32],
                    o: vec![0u8; 32],
                    ue: vec![],
                    oe: vec![],
                },
            };
            assert!(
                !PdfAdapter::verify_guess(&job, "any"),
                "verify_guess must return false (not panic) for key_bits={key_bits}"
            );
        }
    }

    #[test]
    fn parse_hash_rejects_non_ascii_hex_field_without_panicking() {
        // "€€" is U+20AC twice: 6 UTF-8 bytes (even byte count). The former
        // byte-offset &str slice `text[0..2]` panicked on char-boundary violation.
        // hex::decode operates on raw bytes, so it returns None → Err, no panic.
        let id_hex = "€€";
        let u_hex = "00".repeat(32);
        let o_hex = "00".repeat(32);
        let hash = format!("$pdf$2*3*128*-4*1*6*{id_hex}*32*{u_hex}*32*{o_hex}");
        assert!(
            PdfAdapter::parse_hash(&hash).is_err(),
            "parse_hash must return Err, not panic, on non-ASCII in a hex field"
        );
    }

    #[test]
    fn rejects_non_encrypted_input() {
        // Minimal valid %PDF- header with no /Encrypt dict; we use a known-good decrypted
        // output as a "plain" file proxy.
        let plain = PdfAdapter::strip_with_key(ENCRYPTED, "test").unwrap();
        let err = PdfAdapter::strip_with_key(&plain.bytes, "test").unwrap_err();
        assert!(matches!(err, crate::DecryptError::NotEncrypted));
    }
}
