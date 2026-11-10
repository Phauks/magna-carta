//! A document that needs a password to open is refused by every operation that reads or
//! rewrites its content, with an error that says so. One that only carries an owner's
//! restrictions opens without a password and is worked on as before.

// A helper in a `tests/` file is compiled as ordinary code, so the workspace's unwrap ban
// reaches it. A fixture that cannot be read should stop the test where it stands.
#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;

use pdf_core::{
    decrypt, fill_form, flatten_form, merge, prepare_signature, read_form, redact, rotate,
    sanitize, secure, split, stamp_document, watermark, write_searchable_text_layer, BatesError,
    BatesFont, BatesOptions, FormError, FormFillOptions, GenerateError, PageRange, PageSelection,
    PdfError, Permissions, Rect, RedactError, RedactionOptions, RedactionRegion, Rotation,
    ScrubError, ScrubOptions, SecureOptions, SignError, SignatureOptions, WatermarkContent,
    WatermarkOptions, WatermarkPlacement, WriteAlgorithm,
};

fn hello() -> Vec<u8> {
    include_bytes!("fixtures/hello.pdf").to_vec()
}

fn protected(user_password: Option<&str>) -> Vec<u8> {
    secure(
        &hello(),
        &SecureOptions {
            owner_password: "owner".to_string(),
            user_password: user_password.map(str::to_string),
            permissions: Permissions::all_allowed(),
            encrypt_metadata: true,
            algorithm: WriteAlgorithm::Aes256,
        },
    )
    .unwrap()
}

fn draft() -> WatermarkOptions {
    WatermarkOptions {
        content: WatermarkContent::Text {
            text: "DRAFT".to_string(),
            font: BatesFont::Helvetica,
            font_size_pt: 20.0,
            color: [0.5, 0.5, 0.5],
        },
        opacity: 1.0,
        rotation_deg: 0.0,
        placement: WatermarkPlacement::Center,
        pages: PageSelection::All,
    }
}

#[test]
fn every_operation_refuses_a_document_that_needs_a_password() {
    let locked = protected(Some("secret"));
    let plain = hello();

    assert!(matches!(
        stamp_document(&locked, &BatesOptions::default(), 1),
        Err(BatesError::Encrypted)
    ));
    assert!(matches!(
        watermark(&locked, &draft()),
        Err(GenerateError::Encrypted)
    ));
    // Merging used to succeed and write the locked pages out as unreadable noise.
    assert!(matches!(
        merge(&[&plain, &locked]),
        Err(GenerateError::Encrypted)
    ));
    assert!(matches!(
        split(&locked, &[PageRange { start: 0, end: 0 }]),
        Err(GenerateError::Encrypted)
    ));
    assert!(matches!(
        rotate(&locked, Rotation::Cw90, &PageSelection::All),
        Err(GenerateError::Encrypted)
    ));
    assert!(matches!(read_form(&locked), Err(FormError::Encrypted)));
    assert!(matches!(
        fill_form(&locked, &BTreeMap::new(), &FormFillOptions::default()),
        Err(FormError::Encrypted)
    ));
    assert!(matches!(flatten_form(&locked), Err(FormError::Encrypted)));
    assert!(matches!(
        sanitize(locked.clone(), &ScrubOptions::default()),
        Err(ScrubError::Encrypted)
    ));
    assert!(matches!(
        redact(
            locked.clone(),
            &[RedactionRegion {
                page: 0,
                rect: Rect {
                    x0: 0.0,
                    y0: 0.0,
                    x1: 50.0,
                    y1: 50.0
                },
                reason: None,
            }],
            &RedactionOptions::default(),
        ),
        Err(RedactError::Encrypted)
    ));
    assert!(matches!(
        prepare_signature(&locked, &SignatureOptions::default()),
        Err(SignError::Encrypted)
    ));
    assert!(matches!(
        write_searchable_text_layer(locked.clone(), &[]),
        Err(PdfError::Encrypted)
    ));
}

#[test]
fn a_locked_document_is_worked_on_once_it_is_unlocked() {
    let unlocked = decrypt(&protected(Some("secret")), "secret").unwrap();
    let (stamped, range) = stamp_document(&unlocked, &BatesOptions::default(), 1).unwrap();
    assert_eq!((range.start, range.end), (1, 1));
    assert!(watermark(&stamped, &draft()).is_ok());
}

#[test]
fn a_document_with_only_an_owners_restrictions_is_still_worked_on() {
    // No password is needed to open it, so its content is readable and an operation runs.
    let restricted = protected(None);
    assert!(stamp_document(&restricted, &BatesOptions::default(), 1).is_ok());
    assert!(watermark(&restricted, &draft()).is_ok());
    assert!(merge(&[&hello(), &restricted]).is_ok());
}
