// Integration tests for the top-level decryption_core dispatch façade.
// Every assertion goes through `strip_with_key`, `extract_hash`, `verify`, and
// `run_dictionary` — the crate's public API — not the per-format adapters directly.

use decryption_core::{detect, extract_hash, run_dictionary, strip_with_key, verify, Format};
use ms_offcrypto_writer::Ecma376AgileWriter;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{AesMode, ZipWriter};

// The PDF fixture is checked in. Password is "test"; the file uses RC4-128 encryption
// (PDF standard-security handler revision 3), so it is detectable as %PDF on
// decryption — the opened bytes start with "%PDF".
const PDF: &[u8] = include_bytes!("fixtures/pdf_userpw_test.pdf");

// ---------------------------------------------------------------------------
// In-process fixture builders (ZIP and OOXML are not checked in as files).
// ---------------------------------------------------------------------------

/// Build an in-memory AES-256-encrypted ZIP archive with one entry `hello.txt`
/// containing exactly `b"hello\n"`, encrypted with the supplied password.
fn make_aes_zip(password: &str) -> Vec<u8> {
    let buffer = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(buffer);
    let options = SimpleFileOptions::default().with_aes_encryption(AesMode::Aes256, password);
    writer.start_file("hello.txt", options).expect("start_file");
    writer.write_all(b"hello\n").expect("write");
    writer.finish().expect("finish").into_inner()
}

/// Build an in-memory ECMA-376 Agile-encrypted OOXML document (OLE2/CFB container)
/// with the supplied password. The inner ZIP is padded with a STORED entry so the
/// plaintext total_size exceeds 4096 bytes — the minimum required to avoid the
/// unsigned-subtraction underflow guard in `OoxmlAdapter::strip_with_key`.
fn make_encrypted_ooxml(password: &str) -> Vec<u8> {
    let inner_zip = {
        let buffer = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(buffer);

        writer
            .start_file("[Content_Types].xml", SimpleFileOptions::default())
            .expect("zip: start_file");
        writer
            .write_all(
                b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                  <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>",
            )
            .expect("zip: write_all");

        // A STORED (uncompressed) padding entry guarantees total_size > 4096 bytes.
        // Deflate would shrink the padding to a few bytes and trigger the guard.
        writer
            .start_file(
                "pad.bin",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .expect("zip: start pad");
        writer.write_all(&[0u8; 8192]).expect("zip: write pad");

        writer.finish().expect("zip: finish").into_inner()
    };

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// `strip_with_key` selects the correct adapter for each format via magic-byte
/// detection and returns the decrypted payload.
#[test]
fn dispatches_strip_by_detected_format() {
    // PDF: decrypted stream starts with the PDF header.
    let pdf_out = strip_with_key(PDF, "test").expect("PDF strip_with_key");
    assert!(
        pdf_out.bytes.starts_with(b"%PDF"),
        "decrypted PDF must start with %PDF"
    );

    // ZIP (WinZip-AES): decrypted entry content equals the written bytes.
    let zip_bytes = make_aes_zip("test");
    let zip_out = strip_with_key(&zip_bytes, "test").expect("ZIP strip_with_key");
    assert_eq!(
        zip_out.bytes, b"hello\n",
        "decrypted ZIP entry must equal the original content"
    );

    // OOXML: decrypted inner package starts with the ZIP local-file-header magic.
    let ooxml_bytes = make_encrypted_ooxml("test");
    let ooxml_out = strip_with_key(&ooxml_bytes, "test").expect("OOXML strip_with_key");
    assert!(
        ooxml_out.bytes.starts_with(b"PK\x03\x04"),
        "decrypted OOXML inner package must start with PK local-file-header magic"
    );
}

/// `extract_hash` returns a `RecoveryJob` whose parameters allow `verify` and
/// `run_dictionary` to recover the password.
#[test]
fn dispatches_extract_then_recovers_via_dictionary() {
    let job = extract_hash(PDF).expect("extract_hash from PDF");
    assert_eq!(job.format, Format::Pdf, "job format must be Pdf");
    assert!(
        verify(&job, "test"),
        "verify must accept the correct password"
    );
    assert!(
        !verify(&job, "wrong"),
        "verify must reject an incorrect password"
    );
    let found = run_dictionary(
        &job,
        vec!["a".to_string(), "test".to_string(), "b".to_string()],
    );
    assert_eq!(
        found,
        Some("test".to_string()),
        "run_dictionary must find the password in the word list"
    );
}

/// `detect` returns `None` for unrecognised bytes, and both façade functions
/// return their `Unsupported` error variants for unknown input.
#[test]
fn unknown_format_is_none_and_facade_errors() {
    assert!(
        detect(b"garbage").is_none(),
        "detect must return None for unrecognised bytes"
    );
    assert!(
        strip_with_key(b"garbage", "test").is_err(),
        "strip_with_key must error on unrecognised format"
    );
    assert!(
        extract_hash(b"garbage").is_err(),
        "extract_hash must error on unrecognised format"
    );
}
