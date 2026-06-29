//! A deflate stream that inflates past the 256 MiB per-stream cap must be rejected
//! by the pre-flight before any parser inflates it. One bomb, several entrypoints.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::Write;

const OVER_256_MIB: u64 = 256 * 1024 * 1024 + 1;

fn bomb_pdf() -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::best());
    let chunk = vec![0u8; 64 * 1024];
    let mut left = OVER_256_MIB;
    while left > 0 {
        let n = left.min(chunk.len() as u64) as usize;
        e.write_all(&chunk[..n]).unwrap();
        left -= n as u64;
    }
    let blob = e.finish().unwrap();
    let mut v = Vec::new();
    v.extend_from_slice(b"%PDF-1.5\n1 0 obj<</Length 0>>stream\n");
    v.extend_from_slice(&blob);
    v.extend_from_slice(b"\nendstream endobj\n%%EOF");
    v
}

#[test]
fn deflate_bomb_is_rejected_at_default_limits() {
    let pdf = bomb_pdf();

    assert!(matches!(
        pdf_core::detect(pdf.clone()),
        Err(pdf_core::DetectError::Rejected)
    ));
    assert!(matches!(
        pdf_core::Document::load(pdf.clone()),
        Err(pdf_core::PdfError::Rejected)
    ));
    assert_eq!(
        pdf_core::inspect_security(&pdf),
        Err(pdf_core::SecureError::Rejected)
    );
    assert_eq!(
        pdf_core::decrypt(&pdf, "pw"),
        Err(pdf_core::SecureError::Rejected)
    );
    assert_eq!(pdf_core::split(&pdf, &[]), Err(pdf_core::GenerateError::Rejected));
    assert_eq!(pdf_core::merge(&[&pdf]), Err(pdf_core::GenerateError::Rejected));
    assert!(matches!(
        pdf_core::read_form(&pdf),
        Err(pdf_core::FormError::Rejected)
    ));
    assert!(matches!(
        pdf_core::flatten_form(&pdf),
        Err(pdf_core::FormError::Rejected)
    ));
}

// No false positives: real, legitimate documents pass the guard. The largest
// inflated stream in this corpus is ~0.24 MiB, far under the 256 MiB caps.
#[test]
fn real_fixtures_pass_the_guard() {
    let w9 = include_bytes!("../../pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf").to_vec();
    let basicapi = include_bytes!("../../pdf-eval/corpus-ci/basicapi.pdf").to_vec();
    // read_form runs guard_input first; an Ok/NoAcroform result (not Rejected)
    // proves the guard let the document through.
    assert!(!matches!(pdf_core::read_form(&w9), Err(pdf_core::FormError::Rejected)));
    assert!(!matches!(
        pdf_core::read_form(&basicapi),
        Err(pdf_core::FormError::Rejected)
    ));
}
