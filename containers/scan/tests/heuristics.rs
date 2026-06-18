use magna_carta_scan::heuristics::{inspect, ArchiveCaps, Heuristic, Reason};

// Fixtures are built in-code with the same crates the heuristics parse with — no committed binary
// blobs. Each test exercises one structural signal end to end through `inspect`.

// --- PDF fixtures (lopdf) ---------------------------------------------------------------------------

fn pdf(with_open_action: bool) -> Vec<u8> {
    use lopdf::{dictionary, Document, Object, StringFormat};
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let page_id = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );
    let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => pages_id };
    if with_open_action {
        let js = doc.add_object(dictionary! {
            "Type" => "Action",
            "S" => "JavaScript",
            "JS" => Object::String(b"app.alert('hi');".to_vec(), StringFormat::Literal),
        });
        catalog.set("OpenAction", js);
    }
    let catalog_id = doc.add_object(catalog);
    doc.trailer.set("Root", catalog_id);
    let mut buffer = Vec::new();
    doc.save_to(&mut buffer).expect("save pdf fixture");
    buffer
}

#[test]
fn clean_pdf_is_clean() {
    assert_eq!(
        inspect(&pdf(false), None, &ArchiveCaps::default()),
        Heuristic::Clean
    );
}

#[test]
fn pdf_with_open_action_is_active_content() {
    assert_eq!(
        inspect(&pdf(true), None, &ArchiveCaps::default()),
        Heuristic::ActiveContent
    );
}

// --- OLE / CFB fixtures (cfb) -----------------------------------------------------------------------

fn ole_with_macros() -> Vec<u8> {
    use cfb::CompoundFile;
    use std::io::Cursor;
    let mut comp = CompoundFile::create(Cursor::new(Vec::new())).expect("create cfb");
    comp.create_storage("/Macros")
        .expect("create Macros storage");
    comp.into_inner().into_inner()
}

fn cfb_encrypted_package() -> Vec<u8> {
    use cfb::CompoundFile;
    use std::io::{Cursor, Write};
    let mut comp = CompoundFile::create(Cursor::new(Vec::new())).expect("create cfb");
    {
        let mut info = comp
            .create_new_stream("/EncryptionInfo")
            .expect("EncryptionInfo");
        info.write_all(&[0x04, 0x00, 0x04, 0x00])
            .expect("write info");
    }
    {
        let mut pkg = comp
            .create_new_stream("/EncryptedPackage")
            .expect("EncryptedPackage");
        pkg.write_all(&[0u8; 64]).expect("write pkg");
    }
    comp.into_inner().into_inner()
}

#[test]
fn ole_with_macros_is_active_content() {
    assert_eq!(
        inspect(&ole_with_macros(), None, &ArchiveCaps::default()),
        Heuristic::ActiveContent
    );
}

#[test]
fn encrypted_ooxml_package_is_encrypted() {
    assert_eq!(
        inspect(&cfb_encrypted_package(), None, &ArchiveCaps::default()),
        Heuristic::Encrypted
    );
}

// --- ZIP fixtures (zip) -----------------------------------------------------------------------------

fn zip_of(entries: &[(&str, Vec<u8>, zip::CompressionMethod)]) -> Vec<u8> {
    use std::io::{Cursor, Write};
    use zip::write::{SimpleFileOptions, ZipWriter};
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data, method) in entries {
        let options = SimpleFileOptions::default().compression_method(*method);
        writer.start_file(*name, options).expect("start_file");
        writer.write_all(data).expect("write entry");
    }
    writer.finish().expect("finish zip").into_inner()
}

#[test]
fn clean_zip_is_clean() {
    let bytes = zip_of(&[(
        "word/document.xml",
        b"<document/>".to_vec(),
        zip::CompressionMethod::Deflated,
    )]);
    assert_eq!(
        inspect(&bytes, None, &ArchiveCaps::default()),
        Heuristic::Clean
    );
}

#[test]
fn ooxml_with_vbaproject_is_active_content() {
    let bytes = zip_of(&[(
        "word/vbaProject.bin",
        vec![0x00, 0x01, 0x02, 0x03],
        zip::CompressionMethod::Stored,
    )]);
    assert_eq!(
        inspect(&bytes, None, &ArchiveCaps::default()),
        Heuristic::ActiveContent
    );
}

#[test]
fn high_ratio_zip_is_a_decompression_bomb() {
    // 4 MiB of zeros deflates to a few KB -> ratio far above the cap; total stays under the size cap,
    // so the RATIO guard is what trips.
    let bytes = zip_of(&[(
        "zeros.bin",
        vec![0u8; 4 * 1024 * 1024],
        zip::CompressionMethod::Deflated,
    )]);
    assert_eq!(
        inspect(&bytes, None, &ArchiveCaps::default()),
        Heuristic::Suspicious(Reason::DecompressionBomb)
    );
}

#[test]
fn too_many_entries_is_suspicious() {
    let caps = ArchiveCaps {
        max_entries: 2,
        ..ArchiveCaps::default()
    };
    let bytes = zip_of(&[
        ("a.txt", b"a".to_vec(), zip::CompressionMethod::Stored),
        ("b.txt", b"b".to_vec(), zip::CompressionMethod::Stored),
        ("c.txt", b"c".to_vec(), zip::CompressionMethod::Stored),
    ]);
    assert_eq!(
        inspect(&bytes, None, &caps),
        Heuristic::Suspicious(Reason::ArchiveEntryCount)
    );
}

#[test]
fn nested_zip_beyond_depth_is_suspicious() {
    // An inner zip stored inside an outer zip is depth 1; max_depth 0 forbids any nesting.
    let caps = ArchiveCaps {
        max_depth: 0,
        ..ArchiveCaps::default()
    };
    let inner = zip_of(&[("inner.txt", b"x".to_vec(), zip::CompressionMethod::Stored)]);
    let outer = zip_of(&[("nested.zip", inner, zip::CompressionMethod::Stored)]);
    assert_eq!(
        inspect(&outer, None, &caps),
        Heuristic::Suspicious(Reason::ArchiveNesting)
    );
}

#[test]
fn nested_archive_with_a_non_zip_name_is_still_detected() {
    // The inner archive is stored under a non-".zip" name — descent is by content, so it is still
    // walked and the depth cap still trips (H2: a filename rename must not evade nesting detection).
    let caps = ArchiveCaps {
        max_depth: 0,
        ..ArchiveCaps::default()
    };
    let inner = zip_of(&[("inner.txt", b"x".to_vec(), zip::CompressionMethod::Stored)]);
    let outer = zip_of(&[("payload.dat", inner, zip::CompressionMethod::Stored)]);
    assert_eq!(
        inspect(&outer, None, &caps),
        Heuristic::Suspicious(Reason::ArchiveNesting)
    );
}

#[test]
fn a_zip_with_prepended_bytes_is_still_inspected() {
    // A junk prefix defeats an offset-0 magic check but not a real unzip (which reads the tail EOCD),
    // so structural inspection must still run (H1: prepended-bytes / polyglot must not bypass).
    let caps = ArchiveCaps {
        max_entries: 1,
        ..ArchiveCaps::default()
    };
    let zip = zip_of(&[
        ("a.txt", b"a".to_vec(), zip::CompressionMethod::Stored),
        ("b.txt", b"b".to_vec(), zip::CompressionMethod::Stored),
    ]);
    let mut prefixed = vec![0x00, 0x01, 0x02, 0x03, 0x04];
    prefixed.extend_from_slice(&zip);
    assert_eq!(
        inspect(&prefixed, None, &caps),
        Heuristic::Suspicious(Reason::ArchiveEntryCount)
    );
}

#[test]
fn cumulative_declared_size_over_the_cap_is_a_bomb() {
    // A single entry whose declared size exceeds the cumulative cap trips the budget guard.
    let caps = ArchiveCaps {
        max_uncompressed_bytes: 4,
        ..ArchiveCaps::default()
    };
    let bytes = zip_of(&[("big.txt", vec![b'x'; 100], zip::CompressionMethod::Stored)]);
    assert_eq!(
        inspect(&bytes, None, &caps),
        Heuristic::Suspicious(Reason::DecompressionBomb)
    );
}

#[test]
fn unparseable_pdf_with_an_active_content_token_is_active_content() {
    // %PDF magic dispatches to the PDF inspector, but the body is not a valid object graph, so lopdf
    // errors. The byte-scan fallback must still surface the active-content marker (M4).
    let bytes = b"%PDF-1.5\nnot a valid pdf body but it mentions /OpenAction here";
    assert_eq!(
        inspect(bytes, None, &ArchiveCaps::default()),
        Heuristic::ActiveContent
    );
}

#[test]
fn unparseable_pdf_without_markers_is_clean() {
    let bytes = b"%PDF-1.5\nnot a valid pdf body and no active-content markers at all";
    assert_eq!(
        inspect(bytes, None, &ArchiveCaps::default()),
        Heuristic::Clean
    );
}
