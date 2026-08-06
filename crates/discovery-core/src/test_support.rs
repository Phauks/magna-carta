//! Fixture builders for this crate's own tests.
//!
//! The corpus is BUILT rather than committed as binary files, for two reasons that matter more here
//! than the convenience: a constructed fixture states in code exactly which structural feature it is
//! testing (a shared-string table, a traversal path, an expansion ratio), and a test corpus of
//! hostile archives is not a thing to leave lying in a repository as files. The one exception is the
//! PDF corpus, which is the shipped PDF engine's own and is embedded from there.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// A ZIP holding exactly the named entries, deflated.
pub fn zip_from(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in files {
        writer.start_file(*name, options).expect("start entry");
        writer.write_all(bytes).expect("write entry");
    }
    writer.finish().expect("finish archive").into_inner()
}

/// A ZIP whose first entry is STORED rather than deflated — the shape an OpenDocument package's
/// `mimetype` entry is required to take.
fn zip_with_stored_first(first: (&str, &[u8]), rest: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    writer.start_file(first.0, stored).expect("start entry");
    writer.write_all(first.1).expect("write entry");
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in rest {
        writer.start_file(*name, deflated).expect("start entry");
        writer.write_all(bytes).expect("write entry");
    }
    writer.finish().expect("finish archive").into_inner()
}

const CORE_PROPERTIES: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/">
<dcterms:created>2026-08-01T08:00:00Z</dcterms:created>
<dcterms:modified>2026-08-04T09:30:00Z</dcterms:modified>
</cp:coreProperties>"#;

/// A minimal `.docx`: the part that makes it identifiable, one paragraph, and its properties.
pub fn office_open_xml_document(text: &str) -> Vec<u8> {
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>{text}</w:t></w:r></w:p>
</w:body></w:document>"#
    );
    zip_from(&[
        ("[Content_Types].xml", b"<Types/>"),
        ("word/document.xml", body.as_bytes()),
        ("docProps/core.xml", CORE_PROPERTIES),
    ])
}

/// A minimal `.xlsx` with a shared-string table, so the shared-index resolution has something to
/// resolve — a workbook whose strings are all inline would pass a test that never exercises it.
pub fn office_open_xml_workbook() -> Vec<u8> {
    const SHARED: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
<si><t>Record custodian of the file</t></si><si><t>Produced</t></si>
</sst>"#;
    const SHEET: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>Smith</t></is></c><c r="B2"><v>2026-01-02</v></c></row>
</sheetData></worksheet>"#;
    zip_from(&[
        ("[Content_Types].xml", b"<Types/>"),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/sharedStrings.xml", SHARED),
        ("xl/worksheets/sheet1.xml", SHEET),
        ("docProps/core.xml", CORE_PROPERTIES),
    ])
}

/// A minimal `.pptx` with eleven slides, deliberately numbered so lexical ordering would be wrong.
pub fn office_open_xml_presentation() -> Vec<u8> {
    let slides: Vec<(String, Vec<u8>)> = (1..=11)
        .map(|number| {
            (
                format!("ppt/slides/slide{number}.xml"),
                format!(
                    r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Slide {number}</a:t></a:r></a:p></p:sld>"#
                )
                .into_bytes(),
            )
        })
        .collect();
    let mut files: Vec<(&str, &[u8])> = vec![
        ("[Content_Types].xml", b"<Types/>"),
        ("ppt/presentation.xml", b"<presentation/>"),
        ("docProps/core.xml", CORE_PROPERTIES),
    ];
    for (name, bytes) in &slides {
        files.push((name.as_str(), bytes.as_slice()));
    }
    zip_from(&files)
}

/// A minimal `.odt`, with the uncompressed `mimetype` entry the format requires.
pub fn open_document_text(text: &str) -> Vec<u8> {
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:text><text:p>{text}</text:p></office:text></office:body></office:document-content>"#
    );
    const META: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<office:meta><dc:date>2026-08-04T09:30:00</dc:date></office:meta></office:document-meta>"#;
    zip_with_stored_first(
        ("mimetype", b"application/vnd.oasis.opendocument.text"),
        &[("content.xml", content.as_bytes()), ("meta.xml", META)],
    )
}

/// A ZIP that is a container of loose documents rather than a document package.
pub fn plain_zip_archive(files: &[(&str, &[u8])]) -> Vec<u8> {
    zip_from(files)
}

/// A compound file carrying the stream that makes it a legacy Word document.
pub fn legacy_word_compound_file() -> Vec<u8> {
    compound_file_with_streams(&[("WordDocument", b"\xEC\xA5legacy body")])
}

/// A compound file carrying the MAPI property stream that makes it an Outlook message.
pub fn outlook_message() -> Vec<u8> {
    compound_file_with_streams(&[("__properties_version1.0", b"\x00\x00\x00\x00")])
}

fn compound_file_with_streams(streams: &[(&str, &[u8])]) -> Vec<u8> {
    let mut compound = cfb::CompoundFile::create(Cursor::new(Vec::new())).expect("create");
    for (name, bytes) in streams {
        let mut stream = compound.create_stream(name).expect("create stream");
        stream.write_all(bytes).expect("write stream");
    }
    compound.flush().expect("flush");
    compound.into_inner().into_inner()
}

/// A small archive whose entry expands enormously — the classic shape, one highly compressible
/// entry, built rather than committed so no bomb sits in the repository as a file.
pub fn zip_bomb() -> Vec<u8> {
    let payload = vec![b'0'; 4 * 1024 * 1024];
    zip_from(&[("bomb.bin", &payload)])
}

/// An archive with one entry that tries to escape the extraction root and one that does not.
pub fn zip_with_traversal_entry() -> Vec<u8> {
    zip_from_raw_names(&[
        ("../../etc/passwd", b"root:x:0:0"),
        ("innocent.txt", b"an ordinary exhibit"),
    ])
}

/// `zip`'s writer sanitizes entry names, which is correct for writing and useless for building the
/// hostile fixture — so the traversal name is patched into the finished archive's bytes, in both the
/// local header and the central directory, leaving a real archive that really declares the path.
fn zip_from_raw_names(files: &[(&str, &[u8])]) -> Vec<u8> {
    let placeholders: Vec<String> = files
        .iter()
        .enumerate()
        .map(|(index, (name, _))| format!("{index}{}", "_".repeat(name.len() - 1)))
        .collect();
    let borrowed: Vec<(&str, &[u8])> = files
        .iter()
        .enumerate()
        .map(|(index, (_, bytes))| (placeholders[index].as_str(), *bytes))
        .collect();
    let mut archive = zip_from(&borrowed);
    for (index, (name, _)) in files.iter().enumerate() {
        let placeholder = placeholders[index].as_bytes();
        replace_all(&mut archive, placeholder, name.as_bytes());
    }
    archive
}

fn replace_all(haystack: &mut [u8], needle: &[u8], replacement: &[u8]) {
    assert_eq!(needle.len(), replacement.len());
    let mut index = 0;
    while index + needle.len() <= haystack.len() {
        if &haystack[index..index + needle.len()] == needle {
            haystack[index..index + needle.len()].copy_from_slice(replacement);
            index += needle.len();
        } else {
            index += 1;
        }
    }
}

/// Archives inside archives, `depth` deep, with a named payload at the bottom so a test can assert
/// whether the innermost entry was ever reached.
pub fn nested_zip_archive(depth: usize) -> Vec<u8> {
    let mut current = zip_from(&[("deepest.txt", b"the deepest exhibit")]);
    for level in (0..depth).rev() {
        let name = format!("level{level}.zip");
        current = zip_from(&[(name.as_str(), current.as_slice())]);
    }
    current
}
