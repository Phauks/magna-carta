//! Plain text and its markup relatives.
//!
//! The interesting part is not the reading, it is the DECODING: discovery material is decades old
//! and arrives in encodings nobody has typed the name of since. `charset::decode` answers from the
//! bytes; this module normalizes what comes back and stops. Markup is not stripped — an XML or HTML
//! document's tags are read as the text they are, because a document produced as HTML is evidence of
//! what was sent, and silently dropping half of it to make it prettier is not this engine's call.

use super::{single_page, ExtractedDocument};
use crate::error::DiscoveryError;
use crate::identify::IdentifiedFormat;
use crate::limits::Limits;
use crate::normalize::normalize_lines;

pub fn extract(
    bytes: &[u8],
    format: IdentifiedFormat,
    charset: Option<&'static str>,
    limits: &Limits,
) -> Result<ExtractedDocument, DiscoveryError> {
    let (text, detected) = crate::charset::decode(bytes);
    if text.len() > limits.max_extracted_text_bytes {
        return Err(DiscoveryError::LimitExceeded);
    }
    Ok(ExtractedDocument {
        format,
        charset: Some(charset.unwrap_or(detected)),
        pages: single_page(normalize_lines(&text)),
        // A text file has no pages. Reporting a page count of one here would be a lie the eventual
        // Bates numbering would then stamp onto a document.
        page_count: None,
        // Nothing inside a text file states when it was written.
        document_date: None,
        pages_needing_recognition: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract as extract_document, ExtractionOutcome};

    fn extracted(bytes: &[u8]) -> ExtractedDocument {
        match extract_document(bytes).unwrap() {
            ExtractionOutcome::Extracted(document) => document,
            other => panic!("expected an extraction, got {other:?}"),
        }
    }

    #[test]
    fn a_text_file_extracts_its_lines_normalized() {
        let document = extracted(b"The witness stated\r\n\r\nthat the meeting occurred.\r\n");
        assert_eq!(
            document.pages[0].lines,
            vec!["The witness stated", "", "that the meeting occurred."]
        );
        assert_eq!(document.charset, Some("UTF-8"));
        assert_eq!(document.page_count, None);
    }

    #[test]
    fn legacy_encoded_material_extracts_rather_than_excepting() {
        // windows-1252 curly punctuation, invalid as UTF-8: a 1998 memo still has to be readable.
        let document = extracted(b"The client\x92s file was produced in 1998 by counsel.");
        assert!(document.pages[0].lines[0].contains("file was produced in 1998"));
    }

    #[test]
    fn text_over_the_extracted_text_ceiling_is_refused() {
        let limits = Limits {
            max_extracted_text_bytes: 16,
            ..Limits::default()
        };
        assert_eq!(
            extract(
                b"a document much longer than sixteen bytes",
                IdentifiedFormat::PlainText,
                None,
                &limits
            ),
            Err(DiscoveryError::LimitExceeded)
        );
    }
}
