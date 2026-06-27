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
