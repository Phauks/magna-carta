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
    ImageBlock, PageSetup, Paragraph, RunningLine, Span, Table, Timestamp, Typeface,
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
                small: false,
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
            banded: false,
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
            banded: false,
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
                ..ImageBlock::default()
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
                grid: false,
            },
            Field {
                label: "Opened".to_string(),
                value: "2026-02-14".to_string(),
                grid: false,
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

#[test]
fn the_json_form_composes_the_same_document_as_the_model() {
    let json = r#"{
        "title": "Matter summary",
        "language": "en-US",
        "created": { "year": 2026, "month": 11, "day": 10 },
        "page": { "paper": "a4", "landscape": true, "marginLeft": 40 },
        "footer": { "right": "Page {page} of {pages}" },
        "blocks": [
            { "type": "title", "text": "Intake record" },
            { "type": "heading", "level": 2, "text": "Parties" },
            { "type": "paragraph", "text": "Plain text. " , "spans": [{ "text": "Bold run", "bold": true }] },
            { "type": "image", "image": 0, "width": 200, "alignment": "center", "caption": "Exhibit A" },
            { "type": "fields", "fields": [{ "label": "Client", "value": "José Rivera" }] },
            { "type": "table",
              "columns": [{ "heading": "Date" }, { "heading": "Amount", "alignment": "end", "weight": 1 }],
              "rows": [["2026-03-01", "150.00"]] },
            { "type": "rule" },
            { "type": "space", "height": 12 },
            { "type": "pageBreak" },
            { "type": "paragraph", "text": "Second page." }
        ]
    }"#;
    let picture = png(300, 200);
    let model = pdf_compose_core::document_from_json(json, &[&picture]).unwrap();
    assert_eq!(model.page.width, PageSetup::a4().height);
    assert_eq!(model.page.margin_left, 40.0);
    assert_eq!(model.blocks.len(), 10);
    let output = pdf_compose_core::compose_json(json, &[&picture], &FontFamily::bundled()).unwrap();
    assert_eq!(output.page_count, 2);
    let pages = page_texts(&output.pdf);
    assert!(pages[0].contains("Plain text. Bold run"), "{}", pages[0]);
    assert!(pages[0].contains("José Rivera"));
    assert!(pages[0].contains("Page 1 of 2"));
    assert!(pages[1].contains("Second page."));
    assert_eq!(
        output.pdf,
        compose(&model, &FontFamily::bundled()).unwrap().pdf
    );
}

/// How many pixels of the first page are clearly red.
fn red_pixels(pdf: &[u8]) -> usize {
    let page = Document::load(pdf.to_vec())
        .unwrap()
        .render_page(0, 72.0, false)
        .unwrap();
    page.data
        .chunks_exact(4)
        .filter(|pixel| pixel[3] > 200 && pixel[0] > 150 && pixel[1] < 80 && pixel[2] < 80)
        .count()
}

#[test]
fn an_accent_colours_the_title_headings_and_rules_and_nothing_without_one() {
    let json = |accent: &str| {
        format!(
            r#"{{ {accent} "blocks": [
                {{ "type": "title", "text": "Certificate" }},
                {{ "type": "rule" }},
                {{ "type": "heading", "text": "Signers" }},
                {{ "type": "paragraph", "text": "Body text stays black." }}
            ] }}"#
        )
    };
    let plain = pdf_compose_core::compose_json(&json(""), &[], &FontFamily::bundled()).unwrap();
    let coloured = pdf_compose_core::compose_json(
        &json(r#""accent": [200, 20, 20],"#),
        &[],
        &FontFamily::bundled(),
    )
    .unwrap();
    assert_eq!(red_pixels(&plain.pdf), 0);
    assert!(
        red_pixels(&coloured.pdf) > 300,
        "{}",
        red_pixels(&coloured.pdf)
    );
    // The colour changes no position: both documents read the same.
    assert_eq!(page_texts(&plain.pdf), page_texts(&coloured.pdf));
}

#[test]
fn a_small_paragraph_takes_less_of_the_page() {
    let json = |small: bool| {
        let paragraph = format!(
            r#"{{ "type": "paragraph", "text": "A note under the table.", "small": {small} }}"#
        );
        format!(r#"{{ "blocks": [{}] }}"#, vec![paragraph; 40].join(","))
    };
    let fonts = FontFamily::bundled();
    let body = pdf_compose_core::compose_json(&json(false), &[], &fonts).unwrap();
    let small = pdf_compose_core::compose_json(&json(true), &[], &fonts).unwrap();
    assert_eq!(page_texts(&body.pdf).len(), 2);
    assert_eq!(page_texts(&small.pdf).len(), 1);
}

#[test]
fn a_compact_document_sets_its_rows_closer_together() {
    let json = |compact: bool| {
        let field = r#"{ "label": "Signer", "value": "Maria Rivera" }"#;
        format!(
            r#"{{ "compact": {compact}, "blocks": [{{ "type": "fields", "fields": [{}] }}] }}"#,
            vec![field; 36].join(",")
        )
    };
    let fonts = FontFamily::bundled();
    let roomy = pdf_compose_core::compose_json(&json(false), &[], &fonts).unwrap();
    let compact = pdf_compose_core::compose_json(&json(true), &[], &fonts).unwrap();
    assert_eq!(page_texts(&roomy.pdf).len(), 2);
    assert_eq!(page_texts(&compact.pdf).len(), 1);
}

#[test]
fn a_letterhead_heads_every_page_in_the_accent_colour() {
    let json = |letterhead: &str| {
        format!(
            r#"{{ "accent": [200, 20, 20], "page": {{ "marginTop": 90 }}, {letterhead}
                "footer": {{ "center": "Page {{page}} of {{pages}}" }},
                "blocks": [
                    {{ "type": "paragraph", "text": "First." }},
                    {{ "type": "pageBreak" }},
                    {{ "type": "paragraph", "text": "Second." }},
                    {{ "type": "fields", "fields": [
                        {{ "label": "Hash", "value": "b996 78c5\n74a8 ca0a", "grid": true }}
                    ] }}
                ] }}"#
        )
    };
    let fonts = FontFamily::bundled();
    let plain = pdf_compose_core::compose_json(&json(""), &[], &fonts).unwrap();
    let headed = pdf_compose_core::compose_json(
        &json(r#""letterhead": { "title": "Certificate of Completion", "detail": "MC-0123" },"#),
        &[],
        &fonts,
    )
    .unwrap();
    let pages = page_texts(&headed.pdf);
    assert_eq!(pages.len(), 2);
    for page in &pages {
        assert!(page.contains("Certificate of Completion"), "{page}");
        assert!(page.contains("MC-0123"), "{page}");
    }
    assert!(
        pages[1].contains("b996 78c5") && pages[1].contains("74a8 ca0a"),
        "{}",
        pages[1]
    );
    assert!(!page_texts(&plain.pdf)[0].contains("MC-0123"));
    // The bar and the title are drawn in the accent; without a letterhead nothing is.
    assert_eq!(red_pixels(&plain.pdf), 0);
    assert!(red_pixels(&headed.pdf) > 300, "{}", red_pixels(&headed.pdf));
}

#[test]
fn a_json_document_that_is_wrong_is_refused_without_quoting_it() {
    let fonts = FontFamily::bundled();
    let misspelt = r#"{ "blocks": [{ "type": "paragraph", "text": "x", "alignement": "end" }] }"#;
    assert!(matches!(
        pdf_compose_core::compose_json(misspelt, &[], &fonts).unwrap_err(),
        ComposeError::InvalidDocument { line: 1, .. }
    ));
    let unknown_block = r#"{ "blocks": [{ "type": "privileged-secret" }] }"#;
    let error = pdf_compose_core::compose_json(unknown_block, &[], &fonts).unwrap_err();
    assert!(!error.to_string().contains("privileged"), "{error}");
    let no_picture = r#"{ "blocks": [{ "type": "image", "image": 3 }] }"#;
    assert_eq!(
        pdf_compose_core::compose_json(no_picture, &[], &fonts).unwrap_err(),
        ComposeError::ImageMissing { index: 3 }
    );
    assert!(matches!(
        pdf_compose_core::compose_json("not json", &[], &fonts).unwrap_err(),
        ComposeError::InvalidDocument { .. }
    ));
}

/// How many pixels of the first page are a light grey: a shaded band, not ink and not paper.
fn shaded_pixels(pdf: &[u8]) -> usize {
    let page = Document::load(pdf.to_vec())
        .unwrap()
        .render_page(0, 72.0, false)
        .unwrap();
    page.data
        .chunks_exact(4)
        .filter(|pixel| pixel[3] > 200 && (225..=250).contains(&pixel[0]) && pixel[0] == pixel[1])
        .count()
}

fn dark_pixels(pdf: &[u8]) -> usize {
    let page = Document::load(pdf.to_vec())
        .unwrap()
        .render_page(0, 72.0, false)
        .unwrap();
    page.data
        .chunks_exact(4)
        .filter(|pixel| pixel[3] > 200 && pixel[0] < 120)
        .count()
}

#[test]
fn a_banded_table_shades_its_heading_and_alternate_rows() {
    let json = |banded: bool| {
        let row = r#"["2026-03-01", "Signed", "Maria Rivera"]"#;
        format!(
            r#"{{ "blocks": [{{ "type": "table", "banded": {banded},
                "columns": [{{ "heading": "Time" }}, {{ "heading": "Event" }}, {{ "heading": "By" }}],
                "rows": [{}] }}] }}"#,
            [row; 12].join(",")
        )
    };
    let fonts = FontFamily::bundled();
    let ruled = pdf_compose_core::compose_json(&json(false), &[], &fonts).unwrap();
    let banded = pdf_compose_core::compose_json(&json(true), &[], &fonts).unwrap();
    assert!(
        shaded_pixels(&banded.pdf) > shaded_pixels(&ruled.pdf) + 5_000,
        "{} against {}",
        shaded_pixels(&banded.pdf),
        shaded_pixels(&ruled.pdf)
    );
    // Shading changes how a row is told from the next, not what the table says.
    assert_eq!(page_texts(&ruled.pdf), page_texts(&banded.pdf));
}

#[test]
fn the_named_typeface_is_the_family_the_library_bundles_for_it() {
    let paragraph = |text: &str| {
        document(vec![Block::Paragraph(Paragraph {
            spans: vec![Span {
                text: text.to_string(),
                ..Span::default()
            }],
            ..Paragraph::default()
        })])
    };
    let atkinson = FontFamily::bundled_as(Typeface::AtkinsonHyperlegible);
    let liberation = FontFamily::bundled_as(Typeface::LiberationSans);
    let latin = paragraph("Zo\u{eb} O\u{2019}Brien signed 0O1lI");
    let first = compose(&latin, &atkinson).unwrap();
    let second = compose(&latin, &liberation).unwrap();
    assert!(first.missing_characters.is_empty());
    assert_eq!(page_texts(&first.pdf), page_texts(&second.pdf));
    assert_ne!(first.pdf, second.pdf);
    // Atkinson Hyperlegible draws Latin only: a caller sees which letters it lacks and can
    // compose again in the wider family.
    let greek = paragraph("\u{391}\u{3bb}\u{3ad}\u{3be}\u{3b7}\u{3c2}");
    assert!(!compose(&greek, &atkinson)
        .unwrap()
        .missing_characters
        .is_empty());
    assert!(compose(&greek, &liberation)
        .unwrap()
        .missing_characters
        .is_empty());
}

#[test]
fn a_card_frames_its_blocks_and_carries_on_over_a_page_break() {
    let json = |open: &str, close: &str, rows: usize| {
        let row = r#"["2026-03-01", "Signed", "Maria Rivera"]"#;
        format!(
            r#"{{ "blocks": [{open}
                {{ "type": "table",
                  "columns": [{{ "heading": "Time" }}, {{ "heading": "Event" }}, {{ "heading": "By" }}],
                  "rows": [{}] }}{close}] }}"#,
            vec![row; rows].join(",")
        )
    };
    let (open, close) = (
        r#"{ "type": "cardStart", "title": "Audit Log" },"#,
        r#", { "type": "cardEnd" }"#,
    );
    let fonts = FontFamily::bundled();
    let bare = pdf_compose_core::compose_json(&json("", "", 6), &[], &fonts).unwrap();
    let carded = pdf_compose_core::compose_json(&json(open, close, 6), &[], &fonts).unwrap();
    assert!(page_texts(&carded.pdf)[0].contains("Audit Log"));
    // The card's title sits in a dark bar the bare table does not have, and the column headings
    // under it lose their shade. The frame itself is held by layout tests: the reader these tests
    // use does not paint a hairline stroke dark enough to count.
    assert!(
        dark_pixels(&carded.pdf) > dark_pixels(&bare.pdf) + 5_000,
        "{} against {}",
        dark_pixels(&carded.pdf),
        dark_pixels(&bare.pdf)
    );
    assert!(shaded_pixels(&carded.pdf) < shaded_pixels(&bare.pdf));
    // The frame does not hold a long table to one page, and a card never closed is closed.
    let long = pdf_compose_core::compose_json(&json(open, "", 120), &[], &fonts).unwrap();
    let pages = page_texts(&long.pdf);
    assert!(pages.len() >= 2, "{}", pages.len());
    assert_eq!(pages.join("\n").matches("Maria Rivera").count(), 120);
    assert_eq!(pages.join("\n").matches("Audit Log").count(), 1);
}

#[test]
fn fields_set_two_up_take_half_the_rows_and_read_down_each_column() {
    let json = |two_up: bool| {
        let fields: Vec<String> = (1..=60)
            .map(|number| format!(r#"{{ "label": "Label {number}", "value": "Value {number}" }}"#))
            .collect();
        format!(
            r#"{{ "blocks": [{{ "type": "fields", "twoUp": {two_up}, "fields": [{}] }}] }}"#,
            fields.join(",")
        )
    };
    let fonts = FontFamily::bundled();
    let single = pdf_compose_core::compose_json(&json(false), &[], &fonts).unwrap();
    let double = pdf_compose_core::compose_json(&json(true), &[], &fonts).unwrap();
    assert_eq!(page_texts(&single.pdf).len(), 2);
    let pages = page_texts(&double.pdf);
    assert_eq!(pages.len(), 1);
    for number in 1..=60 {
        assert!(pages[0].contains(&format!("Value {number}")), "{number}");
    }
    // The first row holds the first field and the one that opens the second column.
    let first_row = pages[0].lines().next().unwrap_or_default();
    assert!(
        first_row.contains("Value 1") && first_row.contains("Value 31"),
        "{first_row}"
    );
}
