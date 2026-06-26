use crate::{DecryptError, DecryptedFile};
use std::io::{Cursor, Read};
use zip::result::ZipError;

pub struct ZipAdapter;

impl ZipAdapter {
    /// Decrypt the first entry of a password-protected ZIP archive and return the plaintext bytes.
    ///
    /// Supports both WinZip-AES (AES-128 and AES-256) and legacy ZipCrypto encryption. For a
    /// single-entry archive the decrypted entry bytes are returned directly along with the entry
    /// name. For the slice-1 contract only the first entry is processed.
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

        let filename_hint = Some(entry.name().to_owned());
        let mut plaintext = Vec::new();
        entry
            .read_to_end(&mut plaintext)
            .map_err(|error| DecryptError::Malformed(error.to_string()))?;

        Ok(DecryptedFile {
            bytes: plaintext,
            filename_hint,
        })
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
        let options = SimpleFileOptions::default().with_deprecated_encryption(password);
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
}
