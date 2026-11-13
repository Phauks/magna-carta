//! The writer: laid-out pages in, PDF bytes out. It makes no layout decision; every
//! position it draws at was fixed in `layout`.

use krilla::color::{luma, rgb};
use krilla::geom::{PathBuilder, Point, Rect, Size, Transform};
use krilla::image::Image;
use krilla::metadata::{DateTime, Metadata};
use krilla::page::PageSettings;
use krilla::paint::Fill;
use krilla::surface::Surface;
use krilla::text::{Font, TextDirection};
use krilla::{Data, Document};

use crate::fonts::{Face, FontFamily};
use crate::images::{self, Embedded, ImageFailure};
use crate::layout::{Ink, LaidPage, Mark};
use crate::model::{Block, ComposedDocument, Rgb};
use crate::ComposeError;

/// Recorded as the document's producer, so a file found later says where it came from.
const PRODUCER: &str = "Magna Carta";

struct Fonts {
    regular: Font,
    bold: Font,
    italic: Font,
    bold_italic: Font,
}

impl Fonts {
    fn load(family: &FontFamily) -> Result<Self, ComposeError> {
        let load = |face: Face| {
            Font::new(Data::from(family.data(face)), 0).ok_or(ComposeError::InvalidFont)
        };
        Ok(Self {
            regular: load(Face::Regular)?,
            bold: load(Face::Bold)?,
            italic: load(Face::Italic)?,
            bold_italic: load(Face::BoldItalic)?,
        })
    }

    fn get(&self, face: Face) -> Font {
        match face {
            Face::Regular => self.regular.clone(),
            Face::Bold => self.bold.clone(),
            Face::Italic => self.italic.clone(),
            Face::BoldItalic => self.bold_italic.clone(),
        }
    }
}

/// The fill for an ink. A gray is written as a gray, so a document with no accent colour holds
/// no colour at all and prints the same on any device.
fn fill(ink: Ink, accent: Option<Rgb>) -> Option<Fill> {
    let paint = match (ink, accent) {
        (Ink::Accent { .. }, Some(accent)) => {
            rgb::Color::new(accent.red, accent.green, accent.blue).into()
        }
        (Ink::Accent { fallback: gray }, None) | (Ink::Gray(gray), _) => {
            luma::Color::new(gray).into()
        }
    };
    Some(Fill {
        paint,
        ..Fill::default()
    })
}

fn fill_rectangle(
    surface: &mut Surface,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    paint: Option<Fill>,
) {
    let Some(rectangle) = Rect::from_xywh(x, y, width, height) else {
        return;
    };
    let mut builder = PathBuilder::new();
    builder.push_rect(rectangle);
    if let Some(path) = builder.finish() {
        surface.set_fill(paint);
        surface.draw_path(&path);
    }
}

fn metadata(document: &ComposedDocument) -> Metadata {
    let mut metadata = Metadata::new().producer(PRODUCER.to_string());
    if !document.title.trim().is_empty() {
        metadata = metadata.title(document.title.clone());
    }
    if let Some(author) = document
        .author
        .as_ref()
        .filter(|author| !author.trim().is_empty())
    {
        metadata = metadata.authors(vec![author.clone()]);
    }
    if let Some(subject) = document
        .subject
        .as_ref()
        .filter(|subject| !subject.trim().is_empty())
    {
        metadata = metadata.description(subject.clone());
    }
    if let Some(language) = document
        .language
        .as_ref()
        .filter(|tag| !tag.trim().is_empty())
    {
        metadata = metadata.language(language.clone());
    }
    if let Some(created) = document.created {
        metadata = metadata.creation_date(
            DateTime::new(created.year)
                .month(created.month)
                .day(created.day)
                .hour(created.hour)
                .minute(created.minute)
                .second(created.second)
                .utc_offset_hour(0)
                .utc_offset_minute(0),
        );
    }
    metadata
}

/// The encoded bytes of the document's `index`-th image block.
fn image_data(document: &ComposedDocument, index: usize) -> Option<&[u8]> {
    document
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Image(image) => Some(image.data.as_slice()),
            _ => None,
        })
        .nth(index)
}

fn image_error(index: usize, failure: ImageFailure) -> ComposeError {
    match failure {
        ImageFailure::Unreadable => ComposeError::ImageUnreadable { index },
        ImageFailure::TooLarge => ComposeError::ImageTooLarge { index },
    }
}

pub(crate) fn render(
    document: &ComposedDocument,
    family: &FontFamily,
    pages: &[LaidPage],
) -> Result<Vec<u8>, ComposeError> {
    let fonts = Fonts::load(family)?;
    let settings = PageSettings::from_wh(document.page.width, document.page.height)
        .ok_or(ComposeError::InvalidPage)?;
    let accent = document.accent;
    let mut output = Document::new();
    for laid in pages {
        let mut page = output.start_page_with(settings.clone());
        let mut surface = page.surface();
        for mark in &laid.marks {
            match mark {
                Mark::Text {
                    x,
                    baseline,
                    face,
                    size,
                    ink,
                    text,
                } => {
                    surface.set_fill(fill(*ink, accent));
                    surface.draw_text(
                        Point::from_xy(*x, *baseline),
                        fonts.get(*face),
                        *size,
                        text,
                        false,
                        TextDirection::Auto,
                    );
                }
                Mark::Rule {
                    x0,
                    x1,
                    y,
                    thickness,
                    ink,
                } => fill_rectangle(
                    &mut surface,
                    *x0,
                    *y - *thickness / 2.0,
                    *x1 - *x0,
                    *thickness,
                    fill(*ink, accent),
                ),
                Mark::Fill {
                    x,
                    y,
                    width,
                    height,
                    ink,
                } => fill_rectangle(&mut surface, *x, *y, *width, *height, fill(*ink, accent)),
                Mark::Image {
                    index,
                    x,
                    y,
                    width,
                    height,
                } => {
                    let data = image_data(document, *index).ok_or(ComposeError::Write)?;
                    let embedded = images::embed(data, *width, *height)
                        .map_err(|failure| image_error(*index, failure))?;
                    let image = match embedded {
                        Embedded::Jpeg(bytes) => Image::from_jpeg(Data::from(bytes), true)
                            .map_err(|_| ComposeError::ImageUnreadable { index: *index })?,
                        Embedded::Pixels {
                            data,
                            width,
                            height,
                        } => Image::from_rgba8(data, width, height),
                    };
                    let size = Size::from_wh(*width, *height).ok_or(ComposeError::Write)?;
                    surface.push_transform(&Transform::from_translate(*x, *y));
                    surface.draw_image(image, size);
                    surface.pop();
                }
            }
        }
        surface.finish();
        page.finish();
    }
    output.set_metadata(metadata(document));
    output.finish().map_err(|_| ComposeError::Write)
}
