//! Composes documents and reads them back with `pdf-core`: what a reader of the PDF gets is
//! the thing under test, not what the writer was asked for.

// A helper in a `tests/` file is compiled as ordinary code, so the workspace's unwrap ban
// reaches it. A fixture that cannot be built should stop the test where it stands.
#![allow(clippy::unwrap_used)]

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
use pdf_compose_core::{
    compose, Alignment, Block, Column, ComposeError, ComposedDocument, Field, FontFamily,
    ImageBlock, PageSetup, Paragraph, RunningLine, Span, Table, Timestamp,
};
use pdf_core::Document;

fn png(width: u32, height: u32) -> Vec<u8> {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        Rgba([(x % 256) as u8, (y % 256) as u8, 120, 255])
    });
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .unwrap();
    bytes
}

/// A JPEG, optionally carrying an EXIF block that holds one tag: its orientation.
fn jpeg(width: u32, height: u32, orientation: Option<u16>) -> Vec<u8> {
    let image = RgbImage::from_fn(width, height, |x, _| Rgb([(x % 256) as u8, 90, 160]));
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 90);
    if let Some(orientation) = orientation {
        let mut exif = Vec::new();
        exif.extend_from_slice(b"II*\0");
        exif.extend_from_slice(&8u32.to_le_bytes());
        exif.extend_from_slice(&1u16.to_le_bytes());
        exif.extend_from_slice(&0x0112u16.to_le_bytes());
        exif.extend_from_slice(&3u16.to_le_bytes());
        exif.extend_from_slice(&1u32.to_le_bytes());
        exif.extend_from_slice(&orientation.to_le_bytes());
        exif.extend_from_slice(&0u16.to_le_bytes());
        exif.extend_from_slice(&0u32.to_le_bytes());
        encoder.set_exif_metadata(exif).unwrap();
    }
    encoder
        .write_image(
            image.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    bytes
}

fn document(blocks: Vec<Block>) -> ComposedDocument {
    ComposedDocument {
        title: "Matter summary".to_string(),
        blocks,
        ..ComposedDocument::default()
    }
}

fn page_texts(pdf: &[u8]) -> Vec<String> {
    let document = Document::load(pdf.to_vec()).unwrap();
    document
        .document_text_facts(10_000)
        .unwrap()
        .into_iter()
        .map(|facts| {
            facts
                .lines
                .into_iter()
                .map(|line| line.text)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .collect()
}

fn image_block(data: Vec<u8>) -> Block {
    Block::Image(ImageBlock {
        data,
        ..ImageBlock::default()
    })
}

#[test]
fn text_reads_back_including_accented_names() {
    let output = compose(
        &document(vec![
            Block::Title("Intake record".to_string()),
            Block::Heading {
                level: 1,
                text: "Parties".to_string(),
            },
            Block::Paragraph(Paragraph {
                spans: vec![
                    Span::plain("Client: "),
                    Span::bold("José Müller-Ødegård"),
                    Span::plain(", represented since 2024. Fee: €1,250 — “fixed”."),
                ],
                alignment: Alignment::Start,
            }),
        ]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert_eq!(output.page_count, 1);
    assert!(output.missing_characters.is_empty());
    let text = page_texts(&output.pdf).join("\n");
    assert!(text.contains("Intake record"), "{text}");
    assert!(text.contains("Parties"), "{text}");
    assert!(text.contains("José Müller-Ødegård"), "{text}");
    assert!(text.contains("€1,250"), "{text}");
}

#[test]
fn a_long_paragraph_wraps_inside_the_margins_and_runs_onto_more_pages() {
    let sentence = "The quick brown fox jumps over the lazy dog near the courthouse steps. ";
    let output = compose(
        &document(vec![Block::Paragraph(Paragraph::plain(
            sentence.repeat(400),
        ))]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert!(output.page_count > 3, "{}", output.page_count);
    let read = Document::load(output.pdf.clone()).unwrap();
    assert_eq!(read.page_count(), output.page_count);
    let page = PageSetup::letter();
    for facts in read.document_text_facts(10_000).unwrap() {
        assert!(!facts.lines.is_empty());
        for line in &facts.lines {
            assert!(line.rect.x0 >= page.margin_left - 1.0, "{line:?}");
            assert!(
                line.rect.x1 <= page.width - page.margin_right + 1.0,
                "{line:?}"
            );
        }
    }
    let words = page_texts(&output.pdf)
        .join(" ")
        .matches("courthouse")
        .count();
    assert_eq!(words, 400);
}

#[test]
fn a_table_repeats_its_heading_on_every_page_and_loses_no_row() {
    let rows: Vec<Vec<String>> = (1..=180)
        .map(|number| {
            vec![
                format!("2026-03-{:02}", number % 28 + 1),
                format!("Entry number {number} for the ledger"),
                format!("{number}.00"),
            ]
        })
        .collect();
    let output = compose(
        &document(vec![Block::Table(Table {
            columns: vec![
                Column {
                    heading: "Date".to_string(),
                    ..Column::default()
                },
                Column {
                    heading: "Narrative".to_string(),
                    ..Column::default()
                },
                Column {
                    heading: "Amount".to_string(),
                    alignment: Alignment::End,
                    ..Column::default()
                },
            ],
            rows,
        })]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert!(output.page_count >= 3, "{}", output.page_count);
    let pages = page_texts(&output.pdf);
    for page in &pages {
        assert!(page.contains("Narrative"), "{page}");
    }
    let all = pages.join("\n");
    for number in 1..=180 {
        let needle = format!("Entry number {number} for");
        assert_eq!(all.matches(&needle).count(), 1, "{needle}");
    }
}

#[test]
fn a_cell_longer_than_a_page_is_split_and_not_dropped() {
    let long = (1..=900)
        .map(|number| format!("word{number}"))
        .collect::<Vec<_>>()
        .join(" ");
    let output = compose(
        &document(vec![Block::Table(Table {
            columns: vec![
                Column {
                    heading: "Key".to_string(),
                    weight: Some(1.0),
                    ..Column::default()
                },
                Column {
                    heading: "Notes".to_string(),
                    weight: Some(1.0),
                    ..Column::default()
                },
            ],
            rows: vec![vec!["A".to_string(), long]],
        })]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert!(output.page_count >= 2);
    let all = page_texts(&output.pdf).join(" ");
    assert!(all.contains("word1 "), "{all}");
    assert!(all.contains("word450"));
    assert!(all.contains("word900"));
}

#[test]
fn pictures_are_embedded_and_cover_the_page_where_they_are_drawn() {
    let output = compose(
        &document(vec![
            Block::Paragraph(Paragraph::plain("Photograph of the scene:")),
            Block::Image(ImageBlock {
                data: png(800, 600),
                width: Some(400.0),
                alignment: Alignment::Center,
                caption: Some("Exhibit A, taken at the scene".to_string()),
            }),
            image_block(jpeg(640, 480, None)),
        ]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert_eq!(output.page_count, 2);
    let read = Document::load(output.pdf.clone()).unwrap();
    let facts = read.document_text_facts(10).unwrap();
    // 400 x 300 points of a 612 x 792 page.
    let expected = 400.0 * 300.0 / (612.0 * 792.0);
    assert!(
        (facts[0].raster_coverage - expected).abs() < 0.03,
        "{}",
        facts[0].raster_coverage
    );
    assert!(
        facts[1].raster_coverage > 0.2,
        "{}",
        facts[1].raster_coverage
    );
    assert!(page_texts(&output.pdf)[0].contains("Exhibit A, taken at the scene"));
}

#[test]
fn a_photograph_stored_sideways_is_drawn_upright() {
    // Orientation 6: the stored rows are the picture's columns, so 400 x 200 stored is a
    // 200 x 400 picture, taller than it is wide.
    let sideways = compose(
        &document(vec![image_block(jpeg(400, 200, Some(6)))]),
        &FontFamily::bundled(),
    )
    .unwrap();
    let upright = compose(
        &document(vec![image_block(jpeg(200, 400, None))]),
        &FontFamily::bundled(),
    )
    .unwrap();
    let coverage = |pdf: &[u8]| {
        Document::load(pdf.to_vec())
            .unwrap()
            .document_text_facts(1)
            .unwrap()[0]
            .raster_coverage
    };
    assert!((coverage(&sideways.pdf) - coverage(&upright.pdf)).abs() < 0.005);
    // 150 x 300 points at 96 pixels to the inch.
    let expected = 150.0 * 300.0 / (612.0 * 792.0);
    assert!((coverage(&sideways.pdf) - expected).abs() < 0.01);
}

#[test]
fn a_large_photograph_is_scaled_down_to_print_resolution() {
    let small = compose(
        &document(vec![image_block(jpeg(4000, 3000, None))]),
        &FontFamily::bundled(),
    )
    .unwrap();
    // 468 points wide at 300 pixels to the inch is 1,950 pixels: far fewer than the 12
    // million stored, so the file is a fraction of the photograph's own size.
    assert!(small.pdf.len() < jpeg(4000, 3000, None).len());
    assert_eq!(small.page_count, 1);
}

#[test]
fn a_picture_taller_than_the_page_is_fitted_to_it() {
    let output = compose(
        &document(vec![image_block(png(100, 4000))]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert_eq!(output.page_count, 1);
}

#[test]
fn a_damaged_picture_is_named_by_its_position() {
    let error = compose(
        &document(vec![
            image_block(png(10, 10)),
            image_block(b"not a picture at all".to_vec()),
        ]),
        &FontFamily::bundled(),
    )
    .unwrap_err();
    assert_eq!(error, ComposeError::ImageUnreadable { index: 1 });
    let mut cut = png(64, 64);
    cut.truncate(cut.len() / 2);
    let error = compose(&document(vec![image_block(cut)]), &FontFamily::bundled()).unwrap_err();
    assert_eq!(error, ComposeError::ImageUnreadable { index: 0 });
}

#[test]
fn page_breaks_fields_and_running_lines() {
    let mut model = document(vec![
        Block::Fields(vec![
            Field {
                label: "Matter".to_string(),
                value: "Rivera v. Northgate Holdings".to_string(),
            },
            Field {
                label: "Opened".to_string(),
                value: "2026-02-14".to_string(),
            },
        ]),
        Block::Rule,
        Block::PageBreak,
        Block::Paragraph(Paragraph::plain("Second page body.")),
        Block::PageBreak,
        Block::Paragraph(Paragraph::plain("Third page body.")),
    ]);
    model.header = Some(RunningLine {
        left: "Privileged and confidential".to_string(),
        ..RunningLine::default()
    });
    model.footer = Some(RunningLine {
        right: "Page {page} of {pages}".to_string(),
        ..RunningLine::default()
    });
    let output = compose(&model, &FontFamily::bundled()).unwrap();
    assert_eq!(output.page_count, 3);
    let pages = page_texts(&output.pdf);
    assert!(pages[0].contains("Rivera v. Northgate Holdings"));
    assert!(pages[0].contains("Matter"));
    assert!(pages[1].contains("Second page body."));
    assert!(!pages[1].contains("Third"));
    for (index, page) in pages.iter().enumerate() {
        assert!(page.contains("Privileged and confidential"), "{page}");
        assert!(page.contains(&format!("Page {} of 3", index + 1)), "{page}");
    }
}

#[test]
fn the_same_model_gives_the_same_bytes_and_carries_its_metadata() {
    let mut model = document(vec![Block::Paragraph(Paragraph::plain("Body."))]);
    model.author = Some("Goldsmith Law".to_string());
    model.created = Some(Timestamp {
        year: 2026,
        month: 11,
        day: 10,
        hour: 9,
        minute: 30,
        second: 0,
    });
    let first = compose(&model, &FontFamily::bundled()).unwrap();
    let second = compose(&model, &FontFamily::bundled()).unwrap();
    assert_eq!(first.pdf, second.pdf);
    let raw = String::from_utf8_lossy(&first.pdf).to_string();
    assert!(raw.contains("Matter summary"));
    assert!(raw.contains("D:20261110093000"));
}

#[test]
fn a_character_the_family_cannot_draw_is_reported() {
    let output = compose(
        &document(vec![Block::Paragraph(Paragraph::plain(
            "Signed 山田 today",
        ))]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert_eq!(output.missing_characters, vec!['山', '田']);
}

#[test]
fn unusable_pages_and_fonts_and_runaway_documents_are_errors() {
    let mut model = document(vec![Block::Paragraph(Paragraph::plain("Body."))]);
    model.page = PageSetup::with_uniform_margin(200.0, 200.0, 90.0);
    assert_eq!(
        compose(&model, &FontFamily::bundled()).unwrap_err(),
        ComposeError::InvalidPage
    );
    model.page.width = f32::NAN;
    assert_eq!(
        compose(&model, &FontFamily::bundled()).unwrap_err(),
        ComposeError::InvalidPage
    );
    assert_eq!(
        FontFamily::new(vec![1, 2, 3], Vec::new(), Vec::new(), Vec::new()).err(),
        Some(ComposeError::InvalidFont)
    );
    let breaks = vec![Block::PageBreak; pdf_compose_core::MAXIMUM_PAGES + 1];
    assert_eq!(
        compose(&document(breaks), &FontFamily::bundled()).unwrap_err(),
        ComposeError::TooLong
    );
}

#[test]
fn empty_and_odd_content_still_composes() {
    let output = compose(
        &document(vec![
            Block::Table(Table::default()),
            Block::Fields(Vec::new()),
            Block::Paragraph(Paragraph::default()),
            Block::Space(f32::INFINITY),
            Block::Space(-4.0),
            Block::Heading {
                level: 9,
                text: "tab\there\u{7}and\u{0}control".to_string(),
            },
            Block::Paragraph(Paragraph::plain("x".repeat(5_000))),
        ]),
        &FontFamily::bundled(),
    )
    .unwrap();
    assert!(output.page_count >= 1);
    let none = compose(&document(Vec::new()), &FontFamily::bundled()).unwrap();
    assert_eq!(none.page_count, 1);
}
