//! Text this crate draws onto a page (a Bates stamp, a watermark) reads back as the text
//! that was asked for, accents included.

// A helper in a `tests/` file is compiled as ordinary code, so the workspace's unwrap ban
// reaches it. A fixture that cannot be read should stop the test where it stands.
#![allow(clippy::unwrap_used)]

use pdf_core::{
    stamp_document, watermark, BatesError, BatesFont, BatesOptions, Document, GenerateError,
    WatermarkContent, WatermarkOptions, WatermarkPlacement,
};

fn hello() -> Vec<u8> {
    include_bytes!("fixtures/hello.pdf").to_vec()
}

fn page_text(pdf: Vec<u8>) -> String {
    let document = Document::load(pdf).unwrap();
    document
        .page_text_facts(0)
        .unwrap()
        .lines
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n")
}

fn text_watermark(text: &str) -> WatermarkOptions {
    WatermarkOptions {
        content: WatermarkContent::Text {
            text: text.to_string(),
            font: BatesFont::Helvetica,
            font_size_pt: 12.0,
            color: [0.5, 0.5, 0.5],
        },
        opacity: 1.0,
        rotation_deg: 0.0,
        placement: WatermarkPlacement::Center,
        pages: pdf_core::PageSelection::All,
    }
}

#[test]
fn a_bates_prefix_with_accents_is_stamped_as_written() {
    let options = BatesOptions {
        prefix: "MÜLLER-É-".to_string(),
        ..BatesOptions::default()
    };
    let (stamped, _) = stamp_document(&hello(), &options, 7).unwrap();
    let text = page_text(stamped);
    assert!(text.contains("MÜLLER-É-"), "{text}");
}

#[test]
fn a_bates_prefix_the_font_cannot_draw_is_refused() {
    let options = BatesOptions {
        prefix: "山田-".to_string(),
        ..BatesOptions::default()
    };
    assert!(matches!(
        stamp_document(&hello(), &options, 1),
        Err(BatesError::UnsupportedCharacter)
    ));
}

#[test]
fn a_watermark_with_accents_and_typographic_marks_is_drawn_as_written() {
    let marked = watermark(&hello(), &text_watermark("PRIVILÉGIÉ – “BROUILLON” €")).unwrap();
    // The mark is centred over the page's own line of text, so the two interleave when
    // read back; what is under test is that each character survives as itself.
    let text = page_text(marked);
    for character in ['É', '–', '“', '”', '€'] {
        assert!(text.contains(character), "{character} missing from {text}");
    }
    assert!(!text.contains('Ã'), "{text}");
}

#[test]
fn a_watermark_the_font_cannot_draw_is_refused() {
    assert!(matches!(
        watermark(&hello(), &text_watermark("機密")),
        Err(GenerateError::UnsupportedCharacter)
    ));
}
