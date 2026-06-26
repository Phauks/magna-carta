use crate::{DecryptError, DecryptedFile};
use lopdf::Document;

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
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENCRYPTED: &[u8] = include_bytes!("../tests/fixtures/pdf_userpw_test.pdf");

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
    fn rejects_non_encrypted_input() {
        // Minimal valid %PDF- header with no /Encrypt dict; we use a known-good decrypted
        // output as a "plain" file proxy.
        let plain = PdfAdapter::strip_with_key(ENCRYPTED, "test").unwrap();
        let err = PdfAdapter::strip_with_key(&plain.bytes, "test").unwrap_err();
        assert!(matches!(err, crate::DecryptError::NotEncrypted));
    }
}
