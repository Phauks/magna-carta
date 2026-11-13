//! Layout: the content model in, pages of positioned marks out. Everything that decides
//! where something goes lives here, so it can be tested without writing a PDF, and the
//! writer in `render` has no decisions left to make.
//!
//! Coordinates are points from the page's top-left corner, y increasing downward.

use crate::fonts::{Face, Measurer};
use crate::model::{
    Alignment, Block, Column, ComposedDocument, Field, Letterhead, PageSetup, Paragraph,
    RunningLine, Table,
};
use crate::ComposeError;

/// What a mark is drawn in: a shade of gray, or the document's accent colour where it has one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ink {
    /// 0 is black and 255 is white.
    Gray(u8),
    /// The document's accent colour. A document with none draws this mark in `fallback` gray,
    /// so one layout serves both.
    Accent { fallback: u8 },
}

/// One thing drawn on a page.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Mark {
    Text {
        x: f32,
        baseline: f32,
        face: Face,
        size: f32,
        ink: Ink,
        text: String,
    },
    /// A horizontal line.
    Rule {
        x0: f32,
        x1: f32,
        y: f32,
        thickness: f32,
        ink: Ink,
    },
    /// A filled rectangle.
    Fill {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        ink: Ink,
    },
    /// The outline of a rectangle with rounded corners.
    Frame {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        radius: f32,
        thickness: f32,
        ink: Ink,
    },
    /// The document's `index`-th image block.
    Image {
        index: usize,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct LaidPage {
    pub marks: Vec<Mark>,
}

/// What layout needs to know about an image: its size in pixels, after any rotation its
/// own orientation tag asks for.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ImageSize {
    pub pixel_width: u32,
    pub pixel_height: u32,
}

/// The most pages one document may run to. A content model is bounded by its caller, but a
/// single absurd `Space` or a table of a million rows should end in an error and not in an
/// allocation that grows until the process dies.
pub(crate) const MAXIMUM_PAGES: usize = 5_000;

#[derive(Clone, Copy)]
struct TextStyle {
    size: f32,
    line_height: f32,
    ink: Ink,
}

const BODY: TextStyle = TextStyle {
    size: 10.5,
    line_height: 15.0,
    ink: Ink::Gray(0),
};
const TITLE: TextStyle = TextStyle {
    size: 20.0,
    line_height: 26.0,
    ink: Ink::Accent { fallback: 0 },
};
const HEADING_ONE: TextStyle = TextStyle {
    size: 15.0,
    line_height: 20.0,
    ink: Ink::Accent { fallback: 0 },
};
const HEADING_TWO: TextStyle = TextStyle {
    size: 12.5,
    line_height: 17.0,
    ink: Ink::Accent { fallback: 0 },
};
const HEADING_THREE: TextStyle = TextStyle {
    size: 10.5,
    line_height: 15.0,
    ink: Ink::Gray(0),
};
const CAPTION: TextStyle = TextStyle {
    size: 9.0,
    line_height: 12.5,
    ink: Ink::Gray(90),
};
const CELL: TextStyle = TextStyle {
    size: 9.5,
    line_height: 13.0,
    ink: Ink::Gray(0),
};
const RUNNING: TextStyle = TextStyle {
    size: 8.5,
    line_height: 11.0,
    ink: Ink::Gray(110),
};

const PARAGRAPH_GAP: f32 = 7.0;
const SMALL_PARAGRAPH_GAP: f32 = 2.0;
const HEADING_GAP_BEFORE: f32 = 14.0;
const HEADING_GAP_AFTER: f32 = 5.0;
const BLOCK_GAP: f32 = 12.0;
const CELL_PADDING_HORIZONTAL: f32 = 5.0;
const CELL_PADDING_VERTICAL: f32 = 3.5;
const CELL_PADDING_VERTICAL_COMPACT: f32 = 1.5;
const MINIMUM_COLUMN_WIDTH: f32 = 34.0;
/// Pixels per point at the natural size of an image: 96 pixels to the inch, the size a
/// screen shows it at.
const NATURAL_PIXELS_PER_POINT: f32 = 96.0 / 72.0;

/// A run of text in one face, already measured.
#[derive(Debug, Clone, PartialEq)]
struct Piece {
    face: Face,
    text: String,
    width: f32,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Line {
    pieces: Vec<Piece>,
    width: f32,
}

/// Text as layout takes it: tabs become spaces and every other control character is
/// dropped, because a control character has no glyph and would be drawn as a missing-glyph
/// box. A line feed is kept; it is a forced line break.
fn clean(text: &str) -> String {
    text.chars()
        .filter_map(|character| match character {
            '\n' => Some('\n'),
            '\t' | '\u{a0}' => Some(' '),
            character if character.is_control() => None,
            character => Some(character),
        })
        .collect()
}

/// A word, possibly changing face partway through ("un" + bold "bold"), that must not be
/// broken unless it is wider than the line.
type Word = Vec<(Face, String)>;

enum Atom {
    Word(Word),
    Break,
}

/// Split styled text into words and forced breaks. A word is whatever sits between two
/// spaces, even when a change of face falls inside it.
fn atoms(spans: &[(Face, String)]) -> Vec<Atom> {
    let mut atoms = Vec::new();
    let mut word: Word = Vec::new();
    for (face, text) in spans {
        let mut current = String::new();
        for character in clean(text).chars() {
            if character == '\n' || character == ' ' {
                if !current.is_empty() {
                    word.push((*face, std::mem::take(&mut current)));
                }
                if !word.is_empty() {
                    atoms.push(Atom::Word(std::mem::take(&mut word)));
                }
                if character == '\n' {
                    atoms.push(Atom::Break);
                }
            } else {
                current.push(character);
            }
        }
        if !current.is_empty() {
            word.push((*face, current));
        }
    }
    if !word.is_empty() {
        atoms.push(Atom::Word(word));
    }
    atoms
}

fn push_piece(line: &mut Line, face: Face, text: &str) {
    match line.pieces.last_mut() {
        Some(last) if last.face == face => last.text.push_str(text),
        _ => line.pieces.push(Piece {
            face,
            text: text.to_string(),
            width: 0.0,
        }),
    }
}

/// Measure a finished line's pieces as they will be drawn: each merged run shaped whole.
fn finish(mut line: Line, measurer: &mut Measurer, size: f32) -> Line {
    line.width = 0.0;
    for piece in &mut line.pieces {
        piece.width = measurer.width(piece.face, size, &piece.text);
        line.width += piece.width;
    }
    line
}

/// Break styled text into lines no wider than `max_width`. Greedy: a word goes on the
/// current line if it fits and starts the next one if it does not. A single word wider than
/// the line is cut between characters, since the alternative is drawing it off the page.
fn break_lines(
    measurer: &mut Measurer,
    spans: &[(Face, String)],
    size: f32,
    max_width: f32,
) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut line = Line::default();
    let mut line_width = 0.0f32;
    for atom in atoms(spans) {
        let word = match atom {
            Atom::Break => {
                lines.push(finish(std::mem::take(&mut line), measurer, size));
                line_width = 0.0;
                continue;
            }
            Atom::Word(word) => word,
        };
        let word_width: f32 = word
            .iter()
            .map(|(face, text)| measurer.width(*face, size, text))
            .sum();
        let first_face = word.first().map(|(face, _)| *face).unwrap_or(Face::Regular);
        let space_width = measurer.width(first_face, size, " ");
        let is_empty = line.pieces.is_empty();
        if !is_empty && line_width + space_width + word_width > max_width {
            lines.push(finish(std::mem::take(&mut line), measurer, size));
            line_width = 0.0;
        }
        if word_width <= max_width {
            if !line.pieces.is_empty() {
                push_piece(&mut line, first_face, " ");
                line_width += space_width;
            }
            for (face, text) in &word {
                push_piece(&mut line, *face, text);
            }
            line_width += word_width;
            continue;
        }
        // Wider than a whole line: fill line after line a character at a time.
        for (face, text) in &word {
            for character in text.chars() {
                let mut buffer = [0u8; 4];
                let encoded: &str = character.encode_utf8(&mut buffer);
                let character_width = measurer.width(*face, size, encoded);
                if !line.pieces.is_empty() && line_width + character_width > max_width {
                    lines.push(finish(std::mem::take(&mut line), measurer, size));
                    line_width = 0.0;
                }
                push_piece(&mut line, *face, encoded);
                line_width += character_width;
            }
        }
    }
    if !line.pieces.is_empty() || lines.is_empty() {
        lines.push(finish(line, measurer, size));
    }
    lines
}

/// Leads a cell whose words are to be set on a grid. It is a control character, which
/// `clean` drops from any text a caller supplies, so only layout itself can ask for a grid.
const GRID_MARK: char = '\u{1}';

/// Set each word of `text` in a column as wide as the widest word, so the words of every
/// line stand under one another whatever their letters measure. A line feed starts a new
/// line; nothing else does, because a grid that wrapped would no longer be one.
fn grid_lines(measurer: &mut Measurer, face: Face, text: &str, size: f32) -> Vec<Line> {
    let cleaned = clean(text);
    let step = cleaned
        .split_whitespace()
        .map(|word| measurer.width(face, size, word))
        .fold(0.0f32, f32::max)
        + 2.0 * measurer.width(face, size, " ");
    cleaned
        .split('\n')
        .map(|row| {
            let pieces: Vec<Piece> = row
                .split_whitespace()
                .map(|word| Piece {
                    face,
                    text: word.to_string(),
                    width: step,
                })
                .collect();
            Line {
                width: step * pieces.len() as f32,
                pieces,
            }
        })
        .collect()
}

fn plain(face: Face, text: &str) -> Vec<(Face, String)> {
    vec![(face, text.to_string())]
}

/// How the rows of a row-based block are told apart.
#[derive(Clone, Copy, PartialEq, Eq)]
enum RowLines {
    /// Nothing between rows: a list of fields.
    None,
    /// A thin rule under every row.
    Ruled,
    /// Every other row shaded, and one rule under the last.
    Banded,
}

const HEADING_SHADE: Ink = Ink::Gray(236);
const BAND_SHADE: Ink = Ink::Gray(246);

/// One column of a row-based block (a table, or a list of fields).
struct ColumnPlan {
    x: f32,
    width: f32,
    alignment: Alignment,
    face: Face,
    ink: Ink,
}

/// The space between a card's frame and what it holds.
const CARD_PADDING: f32 = 10.0;
const CARD_RADIUS: f32 = 6.0;
const CARD_GAP: f32 = 12.0;
const CARD_TITLE: TextStyle = TextStyle {
    size: 11.5,
    line_height: 15.0,
    ink: Ink::Accent { fallback: 0 },
};
const CARD_EDGE: Ink = Ink::Gray(196);

/// A card whose frame is not drawn yet.
struct OpenCard {
    /// The page as it was before the card narrowed it.
    outer: PageSetup,
    /// Where the frame starts on the current page.
    top: f32,
}

struct Flow<'a, 'f> {
    card: Option<OpenCard>,
    /// The gap most recently added below a block, with nothing drawn since: what a card takes
    /// back so its frame closes at its own padding under the last block.
    trailing_gap: f32,
    page: PageSetup,
    measurer: &'a mut Measurer<'f>,
    pages: Vec<LaidPage>,
    /// The y at which the next block starts.
    cursor: f32,
    /// The space above and below the text of a table or field row.
    cell_padding_vertical: f32,
}

impl Flow<'_, '_> {
    fn top(&self) -> f32 {
        self.page.margin_top
    }

    fn bottom(&self) -> f32 {
        self.page.height - self.page.margin_bottom
    }

    fn left(&self) -> f32 {
        self.page.margin_left
    }

    fn remaining(&self) -> f32 {
        self.bottom() - self.cursor
    }

    fn at_top(&self) -> bool {
        self.cursor <= self.top() + 0.01
    }

    fn new_page(&mut self) -> Result<(), ComposeError> {
        if self.pages.len() >= MAXIMUM_PAGES {
            return Err(ComposeError::TooLong);
        }
        // A card that runs off the page is closed at its foot and opened again at the top
        // of the next, without its title.
        self.frame_card();
        self.pages.push(LaidPage::default());
        self.cursor = self.top();
        self.trailing_gap = 0.0;
        if let Some(card) = self.card.as_mut() {
            card.top = card.outer.margin_top;
        }
        Ok(())
    }

    /// Draw the open card's frame on the current page, from where it started to just under
    /// the last thing drawn in it.
    fn frame_card(&mut self) {
        let Some(card) = self.card.as_ref() else {
            return;
        };
        let outer = card.outer;
        let top = card.top;
        let foot = outer.height - outer.margin_bottom;
        let bottom = (self.cursor - self.trailing_gap + CARD_PADDING).min(foot);
        if bottom - top > 2.0 * CARD_PADDING {
            // Pushed directly: `mark` would forget the trailing gap the caller still needs.
            if let Some(page) = self.pages.last_mut() {
                page.marks.push(Mark::Frame {
                    x: outer.margin_left,
                    y: top,
                    width: outer.content_width(),
                    height: bottom - top,
                    radius: CARD_RADIUS,
                    thickness: 0.75,
                    ink: CARD_EDGE,
                });
            }
        }
    }

    fn open_card(&mut self, title: Option<&str>) -> Result<(), ComposeError> {
        self.close_card();
        self.gap(CARD_GAP);
        // A card starts where its title and a few rows of what it holds will fit.
        self.ensure(2.0 * CARD_PADDING + CARD_TITLE.line_height + 3.0 * CELL.line_height)?;
        let outer = self.page;
        let top = self.cursor;
        self.page.margin_left += CARD_PADDING;
        self.page.margin_right += CARD_PADDING;
        self.page.margin_top += CARD_PADDING;
        self.page.margin_bottom += CARD_PADDING;
        self.card = Some(OpenCard { outer, top });
        self.cursor = top + CARD_PADDING;
        self.trailing_gap = 0.0;
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            let lines = break_lines(
                self.measurer,
                &plain(Face::Bold, title),
                CARD_TITLE.size,
                self.page.content_width(),
            );
            self.flow_lines(&lines, Alignment::Start, CARD_TITLE)?;
            let y = self.cursor + 5.0;
            self.mark(Mark::Rule {
                x0: outer.margin_left,
                x1: outer.width - outer.margin_right,
                y,
                thickness: 0.5,
                ink: CARD_EDGE,
            });
            self.cursor = y + 6.0;
        }
        Ok(())
    }

    fn close_card(&mut self) {
        self.frame_card();
        if let Some(card) = self.card.take() {
            let foot = card.outer.height - card.outer.margin_bottom;
            self.cursor = (self.cursor - self.trailing_gap + CARD_PADDING).min(foot);
            self.page = card.outer;
            self.trailing_gap = 0.0;
        }
    }

    /// Start a new page unless `height` fits on this one. A block taller than a whole page
    /// is left where it is at the top of a page; its own code decides how to split it.
    fn ensure(&mut self, height: f32) -> Result<(), ComposeError> {
        if height > self.remaining() && !self.at_top() {
            self.new_page()?;
        }
        Ok(())
    }

    fn mark(&mut self, mark: Mark) {
        self.trailing_gap = 0.0;
        if let Some(page) = self.pages.last_mut() {
            page.marks.push(mark);
        }
    }

    /// Vertical space that is dropped at the top of a page, where it would only push the
    /// first block down.
    fn gap(&mut self, height: f32) {
        if !self.at_top() {
            let next = (self.cursor + height).min(self.bottom());
            self.trailing_gap += next - self.cursor;
            self.cursor = next;
        }
    }

    /// The baseline of a line of `style` text whose line box starts at `line_top`.
    fn baseline(&self, face: Face, style: TextStyle, line_top: f32) -> f32 {
        let metrics = self.measurer.vertical_metrics(face);
        let text_height = (metrics.ascent + metrics.descent) * style.size;
        line_top + (style.line_height - text_height) / 2.0 + metrics.ascent * style.size
    }

    /// Draw one already-broken line inside the box `[x, x + width]` at `line_top`.
    fn draw_line(
        &mut self,
        line: &Line,
        x: f32,
        width: f32,
        alignment: Alignment,
        style: TextStyle,
        line_top: f32,
    ) {
        let mut pen = match alignment {
            Alignment::Start => x,
            Alignment::Center => x + (width - line.width) / 2.0,
            Alignment::End => x + width - line.width,
        };
        for piece in &line.pieces {
            if !piece.text.trim().is_empty() {
                let baseline = self.baseline(piece.face, style, line_top);
                self.mark(Mark::Text {
                    x: pen,
                    baseline,
                    face: piece.face,
                    size: style.size,
                    ink: style.ink,
                    text: piece.text.clone(),
                });
            }
            pen += piece.width;
        }
    }

    /// Flow broken lines down the page, moving to a new page whenever one will not fit.
    fn flow_lines(
        &mut self,
        lines: &[Line],
        alignment: Alignment,
        style: TextStyle,
    ) -> Result<(), ComposeError> {
        let (x, width) = (self.left(), self.page.content_width());
        for line in lines {
            self.ensure(style.line_height)?;
            let line_top = self.cursor;
            self.draw_line(line, x, width, alignment, style, line_top);
            self.cursor += style.line_height;
        }
        Ok(())
    }

    fn heading(&mut self, text: &str, style: TextStyle) -> Result<(), ComposeError> {
        let lines = break_lines(
            self.measurer,
            &plain(Face::Bold, text),
            style.size,
            self.page.content_width(),
        );
        self.gap(HEADING_GAP_BEFORE);
        // A heading is kept with the start of what it heads: stranding it alone at the foot
        // of a page reads as a heading over nothing.
        let height = lines.len() as f32 * style.line_height;
        self.ensure(height + HEADING_GAP_AFTER + 2.0 * BODY.line_height)?;
        self.flow_lines(&lines, Alignment::Start, style)?;
        self.gap(HEADING_GAP_AFTER);
        Ok(())
    }

    fn paragraph(&mut self, paragraph: &Paragraph) -> Result<(), ComposeError> {
        let spans: Vec<(Face, String)> = paragraph
            .spans
            .iter()
            .map(|span| (Face::of(span.bold, span.italic), span.text.clone()))
            .collect();
        let style = if paragraph.small { CAPTION } else { BODY };
        let lines = break_lines(self.measurer, &spans, style.size, self.page.content_width());
        self.flow_lines(&lines, paragraph.alignment, style)?;
        self.gap(if paragraph.small {
            SMALL_PARAGRAPH_GAP
        } else {
            PARAGRAPH_GAP
        });
        Ok(())
    }

    fn rule(&mut self) -> Result<(), ComposeError> {
        self.ensure(BLOCK_GAP)?;
        let y = self.cursor + BLOCK_GAP / 2.0;
        let (x0, x1) = (self.left(), self.left() + self.page.content_width());
        self.mark(Mark::Rule {
            x0,
            x1,
            y,
            thickness: 1.0,
            ink: Ink::Accent { fallback: 150 },
        });
        self.cursor += BLOCK_GAP;
        Ok(())
    }

    fn image(
        &mut self,
        index: usize,
        size: ImageSize,
        requested_width: Option<f32>,
        alignment: Alignment,
        caption: Option<&str>,
    ) -> Result<(), ComposeError> {
        let content_width = self.page.content_width();
        let caption_lines = match caption {
            Some(caption) if !caption.trim().is_empty() => break_lines(
                self.measurer,
                &plain(Face::Italic, caption),
                CAPTION.size,
                content_width,
            ),
            _ => Vec::new(),
        };
        let caption_height = caption_lines.len() as f32 * CAPTION.line_height
            + if caption_lines.is_empty() { 0.0 } else { 4.0 };
        let aspect = size.pixel_height.max(1) as f32 / size.pixel_width.max(1) as f32;
        let natural_width = size.pixel_width as f32 / NATURAL_PIXELS_PER_POINT;
        let mut width = requested_width
            .filter(|width| width.is_finite() && *width > 0.0)
            .unwrap_or(natural_width)
            .min(content_width);
        // Never taller than a page can hold with its caption: a picture cannot be split.
        let tallest = (self.page.content_height() - caption_height).max(1.0);
        if width * aspect > tallest {
            width = tallest / aspect;
        }
        let height = width * aspect;
        self.ensure(height + caption_height)?;
        let x = match alignment {
            Alignment::Start => self.left(),
            Alignment::Center => self.left() + (content_width - width) / 2.0,
            Alignment::End => self.left() + content_width - width,
        };
        let y = self.cursor;
        self.mark(Mark::Image {
            index,
            x,
            y,
            width,
            height,
        });
        self.cursor += height;
        if !caption_lines.is_empty() {
            self.cursor += 4.0;
            self.flow_lines(&caption_lines, alignment, CAPTION)?;
        }
        self.gap(BLOCK_GAP);
        Ok(())
    }

    /// One row's cells, each broken to its column.
    fn break_row(
        &mut self,
        columns: &[ColumnPlan],
        cells: &[String],
        bold: bool,
    ) -> Vec<Vec<Line>> {
        columns
            .iter()
            .enumerate()
            .map(|(index, column)| {
                let text = cells.get(index).map(String::as_str).unwrap_or("");
                let face = if bold { Face::Bold } else { column.face };
                if let Some(words) = text.strip_prefix(GRID_MARK) {
                    return grid_lines(self.measurer, face, words, CELL.size);
                }
                break_lines(
                    self.measurer,
                    &plain(face, text),
                    CELL.size,
                    (column.width - 2.0 * CELL_PADDING_HORIZONTAL).max(1.0),
                )
            })
            .collect()
    }

    /// Draw lines `[first, first + count)` of a broken row at the cursor and advance past it.
    fn draw_row_slice(
        &mut self,
        columns: &[ColumnPlan],
        row: &[Vec<Line>],
        first: usize,
        count: usize,
        shade: Option<Ink>,
    ) {
        let top = self.cursor;
        let height = count as f32 * CELL.line_height + 2.0 * self.cell_padding_vertical;
        if let Some(ink) = shade {
            let (x, width) = (self.left(), self.page.content_width());
            self.mark(Mark::Fill {
                x,
                y: top,
                width,
                height,
                ink,
            });
        }
        for (column, lines) in columns.iter().zip(row) {
            for (offset, line) in lines.iter().skip(first).take(count).enumerate() {
                let line_top = top + self.cell_padding_vertical + offset as f32 * CELL.line_height;
                let style = TextStyle {
                    ink: column.ink,
                    ..CELL
                };
                self.draw_line(
                    line,
                    column.x + CELL_PADDING_HORIZONTAL,
                    column.width - 2.0 * CELL_PADDING_HORIZONTAL,
                    column.alignment,
                    style,
                    line_top,
                );
            }
        }
        self.cursor = top + height;
    }

    fn row_rule(&mut self, ink: Ink, thickness: f32) {
        let (x0, x1, y) = (
            self.left(),
            self.left() + self.page.content_width(),
            self.cursor,
        );
        self.mark(Mark::Rule {
            x0,
            x1,
            y,
            thickness,
            ink,
        });
    }

    /// Lay out rows under an optional heading row that repeats on every page the rows run
    /// onto. A row moves whole to the next page when it fits there; a row taller than a page
    /// is split between its lines, because holding it back would never place it at all.
    fn rows(
        &mut self,
        columns: &[ColumnPlan],
        heading: Option<&[String]>,
        rows: &[Vec<String>],
        lines: RowLines,
    ) -> Result<(), ComposeError> {
        let heading_row = heading.map(|cells| self.break_row(columns, cells, true));
        let padding = self.cell_padding_vertical;
        let row_height = |lines: usize| lines as f32 * CELL.line_height + 2.0 * padding;
        let line_count = |row: &[Vec<Line>]| row.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let heading_height = heading_row
            .as_deref()
            .map(|row| row_height(line_count(row)))
            .unwrap_or(0.0);
        let full_page = self.page.content_height() - heading_height;

        // The heading is kept with at least one line of the first row.
        self.ensure(heading_height + row_height(1))?;
        let mut heading_due = heading_row.is_some();
        for (number, cells) in rows.iter().enumerate() {
            let shade = (lines == RowLines::Banded && number % 2 == 1).then_some(BAND_SHADE);
            let row = self.break_row(columns, cells, false);
            let total = line_count(&row);
            let mut first = 0;
            while first < total {
                if heading_due {
                    if let Some(heading_row) = heading_row.as_deref() {
                        let count = line_count(heading_row);
                        self.draw_row_slice(columns, heading_row, 0, count, Some(HEADING_SHADE));
                        self.row_rule(Ink::Accent { fallback: 110 }, 0.75);
                    }
                    heading_due = false;
                }
                let fitting = ((self.remaining() - 2.0 * self.cell_padding_vertical)
                    / CELL.line_height)
                    .floor()
                    .max(0.0) as usize;
                let left = total - first;
                let fits_here = fitting >= left;
                let fits_on_a_fresh_page = row_height(left) <= full_page;
                let at_start_of_rows =
                    self.at_top() || self.cursor <= self.top() + heading_height + 0.01;
                if !fits_here && !at_start_of_rows && (fits_on_a_fresh_page || fitting == 0) {
                    self.new_page()?;
                    heading_due = heading_row.is_some();
                    continue;
                }
                // At least one line always goes down, so a page too short for any line still
                // makes progress instead of looping.
                let count = fitting.clamp(1, left);
                self.draw_row_slice(columns, &row, first, count, shade);
                first += count;
                if first < total {
                    self.new_page()?;
                    heading_due = heading_row.is_some();
                }
            }
            if lines == RowLines::Ruled {
                self.row_rule(Ink::Gray(205), 0.5);
            }
        }
        if lines == RowLines::Banded && !rows.is_empty() {
            // Bands have no edge of their own, so the table is closed with one rule.
            self.row_rule(Ink::Gray(205), 0.5);
        }
        if heading_due {
            // A table with a heading and no rows still shows its heading.
            if let Some(heading_row) = heading_row.as_deref() {
                let count = line_count(heading_row);
                self.draw_row_slice(columns, heading_row, 0, count, Some(HEADING_SHADE));
                self.row_rule(Ink::Accent { fallback: 110 }, 0.75);
            }
        }
        self.gap(BLOCK_GAP);
        Ok(())
    }

    fn table(&mut self, table: &Table) -> Result<(), ComposeError> {
        if table.columns.is_empty() {
            return Ok(());
        }
        let widths = self.column_widths(table);
        let mut x = self.left();
        let columns: Vec<ColumnPlan> = table
            .columns
            .iter()
            .zip(&widths)
            .map(|(column, width)| {
                let plan = ColumnPlan {
                    x,
                    width: *width,
                    alignment: column.alignment,
                    face: Face::Regular,
                    ink: Ink::Gray(0),
                };
                x += *width;
                plan
            })
            .collect();
        let headings: Vec<String> = table.columns.iter().map(|c| c.heading.clone()).collect();
        let heading = headings
            .iter()
            .any(|heading| !heading.trim().is_empty())
            .then_some(headings.as_slice());
        let lines = if table.banded {
            RowLines::Banded
        } else {
            RowLines::Ruled
        };
        self.rows(&columns, heading, &table.rows, lines)
    }

    /// Column widths that fill the content width. With a weight on every column the widths
    /// are those shares. Otherwise each column asks for the width of its widest cell on one
    /// line, capped at half the table so one long column cannot starve the rest, and the
    /// asks are scaled to fit.
    fn column_widths(&mut self, table: &Table) -> Vec<f32> {
        let content_width = self.page.content_width();
        let weights: Vec<Option<f32>> = table
            .columns
            .iter()
            .map(|column| column.weight.filter(|w| w.is_finite() && *w > 0.0))
            .collect();
        let asks: Vec<f32> = if weights.iter().all(Option::is_some) {
            weights.iter().map(|weight| weight.unwrap_or(1.0)).collect()
        } else {
            table
                .columns
                .iter()
                .enumerate()
                .map(|(index, column): (usize, &Column)| {
                    let mut widest =
                        self.measurer
                            .width(Face::Bold, CELL.size, &clean(&column.heading));
                    for row in &table.rows {
                        if let Some(cell) = row.get(index) {
                            for line in clean(cell).split('\n') {
                                widest =
                                    widest.max(self.measurer.width(Face::Regular, CELL.size, line));
                            }
                        }
                    }
                    (widest + 2.0 * CELL_PADDING_HORIZONTAL)
                        .clamp(MINIMUM_COLUMN_WIDTH, content_width / 2.0)
                })
                .collect()
        };
        let total: f32 = asks.iter().sum();
        let scale = if total > 0.0 {
            content_width / total
        } else {
            1.0
        };
        asks.iter().map(|ask| ask * scale).collect()
    }

    /// The widest label of `fields`, as the width of a label column no wider than `limit`.
    fn label_width(&mut self, fields: &[Field], limit: f32) -> f32 {
        let mut widest = 0.0f32;
        for field in fields {
            widest = widest.max(
                self.measurer
                    .width(Face::Bold, CELL.size, &clean(&field.label)),
            );
        }
        (widest + 2.0 * CELL_PADDING_HORIZONTAL + 8.0).clamp(MINIMUM_COLUMN_WIDTH, limit)
    }

    /// A label column and a value column filling `[x, x + width]`.
    fn field_columns(&mut self, fields: &[Field], x: f32, width: f32) -> [ColumnPlan; 2] {
        let label_width = self.label_width(fields, width * 0.38);
        [
            ColumnPlan {
                x,
                width: label_width,
                alignment: Alignment::Start,
                face: Face::Bold,
                ink: Ink::Gray(70),
            },
            ColumnPlan {
                x: x + label_width,
                width: width - label_width,
                alignment: Alignment::Start,
                face: Face::Regular,
                ink: Ink::Gray(0),
            },
        ]
    }

    fn fields(&mut self, fields: &[Field]) -> Result<(), ComposeError> {
        if fields.is_empty() {
            return Ok(());
        }
        let columns = self.field_columns(fields, self.left(), self.page.content_width());
        let rows: Vec<Vec<String>> = fields.iter().map(field_cells).collect();
        self.rows(&columns, None, &rows, RowLines::None)
    }

    /// Fields in two columns, read down the first and then down the second. Each half has a
    /// label column sized to its own labels.
    fn fields_two_up(&mut self, fields: &[Field]) -> Result<(), ComposeError> {
        if fields.len() < 2 {
            return self.fields(fields);
        }
        let (first, second) = fields.split_at(fields.len().div_ceil(2));
        let half = self.page.content_width() / 2.0;
        let left = self.field_columns(first, self.left(), half);
        let right = self.field_columns(second, self.left() + half, half);
        let rows: Vec<Vec<String>> = first
            .iter()
            .enumerate()
            .map(|(index, field)| {
                let mut cells = field_cells(field);
                match second.get(index) {
                    Some(beside) => cells.extend(field_cells(beside)),
                    None => cells.extend([String::new(), String::new()]),
                }
                cells
            })
            .collect();
        let [a, b] = left;
        let [c, d] = right;
        self.rows(&[a, b, c, d], None, &rows, RowLines::None)
    }
}

/// A field as its row's two cells.
fn field_cells(field: &Field) -> Vec<String> {
    let value = if field.grid {
        format!("{GRID_MARK}{}", field.value)
    } else {
        field.value.clone()
    };
    vec![field.label.clone(), value]
}

fn running_line(
    measurer: &mut Measurer,
    page: &PageSetup,
    line: &RunningLine,
    style: TextStyle,
    baseline: f32,
    (number, count): (usize, usize),
    marks: &mut Vec<Mark>,
) {
    let fill = |text: &str| {
        clean(text)
            .replace('\n', " ")
            .replace("{pages}", &count.to_string())
            .replace("{page}", &number.to_string())
    };
    let slots = [
        (fill(&line.left), Alignment::Start),
        (fill(&line.center), Alignment::Center),
        (fill(&line.right), Alignment::End),
    ];
    for (text, alignment) in slots {
        if text.trim().is_empty() {
            continue;
        }
        let width = measurer.width(Face::Regular, style.size, &text);
        let x = match alignment {
            Alignment::Start => page.margin_left,
            Alignment::Center => page.margin_left + (page.content_width() - width) / 2.0,
            Alignment::End => page.width - page.margin_right - width,
        };
        marks.push(Mark::Text {
            x,
            baseline,
            face: Face::Regular,
            size: style.size,
            ink: style.ink,
            text,
        });
    }
}

/// The footer of a document with a letterhead: a size up from the plain running line and
/// darker, because it stands under a rule of its own and not alone in the margin.
const LETTERHEAD_FOOTER: TextStyle = TextStyle {
    size: 9.5,
    line_height: 12.0,
    ink: Ink::Gray(60),
};
const LETTERHEAD_BAR: f32 = 5.0;
const LETTERHEAD_PICTURE_HEIGHT: f32 = 24.0;
const LETTERHEAD_TITLE_SIZE: f32 = 12.0;
const LETTERHEAD_DETAIL_SIZE: f32 = 10.5;
const LETTERHEAD_LABEL_SIZE: f32 = 8.5;
/// The band ends this far above the content.
const LETTERHEAD_CLEARANCE: f32 = 12.0;

/// Draw the letterhead in the top margin of one page: the bar, the picture and the two lines
/// of text beside it, and the rule that closes the band. `picture` is the picture's position
/// among the document's images and its size, where the letterhead has one.
fn letterhead_marks(
    measurer: &mut Measurer,
    page: &PageSetup,
    letterhead: &Letterhead,
    picture: Option<(usize, ImageSize)>,
    marks: &mut Vec<Mark>,
) {
    let left = page.margin_left;
    let right = page.width - page.margin_right;
    let rule = page.margin_top - LETTERHEAD_CLEARANCE;
    let picture_top = rule - 9.0 - LETTERHEAD_PICTURE_HEIGHT;
    let bar_top = picture_top - 10.0 - LETTERHEAD_BAR;
    marks.push(Mark::Fill {
        x: left,
        y: bar_top,
        width: right - left,
        height: LETTERHEAD_BAR,
        ink: Ink::Accent { fallback: 60 },
    });
    if let Some((index, size)) = picture.filter(|(_, size)| size.pixel_height > 0) {
        let width = LETTERHEAD_PICTURE_HEIGHT * size.pixel_width as f32 / size.pixel_height as f32;
        marks.push(Mark::Image {
            index,
            x: left,
            y: picture_top,
            width: width.min(right - left),
            height: LETTERHEAD_PICTURE_HEIGHT,
        });
    }
    // The title, then under it the detail in bold with its label small and gray before it.
    // Each is set against the right margin, so `pen` walks leftwards.
    let lines = [
        (
            &letterhead.title,
            Face::Bold,
            LETTERHEAD_TITLE_SIZE,
            Ink::Accent { fallback: 0 },
            picture_top + 9.0,
            false,
        ),
        (
            &letterhead.detail,
            Face::Bold,
            LETTERHEAD_DETAIL_SIZE,
            Ink::Gray(30),
            picture_top + 23.0,
            false,
        ),
        (
            &letterhead.label,
            Face::Regular,
            LETTERHEAD_LABEL_SIZE,
            Ink::Gray(110),
            picture_top + 23.0,
            true,
        ),
    ];
    let mut pen = right;
    for (text, face, size, ink, baseline, beside_previous) in lines {
        if !beside_previous {
            pen = right;
        }
        let text = clean(text).replace('\n', " ");
        if text.trim().is_empty() {
            continue;
        }
        let width = measurer.width(face, size, &text);
        marks.push(Mark::Text {
            x: pen - width,
            baseline,
            face,
            size,
            ink,
            text,
        });
        pen -= width + 6.0;
    }
    marks.push(Mark::Rule {
        x0: left,
        x1: right,
        y: rule,
        thickness: 0.75,
        ink: Ink::Gray(200),
    });
}

/// Lay a document out. `images` holds the pixel size of each [`Block::Image`], in the order
/// the blocks appear.
pub(crate) fn lay_out(
    document: &ComposedDocument,
    images: &[ImageSize],
    measurer: &mut Measurer,
) -> Result<Vec<LaidPage>, ComposeError> {
    let page = document.page;
    let dimensions = [
        page.width,
        page.height,
        page.margin_top,
        page.margin_right,
        page.margin_bottom,
        page.margin_left,
    ];
    // A page needs room for at least a few lines of text; anything less is a caller's
    // mistake, and laying out into it would produce thousands of one-word pages.
    if dimensions
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
        || page.content_width() < 72.0
        || page.content_height() < 72.0
        || page.width > 14_400.0
        || page.height > 14_400.0
    {
        return Err(ComposeError::InvalidPage);
    }

    let mut flow = Flow {
        card: None,
        trailing_gap: 0.0,
        page,
        measurer,
        pages: Vec::new(),
        cursor: page.margin_top,
        cell_padding_vertical: if document.compact {
            CELL_PADDING_VERTICAL_COMPACT
        } else {
            CELL_PADDING_VERTICAL
        },
    };
    flow.new_page()?;
    let mut image_index = 0;
    for block in &document.blocks {
        match block {
            Block::Title(text) => {
                let lines = break_lines(
                    flow.measurer,
                    &plain(Face::Bold, text),
                    TITLE.size,
                    page.content_width(),
                );
                flow.flow_lines(&lines, Alignment::Start, TITLE)?;
                flow.gap(BLOCK_GAP);
            }
            Block::Heading { level, text } => {
                let style = match level {
                    1 => HEADING_ONE,
                    2 => HEADING_TWO,
                    _ => HEADING_THREE,
                };
                flow.heading(text, style)?;
            }
            Block::Paragraph(paragraph) => flow.paragraph(paragraph)?,
            Block::Image(image) => {
                let size = images
                    .get(image_index)
                    .copied()
                    .ok_or(ComposeError::Write)?;
                flow.image(
                    image_index,
                    size,
                    image.width,
                    image.alignment,
                    image.caption.as_deref(),
                )?;
                image_index += 1;
            }
            Block::Table(table) => flow.table(table)?,
            Block::Fields(fields) => flow.fields(fields)?,
            Block::FieldsTwoUp(fields) => flow.fields_two_up(fields)?,
            Block::Rule => flow.rule()?,
            Block::Space(height) => {
                if height.is_finite() && *height > 0.0 {
                    let height = height.min(page.content_height());
                    flow.ensure(height)?;
                    flow.gap(height);
                }
            }
            Block::PageBreak => flow.new_page()?,
            Block::CardStart { title } => flow.open_card(title.as_deref())?,
            Block::CardEnd => flow.close_card(),
        }
    }
    flow.close_card();

    // The letterhead's picture follows the image blocks in `images`.
    let letterhead_picture = document
        .letterhead
        .as_ref()
        .and_then(|letterhead| letterhead.image.as_ref())
        .and_then(|_| images.get(image_index).map(|size| (image_index, *size)));
    let mut pages = flow.pages;
    let count = pages.len();
    for (index, laid) in pages.iter_mut().enumerate() {
        if let Some(header) = &document.header {
            let baseline = page.margin_top / 2.0 + RUNNING.size / 2.0;
            running_line(
                measurer,
                &page,
                header,
                RUNNING,
                baseline,
                (index + 1, count),
                &mut laid.marks,
            );
        }
        if let Some(letterhead) = &document.letterhead {
            letterhead_marks(
                measurer,
                &page,
                letterhead,
                letterhead_picture,
                &mut laid.marks,
            );
        }
        if let Some(footer) = &document.footer {
            let style = if document.letterhead.is_some() {
                LETTERHEAD_FOOTER
            } else {
                RUNNING
            };
            // Under a letterhead the footer is a band of its own, measured from the content
            // as the letterhead is: a rule one clearance below it, then the line.
            let baseline = if document.letterhead.is_some() {
                page.height - page.margin_bottom + Letterhead::FOOTER_HEIGHT
            } else {
                page.height - page.margin_bottom / 2.0 + style.size / 2.0
            };
            if document.letterhead.is_some() {
                laid.marks.push(Mark::Rule {
                    x0: page.margin_left,
                    x1: page.width - page.margin_right,
                    y: baseline - style.size - 7.0,
                    thickness: 0.75,
                    ink: Ink::Accent { fallback: 150 },
                });
            }
            running_line(
                measurer,
                &page,
                footer,
                style,
                baseline,
                (index + 1, count),
                &mut laid.marks,
            );
        }
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fonts::FontFamily;

    #[test]
    fn a_grid_sets_every_word_in_a_column_of_one_width() {
        let family = FontFamily::bundled();
        let mut measurer = Measurer::new(&family).unwrap();
        // Digits and letters measure differently, so plain text would not line up.
        let narrow = measurer.width(Face::Regular, CELL.size, "1111");
        let wide = measurer.width(Face::Regular, CELL.size, "dddd");
        assert!((narrow - wide).abs() > 0.1);

        let lines = grid_lines(
            &mut measurer,
            Face::Regular,
            "1111 dddd ffff\nabcd 0000 1f1f",
            CELL.size,
        );
        assert_eq!(lines.len(), 2);
        let widths: Vec<f32> = lines
            .iter()
            .flat_map(|line| line.pieces.iter().map(|piece| piece.width))
            .collect();
        assert_eq!(widths.len(), 6);
        assert!(widths
            .iter()
            .all(|width| *width == widths[0] && *width > wide));
        assert_eq!(lines[0].pieces[1].text, "dddd");
    }

    fn frames(page: &LaidPage) -> Vec<(f32, f32, f32, f32)> {
        page.marks
            .iter()
            .filter_map(|mark| match mark {
                Mark::Frame {
                    x,
                    y,
                    width,
                    height,
                    ..
                } => Some((*x, *y, *width, *height)),
                _ => None,
            })
            .collect()
    }

    fn field(number: usize) -> Field {
        Field {
            label: format!("Label {number}"),
            value: format!("Value {number}"),
            grid: false,
        }
    }

    #[test]
    fn a_card_is_framed_from_margin_to_margin_around_what_it_holds() {
        let family = FontFamily::bundled();
        let mut measurer = Measurer::new(&family).unwrap();
        let document = ComposedDocument {
            blocks: vec![
                Block::CardStart {
                    title: Some("Summary".to_string()),
                },
                Block::Fields((1..=3).map(field).collect()),
                Block::CardEnd,
                Block::CardStart { title: None },
                Block::Fields((4..=5).map(field).collect()),
            ],
            ..ComposedDocument::default()
        };
        let pages = lay_out(&document, &[], &mut measurer).unwrap();
        let page = document.page;
        let drawn = frames(&pages[0]);
        // Two frames: the second card was never closed, and is closed with the document.
        assert_eq!(drawn.len(), 2);
        for (x, _, width, _) in &drawn {
            assert_eq!(*x, page.margin_left);
            assert_eq!(*width, page.content_width());
        }
        let (_, first_top, _, first_height) = drawn[0];
        let (_, second_top, _, _) = drawn[1];
        assert_eq!(first_top, page.margin_top);
        assert!((second_top - (first_top + first_height) - CARD_GAP).abs() < 0.01);
        // Text sits inside the padding on both sides.
        for mark in &pages[0].marks {
            if let Mark::Text { x, .. } = mark {
                assert!(*x >= page.margin_left + CARD_PADDING);
            }
        }
    }

    #[test]
    fn a_card_that_runs_off_a_page_is_framed_on_each_page_it_reaches() {
        let family = FontFamily::bundled();
        let mut measurer = Measurer::new(&family).unwrap();
        let document = ComposedDocument {
            blocks: vec![
                Block::CardStart {
                    title: Some("Audit Log".to_string()),
                },
                Block::Fields((1..=60).map(field).collect()),
                Block::CardEnd,
            ],
            ..ComposedDocument::default()
        };
        let pages = lay_out(&document, &[], &mut measurer).unwrap();
        let page = document.page;
        assert_eq!(pages.len(), 2);
        let (first, second) = (frames(&pages[0]), frames(&pages[1]));
        assert_eq!((first.len(), second.len()), (1, 1));
        // The first closes under the last row the page took, within a row of its foot and never
        // past it; the second starts at the top of the next.
        let foot = page.height - page.margin_bottom;
        let closed = first[0].1 + first[0].3;
        assert!(closed <= foot + 0.01 && closed > foot - 2.0 * CELL.line_height);
        assert_eq!(second[0].1, page.margin_top);
        assert!(second[0].3 < first[0].3);
    }
}
