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
    /// Which of the library's own families the document is set in, where the caller leaves
    /// the choice to the library ([`FontFamily::bundled_as`](crate::FontFamily::bundled_as)).
    pub typeface: Typeface,
    /// The colour the title, the first two levels of heading and every rule are drawn in.
    /// `None` leaves the document in black and gray.
    pub accent: Option<Rgb>,
    /// Set the rows of every table and field list closer together, for a document that has to
    /// hold a known amount on one page.
    pub compact: bool,
    /// A band drawn in the top margin of every page, and a rule above the footer to match.
    pub letterhead: Option<Letterhead>,
    /// Drawn in the top margin of every page.
    pub header: Option<RunningLine>,
    /// Drawn in the bottom margin of every page.
    pub footer: Option<RunningLine>,
    pub blocks: Vec<Block>,
}

/// The families compiled into the library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Typeface {
    /// Liberation Sans: Latin, Greek and Cyrillic, metric-compatible with Arial.
    #[default]
    LiberationSans,
    /// Atkinson Hyperlegible Next: drawn so that similar letters and digits are hard to
    /// confuse. Latin only, so a caller that may print another script checks
    /// `missing_characters` and composes again in Liberation Sans.
    AtkinsonHyperlegible,
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

/// What every page of a document is headed with: a bar in the accent colour, a picture at
/// the left (a logo), and at the right a title over a line of detail, with a thin rule
/// beneath. It is drawn in the top margin and ends 12 points above the content, so the page
/// needs a top margin of at least [`Letterhead::HEIGHT`] plus whatever the printer cannot
/// reach. With a letterhead the footer is set a little larger under a rule of its own, at
/// [`Letterhead::FOOTER_HEIGHT`] below the content.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Letterhead {
    /// The encoded picture, drawn 24 points tall. `None` leaves the left side empty.
    pub image: Option<Vec<u8>>,
    pub title: String,
    /// What the detail is, set small and gray before it: "Reference".
    pub label: String,
    /// The line under the title, set bold: the document's own number.
    pub detail: String,
}

impl Letterhead {
    /// The room the band takes above the content, in points.
    pub const HEIGHT: f32 = 60.0;
    /// How far below the content the footer line's baseline sits when a letterhead is drawn:
    /// a rule 11.5 points under the content, then the line. A bottom margin of this plus the
    /// distance kept from the paper's edge puts the footer where the caller wants it.
    pub const FOOTER_HEIGHT: f32 = 28.0;
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
    /// Set in the smaller, grayer text of a caption: a note beneath the content it serves.
    pub small: bool,
}

impl Paragraph {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            spans: vec![Span::plain(text)],
            alignment: Alignment::Start,
            small: false,
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
    /// A short line set small and bold above the picture, saying what it is.
    pub label: Option<String>,
    /// Set this picture on the line of the image block before it, in the second half of the
    /// width, the two starting level. Without a picture directly before it, it stands alone.
    pub beside: bool,
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
    /// Shade every other row in place of ruling between rows: easier to follow across a wide
    /// table of many short rows.
    pub banded: bool,
    /// How each row is set, by position. A table with fewer entries than rows sets the rest
    /// plainly.
    pub row_styles: Vec<RowStyle>,
}

/// How one row of a table is set apart from the others.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RowStyle {
    #[default]
    Plain,
    /// A sum of the rows above: bold, under a darker rule.
    Total,
    /// A part of the row above it: gray, its first cell stepped in.
    Child,
    /// Kept for the record but no longer in force: gray.
    Muted,
}

/// One figure of a summary row: what it counts, the figure, and a line about it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Figure {
    pub label: String,
    pub value: String,
    pub note: Option<String>,
    /// Draw the figure in the alert colour: something a reader should not pass over.
    pub alert: bool,
}

/// A labelled value, the unit of a record sheet.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Field {
    pub label: String,
    pub value: String,
    /// Set the value's words in columns of one width, a line to each line feed, so a value
    /// read in groups (a hash, a serial number) lines up from row to row.
    pub grid: bool,
}

/// One line of text set at a fixed place on the current page, outside the flow: a field on a
/// form printed onto preprinted paper, such as a check. It moves nothing else on the page.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    /// From the page's left edge, in points.
    pub x: f32,
    /// The top of the line's box, from the page's top edge, in points. The baseline sits
    /// `size` below it.
    pub y: f32,
    /// The box's width. `alignment` sets the text against it; text wider than the box is set in
    /// full and runs past it, because cutting a payee's name short changes what the paper says.
    pub width: f32,
    pub size: f32,
    pub bold: bool,
    pub alignment: Alignment,
    pub text: String,
    /// A character repeated after the text to the end of the box, so nothing can be written in
    /// after it: the asterisks after a check's amount in words.
    pub fill: Option<char>,
    /// Draw a thin outline of the box: a test page, held against the real paper.
    pub outline: bool,
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
    /// Labelled fields set in two columns side by side, read down the first and then down
    /// the second, for a list of short values that would otherwise leave half the page empty.
    FieldsTwoUp(Vec<Field>),
    /// A thin horizontal line across the page.
    Rule,
    /// Empty vertical space, in points.
    Space(f32),
    /// Everything after this starts on a new page.
    PageBreak,
    /// Opens a card: a rounded frame around the blocks up to the next `CardEnd`, with an
    /// optional title set inside it over a rule. A card that reaches the foot of a page is
    /// closed there and opened again on the next; one still open at the end of the document
    /// is closed. Cards do not nest: a second `CardStart` closes the first.
    CardStart {
        title: Option<String>,
    },
    /// Closes the open card. Without one it does nothing.
    CardEnd,
    /// A row of summary figures in columns of one width, six to a line at most.
    Figures(Vec<Figure>),
    /// One or two words set very large and centred: the label of a cover sheet.
    Display {
        text: String,
        /// How far down the page the label starts when it is the first thing on it. A `Space`
        /// block is dropped at the top of a page; this is kept, which is what sets a cover
        /// sheet's label in the middle of the sheet.
        space_above: f32,
    },
    /// Lines to sign on, two to a row, each with what it is for beneath it.
    SignatureLines(Vec<String>),
    /// Text at a fixed place on the current page; see [`Placed`].
    Placed(Placed),
}
