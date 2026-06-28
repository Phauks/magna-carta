use magna_carta_scan::identify::{identify_bytes, IdentifyEngine};

// A complete (if tiny) one-page PDF document: header, catalog/pages/page objects, xref, and trailer.
// Magika identifies by CONTENT FEATURES, not just the magic bytes, so a bare `%PDF` header classifies as
// `unknown`; a real document body is what the embedded model recognizes as a PDF.
const TINY_PDF: &[u8] = b"%PDF-1.4\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n\
xref\n\
0 4\n\
0000000000 65535 f \n\
0000000009 00000 n \n\
0000000058 00000 n \n\
0000000115 00000 n \n\
trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n";

// The embedded model identifies a small PDF document as a PDF. No network, no external model file: the
// standard model ships inside the magika crate.
#[test]
fn identifies_a_pdf_buffer() {
    let engine = IdentifyEngine::new().expect("magika session builds with the embedded model");
    let raw = identify_bytes(&engine, TINY_PDF);
    assert_eq!(raw.label, "pdf");
    assert!(raw.score > 0.0);
    assert!(!raw.magika_version.is_empty());
    assert!(!raw.model_version.is_empty());
}
