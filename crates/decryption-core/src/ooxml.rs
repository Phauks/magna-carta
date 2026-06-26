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
}
