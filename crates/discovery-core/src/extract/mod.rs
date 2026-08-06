//! Native text extraction: the identified format decides the route, and the route reads the
//! document's own words rather than a picture of them.
//!
//! THE NATIVE ROUTE IS TRIED FIRST, ALWAYS. Recognizing a page whose text is already present is
//! slower, worse, and returns a recognizer's reading of a picture of the characters rather than the
//! characters the author typed — and a discovery index built on the second is an index that
//! disagrees with the document. So a route reports which of its pages still need recognition
//! ([`ExtractedDocument::pages_needing_recognition`]) instead of handing the whole document over.
//!
//! Every route is total in the same way: extracted text, a page count where the format has pages, a
//! best-available document date with the source of that date recorded, and a typed error for corrupt,
//! encrypted, and unsupported input. A parse failure is never a panic used as control flow, because
//! the target this compiles to cannot unwind — a panic there is an aborted isolate, not a caught
//! error.

mod email;
mod office;
mod pdf;
mod rich_text;
mod text;

use crate::chunk::Page;
use crate::error::DiscoveryError;
use crate::identify::{identify_with_limits, IdentifiedFormat};
use crate::limits::Limits;

/// Where a document's date came from, which also says how to read [`DocumentDate::value`]. The
/// engine reports the date VERBATIM as the format wrote it rather than converting it: date
/// conversion needs a calendar and a time zone database, neither of which belongs in an I/O-free
/// parse engine, and a conversion done here would be a second place for a date to be wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DateSource {
    /// An RFC 5322 `Date:` header, in that encoding.
    EmailDateHeader,
    /// A package's own properties part — ISO 8601, as those formats write it.
    PackageProperties,
    /// A PDF Info dictionary date string (`D:YYYYMMDDHHmmSS`).
    PdfInfoDictionary,
}

impl DateSource {
    pub fn label(&self) -> &'static str {
        match self {
            DateSource::EmailDateHeader => "emailDateHeader",
            DateSource::PackageProperties => "packageProperties",
            DateSource::PdfInfoDictionary => "pdfInfoDictionary",
        }
    }
}

/// The best date the document itself carries, and where in the document it was found. The file
/// system's own timestamps are the last resort named in the design, and they are deliberately NOT
/// here: this engine never sees a file system, so that fallback belongs to the caller that does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentDate {
    pub value: String,
    pub source: DateSource,
}

/// What one document extracted to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedDocument {
    pub format: IdentifiedFormat,
    /// The encoding the bytes were read as, for text-family formats. `None` where the encoding is a
    /// property of the format's internal parts rather than of the file.
    pub charset: Option<&'static str>,
    pub pages: Vec<Page>,
    /// `None` for a format with no concept of a page — a text file, a spreadsheet, a message.
    pub page_count: Option<usize>,
    pub document_date: Option<DocumentDate>,
    /// Zero-based indexes of pages whose words exist only as pixels. Empty for every format that is
    /// not a PDF, and empty for a born-digital PDF — which is the whole point: a document with an
    /// empty list here must never be sent to recognition.
    pub pages_needing_recognition: Vec<usize>,
}

impl ExtractedDocument {
    /// True when nothing readable came out. Used by the caller to raise the `noTextExtracted`
    /// exception rather than indexing an empty document, which would assert that the document
    /// contains no words.
    pub fn is_empty(&self) -> bool {
        self.pages
            .iter()
            .all(|page| page.lines.iter().all(|line| line.trim().is_empty()))
    }
}

/// What extraction concluded. Conversion is a separate outcome rather than an error because a legacy
/// binary is not a failure — it is a document that reaches its text through the conversion engine,
/// and calling it an exception here would put half a 1997 matter in the exception report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtractionOutcome {
    Extracted(ExtractedDocument),
    /// A legacy binary Office format. The caller routes it to the conversion engine and extracts
    /// from the conversion.
    NeedsConversion {
        format: IdentifiedFormat,
    },
    /// An archive. The caller expands it and extracts each entry; extracting "the archive" as a
    /// document would produce nothing and hide everything inside it.
    NeedsExpansion {
        format: IdentifiedFormat,
    },
}

/// Extract one document.
pub fn extract(bytes: &[u8]) -> Result<ExtractionOutcome, DiscoveryError> {
    extract_with_limits(bytes, &Limits::default())
}

/// [`extract`] with explicit caps. The input cap is enforced before the format is identified, so an
/// oversized buffer is refused before any decoder touches it.
pub fn extract_with_limits(
    bytes: &[u8],
    limits: &Limits,
) -> Result<ExtractionOutcome, DiscoveryError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(DiscoveryError::LimitExceeded);
    }
    let identification = identify_with_limits(bytes, limits);
    let format = identification.format;
    match format {
        IdentifiedFormat::Pdf => pdf::extract(bytes, limits).map(ExtractionOutcome::Extracted),
        IdentifiedFormat::OfficeOpenXmlDocument
        | IdentifiedFormat::OfficeOpenXmlWorkbook
        | IdentifiedFormat::OfficeOpenXmlPresentation
        | IdentifiedFormat::OpenDocumentText
        | IdentifiedFormat::OpenDocumentSpreadsheet
        | IdentifiedFormat::OpenDocumentPresentation => {
            office::extract(bytes, format, limits).map(ExtractionOutcome::Extracted)
        }
        IdentifiedFormat::RichTextFormat => {
            rich_text::extract(bytes, limits).map(ExtractionOutcome::Extracted)
        }
        IdentifiedFormat::EmailMessage
        | IdentifiedFormat::OutlookMessage
        | IdentifiedFormat::MboxArchive => {
            email::extract(bytes, format, limits).map(ExtractionOutcome::Extracted)
        }
        IdentifiedFormat::PlainText
        | IdentifiedFormat::DelimitedText
        | IdentifiedFormat::JavaScriptObjectNotation
        | IdentifiedFormat::ExtensibleMarkup
        | IdentifiedFormat::HypertextMarkup => {
            text::extract(bytes, format, identification.charset, limits)
                .map(ExtractionOutcome::Extracted)
        }
        // A picture is a one-page document whose words are all pixels. Saying so — rather than
        // calling it unsupported — is what routes it to recognition, and it is why this returns an
        // extraction with no text rather than an error.
        IdentifiedFormat::RasterImage => Ok(ExtractionOutcome::Extracted(ExtractedDocument {
            format,
            charset: None,
            pages: vec![crate::chunk::Page {
                page_index: 0,
                lines: Vec::new(),
            }],
            page_count: Some(1),
            document_date: None,
            pages_needing_recognition: vec![0],
        })),
        IdentifiedFormat::LegacyWordDocument
        | IdentifiedFormat::LegacyExcelWorkbook
        | IdentifiedFormat::LegacyPowerPointPresentation => {
            Ok(ExtractionOutcome::NeedsConversion { format })
        }
        IdentifiedFormat::ZipArchive => Ok(ExtractionOutcome::NeedsExpansion { format }),
        IdentifiedFormat::EncryptedOfficePackage => Err(DiscoveryError::Encrypted),
        // Identified, and this engine has no route. The identified format travels back with the
        // caller's own record of the document, so "we could not read this, and here is exactly what
        // it was" stays sayable.
        IdentifiedFormat::CompoundFile | IdentifiedFormat::Unknown => {
            Err(DiscoveryError::UnsupportedFormat)
        }
    }
}

/// The single page every page-less format produces, so a text file and a PDF reach the chunker in
/// the same shape.
pub(crate) fn single_page(lines: Vec<String>) -> Vec<Page> {
    vec![Page {
        page_index: 0,
        lines,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        legacy_word_compound_file, office_open_xml_document, plain_zip_archive,
    };

    #[test]
    fn a_legacy_binary_asks_for_conversion_rather_than_failing() {
        assert_eq!(
            extract(&legacy_word_compound_file()).unwrap(),
            ExtractionOutcome::NeedsConversion {
                format: IdentifiedFormat::LegacyWordDocument
            }
        );
    }

    #[test]
    fn an_archive_asks_to_be_expanded_rather_than_extracting_to_nothing() {
        assert_eq!(
            extract(&plain_zip_archive(&[("a.txt", b"one")])).unwrap(),
            ExtractionOutcome::NeedsExpansion {
                format: IdentifiedFormat::ZipArchive
            }
        );
    }

    #[test]
    fn bytes_over_the_input_cap_are_refused_before_anything_is_identified() {
        let limits = Limits {
            max_input_bytes: 8,
            ..Limits::default()
        };
        assert_eq!(
            extract_with_limits(&office_open_xml_document("text"), &limits),
            Err(DiscoveryError::LimitExceeded)
        );
    }

    #[test]
    fn bytes_nothing_can_name_are_an_unsupported_format_rather_than_a_crash() {
        let binary: Vec<u8> = (0u8..=255).cycle().take(2048).collect();
        assert_eq!(extract(&binary), Err(DiscoveryError::UnsupportedFormat));
    }
}
