use magna_carta_bundle::contract::{Compression, Encryption};
use magna_carta_bundle::encode::{encode_7z, LocalEntry};
use sevenz_rust2::{Password, SevenZReader};
use std::io::Cursor;

fn entries() -> Vec<LocalEntry> {
    vec![LocalEntry::from_bytes(
        "docs/a.txt",
        Some(1_700_000_000),
        b"alpha".to_vec(),
    )]
}

#[test]
fn plain_7z_round_trips() {
    let mut out = Cursor::new(Vec::new());
    encode_7z(entries().into_iter(), Compression::Normal, None, &mut out).unwrap();
    let bytes = out.into_inner();
    let len = bytes.len() as u64;
    let mut reader = SevenZReader::new(Cursor::new(bytes), len, Password::empty()).unwrap();
    assert!(reader
        .archive()
        .files
        .iter()
        .any(|f| f.name() == "docs/a.txt"));
    let content = reader.read_file("docs/a.txt").unwrap();
    assert_eq!(content, b"alpha");
}

#[test]
fn store_7z_round_trips() {
    // Store → COPY (no compression); content must still read back intact.
    let mut out = Cursor::new(Vec::new());
    encode_7z(entries().into_iter(), Compression::Store, None, &mut out).unwrap();
    let bytes = out.into_inner();
    let len = bytes.len() as u64;
    let mut reader = SevenZReader::new(Cursor::new(bytes), len, Password::empty()).unwrap();
    assert_eq!(reader.read_file("docs/a.txt").unwrap(), b"alpha");
}

// Many longish entry names so the 7z header is large enough that header encryption genuinely engages
// (sevenz-rust2 falls back to a cleartext header for a tiny file list).
fn many_named_entries() -> Vec<LocalEntry> {
    (0..200)
        .map(|i| {
            LocalEntry::from_bytes(
                &format!("documents/department/matter-{i:04}/exhibit_with_a_longish_name.txt"),
                None,
                format!("body-{i}").into_bytes(),
            )
        })
        .collect()
}

#[test]
fn header_encryption_hides_the_file_list_only_when_requested() {
    // encryptFileNames = true: the header (file list) is encrypted, so opening without the password fails.
    let mut out = Cursor::new(Vec::new());
    let enc = Encryption {
        password: "open sesame".into(),
        encrypt_file_names: true,
    };
    encode_7z(
        many_named_entries().into_iter(),
        Compression::Normal,
        Some(&enc),
        &mut out,
    )
    .unwrap();
    let bytes = out.into_inner();
    let len = bytes.len() as u64;
    assert!(
        SevenZReader::new(Cursor::new(bytes.clone()), len, Password::empty()).is_err(),
        "an encrypted header must not open without the password"
    );
    assert!(
        SevenZReader::new(Cursor::new(bytes), len, Password::from("open sesame")).is_ok(),
        "the right password must open the encrypted header"
    );

    // encryptFileNames = false: content is encrypted but the header (names) stays readable without it.
    let mut out2 = Cursor::new(Vec::new());
    let enc2 = Encryption {
        password: "open sesame".into(),
        encrypt_file_names: false,
    };
    encode_7z(
        many_named_entries().into_iter(),
        Compression::Normal,
        Some(&enc2),
        &mut out2,
    )
    .unwrap();
    let bytes2 = out2.into_inner();
    let len2 = bytes2.len() as u64;
    let reader = SevenZReader::new(Cursor::new(bytes2), len2, Password::empty())
        .expect("a cleartext header must open without the password");
    assert!(reader
        .archive()
        .files
        .iter()
        .any(|f| f.name().starts_with("documents/department/matter-0000")));
}

#[test]
fn encrypted_7z_opens_with_password_and_rejects_wrong_one() {
    let mut out = Cursor::new(Vec::new());
    let enc = Encryption {
        password: "correct horse".into(),
        encrypt_file_names: true,
    };
    encode_7z(
        entries().into_iter(),
        Compression::Maximum,
        Some(&enc),
        &mut out,
    )
    .unwrap();
    let bytes = out.into_inner();
    let len = bytes.len() as u64;

    // Right password recovers the original content (proves AES-256 decryption round-trips).
    let mut good = SevenZReader::new(
        Cursor::new(bytes.clone()),
        len,
        Password::from("correct horse"),
    )
    .unwrap();
    assert_eq!(good.read_file("docs/a.txt").unwrap(), b"alpha");

    // Wrong password can never recover the content — the encrypted stream fails to decode (or, if the
    // open itself fails, even better). This holds regardless of whether the (tiny) header ended up
    // encrypted: the entry's content stream is always AES-encrypted. If the content were stored in the
    // clear this assertion would fail, so it also proves encryption is genuinely applied.
    let recovered = SevenZReader::new(Cursor::new(bytes), len, Password::from("wrong"))
        .and_then(|mut r| r.read_file("docs/a.txt"));
    if let Ok(plain) = recovered {
        assert_ne!(plain, b"alpha");
    }
}
