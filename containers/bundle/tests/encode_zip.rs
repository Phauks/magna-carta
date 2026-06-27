use magna_carta_bundle::contract::{Compression, Encryption};
use magna_carta_bundle::encode::{encode_zip, LocalEntry};
use std::io::{Cursor, Read};

fn entries() -> Vec<LocalEntry> {
    vec![
        LocalEntry::from_bytes("Pleadings/a.txt", Some(1_700_000_000), b"alpha".to_vec()),
        LocalEntry::from_bytes("b.txt", None, b"bravo".to_vec()),
    ]
}

#[test]
fn plain_store_zip_round_trips() {
    let mut out = Cursor::new(Vec::new());
    encode_zip(entries().into_iter(), Compression::Store, None, &mut out).unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(out.into_inner())).unwrap();
    assert_eq!(archive.len(), 2);
    let mut s = String::new();
    archive
        .by_name("Pleadings/a.txt")
        .unwrap()
        .read_to_string(&mut s)
        .unwrap();
    assert_eq!(s, "alpha");
}

#[test]
fn aes_zip_opens_with_password_and_rejects_wrong_one() {
    let mut out = Cursor::new(Vec::new());
    let enc = Encryption {
        password: "correct horse".into(),
        encrypt_file_names: false,
    };
    encode_zip(
        entries().into_iter(),
        Compression::Maximum,
        Some(&enc),
        &mut out,
    )
    .unwrap();
    let bytes = out.into_inner();

    let mut archive = zip::ZipArchive::new(Cursor::new(bytes.clone())).unwrap();
    let mut s = String::new();
    archive
        .by_name_decrypt("b.txt", b"correct horse")
        .unwrap()
        .read_to_string(&mut s)
        .unwrap();
    assert_eq!(s, "bravo");

    let mut archive2 = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert!(archive2.by_name_decrypt("b.txt", b"wrong").is_err());
}
