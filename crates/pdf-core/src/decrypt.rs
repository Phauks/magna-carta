//! PDF Standard Security Handler — the unlock (decrypt) side.
//!
//! [`decrypt`] turns a password-protected PDF into plaintext bytes so the rest of
//! the engine (render, redact, scrub, detect, forms) can operate on it. It is a
//! byte-to-byte transform: every string and stream is decrypted and the `/Encrypt`
//! dictionary is dropped, so the output parses in any engine — `hayro` included —
//! with no password. Decrypting once to bytes is what lets the two independent
//! parsers (`hayro` for render, `lopdf` for the model) both see a protected input
//! without either having to coordinate on keys.

use lopdf::{Document, LoadOptions};

/// What a security-handler operation can fail at.
///
/// No logging happens here and no variant carries the password or any document
/// content — the consuming surface owns error reporting (Error-ID correlation,
/// redaction), and a password must never reach a log line or error payload.
#[derive(Debug, PartialEq, Eq)]
pub enum SecureError {
    /// The bytes are not a parseable PDF.
    Parse,
    /// The supplied password did not open the document.
    WrongPassword,
    /// The document uses a security handler this engine does not implement
    /// (e.g. a public-key / certificate handler).
    UnsupportedHandler,
    /// The decrypted (or secured) document could not be re-serialised.
    Reassemble,
}

/// Decrypt a password-protected PDF to plaintext bytes.
///
/// A document that is not encrypted is returned unchanged, so callers need not
/// pre-check. The output never carries an `/Encrypt` dictionary. A wrong password
/// yields [`SecureError::WrongPassword`] (distinct from [`SecureError::Parse`]) so
/// a caller can re-prompt rather than report a corrupt file.
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError> {
    // A plain load fully reads an unencrypted file but surfaces only the `/Encrypt`
    // dictionary of an encrypted one — lopdf cannot enumerate encrypted objects
    // without the key. So detect cheaply here, then (only if needed) reload WITH the
    // password, which decrypts every string and stream during the read. The two-step
    // "load then Document::decrypt" path does NOT work: the objects were never read.
    let probe = Document::load_mem(bytes).map_err(|_| SecureError::Parse)?;
    if !probe.is_encrypted() {
        return Ok(bytes.to_vec());
    }
    let mut doc = Document::load_mem_with_options(bytes, LoadOptions::with_password(password))
        .map_err(map_unlock_error)?;
    // The reader drops the encryption dictionary object during a password load; clear
    // any lingering trailer reference so the output is plain and needs no password.
    doc.trailer.remove(b"Encrypt");
    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|_| SecureError::Reassemble)?;
    Ok(output)
}

/// Classify a `lopdf` unlock failure. A bad password and an unsupported scheme are
/// distinguished; everything else is treated as an unreadable encryption setup.
fn map_unlock_error(err: lopdf::Error) -> SecureError {
    use lopdf::encryption::DecryptionError as D;
    match err {
        lopdf::Error::InvalidPassword => SecureError::WrongPassword,
        lopdf::Error::Decryption(D::IncorrectPassword)
        | lopdf::Error::Decryption(D::Padding)
        | lopdf::Error::Decryption(D::InvalidHashLength) => SecureError::WrongPassword,
        lopdf::Error::Decryption(D::UnsupportedEncryption)
        | lopdf::Error::Decryption(D::UnsupportedVersion)
        | lopdf::Error::Decryption(D::UnsupportedRevision) => SecureError::UnsupportedHandler,
        _ => SecureError::Parse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
    use lopdf::{dictionary, EncryptionState, EncryptionVersion, Object, Permissions, Stream};
    use std::collections::BTreeMap;
    use std::sync::Arc;

    /// A minimal single-page Letter PDF built with lopdf, serialised to bytes.
    /// Built programmatically (rather than from an external fixture) so lopdf
    /// re-loads its own output cleanly and hayro renders the blank page.
    fn minimal_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(vec![]),
            b"Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let page_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]),
            b"Contents" => Object::Reference(content_id),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
        });
        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set(b"Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages_dict.set(b"Count", Object::Integer(1));
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialise minimal pdf");
        bytes
    }

    /// Encrypt a plaintext PDF to AES-256 (V5/R6) for the round-trip fixtures. A
    /// fixed file-encryption key keeps the test deterministic — the real `secure`
    /// path (built next) generates a random key.
    fn encrypt_aes256(plain: &[u8], owner: &str, user: &str) -> Vec<u8> {
        let mut doc = Document::load_mem(plain).expect("load plaintext fixture");
        let key = [7u8; 32];
        let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
        let version = EncryptionVersion::V5 {
            encrypt_metadata: true,
            crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
            file_encryption_key: &key,
            stream_filter: b"StdCF".to_vec(),
            string_filter: b"StdCF".to_vec(),
            owner_password: owner,
            user_password: user,
            permissions: Permissions::PRINTABLE
                | Permissions::COPYABLE
                | Permissions::COPYABLE_FOR_ACCESSIBILITY
                | Permissions::PRINTABLE_IN_HIGH_QUALITY,
        };
        let state = EncryptionState::try_from(version).expect("build V5 encryption state");
        doc.encrypt(&state).expect("encrypt to AES-256");
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise encrypted document");
        out
    }

    /// The spike: prove lopdf's whole-document decrypt produces bytes that the
    /// `hayro` render path opens, and that the unlock/error/identity contracts hold.
    #[test]
    fn probe_decrypt_roundtrips_through_hayro() {
        let encrypted = encrypt_aes256(&minimal_pdf(), "owner-secret", "open-secret");

        // Sanity: the fixture really is encrypted.
        assert!(Document::load_mem(&encrypted)
            .expect("parse encrypted")
            .is_encrypted());

        // Unlock with the user (open) password → plaintext.
        let decrypted = decrypt(&encrypted, "open-secret").expect("decrypt with user password");

        // No /Encrypt survives.
        assert!(!Document::load_mem(&decrypted)
            .expect("parse decrypted")
            .is_encrypted());

        // The decrypted bytes load and render in the hayro engine (the cross-parser proof).
        let doc = crate::Document::load(decrypted).expect("hayro loads decrypted bytes");
        assert_eq!(doc.page_count(), 1);
        let page = doc
            .render_page(0, 72.0, false)
            .expect("hayro renders page 0");
        assert!(!page.data.is_empty());

        // Wrong password is distinguishable from a parse failure.
        assert_eq!(
            decrypt(&encrypted, "not-the-password"),
            Err(SecureError::WrongPassword)
        );

        // An unencrypted input is returned unchanged.
        let plain = minimal_pdf();
        assert_eq!(decrypt(&plain, ""), Ok(plain.clone()));
    }
}
