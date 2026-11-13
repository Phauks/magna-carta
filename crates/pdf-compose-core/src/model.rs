//! The content model: what a caller says a document holds. Nothing here knows about pages,
//! fonts or coordinates; `layout` decides where each block lands.

/// A document to compose: its identity, its page, its running lines, and its content in order.
#[derive(Debug, Clone, Default)]
pub struct ComposedDocument {
    /// The document's title, recorded in its metadata. It is not drawn; put a
    /// [`Block::Title`] in `blocks` to show one.
    pub title: String,
    pub author: Option<String>,
    pub subject: Option<String>,
    /// A BCP 47 language tag such as `en-US`, recorded so a screen reader picks a voice.
    pub language: Option<String>,
    /// When the document was made. Supplied by the caller: this library reads no clock, so
    /// the same input always yields the same bytes.
    pub created: Option<Timestamp>,
    pub page: PageSetup,
    /// The colour the title, the first two levels of heading and every rule are drawn in.
    /// `None` leaves the document in black and gray.
    pub accent: Option<Rgb>,
    /// Drawn in the top margin of every page.
    pub header: Option<RunningLine>,
    /// Drawn in the bottom margin of every page.
    pub footer: Option<RunningLine>,
    pub blocks: Vec<Block>,
}

/// A colour, each part from 0 to 255.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

/// A calendar instant in Coordinated Universal Time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timestamp {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

/// The page every block is laid out on, in points (1/72 inch).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageSetup {
    pub width: f32,
    pub height: f32,
    pub margin_top: f32,
    pub margin_right: f32,
    pub margin_bottom: f32,
    pub margin_left: f32,
}

impl PageSetup {
    /// US Letter, portrait, one-inch margins.
    pub fn letter() -> Self {
        Self::with_uniform_margin(612.0, 792.0, 72.0)
    }

    /// A4, portrait, 25 mm margins.
    pub fn a4() -> Self {
        Self::with_uniform_margin(595.28, 841.89, 70.87)
    }

    pub fn with_uniform_margin(width: f32, height: f32, margin: f32) -> Self {
        Self {
            width,
            height,
            margin_top: margin,
            margin_right: margin,
            margin_bottom: margin,
            margin_left: margin,
        }
    }

    /// The same page turned on its side.
    pub fn landscape(self) -> Self {
        Self {
            width: self.height,
            height: self.width,
            ..self
        }
    }

    pub(crate) fn content_width(&self) -> f32 {
        self.width - self.margin_left - self.margin_right
    }

    pub(crate) fn content_height(&self) -> f32 {
        self.height - self.margin_top - self.margin_bottom
    }
}

impl Default for PageSetup {
    fn default() -> Self {
        Self::letter()
    }
}

/// One line repeated on every page, in three slots. `{page}` is replaced with the page's
/// number and `{pages}` with the document's page count.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunningLine {
    pub left: String,
    pub center: String,
    pub right: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Alignment {
    #[default]
    Start,
    Center,
    End,
}

/// A stretch of text in one style.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Span {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
}

impl Span {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: false,
            italic: false,
        }
    }

    pub fn bold(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: true,
            italic: false,
        }
    }

    pub fn italic(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: false,
            italic: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Paragraph {
    pub spans: Vec<Span>,
    pub alignment: Alignment,
}

impl Paragraph {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            spans: vec![Span::plain(text)],
            alignment: Alignment::Start,
        }
    }
}

/// A picture placed in the flow of the document.
#[derive(Debug, Clone, Default)]
pub struct ImageBlock {
    /// The encoded file: PNG, JPEG, GIF, WebP, BMP or TIFF.
    pub data: Vec<u8>,
    /// The width to draw it at, in points. `None` draws it at its natural size (96 pixels to
    /// the inch). Either way it is scaled down to fit the page and never scaled up past it.
    pub width: Option<f32>,
    pub alignment: Alignment,
    /// A line of text set under the picture.
    pub caption: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Column {
    pub heading: String,
    pub alignment: Alignment,
    /// The column's share of the table's width relative to the other columns. `None` sizes
    /// the column from its content.
    pub weight: Option<f32>,
}

/// A table whose heading row repeats at the top of every page it runs onto.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Table {
    pub columns: Vec<Column>,
    /// One entry per row, one string per column. A short row is padded with empty cells and a
    /// long one is cut to the column count.
    pub rows: Vec<Vec<String>>,
}

/// A labelled value, the unit of a record sheet.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Field {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub enum Block {
    /// The document's own title, set large at the top.
    Title(String),
    /// A section heading. `level` is 1, 2 or 3; anything else is read as 3.
    Heading {
        level: u8,
        text: String,
    },
    Paragraph(Paragraph),
    Image(ImageBlock),
    Table(Table),
    /// Labels down the left and their values beside them.
    Fields(Vec<Field>),
    /// A thin horizontal line across the page.
    Rule,
    /// Empty vertical space, in points.
    Space(f32),
    /// Everything after this starts on a new page.
    PageBreak,
}
