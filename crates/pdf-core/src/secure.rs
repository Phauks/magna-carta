//! PDF Standard Security Handler — the protect (encrypt) side.
//!
//! [`secure`] applies password protection to a PDF. It writes **AES-256 (V5/R6, PDF
//! 2.0)** by default and never emits the weak RC4 cipher. An AES-128 path exists for
//! reader-compatibility but is opt-in. The cipher work is lopdf's; this module owns the
//! firm policy: the password and permission model, and the honest treatment of what PDF
//! permissions actually guarantee (see [`crate::Permissions`]).

use crate::{Permissions, SecureError};
use lopdf::encryption::crypt_filters::{Aes128CryptFilter, Aes256CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Object, StringFormat};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Which cipher [`secure`] writes.
#[derive(Debug, Default, PartialEq, Eq, Clone, Copy)]
pub enum WriteAlgorithm {
    /// AES-256 (V5/R6, PDF 2.0) — the default and recommended cipher.
    #[default]
    Aes256,
    /// AES-128 (V4) — for older readers only; opt-in. Still never RC4.
    Aes128,
}

/// How to protect a document.
///
/// `user_password` is the **open** password — `None` produces a document that opens
/// without a prompt but still carries the owner password and permission policy. The
/// `owner_password` always governs permission changes. Permission bits are advisory
/// (see [`crate::Permissions`]); the open password plus the cipher is the real control.
#[derive(Clone)]
pub struct SecureOptions {
    pub owner_password: String,
    pub user_password: Option<String>,
    pub permissions: Permissions,
    pub encrypt_metadata: bool,
    pub algorithm: WriteAlgorithm,
}

// Hand-written so the passwords can never reach a log, error, or panic via `{:?}`.
// A derived `Debug` would print both passwords verbatim.
impl std::fmt::Debug for SecureOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecureOptions")
            .field("owner_password", &"<redacted>")
            .field(
                "user_password",
                &self.user_password.as_ref().map(|_| "<redacted>"),
            )
            .field("permissions", &self.permissions)
            .field("encrypt_metadata", &self.encrypt_metadata)
            .field("algorithm", &self.algorithm)
            .finish()
    }
}

/// Encrypt a PDF, returning the protected bytes.
///
/// Writes AES-256 by default. The input must not already be encrypted — unlock it with
/// [`crate::decrypt`] first (this yields [`SecureError::AlreadyEncrypted`]).
pub fn secure(bytes: &[u8], opts: &SecureOptions) -> Result<Vec<u8>, SecureError> {
    let mut doc = Document::load_mem(bytes).map_err(|_| SecureError::Parse)?;
    if doc.is_encrypted() {
        return Err(SecureError::AlreadyEncrypted);
    }

    let permissions = opts.permissions.to_lopdf();
    let user_password = opts.user_password.as_deref().unwrap_or("");

    let state = match opts.algorithm {
        WriteAlgorithm::Aes256 => {
            // R6 derives the file key independently of the document, so the 32 random
            // bytes are the actual AES-256 key. The OS RNG serves web (wasm) and native.
            let mut key = [0u8; 32];
            getrandom::fill(&mut key).map_err(|_| SecureError::Reassemble)?;
            let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
            let version = EncryptionVersion::V5 {
                encrypt_metadata: opts.encrypt_metadata,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
                file_encryption_key: &key,
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password: &opts.owner_password,
                user_password,
                permissions,
            };
            EncryptionState::try_from(version).map_err(|_| SecureError::Reassemble)?
        }
        WriteAlgorithm::Aes128 => {
            // V4 (R4) derives the key from the document /ID; ensure one exists.
            ensure_file_id(&mut doc)?;
            let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
            let version = EncryptionVersion::V4 {
                document: &doc,
                encrypt_metadata: opts.encrypt_metadata,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password: &opts.owner_password,
                user_password,
                permissions,
            };
            EncryptionState::try_from(version).map_err(|_| SecureError::Reassemble)?
        }
    };

    doc.encrypt(&state).map_err(|_| SecureError::Reassemble)?;
    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|_| SecureError::Reassemble)?;
    Ok(output)
}

/// Ensure the trailer carries a file `/ID` (two 16-byte strings), generating a random
/// one if absent. Required by the V2/V4 key derivation; harmless otherwise.
fn ensure_file_id(doc: &mut Document) -> Result<(), SecureError> {
    if doc.trailer.get(b"ID").is_ok() {
        return Ok(());
    }
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).map_err(|_| SecureError::Reassemble)?;
    let element = Object::String(id.to_vec(), StringFormat::Hexadecimal);
    doc.trailer
        .set(b"ID", Object::Array(vec![element.clone(), element]));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{inspect_security, Algorithm};
    use lopdf::{dictionary, Stream};

    /// A minimal single-page Letter PDF built with lopdf — lopdf re-loads its own output
    /// cleanly and hayro renders the blank page.
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

    fn opts(user: Option<&str>) -> SecureOptions {
        SecureOptions {
            owner_password: "owner".to_string(),
            user_password: user.map(str::to_string),
            permissions: Permissions::all_allowed(),
            encrypt_metadata: true,
            algorithm: WriteAlgorithm::Aes256,
        }
    }

    #[test]
    fn secure_then_decrypt_roundtrips() {
        let secured = secure(&minimal_pdf(), &opts(Some("open"))).expect("secure");
        assert!(Document::load_mem(&secured).unwrap().is_encrypted());
        let plain = crate::decrypt(&secured, "open").expect("decrypt the secured doc");
        let doc = crate::Document::load(plain).expect("hayro loads the unlocked doc");
        assert_eq!(doc.page_count(), 1);
    }

    #[test]
    fn secure_defaults_to_aes256() {
        let secured = secure(&minimal_pdf(), &opts(Some("open"))).expect("secure");
        assert_eq!(
            inspect_security(&secured).unwrap().algorithm,
            Algorithm::Aes256
        );
    }

    #[test]
    fn secure_aes128_is_opt_in() {
        let mut o = opts(Some("open"));
        o.algorithm = WriteAlgorithm::Aes128;
        let secured = secure(&minimal_pdf(), &o).expect("secure AES-128");
        assert_eq!(
            inspect_security(&secured).unwrap().algorithm,
            Algorithm::Aes128
        );
    }

    #[test]
    fn secure_owner_only_opens_without_user_password() {
        // No open password: the document opens with the empty password but is still encrypted.
        let secured = secure(&minimal_pdf(), &opts(None)).expect("secure");
        let info = inspect_security(&secured).unwrap();
        assert!(info.encrypted);
        assert!(!info.has_user_password);
        // Opening with the empty password must yield actually-DECRYPTED bytes — not the
        // still-encrypted input handed back (the empty-password auto-open passthrough trap).
        let plain = crate::decrypt(&secured, "").expect("opens with the empty password");
        assert!(!Document::load_mem(&plain).unwrap().is_encrypted());
        crate::Document::load(plain).expect("hayro loads the unlocked owner-only doc");
    }

    #[test]
    fn secure_aes128_round_trips_through_decrypt() {
        // Writing AES-128 must produce a document that actually decrypts and renders,
        // not merely one that inspects as AES-128.
        let mut o = opts(Some("open"));
        o.algorithm = WriteAlgorithm::Aes128;
        let secured = secure(&minimal_pdf(), &o).expect("secure AES-128");
        let plain = crate::decrypt(&secured, "open").expect("decrypt AES-128 output");
        assert!(!Document::load_mem(&plain).unwrap().is_encrypted());
        assert_eq!(crate::Document::load(plain).unwrap().page_count(), 1);
    }

    #[test]
    fn secure_all_eight_permission_bits_round_trip() {
        // A distinct on/off pattern across every bit catches a transposed flag in
        // Permissions::to_lopdf / from_p that the copy/modify-only tests would miss.
        let perms = Permissions {
            print: true,
            print_high_res: false,
            copy: true,
            modify: false,
            annotate: true,
            fill_forms: false,
            assemble: true,
            accessibility_copy: false,
        };
        let mut o = opts(Some("open"));
        o.permissions = perms;
        let secured = secure(&minimal_pdf(), &o).expect("secure");
        let got = inspect_security(&secured)
            .unwrap()
            .permissions
            .expect("password-required doc exposes permissions");
        assert_eq!(got, perms);
    }

    #[test]
    fn load_protected_opens_an_encrypted_document() {
        let secured = secure(&minimal_pdf(), &opts(Some("open"))).expect("secure");
        let doc =
            crate::Document::load_protected(secured.clone(), "open").expect("load_protected ok");
        assert_eq!(doc.page_count(), 1);
        // A wrong password propagates as WrongPassword, not Parse.
        assert_eq!(
            crate::Document::load_protected(secured, "wrong").err(),
            Some(SecureError::WrongPassword)
        );
    }

    #[test]
    fn secure_wrong_password_fails_to_decrypt() {
        let secured = secure(&minimal_pdf(), &opts(Some("open"))).expect("secure");
        assert_eq!(
            crate::decrypt(&secured, "wrong"),
            Err(SecureError::WrongPassword)
        );
    }

    #[test]
    fn secure_permissions_survive() {
        let mut o = opts(Some("open"));
        o.permissions = Permissions {
            copy: false,
            modify: false,
            ..Permissions::all_allowed()
        };
        let secured = secure(&minimal_pdf(), &o).expect("secure");
        let p = inspect_security(&secured)
            .unwrap()
            .permissions
            .expect("password-required doc exposes permissions");
        assert!(!p.copy);
        assert!(!p.modify);
        assert!(p.print);
    }

    #[test]
    fn secure_rejects_already_encrypted_input() {
        let secured = secure(&minimal_pdf(), &opts(Some("open"))).expect("secure");
        assert_eq!(
            secure(&secured, &opts(Some("again"))),
            Err(SecureError::AlreadyEncrypted)
        );
    }

    #[test]
    fn secure_options_debug_redacts_passwords() {
        // SecureOptions holds plaintext passwords; its Debug must never print them, so a
        // stray {:?} in a future log or error cannot leak them.
        let o = SecureOptions {
            owner_password: "OWNER-SECRET".to_string(),
            user_password: Some("USER-SECRET".to_string()),
            ..opts(None)
        };
        let shown = format!("{o:?}");
        assert!(!shown.contains("OWNER-SECRET"));
        assert!(!shown.contains("USER-SECRET"));
        assert!(shown.contains("redacted"));
    }
}
