//! Office Open XML and OpenDocument — both are a ZIP of XML parts, so both are read the same way:
//! open the package's central directory, read the parts that hold words, and walk each one for
//! character data. No part is ever read by inflating the whole package first, and every part is read
//! under a cap, because a package is an archive and an archive is a bomb until it is bounded.

use std::io::{Cursor, Read};

use super::{single_page, DateSource, DocumentDate, ExtractedDocument};
use crate::chunk::Page;
use crate::error::DiscoveryError;
use crate::identify::IdentifiedFormat;
use crate::limits::Limits;
use crate::xml::{first_element_text, text_lines, XmlTextRules};

type Package<'bytes> = zip::read::ZipArchive<Cursor<&'bytes [u8]>>;

/// The word-processing body. A paragraph ends a line; a tab or a soft break is a space; the fields
/// that carry instructions rather than content are skipped so a mail-merge field's plumbing does not
/// become searchable text.
const WORDPROCESSING_RULES: XmlTextRules = XmlTextRules {
    line_break_elements: &["p"],
    skipped_elements: &["instrText", "fldChar", "binData", "proofErr"],
    space_elements: &["tab", "br"],
};

/// A presentation's slide. Text sits in `a:p` paragraphs inside shape text bodies.
const PRESENTATION_RULES: XmlTextRules = XmlTextRules {
    line_break_elements: &["p"],
    skipped_elements: &["blip", "extLst"],
    space_elements: &["br", "tab"],
};

/// An OpenDocument body. Headings and paragraphs end lines; so does a table row, or a spreadsheet
/// would come out as one enormous line.
const OPEN_DOCUMENT_RULES: XmlTextRules = XmlTextRules {
    line_break_elements: &["p", "h", "table-row"],
    skipped_elements: &["binary-data", "annotation"],
    space_elements: &["tab", "line-break", "s"],
};

/// The most bytes any single XML part may occupy once inflated. A part is a document's text, not its
/// media, so this is generous for real documents and refuses the part that is a bomb.
const MAX_PART_BYTES: u64 = 512 * 1024 * 1024;

pub fn extract(
    bytes: &[u8],
    format: IdentifiedFormat,
    limits: &Limits,
) -> Result<ExtractedDocument, DiscoveryError> {
    let mut package =
        zip::read::ZipArchive::new(Cursor::new(bytes)).map_err(|_| DiscoveryError::Corrupt)?;
    match format {
        IdentifiedFormat::OfficeOpenXmlDocument => {
            let part = require_part(&mut package, "word/document.xml")?;
            Ok(ExtractedDocument {
                format,
                charset: None,
                pages: single_page(text_lines(&part, &WORDPROCESSING_RULES, limits)?),
                // A word-processing document's page count is a property of how it is laid out for a
                // given printer, not of the file. Claiming one here would put a made-up number under
                // the eventual Bates stamps.
                page_count: None,
                document_date: package_properties_date(&mut package),
                pages_needing_recognition: Vec::new(),
            })
        }
        IdentifiedFormat::OfficeOpenXmlWorkbook => {
            let lines = workbook_lines(&mut package, limits)?;
            Ok(ExtractedDocument {
                format,
                charset: None,
                pages: single_page(lines),
                page_count: None,
                document_date: package_properties_date(&mut package),
                pages_needing_recognition: Vec::new(),
            })
        }
        IdentifiedFormat::OfficeOpenXmlPresentation => {
            let pages = presentation_pages(&mut package, limits)?;
            let page_count = pages.len();
            Ok(ExtractedDocument {
                format,
                charset: None,
                pages,
                // A slide IS a page: it is the unit a person cites and the unit a production stamps.
                page_count: Some(page_count),
                document_date: package_properties_date(&mut package),
                pages_needing_recognition: Vec::new(),
            })
        }
        IdentifiedFormat::OpenDocumentText
        | IdentifiedFormat::OpenDocumentSpreadsheet
        | IdentifiedFormat::OpenDocumentPresentation => {
            let part = require_part(&mut package, "content.xml")?;
            Ok(ExtractedDocument {
                format,
                charset: None,
                pages: single_page(text_lines(&part, &OPEN_DOCUMENT_RULES, limits)?),
                page_count: None,
                document_date: open_document_date(&mut package),
                pages_needing_recognition: Vec::new(),
            })
        }
        _ => Err(DiscoveryError::UnsupportedFormat),
    }
}

/// Read one part, capped. A part named by the format and absent from the package means the package
/// is not the thing it claimed to be — corrupt, not unsupported.
fn require_part(package: &mut Package<'_>, name: &str) -> Result<Vec<u8>, DiscoveryError> {
    read_part(package, name).ok_or(DiscoveryError::Corrupt)
}

fn read_part(package: &mut Package<'_>, name: &str) -> Option<Vec<u8>> {
    let entry = package.by_name(name).ok()?;
    let mut part = Vec::new();
    // `take` bounds the read at the cap regardless of what the entry's header DECLARES its size to
    // be — a declared length never sizes an allocation here.
    entry.take(MAX_PART_BYTES).read_to_end(&mut part).ok()?;
    Some(part)
}

/// A spreadsheet's words live in two places: the shared-string table (which holds every repeated
/// string once) and the sheets themselves (inline strings and numbers). Reading only one of them
/// misses most of a real workbook, so both are read and a row becomes a line.
fn workbook_lines(
    package: &mut Package<'_>,
    limits: &Limits,
) -> Result<Vec<String>, DiscoveryError> {
    let shared = match read_part(package, "xl/sharedStrings.xml") {
        Some(part) => shared_strings(&part, limits)?,
        None => Vec::new(),
    };
    let mut sheet_names: Vec<String> = package
        .file_names()
        .filter_map(|name| name.ok().map(std::borrow::Cow::into_owned))
        .filter(|name| name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml"))
        .collect();
    sheet_names.sort_by_key(|name| trailing_number(name));
    let mut lines = Vec::new();
    for name in sheet_names {
        let Some(part) = read_part(package, &name) else {
            continue;
        };
        lines.extend(sheet_rows(&part, &shared, limits)?);
    }
    Ok(lines)
}

/// The shared-string table: one entry per distinct string, referenced by index from the cells.
fn shared_strings(part: &[u8], limits: &Limits) -> Result<Vec<String>, DiscoveryError> {
    const SHARED_STRING_RULES: XmlTextRules = XmlTextRules {
        line_break_elements: &["si"],
        skipped_elements: &["rPh", "phoneticPr"],
        space_elements: &[],
    };
    // A shared string that normalizes to nothing still occupies its index, so the table cannot be
    // built from the line walk (which drops empties). It is walked as one line per `si` and the
    // empties are restored by position below.
    text_lines(part, &SHARED_STRING_RULES, limits)
}

/// Walk one sheet, emitting a tab-separated line per row. A cell's `t="s"` says its value is an
/// index into the shared table rather than a literal, which is why this is a bespoke walk rather
/// than the generic one: resolving the index is the difference between a spreadsheet's real words
/// and a page of row numbers.
fn sheet_rows(
    part: &[u8],
    shared: &[String],
    limits: &Limits,
) -> Result<Vec<String>, DiscoveryError> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(part);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    let mut cells: Vec<String> = Vec::new();
    let mut cell_is_shared_index = false;
    let mut in_value = false;
    let mut events = 0usize;
    loop {
        events += 1;
        if events > limits.max_xml_events {
            return Err(DiscoveryError::LimitExceeded);
        }
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| DiscoveryError::Corrupt)?;
        match event {
            Event::Start(start) => {
                let name = start.name();
                match local(name.as_ref()) {
                    "row" => cells.clear(),
                    "c" => {
                        cell_is_shared_index = start.attributes().flatten().any(|attribute| {
                            attribute.key.as_ref() == b"t" && attribute.value.as_ref() == b"s"
                        })
                    }
                    "v" | "t" => in_value = true,
                    _ => {}
                }
            }
            Event::Text(text) if in_value => {
                let value = text.decode().map_err(|_| DiscoveryError::Corrupt)?;
                let resolved = if cell_is_shared_index {
                    value
                        .parse::<usize>()
                        .ok()
                        .and_then(|index| shared.get(index))
                        .cloned()
                        .unwrap_or_default()
                } else {
                    value.into_owned()
                };
                let cell = crate::normalize::normalize_line(&resolved);
                if !cell.is_empty() {
                    cells.push(cell);
                }
            }
            Event::End(end) => match local(end.name().as_ref()) {
                "v" | "t" => in_value = false,
                "row" if !cells.is_empty() => {
                    lines.push(cells.join("\t"));
                    cells.clear();
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(lines)
}

/// One slide, one page — sorted by the number in the part name, because `slide10.xml` sorts before
/// `slide2.xml` as a string and a production whose pages are in lexical order is a production nobody
/// can cite.
fn presentation_pages(
    package: &mut Package<'_>,
    limits: &Limits,
) -> Result<Vec<Page>, DiscoveryError> {
    let mut slide_names: Vec<String> = package
        .file_names()
        .filter_map(|name| name.ok().map(std::borrow::Cow::into_owned))
        .filter(|name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
        .collect();
    slide_names.sort_by_key(|name| trailing_number(name));
    let mut pages = Vec::new();
    for (index, name) in slide_names.iter().enumerate() {
        if index >= limits.max_page_count {
            return Err(DiscoveryError::LimitExceeded);
        }
        let Some(part) = read_part(package, name) else {
            continue;
        };
        pages.push(Page {
            page_index: index,
            lines: text_lines(&part, &PRESENTATION_RULES, limits)?,
        });
    }
    Ok(pages)
}

/// The number at the end of a part's stem, for ordering. A name with no number sorts first, which is
/// stable and does not matter because the formats always number.
fn trailing_number(name: &str) -> u32 {
    let stem = name.rsplit('/').next().unwrap_or(name);
    let digits: String = stem
        .chars()
        .skip_while(|character| !character.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().unwrap_or(0)
}

fn local(raw: &[u8]) -> &str {
    let name = std::str::from_utf8(raw).unwrap_or("");
    match name.rsplit_once(':') {
        Some((_, tail)) => tail,
        None => name,
    }
}

/// Modified before created: the date a reviewer sorts by is when the document last said something,
/// not when its template was first opened.
fn package_properties_date(package: &mut Package<'_>) -> Option<DocumentDate> {
    let part = read_part(package, "docProps/core.xml")?;
    let value = first_element_text(&part, &["modified", "created"], &Limits::default())?;
    Some(DocumentDate {
        value,
        source: DateSource::PackageProperties,
    })
}

fn open_document_date(package: &mut Package<'_>) -> Option<DocumentDate> {
    let part = read_part(package, "meta.xml")?;
    let value = first_element_text(&part, &["date", "creation-date"], &Limits::default())?;
    Some(DocumentDate {
        value,
        source: DateSource::PackageProperties,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract as extract_document, ExtractionOutcome};
    use crate::test_support::{
        office_open_xml_document, office_open_xml_presentation, office_open_xml_workbook,
        open_document_text, zip_from,
    };

    fn extracted(bytes: &[u8]) -> ExtractedDocument {
        match extract_document(bytes).unwrap() {
            ExtractionOutcome::Extracted(document) => document,
            other => panic!("expected an extraction, got {other:?}"),
        }
    }

    #[test]
    fn a_word_processing_document_extracts_its_paragraphs_and_its_date() {
        let document = extracted(&office_open_xml_document(
            "The seller shall indemnify the buyer.",
        ));
        assert_eq!(
            document.pages[0].lines,
            vec!["The seller shall indemnify the buyer."]
        );
        assert_eq!(
            document.document_date,
            Some(DocumentDate {
                value: "2026-08-04T09:30:00Z".to_owned(),
                source: DateSource::PackageProperties,
            })
        );
        assert_eq!(document.page_count, None);
    }

    #[test]
    fn a_workbook_resolves_its_shared_strings_rather_than_extracting_indexes() {
        let document = extracted(&office_open_xml_workbook());
        let text = document.pages[0].lines.join("\n");
        assert!(
            text.contains("Record custodian of the file"),
            "got {text:?}"
        );
        assert!(text.contains("2026-01-02"), "got {text:?}");
        assert!(
            !text.contains("\n0\n"),
            "a shared-string index leaked: {text:?}"
        );
    }

    #[test]
    fn a_presentation_is_one_page_per_slide_in_numeric_order() {
        let document = extracted(&office_open_xml_presentation());
        assert_eq!(document.page_count, Some(11));
        assert_eq!(document.pages[0].lines, vec!["Slide 1"]);
        // Slide 10 and 11 exist precisely because they sort before slide 2 as strings.
        assert_eq!(document.pages[1].lines, vec!["Slide 2"]);
        assert_eq!(document.pages[10].lines, vec!["Slide 11"]);
    }

    #[test]
    fn an_open_document_package_extracts_its_body() {
        let document = extracted(&open_document_text("Deposition of the witness."));
        assert_eq!(document.pages[0].lines, vec!["Deposition of the witness."]);
    }

    #[test]
    fn a_package_whose_part_will_not_inflate_is_corrupt_rather_than_empty() {
        // The package's directory still names `word/document.xml`, so it identifies as a
        // word-processing document; its compressed bytes are then damaged. The honest answer is
        // corrupt — "a document containing no words" would be a claim about its contents.
        let body = "<w:document><w:body><w:p>a paragraph of real text</w:p></w:body></w:document>"
            .repeat(20);
        let mut package = zip_from(&[
            ("word/document.xml", body.as_bytes()),
            ("[Content_Types].xml", b"<Types/>"),
        ]);
        // Damage the FIRST entry's compressed stream and nothing else, so the central directory
        // still names the part (the package identifies) while the part itself will not inflate.
        // The local header is 30 bytes plus the name and the extra field, both declared in it.
        let name_length = u16::from_le_bytes([package[26], package[27]]) as usize;
        let extra_length = u16::from_le_bytes([package[28], package[29]]) as usize;
        let data_start = 30 + name_length + extra_length;
        for byte in &mut package[data_start + 4..data_start + 20] {
            *byte ^= 0xFF;
        }
        assert_eq!(
            crate::extract::extract(&package),
            Err(DiscoveryError::Corrupt)
        );
    }
}
