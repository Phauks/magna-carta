//! PDF text layers, over the shipped PDF engine.
//!
//! THIS ROUTE IS THE ONE THAT CLOSES THE PLATFORM'S BORN-DIGITAL GAP. The extraction port shipped
//! backed only by recognition, which skips pages that already carry a text layer — so a
//! born-digital PDF, the single most common document in a law firm, extracted to nothing and was
//! recorded unextractable. Reading the page's own glyphs is not a discovery nicety; it is the
//! correct answer for the whole platform's search, and discovery is simply the consumer that made
//! living without it impossible.
//!
//! What this route does NOT do is decide to recognize anything. It reports which pages have words
//! only as pixels and hands that list back; routing those pages to the recognition engine is the
//! composing caller's decision, made where both engines are reachable.

use pdf_core::{Document, PdfError, SecureError};

use super::{DateSource, DocumentDate, ExtractedDocument};
use crate::chunk::Page;
use crate::error::DiscoveryError;
use crate::identify::IdentifiedFormat;
use crate::limits::Limits;

pub fn extract(bytes: &[u8], limits: &Limits) -> Result<ExtractedDocument, DiscoveryError> {
    // Encryption is checked before the reader opens the document, so a locked file is named as
    // locked rather than reported as unreadable. The two are different conversations: a password can
    // be asked for, and a public-key handler cannot.
    match pdf_core::inspect_security(bytes) {
        Ok(security) if security.has_user_password => {
            return Err(DiscoveryError::PasswordProtected)
        }
        Ok(_) => {}
        Err(SecureError::Rejected) => return Err(DiscoveryError::LimitExceeded),
        // A file whose security cannot be read may still open — an unencrypted document with a
        // damaged trailer is common in productions — so this is not fatal on its own.
        Err(_) => {}
    }
    let document = Document::load(bytes.to_vec()).map_err(map_error)?;
    let page_count = document.page_count();
    if page_count > limits.max_page_count {
        return Err(DiscoveryError::LimitExceeded);
    }
    let facts = document
        .document_text_facts(limits.max_page_count)
        .map_err(map_error)?;
    let mut pages = Vec::with_capacity(facts.len());
    let mut pages_needing_recognition = Vec::new();
    for fact in &facts {
        if fact.needs_recognition {
            pages_needing_recognition.push(fact.page_index);
        }
        pages.push(Page {
            page_index: fact.page_index,
            lines: fact
                .lines
                .iter()
                .map(|line| crate::normalize::normalize_line(&line.text))
                .filter(|line| !line.is_empty())
                .collect(),
        });
    }
    Ok(ExtractedDocument {
        format: IdentifiedFormat::Pdf,
        charset: None,
        pages,
        page_count: Some(page_count),
        document_date: info_dictionary_date(bytes),
        pages_needing_recognition,
    })
}

/// The Info dictionary's dates, modified before created for the same reason a package's are:
/// a reviewer sorts by when the document last said something.
fn info_dictionary_date(bytes: &[u8]) -> Option<DocumentDate> {
    let document = lopdf::Document::load_mem(bytes).ok()?;
    let info = document.trailer.get(b"Info").ok()?;
    let dictionary = match info {
        lopdf::Object::Reference(id) => document.get_object(*id).ok()?.as_dict().ok()?,
        other => other.as_dict().ok()?,
    };
    for key in [b"ModDate".as_slice(), b"CreationDate".as_slice()] {
        let Ok(value) = dictionary.get(key) else {
            continue;
        };
        let Ok(raw) = value.as_str() else {
            continue;
        };
        // A PDF date is ASCII by the format's own definition; anything else is not a date this
        // engine is going to hand on as one.
        let Ok(text) = std::str::from_utf8(raw) else {
            continue;
        };
        let value = crate::normalize::normalize_line(text);
        if !value.is_empty() {
            return Some(DocumentDate {
                value,
                source: DateSource::PdfInfoDictionary,
            });
        }
    }
    None
}

fn map_error(error: PdfError) -> DiscoveryError {
    match error {
        // The PDF engine's own bomb guard refused the input.
        PdfError::Rejected => DiscoveryError::LimitExceeded,
        PdfError::Parse | PdfError::Render | PdfError::PageOutOfRange => DiscoveryError::Corrupt,
        // Locked with a password nobody supplied: a password can be asked for.
        PdfError::Encrypted => DiscoveryError::PasswordProtected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract as extract_document, ExtractionOutcome};

    /// The PDF engine's own fixture corpus, embedded at compile time rather than read from disk, so
    /// these tests run on the wasm target too — where there is no file system to read from.
    const BORN_DIGITAL: &[u8] = include_bytes!("../../../pdf-core/tests/fixtures/born_digital.pdf");
    const SCAN_ONLY: &[u8] = include_bytes!("../../../pdf-core/tests/fixtures/scan_only.pdf");
    const MIXED: &[u8] = include_bytes!("../../../pdf-core/tests/fixtures/mixed_text_and_scan.pdf");
    const HELLO: &[u8] = include_bytes!("../../../pdf-core/tests/fixtures/hello.pdf");

    fn extracted(bytes: &[u8]) -> ExtractedDocument {
        match extract_document(bytes).unwrap() {
            ExtractionOutcome::Extracted(document) => document,
            other => panic!("expected an extraction, got {other:?}"),
        }
    }

    /// The regression that justifies the whole route: this document extracted to NOTHING under the
    /// recognition-only port and was recorded unextractable.
    #[test]
    fn a_born_digital_pdf_extracts_its_real_text_and_is_never_sent_to_recognition() {
        let document = extracted(BORN_DIGITAL);
        let text = document.pages[0].lines.join("\n");
        assert!(!text.trim().is_empty(), "the text layer read as empty");
        assert!(
            document.pages_needing_recognition.is_empty(),
            "a born-digital page was routed to recognition"
        );
        assert_eq!(document.page_count, Some(2));
    }

    #[test]
    fn a_scanned_pdf_reports_its_pages_as_needing_recognition() {
        let document = extracted(SCAN_ONLY);
        assert_eq!(document.pages_needing_recognition, vec![0]);
    }

    #[test]
    fn a_mixed_document_routes_only_the_pages_that_need_it() {
        let document = extracted(MIXED);
        assert!(
            !document.pages_needing_recognition.is_empty(),
            "the scanned half was not reported"
        );
        assert!(
            document.pages_needing_recognition.len() < document.page_count.unwrap_or(0),
            "every page was reported, so the native half was not read"
        );
    }

    #[test]
    fn a_truncated_pdf_is_corrupt_rather_than_a_panic() {
        let mut truncated = HELLO.to_vec();
        truncated.truncate(truncated.len() / 3);
        assert_eq!(extract_document(&truncated), Err(DiscoveryError::Corrupt));
    }

    #[test]
    fn a_pdf_with_an_absurd_declared_length_is_refused_by_the_guard() {
        // The header is real, the body claims a stream far larger than the file. The engine's own
        // bomb guard refuses it, and the refusal arrives as a limit rather than a corruption.
        let mut crafted = b"%PDF-1.7\n1 0 obj\n<< /Length 4294967295 >>\nstream\n".to_vec();
        crafted.extend_from_slice(&[b'A'; 64]);
        crafted.extend_from_slice(b"\nendstream\nendobj\n");
        assert!(matches!(
            extract_document(&crafted),
            Err(DiscoveryError::Corrupt) | Err(DiscoveryError::LimitExceeded)
        ));
    }

    #[test]
    fn a_page_count_over_the_ceiling_is_refused_before_the_pages_are_read() {
        let limits = Limits {
            max_page_count: 0,
            ..Limits::default()
        };
        assert_eq!(
            crate::extract::extract_with_limits(HELLO, &limits),
            Err(DiscoveryError::LimitExceeded)
        );
    }
}
