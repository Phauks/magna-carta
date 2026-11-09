//! What the bytes actually are.
//!
//! The file name is evidence, never authority. A production's names are wrong often enough that
//! routing on them is how a spreadsheet gets read as a picture — and a name is also the one part of
//! a hostile file an opposing party controls most cheaply. So identification here reads bytes and
//! nothing else: [`identify`] cannot be handed a name, which makes "identified by extension" a thing
//! this module has no way to do. Comparing the two answers is a separate, deliberate call
//! ([`name_agreement`]) whose result is reported, never acted on.
//!
//! `engine_host::format::detect` gives the container-level answer — PDF, ZIP, OLE2 — and this module
//! refines it into the subtypes extraction has to route on, because "a ZIP" is not a routing
//! decision when the ZIP might be a Word document, a spreadsheet, an OpenDocument package, or a
//! production of ten thousand loose files.

use std::io::{Cursor, Read};

use engine_host::format::{detect, Format};

use crate::limits::Limits;

/// A format this engine can name. Naming a format it cannot READ is the point of several of these:
/// a document recorded as "legacy WordPerfect, unsupported" is a defensible sentence, and
/// "extraction failed" is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentifiedFormat {
    Pdf,
    /// An Office Open XML package — `.docx`, `.xlsx`, `.pptx`.
    OfficeOpenXmlDocument,
    OfficeOpenXmlWorkbook,
    OfficeOpenXmlPresentation,
    /// An OpenDocument package — `.odt`, `.ods`, `.odp`.
    OpenDocumentText,
    OpenDocumentSpreadsheet,
    OpenDocumentPresentation,
    /// A ZIP that is a container of other files rather than a document package.
    ZipArchive,
    /// An OLE2 compound file holding a legacy binary Office document.
    LegacyWordDocument,
    LegacyExcelWorkbook,
    LegacyPowerPointPresentation,
    /// An OLE2 compound file that is an Outlook message.
    OutlookMessage,
    /// An OLE2 whose payload is an encrypted OOXML package.
    EncryptedOfficePackage,
    /// An OLE2 this engine can open but not subtype.
    CompoundFile,
    /// A picture. Named because a picture's words are reachable — by recognition — and a document
    /// recorded as "unknown" would never be sent there.
    RasterImage,
    RichTextFormat,
    /// An RFC 5322 message — the extension-less case this identification exists for.
    EmailMessage,
    MboxArchive,
    HypertextMarkup,
    ExtensibleMarkup,
    JavaScriptObjectNotation,
    DelimitedText,
    PlainText,
    /// Bytes that match nothing this engine knows. Not an error: an unidentified document is still a
    /// document that has to appear in the corpus and in the report.
    Unknown,
}

impl IdentifiedFormat {
    /// The stable wire label for this format. Fixed keywords, never derived from input, so the label
    /// can cross the wasm edge and the container's JSON alongside an error code without carrying a
    /// byte of the document.
    pub fn label(&self) -> &'static str {
        match self {
            IdentifiedFormat::Pdf => "pdf",
            IdentifiedFormat::OfficeOpenXmlDocument => "officeOpenXmlDocument",
            IdentifiedFormat::OfficeOpenXmlWorkbook => "officeOpenXmlWorkbook",
            IdentifiedFormat::OfficeOpenXmlPresentation => "officeOpenXmlPresentation",
            IdentifiedFormat::OpenDocumentText => "openDocumentText",
            IdentifiedFormat::OpenDocumentSpreadsheet => "openDocumentSpreadsheet",
            IdentifiedFormat::OpenDocumentPresentation => "openDocumentPresentation",
            IdentifiedFormat::ZipArchive => "zipArchive",
            IdentifiedFormat::LegacyWordDocument => "legacyWordDocument",
            IdentifiedFormat::LegacyExcelWorkbook => "legacyExcelWorkbook",
            IdentifiedFormat::LegacyPowerPointPresentation => "legacyPowerPointPresentation",
            IdentifiedFormat::OutlookMessage => "outlookMessage",
            IdentifiedFormat::EncryptedOfficePackage => "encryptedOfficePackage",
            IdentifiedFormat::CompoundFile => "compoundFile",
            IdentifiedFormat::RasterImage => "rasterImage",
            IdentifiedFormat::RichTextFormat => "richTextFormat",
            IdentifiedFormat::EmailMessage => "emailMessage",
            IdentifiedFormat::MboxArchive => "mboxArchive",
            IdentifiedFormat::HypertextMarkup => "hypertextMarkup",
            IdentifiedFormat::ExtensibleMarkup => "extensibleMarkup",
            IdentifiedFormat::JavaScriptObjectNotation => "javaScriptObjectNotation",
            IdentifiedFormat::DelimitedText => "delimitedText",
            IdentifiedFormat::PlainText => "plainText",
            IdentifiedFormat::Unknown => "unknown",
        }
    }

    /// Is this an archive whose entries are separate documents, rather than a document that happens
    /// to be stored as a package? The distinction decides whether expansion is even a question.
    pub fn is_container(&self) -> bool {
        matches!(self, IdentifiedFormat::ZipArchive)
    }
}

/// How sure the identification is, so a caller can surface a doubtful answer rather than assume it.
/// A discovery corpus is exactly where an assumed identification becomes a document nobody read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    /// Magic bytes, or a package's own declared type. There is no plausible other reading.
    Certain,
    /// A structural rule over the leading bytes — a header block, a control word, a markup opener.
    Probable,
    /// Statistics. Charset detection and delimiter sniffing land here.
    Uncertain,
}

impl Confidence {
    pub fn label(&self) -> &'static str {
        match self {
            Confidence::Certain => "certain",
            Confidence::Probable => "probable",
            Confidence::Uncertain => "uncertain",
        }
    }
}

/// The answer, plus how sure it is and (for text) what encoding the bytes were read as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identification {
    pub format: IdentifiedFormat,
    pub confidence: Confidence,
    /// The encoding label for a text-family identification, from the byte-order mark where there is
    /// one and from statistical detection where there is not. `None` for binary formats, whose
    /// encoding is a property of their internal parts rather than of the file.
    pub charset: Option<&'static str>,
}

/// Whether a file's name agrees with what its bytes turned out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameAgreement {
    /// The extension names the family the bytes belong to.
    Agrees,
    /// The extension names a different family. The bytes win; this is reported so the disagreement
    /// reaches the exception report rather than being quietly resolved.
    Disagrees,
    /// No extension, or one this engine has no expectation for. Not a disagreement.
    NoOpinion,
}

const OOXML_DOCUMENT_PART: &str = "word/document.xml";
const OOXML_WORKBOOK_PART: &str = "xl/workbook.xml";
const OOXML_PRESENTATION_PART: &str = "ppt/presentation.xml";
/// The OpenDocument package's own declared media type, stored uncompressed as the first entry so it
/// can be read without inflating anything.
const OPEN_DOCUMENT_TYPE_ENTRY: &str = "mimetype";
/// An OLE2 holding an encrypted OOXML package keeps the ciphertext in this stream.
const ENCRYPTED_PACKAGE_STREAM: &str = "EncryptedPackage";

/// Identify a document from its bytes alone.
///
/// Total: every input has an answer, and bytes that match nothing are [`IdentifiedFormat::Unknown`]
/// rather than an error, because a document nobody could name still belongs in the corpus.
pub fn identify(bytes: &[u8]) -> Identification {
    identify_with_limits(bytes, &Limits::default())
}

/// [`identify`] with explicit caps. Identification reads a bounded prefix and, for packages, the
/// central directory — never the whole document — so the caps here bound structure, not size.
pub fn identify_with_limits(bytes: &[u8], limits: &Limits) -> Identification {
    if bytes.is_empty() {
        return Identification {
            format: IdentifiedFormat::Unknown,
            confidence: Confidence::Certain,
            charset: None,
        };
    }
    match detect(bytes) {
        Some(Format::Pdf) => certain(IdentifiedFormat::Pdf),
        Some(Format::Zip) => identify_zip(bytes, limits),
        Some(Format::Ole2) => identify_compound_file(bytes),
        None => identify_text_family(bytes),
    }
}

fn certain(format: IdentifiedFormat) -> Identification {
    Identification {
        format,
        confidence: Confidence::Certain,
        charset: None,
    }
}

/// A ZIP is four different routing decisions wearing one magic number. The distinguishing evidence is
/// the entry NAMES in the central directory, which cost no decompression to read.
fn identify_zip(bytes: &[u8], limits: &Limits) -> Identification {
    let Ok(mut archive) = zip::read::ZipArchive::new(Cursor::new(bytes)) else {
        // The magic says ZIP and the directory does not parse. It is still a ZIP — a damaged one —
        // and saying so is more useful than calling it unknown.
        return Identification {
            format: IdentifiedFormat::ZipArchive,
            confidence: Confidence::Probable,
            charset: None,
        };
    };
    if archive.len() > limits.max_archive_entries {
        return Identification {
            format: IdentifiedFormat::ZipArchive,
            confidence: Confidence::Certain,
            charset: None,
        };
    }
    let names: Vec<String> = archive
        .file_names()
        .filter_map(|name| name.ok().map(std::borrow::Cow::into_owned))
        .collect();
    let has = |part: &str| names.iter().any(|name| name == part);
    if has(OOXML_DOCUMENT_PART) {
        return certain(IdentifiedFormat::OfficeOpenXmlDocument);
    }
    if has(OOXML_WORKBOOK_PART) {
        return certain(IdentifiedFormat::OfficeOpenXmlWorkbook);
    }
    if has(OOXML_PRESENTATION_PART) {
        return certain(IdentifiedFormat::OfficeOpenXmlPresentation);
    }
    if has(OPEN_DOCUMENT_TYPE_ENTRY) {
        if let Some(format) = open_document_kind(&mut archive) {
            return certain(format);
        }
    }
    certain(IdentifiedFormat::ZipArchive)
}

/// Read the OpenDocument package's declared type. The entry is stored uncompressed and is a short
/// media-type string, so it is read under a fixed small cap — a package that declares a megabyte-long
/// media type is not one this engine is going to believe.
fn open_document_kind(
    archive: &mut zip::read::ZipArchive<Cursor<&[u8]>>,
) -> Option<IdentifiedFormat> {
    const MAX_DECLARED_TYPE_BYTES: u64 = 256;
    let entry = archive.by_name(OPEN_DOCUMENT_TYPE_ENTRY).ok()?;
    let mut declared = String::new();
    entry
        .take(MAX_DECLARED_TYPE_BYTES)
        .read_to_string(&mut declared)
        .ok()?;
    match declared.trim() {
        "application/vnd.oasis.opendocument.text" => Some(IdentifiedFormat::OpenDocumentText),
        "application/vnd.oasis.opendocument.spreadsheet" => {
            Some(IdentifiedFormat::OpenDocumentSpreadsheet)
        }
        "application/vnd.oasis.opendocument.presentation" => {
            Some(IdentifiedFormat::OpenDocumentPresentation)
        }
        _ => None,
    }
}

/// An OLE2 compound file is the honest magic-level answer for four unrelated things. The root
/// storage's own entry names say which, and reading a directory costs no stream decoding.
fn identify_compound_file(bytes: &[u8]) -> Identification {
    let Ok(compound) = cfb::CompoundFile::open(Cursor::new(bytes)) else {
        return Identification {
            format: IdentifiedFormat::CompoundFile,
            confidence: Confidence::Probable,
            charset: None,
        };
    };
    // The root storage's own children, not a recursive walk: a `.msg`'s recipients and attachments
    // are sub-storages that could number in the thousands, and identification has no reason to visit
    // them. One level is where the distinguishing streams live.
    let entries: Vec<String> = compound
        .read_root_storage()
        .map(|entry| entry.name().to_owned())
        .collect();
    let has = |name: &str| entries.iter().any(|entry| entry == name);
    // Checked before the document streams: an encrypted OOXML package is an OLE2 wrapper whose only
    // payload is ciphertext, and reading it as a legacy binary would be reading the wrapper.
    if has(ENCRYPTED_PACKAGE_STREAM) {
        return certain(IdentifiedFormat::EncryptedOfficePackage);
    }
    // The MAPI property stream is what makes an OLE2 a message rather than a document.
    if entries.iter().any(|entry| {
        entry.starts_with("__properties_version1.0") || entry.starts_with("__substg1.0")
    }) {
        return certain(IdentifiedFormat::OutlookMessage);
    }
    if has("WordDocument") {
        return certain(IdentifiedFormat::LegacyWordDocument);
    }
    if has("Workbook") || has("Book") {
        return certain(IdentifiedFormat::LegacyExcelWorkbook);
    }
    if has("PowerPoint Document") {
        return certain(IdentifiedFormat::LegacyPowerPointPresentation);
    }
    Identification {
        format: IdentifiedFormat::CompoundFile,
        confidence: Confidence::Probable,
        charset: None,
    }
}

/// How many leading bytes the text-family rules read. Every rule below is a statement about the head
/// of a file — a control word, a header block, a markup opener — so the window is fixed and small,
/// and identification stays constant-cost no matter how large the document is.
const TEXT_SNIFF_BYTES: usize = 8 * 1024;

/// Everything that is not a recognized container. The order matters: the structural rules run before
/// the statistical ones, so a message is a message rather than "text that happens to decode".
fn identify_text_family(bytes: &[u8]) -> Identification {
    let window = &bytes[..bytes.len().min(TEXT_SNIFF_BYTES)];
    if let Some(format) = image_magic(window) {
        return certain(format);
    }
    if window.starts_with(br"{\rtf") {
        return Identification {
            format: IdentifiedFormat::RichTextFormat,
            confidence: Confidence::Certain,
            charset: None,
        };
    }
    let (text, charset) = crate::charset::decode(window);
    let trimmed = text.trim_start();
    if is_mbox(trimmed) {
        return Identification {
            format: IdentifiedFormat::MboxArchive,
            confidence: Confidence::Probable,
            charset: Some(charset),
        };
    }
    if looks_like_rfc5322(trimmed) {
        return Identification {
            format: IdentifiedFormat::EmailMessage,
            confidence: Confidence::Probable,
            charset: Some(charset),
        };
    }
    let lowered = trimmed
        .get(..trimmed.len().min(512))
        .unwrap_or("")
        .to_ascii_lowercase();
    if lowered.starts_with("<!doctype html") || lowered.starts_with("<html") {
        return Identification {
            format: IdentifiedFormat::HypertextMarkup,
            confidence: Confidence::Probable,
            charset: Some(charset),
        };
    }
    if trimmed.starts_with("<?xml") {
        return Identification {
            format: IdentifiedFormat::ExtensibleMarkup,
            confidence: Confidence::Probable,
            charset: Some(charset),
        };
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Identification {
            format: IdentifiedFormat::JavaScriptObjectNotation,
            confidence: Confidence::Uncertain,
            charset: Some(charset),
        };
    }
    if !is_readable_text(&text) {
        return Identification {
            format: IdentifiedFormat::Unknown,
            confidence: Confidence::Probable,
            charset: None,
        };
    }
    if is_delimited(&text) {
        return Identification {
            format: IdentifiedFormat::DelimitedText,
            confidence: Confidence::Uncertain,
            charset: Some(charset),
        };
    }
    Identification {
        format: IdentifiedFormat::PlainText,
        confidence: Confidence::Uncertain,
        charset: Some(charset),
    }
}

/// The picture magic numbers a production actually contains — scans, photographs of documents, and
/// exported fax pages. This engine reads no pixels; naming the format is what lets the caller route
/// the page to recognition instead of recording it as unreadable.
fn image_magic(bytes: &[u8]) -> Option<IdentifiedFormat> {
    const TIFF_LITTLE_ENDIAN: &[u8] = &[0x49, 0x49, 0x2A, 0x00];
    const TIFF_BIG_ENDIAN: &[u8] = &[0x4D, 0x4D, 0x00, 0x2A];
    let is_image = bytes.starts_with(&[0xFF, 0xD8, 0xFF])
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(TIFF_LITTLE_ENDIAN)
        || bytes.starts_with(TIFF_BIG_ENDIAN)
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || bytes.starts_with(b"BM")
        || (bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP");
    is_image.then_some(IdentifiedFormat::RasterImage)
}

/// An mbox opens with a `From ` separator line — no colon, which is what tells it from a `From:`
/// header on a single message.
fn is_mbox(text: &str) -> bool {
    text.starts_with("From ")
}

/// RFC 5322 has no magic number, so the rule is the header block itself: unfolded `Name: value` lines
/// running until a blank line, including at least one header a message cannot be a message without.
/// This is the case extension-less identification exists for — a production of loose message files
/// named by a hash is otherwise unroutable.
fn looks_like_rfc5322(text: &str) -> bool {
    const DEFINING_HEADERS: &[&str] = &[
        "received:",
        "message-id:",
        "mime-version:",
        "from:",
        "to:",
        "subject:",
        "date:",
    ];
    let mut header_lines = 0usize;
    let mut defining = 0usize;
    for line in text.lines() {
        if line.trim().is_empty() {
            break;
        }
        // A folded continuation belongs to the header above it.
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some(colon) = line.find(':') else {
            return false;
        };
        let name = line[..colon].trim();
        if name.is_empty() || !name.bytes().all(|byte| (33..=126).contains(&byte)) {
            return false;
        }
        header_lines += 1;
        let lowered = line[..=colon].to_ascii_lowercase();
        if DEFINING_HEADERS.contains(&lowered.as_str()) {
            defining += 1;
        }
    }
    header_lines >= 2 && defining >= 2
}

/// Is this decoded text something a person wrote, or binary that happened to decode? Control
/// characters other than the three that appear in real text are the tell.
fn is_readable_text(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let control = text
        .chars()
        .filter(|character| {
            character.is_control() && *character != '\n' && *character != '\r' && *character != '\t'
        })
        .count();
    // One control character in a hundred is a corrupt text file; one in ten is a binary.
    control * 100 < text.chars().count() * 5
}

/// A delimiter that appears the same number of times on every one of the first several non-empty
/// lines is a column separator; one that varies is punctuation. Deliberately conservative — this
/// answer only ever changes a label, never a route, because delimited text extracts as text either
/// way.
fn is_delimited(text: &str) -> bool {
    const SAMPLE_LINES: usize = 5;
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(SAMPLE_LINES)
        .collect();
    if lines.len() < 2 {
        return false;
    }
    [',', '\t', ';', '|'].iter().any(|delimiter| {
        let counts: Vec<usize> = lines
            .iter()
            .map(|line| line.matches(*delimiter).count())
            .collect();
        counts[0] > 0 && counts.iter().all(|count| *count == counts[0])
    })
}

/// Compare an identification against what a file's name claims, so a disagreement can be REPORTED.
/// Never consulted by [`identify`] — the separation is the guarantee that a name cannot influence a
/// route, and it is why this takes an already-made identification rather than making one.
pub fn name_agreement(identified: IdentifiedFormat, file_name: &str) -> NameAgreement {
    let Some(extension) = file_name.rsplit_once('.').map(|(_, tail)| tail) else {
        return NameAgreement::NoOpinion;
    };
    let expected = match extension.to_ascii_lowercase().as_str() {
        "pdf" => IdentifiedFormat::Pdf,
        "docx" | "docm" => IdentifiedFormat::OfficeOpenXmlDocument,
        "xlsx" | "xlsm" => IdentifiedFormat::OfficeOpenXmlWorkbook,
        "pptx" | "pptm" => IdentifiedFormat::OfficeOpenXmlPresentation,
        "odt" => IdentifiedFormat::OpenDocumentText,
        "ods" => IdentifiedFormat::OpenDocumentSpreadsheet,
        "odp" => IdentifiedFormat::OpenDocumentPresentation,
        "zip" => IdentifiedFormat::ZipArchive,
        "doc" => IdentifiedFormat::LegacyWordDocument,
        "xls" => IdentifiedFormat::LegacyExcelWorkbook,
        "ppt" => IdentifiedFormat::LegacyPowerPointPresentation,
        "msg" => IdentifiedFormat::OutlookMessage,
        "jpg" | "jpeg" | "png" | "tif" | "tiff" | "gif" | "bmp" | "webp" => {
            IdentifiedFormat::RasterImage
        }
        "rtf" => IdentifiedFormat::RichTextFormat,
        "eml" => IdentifiedFormat::EmailMessage,
        "mbox" => IdentifiedFormat::MboxArchive,
        "html" | "htm" => IdentifiedFormat::HypertextMarkup,
        "xml" => IdentifiedFormat::ExtensibleMarkup,
        "json" => IdentifiedFormat::JavaScriptObjectNotation,
        "csv" | "tsv" => IdentifiedFormat::DelimitedText,
        "txt" | "text" | "log" => IdentifiedFormat::PlainText,
        _ => return NameAgreement::NoOpinion,
    };
    if expected == identified {
        return NameAgreement::Agrees;
    }
    // Text subtypes are one family: a `.csv` whose rows have no consistent delimiter identifies as
    // plain text, and calling that a disagreement would fill the report with noise.
    if is_text_family(expected) && is_text_family(identified) {
        return NameAgreement::Agrees;
    }
    NameAgreement::Disagrees
}

fn is_text_family(format: IdentifiedFormat) -> bool {
    matches!(
        format,
        IdentifiedFormat::PlainText
            | IdentifiedFormat::DelimitedText
            | IdentifiedFormat::JavaScriptObjectNotation
            | IdentifiedFormat::ExtensibleMarkup
            | IdentifiedFormat::HypertextMarkup
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        legacy_word_compound_file, office_open_xml_document, open_document_text, outlook_message,
        plain_zip_archive,
    };

    #[test]
    fn a_pdf_is_identified_by_its_magic_bytes() {
        let identification = identify(b"%PDF-1.7\n1 0 obj\n");
        assert_eq!(identification.format, IdentifiedFormat::Pdf);
        assert_eq!(identification.confidence, Confidence::Certain);
    }

    #[test]
    fn a_zip_is_refined_into_the_package_it_actually_is() {
        assert_eq!(
            identify(&office_open_xml_document("Contract terms")).format,
            IdentifiedFormat::OfficeOpenXmlDocument
        );
        assert_eq!(
            identify(&open_document_text("Contract terms")).format,
            IdentifiedFormat::OpenDocumentText
        );
        assert_eq!(
            identify(&plain_zip_archive(&[("exhibit-a.txt", b"one")])).format,
            IdentifiedFormat::ZipArchive
        );
    }

    #[test]
    fn an_ole2_is_refined_into_the_document_it_actually_is() {
        assert_eq!(
            identify(&legacy_word_compound_file()).format,
            IdentifiedFormat::LegacyWordDocument
        );
        assert_eq!(
            identify(&outlook_message()).format,
            IdentifiedFormat::OutlookMessage
        );
    }

    #[test]
    fn an_extension_less_message_is_identified_from_its_header_block() {
        let message = b"Received: from mail.example.test\r\nFrom: opposing@example.test\r\nTo: firm@example.test\r\nSubject: Production\r\n\r\nBody text.\r\n";
        let identification = identify(message);
        assert_eq!(identification.format, IdentifiedFormat::EmailMessage);
        assert_eq!(identification.confidence, Confidence::Probable);
    }

    #[test]
    fn prose_that_merely_mentions_a_colon_is_not_a_message() {
        let prose =
            b"Dear Counsel:\n\nPlease find enclosed the documents responsive to request 4.\n";
        assert_ne!(identify(prose).format, IdentifiedFormat::EmailMessage);
    }

    #[test]
    fn rich_text_and_mbox_are_identified_by_their_openers() {
        assert_eq!(
            identify(br"{\rtf1\ansi Hello}").format,
            IdentifiedFormat::RichTextFormat
        );
        assert_eq!(
            identify(
                b"From opposing@example.test Tue Aug 04 10:00:00 2026\nSubject: One\n\nbody\n"
            )
            .format,
            IdentifiedFormat::MboxArchive
        );
    }

    #[test]
    fn markup_delimited_and_plain_text_are_told_apart() {
        assert_eq!(
            identify(b"<!DOCTYPE html><html><body>hi</body></html>").format,
            IdentifiedFormat::HypertextMarkup
        );
        assert_eq!(
            identify(b"<?xml version=\"1.0\"?><root/>").format,
            IdentifiedFormat::ExtensibleMarkup
        );
        assert_eq!(
            identify(b"name,role,date\nSmith,record custodian,2026-01-02\n").format,
            IdentifiedFormat::DelimitedText
        );
        assert_eq!(
            identify(b"The witness stated that the meeting occurred in March.\n").format,
            IdentifiedFormat::PlainText
        );
    }

    /// The whole corpus, with every extension stripped, still routes correctly — because the
    /// extension was never consulted.
    #[test]
    fn the_fixture_corpus_identifies_with_no_name_at_all() {
        let corpus: Vec<(Vec<u8>, IdentifiedFormat)> = vec![
            (b"%PDF-1.7\ntrailer\n".to_vec(), IdentifiedFormat::Pdf),
            (
                office_open_xml_document("text"),
                IdentifiedFormat::OfficeOpenXmlDocument,
            ),
            (
                open_document_text("text"),
                IdentifiedFormat::OpenDocumentText,
            ),
            (
                plain_zip_archive(&[("a.txt", b"a")]),
                IdentifiedFormat::ZipArchive,
            ),
            (
                legacy_word_compound_file(),
                IdentifiedFormat::LegacyWordDocument,
            ),
            (outlook_message(), IdentifiedFormat::OutlookMessage),
            (br"{\rtf1 x}".to_vec(), IdentifiedFormat::RichTextFormat),
            (
                b"From: a@b.test\r\nSubject: s\r\n\r\nbody".to_vec(),
                IdentifiedFormat::EmailMessage,
            ),
            (
                b"Plain prose about the deposition.".to_vec(),
                IdentifiedFormat::PlainText,
            ),
        ];
        for (bytes, expected) in corpus {
            assert_eq!(identify(&bytes).format, expected);
        }
    }

    #[test]
    fn a_name_that_contradicts_the_bytes_loses_and_the_disagreement_is_reported() {
        // A spreadsheet renamed to a picture: identification is unmoved, and the lie is reported.
        let spreadsheet = office_open_xml_document("cells");
        let identification = identify(&spreadsheet);
        assert_eq!(
            identification.format,
            IdentifiedFormat::OfficeOpenXmlDocument
        );
        assert_eq!(
            name_agreement(identification.format, "PLTF000123.jpg"),
            NameAgreement::Disagrees
        );
        assert_eq!(
            name_agreement(identification.format, "PLTF000123.docx"),
            NameAgreement::Agrees
        );
        assert_eq!(
            name_agreement(identification.format, "PLTF000123"),
            NameAgreement::NoOpinion
        );
    }

    #[test]
    fn empty_input_is_unknown_rather_than_an_error() {
        assert_eq!(identify(b"").format, IdentifiedFormat::Unknown);
    }

    #[test]
    fn binary_bytes_that_match_nothing_are_unknown_not_text() {
        let binary: Vec<u8> = (0u8..=255).cycle().take(4096).collect();
        assert_eq!(identify(&binary).format, IdentifiedFormat::Unknown);
    }

    #[test]
    fn every_format_has_a_distinct_stable_label() {
        let formats = [
            IdentifiedFormat::Pdf,
            IdentifiedFormat::OfficeOpenXmlDocument,
            IdentifiedFormat::OfficeOpenXmlWorkbook,
            IdentifiedFormat::OfficeOpenXmlPresentation,
            IdentifiedFormat::OpenDocumentText,
            IdentifiedFormat::OpenDocumentSpreadsheet,
            IdentifiedFormat::OpenDocumentPresentation,
            IdentifiedFormat::ZipArchive,
            IdentifiedFormat::LegacyWordDocument,
            IdentifiedFormat::LegacyExcelWorkbook,
            IdentifiedFormat::LegacyPowerPointPresentation,
            IdentifiedFormat::OutlookMessage,
            IdentifiedFormat::EncryptedOfficePackage,
            IdentifiedFormat::CompoundFile,
            IdentifiedFormat::RasterImage,
            IdentifiedFormat::RichTextFormat,
            IdentifiedFormat::EmailMessage,
            IdentifiedFormat::MboxArchive,
            IdentifiedFormat::HypertextMarkup,
            IdentifiedFormat::ExtensibleMarkup,
            IdentifiedFormat::JavaScriptObjectNotation,
            IdentifiedFormat::DelimitedText,
            IdentifiedFormat::PlainText,
            IdentifiedFormat::Unknown,
        ];
        let mut labels: Vec<&str> = formats.iter().map(|format| format.label()).collect();
        labels.sort_unstable();
        let count = labels.len();
        labels.dedup();
        assert_eq!(labels.len(), count, "two formats share a wire label");
    }
}
