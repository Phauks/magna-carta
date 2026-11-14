//! Compose a PDF from content: headings, paragraphs, pictures, tables and labelled fields,
//! flowed onto pages with repeating header and footer lines.
//!
//! `pdf-core` works on PDFs that already exist. This crate makes new ones, from a content
//! model ([`ComposedDocument`]) that says what the document holds and nothing about where it
//! goes. It works in two passes: `layout` turns the model into pages of positioned marks,
//! and `render` writes those marks out. The split keeps every placement decision testable
//! without parsing a PDF, and lets a header say "page 3 of 12" before the first page is
//! written.
//!
//! The output is deterministic: no clock is read and nothing is random, so the same model
//! and fonts give the same bytes.

mod fonts;
mod images;
mod layout;
mod model;
mod render;
#[cfg(target_arch = "wasm32")]
mod wasm;
mod wire;

pub use fonts::FontFamily;
pub use model::{
    Alignment, Block, Column, ComposedDocument, Field, Figure, ImageBlock, Letterhead, PageSetup,
    Paragraph, Placed, Rgb, RowStyle, RunningLine, Span, Table, Timestamp, Typeface,
};
pub use wire::{compose_json, document_from_json};

/// The most pages one document may run to.
pub const MAXIMUM_PAGES: usize = layout::MAXIMUM_PAGES;

/// Why a document could not be composed. No variant carries document content: a message
/// built from one is safe to log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComposeError {
    /// A font file is not a TrueType or OpenType font this library can use.
    InvalidFont,
    /// The page is not finite, or leaves less than an inch of room inside its margins.
    InvalidPage,
    /// The content runs past [`MAXIMUM_PAGES`].
    TooLong,
    /// The `index`-th image block (counting from zero) is not a picture in a supported
    /// format, or is damaged.
    ImageUnreadable { index: usize },
    /// The `index`-th image block is larger than this library will decode.
    ImageTooLarge { index: usize },
    /// The JSON form of a document does not parse as one. `line` and `column` say where;
    /// the parser's own message is withheld because it can quote the value it stopped at.
    InvalidDocument { line: usize, column: usize },
    /// The JSON form of a document names a picture the caller did not supply.
    ImageMissing { index: usize },
    /// The writer failed to serialize the document.
    Write,
}

impl std::fmt::Display for ComposeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ComposeError::InvalidFont => write!(formatter, "a font file is not a usable font"),
            ComposeError::InvalidPage => {
                write!(formatter, "the page size or margins are not usable")
            }
            ComposeError::TooLong => write!(formatter, "the document has too many pages"),
            ComposeError::ImageUnreadable { index } => {
                write!(formatter, "image {index} is not a readable picture")
            }
            ComposeError::ImageTooLarge { index } => {
                write!(formatter, "image {index} is too large")
            }
            ComposeError::InvalidDocument { line, column } => write!(
                formatter,
                "the document is not valid at line {line}, column {column}"
            ),
            ComposeError::ImageMissing { index } => {
                write!(formatter, "image {index} was not supplied")
            }
            ComposeError::Write => write!(formatter, "the document could not be written"),
        }
    }
}

impl std::error::Error for ComposeError {}

/// A composed document.
#[derive(Debug, Clone)]
pub struct ComposeOutput {
    pub pdf: Vec<u8>,
    pub page_count: usize,
    /// Every character the content used that the font family has no glyph for, in code-point
    /// order. Each was drawn as the font's missing-glyph box. An empty list means the
    /// document shows all of its text; a caller that cannot accept a box checks this and
    /// supplies a family that covers the script.
    pub missing_characters: Vec<char>,
}

/// Compose `document` in `fonts`.
pub fn compose(
    document: &ComposedDocument,
    fonts: &FontFamily,
) -> Result<ComposeOutput, ComposeError> {
    let mut sizes = Vec::new();
    for block in &document.blocks {
        if let Block::Image(image) = block {
            let index = sizes.len();
            sizes.push(images::probe(&image.data).map_err(|failure| match failure {
                images::ImageFailure::Unreadable => ComposeError::ImageUnreadable { index },
                images::ImageFailure::TooLarge => ComposeError::ImageTooLarge { index },
            })?);
        }
    }
    // The letterhead's picture takes the position after the last image block.
    if let Some(data) = document
        .letterhead
        .as_ref()
        .and_then(|letterhead| letterhead.image.as_deref())
    {
        let index = sizes.len();
        sizes.push(images::probe(data).map_err(|failure| match failure {
            images::ImageFailure::Unreadable => ComposeError::ImageUnreadable { index },
            images::ImageFailure::TooLarge => ComposeError::ImageTooLarge { index },
        })?);
    }
    let mut measurer = fonts::Measurer::new(fonts)?;
    let pages = layout::lay_out(document, &sizes, &mut measurer)?;
    let missing_characters = measurer.into_missing();
    let pdf = render::render(document, fonts, &pages)?;
    Ok(ComposeOutput {
        pdf,
        page_count: pages.len(),
        missing_characters,
    })
}
