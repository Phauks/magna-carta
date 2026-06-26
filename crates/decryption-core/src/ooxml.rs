use crate::{DecryptError, DecryptedFile};

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
            use std::io::Read;

            let cursor = std::io::Cursor::new(bytes);
            let mut compound_file = cfb::CompoundFile::open(cursor).map_err(|error| {
                DecryptError::Malformed(format!("not a valid OLE2/CFB compound file: {error}"))
            })?;

            if !compound_file.is_stream("/EncryptionInfo") {
                return Err(DecryptError::Malformed(
                    "OLE2 compound file is missing the required EncryptionInfo stream".to_owned(),
                ));
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
}
