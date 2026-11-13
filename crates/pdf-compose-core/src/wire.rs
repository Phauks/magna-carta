//! The JSON form of the content model: what a caller that is not Rust sends. It mirrors
//! `model` one for one, in camelCase, with one difference: a picture is named by its
//! position in a list of byte arrays passed beside the JSON, so megabytes of photograph
//! never travel as text.
//!
//! Unknown fields are refused. A misspelt `alignment` silently ignored is a document that
//! comes out wrong with nothing to say why.

use serde::Deserialize;

use crate::model::{
    Alignment, Block, Column, ComposedDocument, Field, ImageBlock, PageSetup, Paragraph, Rgb,
    RunningLine, Span, Table, Timestamp,
};
use crate::{compose, ComposeError, ComposeOutput, FontFamily};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireDocument {
    #[serde(default)]
    title: String,
    author: Option<String>,
    subject: Option<String>,
    language: Option<String>,
    created: Option<WireTimestamp>,
    #[serde(default)]
    page: WirePage,
    /// Red, green and blue, each from 0 to 255.
    accent: Option<[u8; 3]>,
    header: Option<WireRunningLine>,
    footer: Option<WireRunningLine>,
    #[serde(default)]
    blocks: Vec<WireBlock>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireTimestamp {
    year: u16,
    month: u8,
    day: u8,
    #[serde(default)]
    hour: u8,
    #[serde(default)]
    minute: u8,
    #[serde(default)]
    second: u8,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum WirePaper {
    #[default]
    Letter,
    A4,
}

/// A named paper size, optionally turned and with its margins overridden, or exact
/// dimensions in points through `width` and `height`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WirePage {
    #[serde(default)]
    paper: WirePaper,
    #[serde(default)]
    landscape: bool,
    width: Option<f32>,
    height: Option<f32>,
    margin_top: Option<f32>,
    margin_right: Option<f32>,
    margin_bottom: Option<f32>,
    margin_left: Option<f32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRunningLine {
    #[serde(default)]
    left: String,
    #[serde(default)]
    center: String,
    #[serde(default)]
    right: String,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum WireAlignment {
    #[default]
    Start,
    Center,
    End,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireSpan {
    text: String,
    #[serde(default)]
    bold: bool,
    #[serde(default)]
    italic: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireColumn {
    #[serde(default)]
    heading: String,
    #[serde(default)]
    alignment: WireAlignment,
    weight: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireField {
    label: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum WireBlock {
    Title {
        text: String,
    },
    Heading {
        #[serde(default = "first_level")]
        level: u8,
        text: String,
    },
    /// Either `text`, for a plain paragraph, or `spans`, for one with bold and italic runs.
    Paragraph {
        text: Option<String>,
        #[serde(default)]
        spans: Vec<WireSpan>,
        #[serde(default)]
        alignment: WireAlignment,
    },
    Image {
        /// The picture's position in the list of byte arrays passed beside the JSON.
        image: usize,
        width: Option<f32>,
        #[serde(default)]
        alignment: WireAlignment,
        caption: Option<String>,
    },
    Table {
        columns: Vec<WireColumn>,
        #[serde(default)]
        rows: Vec<Vec<String>>,
    },
    Fields {
        fields: Vec<WireField>,
    },
    Rule,
    Space {
        height: f32,
    },
    PageBreak,
}

fn first_level() -> u8 {
    1
}

fn alignment(wire: WireAlignment) -> Alignment {
    match wire {
        WireAlignment::Start => Alignment::Start,
        WireAlignment::Center => Alignment::Center,
        WireAlignment::End => Alignment::End,
    }
}

fn running_line(wire: WireRunningLine) -> RunningLine {
    RunningLine {
        left: wire.left,
        center: wire.center,
        right: wire.right,
    }
}

fn page(wire: &WirePage) -> PageSetup {
    let mut page = match wire.paper {
        WirePaper::Letter => PageSetup::letter(),
        WirePaper::A4 => PageSetup::a4(),
    };
    if wire.landscape {
        page = page.landscape();
    }
    page.width = wire.width.unwrap_or(page.width);
    page.height = wire.height.unwrap_or(page.height);
    page.margin_top = wire.margin_top.unwrap_or(page.margin_top);
    page.margin_right = wire.margin_right.unwrap_or(page.margin_right);
    page.margin_bottom = wire.margin_bottom.unwrap_or(page.margin_bottom);
    page.margin_left = wire.margin_left.unwrap_or(page.margin_left);
    page
}

/// Read the JSON form of a document. `images` are the pictures its image blocks name by
/// position.
pub fn document_from_json(json: &str, images: &[&[u8]]) -> Result<ComposedDocument, ComposeError> {
    let wire: WireDocument =
        serde_json::from_str(json).map_err(|error| ComposeError::InvalidDocument {
            line: error.line(),
            column: error.column(),
        })?;
    let page = page(&wire.page);
    let mut blocks = Vec::with_capacity(wire.blocks.len());
    for block in wire.blocks {
        blocks.push(match block {
            WireBlock::Title { text } => Block::Title(text),
            WireBlock::Heading { level, text } => Block::Heading { level, text },
            WireBlock::Paragraph {
                text,
                spans,
                alignment: wire_alignment,
            } => {
                let mut all: Vec<Span> = text.into_iter().map(Span::plain).collect();
                all.extend(spans.into_iter().map(|span| Span {
                    text: span.text,
                    bold: span.bold,
                    italic: span.italic,
                }));
                Block::Paragraph(Paragraph {
                    spans: all,
                    alignment: alignment(wire_alignment),
                })
            }
            WireBlock::Image {
                image,
                width,
                alignment: wire_alignment,
                caption,
            } => {
                let data = images
                    .get(image)
                    .ok_or(ComposeError::ImageMissing { index: image })?;
                Block::Image(ImageBlock {
                    data: data.to_vec(),
                    width,
                    alignment: alignment(wire_alignment),
                    caption,
                })
            }
            WireBlock::Table { columns, rows } => Block::Table(Table {
                columns: columns
                    .into_iter()
                    .map(|column| Column {
                        heading: column.heading,
                        alignment: alignment(column.alignment),
                        weight: column.weight,
                    })
                    .collect(),
                rows,
            }),
            WireBlock::Fields { fields } => Block::Fields(
                fields
                    .into_iter()
                    .map(|field| Field {
                        label: field.label,
                        value: field.value,
                    })
                    .collect(),
            ),
            WireBlock::Rule => Block::Rule,
            WireBlock::Space { height } => Block::Space(height),
            WireBlock::PageBreak => Block::PageBreak,
        });
    }
    Ok(ComposedDocument {
        title: wire.title,
        author: wire.author,
        subject: wire.subject,
        language: wire.language,
        created: wire.created.map(|created| Timestamp {
            year: created.year,
            month: created.month,
            day: created.day,
            hour: created.hour,
            minute: created.minute,
            second: created.second,
        }),
        page,
        accent: wire
            .accent
            .map(|[red, green, blue]| Rgb { red, green, blue }),
        header: wire.header.map(running_line),
        footer: wire.footer.map(running_line),
        blocks,
    })
}

/// Compose a document from its JSON form.
pub fn compose_json(
    json: &str,
    images: &[&[u8]],
    fonts: &FontFamily,
) -> Result<ComposeOutput, ComposeError> {
    compose(&document_from_json(json, images)?, fonts)
}
