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
    /// `secure` was asked to encrypt a document that is already encrypted; unlock it first.
    AlreadyEncrypted,
    /// The decrypted (or secured) document could not be re-serialised.
    Reassemble,
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
}

/// Which security handler a document declares.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Handler {
    /// The password-based Standard Security Handler — what this engine reads and writes.
    Standard,
    /// A public-key (certificate) handler — classified but not opened.
    PublicKey,
    /// The document is not encrypted.
    None,
}

/// The cipher a document's content is protected with.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Algorithm {
    /// RC4 (40–128 bit) — legacy, readable but never written.
    Rc4,
    /// AES-128 (`/AESV2`, V4).
    Aes128,
    /// AES-256 (`/AESV3`, V5/R6, PDF 2.0) — the write target.
    Aes256,
    /// Encrypted, but the cipher could not be read (see [`SecurityInfo`] notes).
    Unknown,
    /// The document is not encrypted.
    None,
}

/// A document's declared permission policy. These bits are **advisory**: they are
/// honoured only by cooperating viewers, and any tool that can open the document can
/// ignore or strip them. The only real confidentiality control is the user (open)
/// password plus the cipher.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Permissions {
    pub print: bool,
    pub print_high_res: bool,
    pub copy: bool,
    pub modify: bool,
    pub annotate: bool,
    pub fill_forms: bool,
    pub assemble: bool,
    pub accessibility_copy: bool,
}

impl Permissions {
    /// Everything allowed — the effective state of an unencrypted document.
    pub fn all_allowed() -> Self {
        Self {
            print: true,
            print_high_res: true,
            copy: true,
            modify: true,
            annotate: true,
            fill_forms: true,
            assemble: true,
            accessibility_copy: true,
        }
    }

    /// Decode the standard `/P` permission bitfield, reusing lopdf's flag definitions.
    fn from_p(p: i64) -> Self {
        use lopdf::Permissions as L;
        let f = L::from_bits_truncate(p as u64);
        Self {
            print: f.contains(L::PRINTABLE),
            print_high_res: f.contains(L::PRINTABLE_IN_HIGH_QUALITY),
            copy: f.contains(L::COPYABLE),
            modify: f.contains(L::MODIFIABLE),
            annotate: f.contains(L::ANNOTABLE),
            fill_forms: f.contains(L::FILLABLE),
            assemble: f.contains(L::ASSEMBLABLE),
            accessibility_copy: f.contains(L::COPYABLE_FOR_ACCESSIBILITY),
        }
    }

    /// Pack into lopdf's `/P` flag set for writing (used by `secure`).
    pub(crate) fn to_lopdf(self) -> lopdf::Permissions {
        use lopdf::Permissions as L;
        let mut f = L::empty();
        f.set(L::PRINTABLE, self.print);
        f.set(L::PRINTABLE_IN_HIGH_QUALITY, self.print_high_res);
        f.set(L::COPYABLE, self.copy);
        f.set(L::MODIFIABLE, self.modify);
        f.set(L::ANNOTABLE, self.annotate);
        f.set(L::FILLABLE, self.fill_forms);
        f.set(L::ASSEMBLABLE, self.assemble);
        f.set(L::COPYABLE_FOR_ACCESSIBILITY, self.accessibility_copy);
        f
    }
}

/// What a document's security looks like, read without opening it.
///
/// `permissions` is `Some` when the policy can be read and `None` when it cannot.
/// The unreadable case arises for a document whose **user (open) password is empty**:
/// lopdf transparently opens it and consumes the `/Encrypt` dictionary during load, so
/// the cipher and permission detail are no longer available. Such a document still
/// reports `encrypted: true` and `has_user_password: false` — the facts a caller needs
/// to decide whether to prompt. A document that requires an open password yields full
/// detail.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct SecurityInfo {
    pub encrypted: bool,
    pub handler: Handler,
    pub algorithm: Algorithm,
    /// True when an open (user) password is required to view the document.
    pub has_user_password: bool,
    /// The advisory permission policy, or `None` when it could not be read.
    pub permissions: Option<Permissions>,
}

/// Inspect a PDF's security without opening it.
///
/// A still-present `/Encrypt` dictionary after a plain load means an open password is
/// required (lopdf would otherwise have opened and consumed it). For that case the full
/// `/Encrypt` detail is read. A document opened with the empty user password reports the
/// actionable facts only. A public-key handler — which lopdf does not implement, and
/// which may fail to load at all — is still classified from the raw `/Filter` name.
pub fn inspect_security(bytes: &[u8]) -> Result<SecurityInfo, SecureError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| SecureError::Rejected)?;
    let doc = match Document::load_mem(bytes) {
        Ok(doc) => doc,
        // A public-key handler can fail to load; classify it from the raw bytes rather
        // than reporting a corrupt file.
        Err(_) if is_public_key_handler(bytes) => return Ok(public_key_info()),
        Err(_) => return Err(SecureError::Parse),
    };

    if doc.is_encrypted() {
        let dict = doc.get_encrypted().map_err(|_| SecureError::Parse)?;
        let handler = match dict.get(b"Filter").ok().and_then(|o| o.as_name().ok()) {
            Some(b"Standard") => Handler::Standard,
            // Adobe.PPKLite / Adobe.PubSec / any vendor handler — not opened.
            Some(_) | None => Handler::PublicKey,
        };
        let version = dict
            .get(b"V")
            .ok()
            .and_then(|o| o.as_i64().ok())
            .unwrap_or(0);
        let algorithm = match handler {
            Handler::Standard => algorithm_of(dict, version),
            _ => Algorithm::Unknown,
        };
        let permissions = dict
            .get(b"P")
            .ok()
            .and_then(|o| o.as_i64().ok())
            .map(Permissions::from_p);
        return Ok(SecurityInfo {
            encrypted: true,
            handler,
            algorithm,
            // /Encrypt survived the load, so the empty password did not open it.
            has_user_password: true,
            permissions,
        });
    }

    if doc.was_encrypted() {
        // The document opened with the EMPTY password during load, which consumed the
        // /Encrypt dictionary, so the cipher and permission detail are not recoverable.
        // The Standard handler is implied — it is the only one lopdf opens. `false` here
        // means "this engine opened it without a password"; in the rare case the empty
        // password was the OWNER (not user) password, another viewer might still prompt.
        return Ok(SecurityInfo {
            encrypted: true,
            handler: Handler::Standard,
            algorithm: Algorithm::Unknown,
            has_user_password: false,
            permissions: None,
        });
    }

    Ok(SecurityInfo {
        encrypted: false,
        handler: Handler::None,
        algorithm: Algorithm::None,
        has_user_password: false,
        permissions: Some(Permissions::all_allowed()),
    })
}

fn public_key_info() -> SecurityInfo {
    SecurityInfo {
        encrypted: true,
        handler: Handler::PublicKey,
        algorithm: Algorithm::Unknown,
        has_user_password: false,
        permissions: None,
    }
}

/// Heuristic detection of a public-key (certificate) security handler. The `/Encrypt`
/// dictionary — including its `/Filter` name — is itself never encrypted, so the
/// handler name appears verbatim in the bytes even when the document fails to load.
///
/// Only `Adobe.PubSec` (the public-key *encryption* handler) is matched. `Adobe.PPKLite`
/// is deliberately excluded: it is the digital-*signature* handler and appears in every
/// signed — but not necessarily encrypted — PDF, so scanning for it would misreport a
/// merely-corrupt signed document as encrypted.
fn is_public_key_handler(bytes: &[u8]) -> bool {
    bytes
        .windows(b"Adobe.PubSec".len())
        .any(|w| w == b"Adobe.PubSec")
}

/// Resolve the content cipher. V1/V2 are RC4; V4/V5 name the cipher in the stream
/// crypt filter's `/CFM` (falling back to the version when it is absent).
fn algorithm_of(dict: &lopdf::Dictionary, version: i64) -> Algorithm {
    if version < 4 {
        return Algorithm::Rc4;
    }
    let stream_filter = dict
        .get(b"StmF")
        .ok()
        .and_then(|o| o.as_name().ok())
        .unwrap_or(b"StdCF");
    let cfm = dict
        .get(b"CF")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|cf| cf.get(stream_filter).ok())
        .and_then(|f| f.as_dict().ok())
        .and_then(|f| f.get(b"CFM").ok())
        .and_then(|o| o.as_name().ok());
    match cfm {
        Some(b"AESV3") => Algorithm::Aes256,
        Some(b"AESV2") => Algorithm::Aes128,
        Some(b"V2") => Algorithm::Rc4,
        // No (or Identity) stream filter named: infer from the version.
        _ if version >= 5 => Algorithm::Aes256,
        _ => Algorithm::Rc4,
    }
}

/// Decrypt a password-protected PDF to plaintext bytes.
///
/// A document that is not encrypted is returned unchanged, so callers need not
/// pre-check. The output never carries an `/Encrypt` dictionary. A wrong password
/// yields [`SecureError::WrongPassword`] (distinct from [`SecureError::Parse`]) so
/// a caller can re-prompt rather than report a corrupt file.
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| SecureError::Rejected)?;
    decrypt_unguarded(bytes, password)
}

/// Decrypt without running the bomb guard. Callers that already ran `guard_input` on the
/// same bytes use this to avoid scanning twice (e.g. `Document::load_protected`).
pub(crate) fn decrypt_unguarded(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError> {
    // A plain load fully reads an unencrypted file but surfaces only the `/Encrypt`
    // dictionary of an encrypted one — lopdf cannot enumerate encrypted objects
    // without the key. So detect cheaply here, then (only if needed) reload WITH the
    // password, which decrypts every string and stream during the read. The two-step
    // "load then Document::decrypt" path does NOT work: the objects were never read.
    let probe = Document::load_mem(bytes).map_err(|_| SecureError::Parse)?;
    // `is_encrypted()` is true while a `/Encrypt` dictionary survives the load (an open
    // password is required). `was_encrypted()` is true when lopdf opened the document
    // with the EMPTY password during the load and stripped `/Encrypt`. A document that
    // is neither is genuinely plaintext and passes through unchanged. Gating only on
    // `is_encrypted()` would hand an empty-password-protected document straight back
    // still encrypted — so both signals must be checked.
    if !probe.is_encrypted() && !probe.was_encrypted() {
        return Ok(bytes.to_vec());
    }
    let mut doc = if probe.is_encrypted() {
        // An open password is required; reload WITH it so every object is decrypted
        // during the read (a plain load surfaces only the `/Encrypt` dictionary).
        Document::load_mem_with_options(bytes, LoadOptions::with_password(password))
            .map_err(map_unlock_error)?
    } else {
        // Opened with the empty password during the probe load: the objects are already
        // decrypted in memory. The supplied password is irrelevant — the document needs
        // none — so reuse the probe rather than failing on a non-empty guess.
        probe
    };
    // Ensure no `/Encrypt` reference survives so the output is plain and needs no password.
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
    use lopdf::encryption::crypt_filters::{Aes128CryptFilter, Aes256CryptFilter, CryptFilter};
    use lopdf::{dictionary, EncryptionState, EncryptionVersion, Object, Stream};
    use std::collections::BTreeMap;
    use std::sync::Arc;

    // lopdf's permission flags are referenced fully-qualified (`lopdf::Permissions`) so
    // they never shadow this crate's own `Permissions` decode type in scope here.
    fn default_perms() -> lopdf::Permissions {
        lopdf::Permissions::PRINTABLE
            | lopdf::Permissions::COPYABLE
            | lopdf::Permissions::COPYABLE_FOR_ACCESSIBILITY
            | lopdf::Permissions::PRINTABLE_IN_HIGH_QUALITY
    }

    /// Set a file `/ID`, which the V2/V4 (R2–R4) key derivation requires. V5/R6 does not.
    fn set_file_id(doc: &mut Document) {
        let id = Object::String(vec![0x42u8; 16], lopdf::StringFormat::Hexadecimal);
        doc.trailer.set(b"ID", Object::Array(vec![id.clone(), id]));
    }

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

    /// Encrypt a plaintext PDF to AES-256 (V5/R6) with a chosen permission policy. A
    /// fixed file-encryption key keeps the test deterministic — the real `secure`
    /// path (built next) generates a random key.
    fn encrypt_v5(plain: &[u8], owner: &str, user: &str, perms: lopdf::Permissions) -> Vec<u8> {
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
            permissions: perms,
        };
        let state = EncryptionState::try_from(version).expect("build V5 encryption state");
        doc.encrypt(&state).expect("encrypt to AES-256");
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise encrypted document");
        out
    }

    /// Encrypt to legacy RC4 (V2) — for read/inspect coverage only; we never write it.
    fn encrypt_rc4(plain: &[u8], owner: &str, user: &str) -> Vec<u8> {
        let mut doc = Document::load_mem(plain).expect("load plaintext fixture");
        set_file_id(&mut doc);
        let version = EncryptionVersion::V2 {
            document: &doc,
            owner_password: owner,
            user_password: user,
            key_length: 128,
            permissions: default_perms(),
        };
        let state = EncryptionState::try_from(version).expect("build V2 (RC4) state");
        doc.encrypt(&state).expect("encrypt RC4");
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise");
        out
    }

    /// Encrypt to AES-128 (V4, `/AESV2`) — for read/inspect coverage only.
    fn encrypt_aes128(plain: &[u8], owner: &str, user: &str) -> Vec<u8> {
        let mut doc = Document::load_mem(plain).expect("load plaintext fixture");
        set_file_id(&mut doc);
        let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
        let version = EncryptionVersion::V4 {
            document: &doc,
            encrypt_metadata: true,
            crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
            stream_filter: b"StdCF".to_vec(),
            string_filter: b"StdCF".to_vec(),
            owner_password: owner,
            user_password: user,
            permissions: default_perms(),
        };
        let state = EncryptionState::try_from(version).expect("build V4 (AES-128) state");
        doc.encrypt(&state).expect("encrypt AES-128");
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise");
        out
    }

    /// A minimal document carrying a public-key (`/Adobe.PubSec`) `/Encrypt` dictionary,
    /// built by hand (lopdf does not produce public-key encryption). The content is not
    /// actually enciphered — this exercises only the handler classification path.
    fn fake_pubkey_encrypted() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(vec![]),
            b"Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        let enc_id = doc.add_object(dictionary! {
            b"Filter" => Object::Name(b"Adobe.PubSec".to_vec()),
            b"V" => Object::Integer(4),
            b"R" => Object::Integer(4),
            b"P" => Object::Integer(-44),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        doc.trailer.set(b"Encrypt", Object::Reference(enc_id));
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialise");
        bytes
    }

    /// Prove lopdf's whole-document decrypt produces bytes that the `hayro` render
    /// path opens, and that the unlock / wrong-password / identity contracts hold.
    #[test]
    fn probe_decrypt_roundtrips_through_hayro() {
        let encrypted = encrypt_v5(
            &minimal_pdf(),
            "owner-secret",
            "open-secret",
            default_perms(),
        );

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

    #[test]
    fn inspect_unencrypted_is_clean() {
        let info = inspect_security(&minimal_pdf()).expect("inspect");
        assert!(!info.encrypted);
        assert_eq!(info.handler, Handler::None);
        assert_eq!(info.algorithm, Algorithm::None);
        assert!(!info.has_user_password);
        assert_eq!(info.permissions, Some(Permissions::all_allowed()));
    }

    #[test]
    fn inspect_aes256_with_user_password() {
        let enc = encrypt_v5(&minimal_pdf(), "owner", "open", default_perms());
        let info = inspect_security(&enc).expect("inspect");
        assert!(info.encrypted);
        assert_eq!(info.handler, Handler::Standard);
        assert_eq!(info.algorithm, Algorithm::Aes256);
        assert!(info.has_user_password);
    }

    #[test]
    fn inspect_aes256_owner_only_opens_without_prompt() {
        // An empty user password means the document opens with no prompt. lopdf consumes
        // the /Encrypt dict during load, so detail is unknown — but the actionable facts
        // (encrypted, no open password required) are reported.
        let enc = encrypt_v5(&minimal_pdf(), "owner", "", default_perms());
        let info = inspect_security(&enc).expect("inspect");
        assert!(info.encrypted);
        assert!(!info.has_user_password);
        assert_eq!(info.handler, Handler::Standard);
        assert_eq!(info.permissions, None);
    }

    #[test]
    fn inspect_classifies_rc4_and_aes128() {
        let rc4 = encrypt_rc4(&minimal_pdf(), "owner", "open");
        assert_eq!(inspect_security(&rc4).unwrap().algorithm, Algorithm::Rc4);
        let aes128 = encrypt_aes128(&minimal_pdf(), "owner", "open");
        assert_eq!(
            inspect_security(&aes128).unwrap().algorithm,
            Algorithm::Aes128
        );
    }

    #[test]
    fn inspect_flags_public_key_handler() {
        let info = inspect_security(&fake_pubkey_encrypted()).expect("inspect");
        assert!(info.encrypted);
        assert_eq!(info.handler, Handler::PublicKey);
    }

    #[test]
    fn inspect_decodes_permissions() {
        // Print allowed; copy and modify denied.
        let perms = lopdf::Permissions::PRINTABLE | lopdf::Permissions::PRINTABLE_IN_HIGH_QUALITY;
        let enc = encrypt_v5(&minimal_pdf(), "owner", "open", perms);
        let info = inspect_security(&enc).expect("inspect");
        let p = info
            .permissions
            .expect("permissions readable for a password-required doc");
        assert!(p.print);
        assert!(!p.copy);
        assert!(!p.modify);
    }

    #[test]
    fn decrypt_legacy_rc4_and_aes128_inputs() {
        for enc in [
            encrypt_rc4(&minimal_pdf(), "owner", "open"),
            encrypt_aes128(&minimal_pdf(), "owner", "open"),
        ] {
            let plain = decrypt(&enc, "open").expect("decrypt legacy input");
            assert!(!Document::load_mem(&plain)
                .expect("parse decrypted")
                .is_encrypted());
            let doc = crate::Document::load(plain).expect("hayro loads decrypted legacy input");
            assert_eq!(doc.page_count(), 1);
        }
    }

    #[test]
    fn decrypt_output_feeds_another_engine_module() {
        // The cross-module proof: once decrypted to bytes, an AES-256 document flows
        // through a separate engine module (the bad-redaction detector) with no password.
        let enc = encrypt_v5(&minimal_pdf(), "owner", "open", default_perms());
        let plain = decrypt(&enc, "open").expect("decrypt");
        let report = crate::detect(plain).expect("detector runs on decrypted bytes");
        assert_eq!(report.pages_scanned, 1);
    }

    #[test]
    fn decrypt_owner_only_doc_actually_decrypts() {
        // An empty user password: lopdf auto-opens the document during load and strips
        // /Encrypt, so the cheap probe reports "unencrypted". decrypt() must still emit
        // DECRYPTED plaintext, not hand back the original encrypted bytes.
        let enc = encrypt_v5(&minimal_pdf(), "owner", "", default_perms());
        // load_mem auto-opens it with the empty password (so is_encrypted() is already
        // false), but was_encrypted() confirms it really was protected on disk.
        assert!(Document::load_mem(&enc).unwrap().was_encrypted());
        let plain = decrypt(&enc, "").expect("decrypt owner-only");
        assert_ne!(plain, enc); // not the encrypted bytes verbatim
        let reloaded = Document::load_mem(&plain).unwrap();
        assert!(!reloaded.is_encrypted() && !reloaded.was_encrypted());
        assert_eq!(crate::Document::load(plain).unwrap().page_count(), 1);
    }

    #[test]
    fn decrypt_wrong_password_for_rc4_and_aes128() {
        // map_unlock_error must classify a bad password as WrongPassword for the legacy
        // ciphers too (their lopdf DecryptionError variants differ from AES-256/R6).
        for enc in [
            encrypt_rc4(&minimal_pdf(), "owner", "open"),
            encrypt_aes128(&minimal_pdf(), "owner", "open"),
        ] {
            assert_eq!(
                decrypt(&enc, "not-the-password"),
                Err(SecureError::WrongPassword)
            );
        }
    }

    #[test]
    fn inspect_flags_public_key_handler_when_load_fails() {
        // A document that lopdf cannot load but that carries the public-key encryption
        // handler name must still be classified (not reported as a plain parse failure).
        let bytes = b"%PDF-1.7\n<< /Filter /Adobe.PubSec >>\nbroken-and-unparseable".to_vec();
        assert!(Document::load_mem(&bytes).is_err()); // genuinely unloadable
        let info = inspect_security(&bytes).expect("classified from the raw filter name");
        assert!(info.encrypted);
        assert_eq!(info.handler, Handler::PublicKey);
    }

    #[test]
    fn inspect_does_not_flag_a_corrupt_signed_document_as_encrypted() {
        // Adobe.PPKLite is the SIGNATURE handler, not encryption; a corrupt unencrypted
        // signed document must not be misreported as public-key encrypted.
        let bytes =
            b"%PDF-1.7\n<< /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached >>\ntruncated"
                .to_vec();
        assert_eq!(inspect_security(&bytes), Err(SecureError::Parse));
    }

    #[test]
    fn decrypt_and_inspect_reject_oversize_input() {
        let limits = crate::guard::GuardLimits::default();
        let big = vec![0u8; limits.max_input_bytes + 1];
        assert_eq!(decrypt(&big, "pw"), Err(SecureError::Rejected));
        assert_eq!(inspect_security(&big), Err(SecureError::Rejected));
    }

    #[test]
    fn decrypt_error_never_carries_the_password() {
        // The only value decrypt() returns on a bad password is the error; it must not
        // embed the attempted password (the secrets-hygiene invariant).
        let enc = encrypt_v5(&minimal_pdf(), "owner", "open", default_perms());
        let err = decrypt(&enc, "TOPSECRET-attempt").unwrap_err();
        assert_eq!(err, SecureError::WrongPassword);
        assert!(!format!("{err:?}").contains("TOPSECRET"));
    }
}
