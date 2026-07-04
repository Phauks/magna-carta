//! Open Packaging Conventions reconstruction so a recovered OOXML package
//! (docx/xlsx/pptx) reopens: regenerate [Content_Types].xml and the root _rels.

const CONTENT_TYPES_PATH: &str = "[Content_Types].xml";
const ROOT_RELS_PATH: &str = "_rels/.rels";

/// True when the entry set looks like an OOXML (Open Packaging Conventions)
/// package: it has a main-story directory or a content-types part.
pub fn is_ooxml(entries: &[(String, Vec<u8>)]) -> bool {
    entries.iter().any(|(name, _)| {
        name == CONTENT_TYPES_PATH
            || name.starts_with("word/")
            || name.starts_with("xl/")
            || name.starts_with("ppt/")
    })
}

fn has(entries: &[(String, Vec<u8>)], path: &str) -> bool {
    entries.iter().any(|(name, _)| name == path)
}

/// The main document part of the package, if present, in OPC priority order.
fn main_part(entries: &[(String, Vec<u8>)]) -> Option<&'static str> {
    if entries.iter().any(|(n, _)| n == "word/document.xml") {
        Some("word/document.xml")
    } else if entries.iter().any(|(n, _)| n == "xl/workbook.xml") {
        Some("xl/workbook.xml")
    } else if entries.iter().any(|(n, _)| n == "ppt/presentation.xml") {
        Some("ppt/presentation.xml")
    } else {
        None
    }
}

fn content_type_for(main: &str) -> &'static str {
    match main {
        "xl/workbook.xml" => {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
        }
        "ppt/presentation.xml" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
        }
        // word/document.xml and the default
        _ => "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    }
}

fn synth_content_types(main: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
         <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
         <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
         <Override PartName=\"/{main}\" ContentType=\"{ct}\"/></Types>",
        main = main,
        ct = content_type_for(main),
    )
    .into_bytes()
}

fn synth_root_rels(main: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
         <Relationship Id=\"rId1\" \
         Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" \
         Target=\"{main}\"/></Relationships>",
        main = main,
    )
    .into_bytes()
}

/// Ensure the OPC skeleton (content types + root relationships) is present so the
/// package reopens. Existing parts are never overwritten; only missing skeleton
/// parts are synthesized, and only when a main document part can be identified.
pub fn reconstruct_opc(mut entries: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)> {
    let Some(main) = main_part(&entries) else {
        return entries; // no recognizable main part — nothing safe to synthesize
    };
    if !has(&entries, CONTENT_TYPES_PATH) {
        entries.push((CONTENT_TYPES_PATH.to_string(), synth_content_types(main)));
    }
    if !has(&entries, ROOT_RELS_PATH) {
        entries.push((ROOT_RELS_PATH.to_string(), synth_root_rels(main)));
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(entries: &[(String, Vec<u8>)]) -> Vec<&str> {
        entries.iter().map(|(n, _)| n.as_str()).collect()
    }

    #[test]
    fn detects_a_word_package() {
        let entries = vec![("word/document.xml".to_string(), b"<w:document/>".to_vec())];
        assert!(is_ooxml(&entries));
    }

    #[test]
    fn a_non_ooxml_zip_is_not_ooxml() {
        let entries = vec![("photos/cat.jpg".to_string(), vec![0xFF, 0xD8])];
        assert!(!is_ooxml(&entries));
    }

    #[test]
    fn reconstructs_a_missing_content_types_and_root_rels() {
        // A docx whose OPC skeleton was lost in salvage: only the main part remains.
        let entries = vec![("word/document.xml".to_string(), minimal_document_xml())];
        let rebuilt = reconstruct_opc(entries);
        let n = names(&rebuilt);
        assert!(
            n.contains(&CONTENT_TYPES_PATH),
            "must synthesize [Content_Types].xml"
        );
        assert!(n.contains(&ROOT_RELS_PATH), "must synthesize _rels/.rels");
        // The content types must declare the rels default and the document override.
        let ct = &rebuilt
            .iter()
            .find(|(p, _)| p == CONTENT_TYPES_PATH)
            .unwrap()
            .1;
        let ct = String::from_utf8_lossy(ct);
        assert!(ct.contains("Extension=\"rels\""));
        assert!(ct.contains("/word/document.xml"));
        // The root rels must point at the main document part.
        let rels = &rebuilt.iter().find(|(p, _)| p == ROOT_RELS_PATH).unwrap().1;
        let rels = String::from_utf8_lossy(rels);
        assert!(rels.contains("word/document.xml"));
    }

    #[test]
    fn an_existing_content_types_is_left_untouched() {
        let custom = b"<Types>custom</Types>".to_vec();
        let entries = vec![
            (CONTENT_TYPES_PATH.to_string(), custom.clone()),
            ("word/document.xml".to_string(), minimal_document_xml()),
        ];
        let rebuilt = reconstruct_opc(entries);
        let ct = &rebuilt
            .iter()
            .find(|(p, _)| p == CONTENT_TYPES_PATH)
            .unwrap()
            .1;
        assert_eq!(
            ct, &custom,
            "an existing [Content_Types].xml must not be overwritten"
        );
    }

    fn minimal_document_xml() -> Vec<u8> {
        b"<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>".to_vec()
    }
}
