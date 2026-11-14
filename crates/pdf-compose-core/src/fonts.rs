//! The four faces a document is set in, and the one measurement layout needs from them:
//! how wide a run of text is.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::ComposeError;

/// Which of the family's four faces a run of text is set in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Face {
    Regular,
    Bold,
    Italic,
    BoldItalic,
}

impl Face {
    pub(crate) fn of(bold: bool, italic: bool) -> Self {
        match (bold, italic) {
            (false, false) => Face::Regular,
            (true, false) => Face::Bold,
            (false, true) => Face::Italic,
            (true, true) => Face::BoldItalic,
        }
    }
}

/// A font family: the TrueType or OpenType file for each of its four faces. Every glyph a
/// document uses is embedded in it, so the document reads the same on a machine that has
/// never seen the family.
#[derive(Clone)]
pub struct FontFamily {
    regular: Arc<Vec<u8>>,
    bold: Arc<Vec<u8>>,
    italic: Arc<Vec<u8>>,
    bold_italic: Arc<Vec<u8>>,
}

impl FontFamily {
    /// A family from the caller's own font files. Each is checked to be a font this library
    /// can shape with before any layout happens.
    pub fn new(
        regular: Vec<u8>,
        bold: Vec<u8>,
        italic: Vec<u8>,
        bold_italic: Vec<u8>,
    ) -> Result<Self, ComposeError> {
        for data in [&regular, &bold, &italic, &bold_italic] {
            if rustybuzz::Face::from_slice(data, 0).is_none() {
                return Err(ComposeError::InvalidFont);
            }
        }
        Ok(Self {
            regular: Arc::new(regular),
            bold: Arc::new(bold),
            italic: Arc::new(italic),
            bold_italic: Arc::new(bold_italic),
        })
    }

    /// Liberation Sans, compiled into the library. Metric-compatible with Arial and
    /// licensed under the SIL Open Font License (`fonts/LICENSE.txt`). It covers Latin,
    /// Greek and Cyrillic; a document in another script needs a family of its own.
    #[cfg(feature = "bundled-fonts")]
    pub fn bundled() -> Self {
        Self {
            regular: Arc::new(include_bytes!("../fonts/LiberationSans-Regular.ttf").to_vec()),
            bold: Arc::new(include_bytes!("../fonts/LiberationSans-Bold.ttf").to_vec()),
            italic: Arc::new(include_bytes!("../fonts/LiberationSans-Italic.ttf").to_vec()),
            bold_italic: Arc::new(
                include_bytes!("../fonts/LiberationSans-BoldItalic.ttf").to_vec(),
            ),
        }
    }

    /// Atkinson Hyperlegible Next, compiled into the library and licensed under the SIL Open
    /// Font License (`fonts/AtkinsonHyperlegibleNext-LICENSE.txt`). It covers Latin only.
    #[cfg(feature = "bundled-fonts")]
    pub fn atkinson_hyperlegible() -> Self {
        Self {
            regular: Arc::new(
                include_bytes!("../fonts/AtkinsonHyperlegibleNext-Regular.ttf").to_vec(),
            ),
            bold: Arc::new(include_bytes!("../fonts/AtkinsonHyperlegibleNext-Bold.ttf").to_vec()),
            italic: Arc::new(
                include_bytes!("../fonts/AtkinsonHyperlegibleNext-Italic.ttf").to_vec(),
            ),
            bold_italic: Arc::new(
                include_bytes!("../fonts/AtkinsonHyperlegibleNext-BoldItalic.ttf").to_vec(),
            ),
        }
    }

    /// The compiled-in family a document names as its typeface.
    #[cfg(feature = "bundled-fonts")]
    pub fn bundled_as(typeface: crate::Typeface) -> Self {
        match typeface {
            crate::Typeface::LiberationSans => Self::bundled(),
            crate::Typeface::AtkinsonHyperlegible => Self::atkinson_hyperlegible(),
        }
    }

    pub(crate) fn data(&self, face: Face) -> Arc<Vec<u8>> {
        Arc::clone(match face {
            Face::Regular => &self.regular,
            Face::Bold => &self.bold,
            Face::Italic => &self.italic,
            Face::BoldItalic => &self.bold_italic,
        })
    }
}

/// The measuring side of a family: shapes text the way the writer will when it draws it,
/// and remembers every character no face had a glyph for.
pub(crate) struct Measurer<'a> {
    faces: [rustybuzz::Face<'a>; 4],
    missing: BTreeSet<char>,
}

/// Where a face's line sits relative to its baseline, as fractions of the font size.
#[derive(Debug, Clone, Copy)]
pub(crate) struct VerticalMetrics {
    pub ascent: f32,
    pub descent: f32,
}

impl<'a> Measurer<'a> {
    pub(crate) fn new(family: &'a FontFamily) -> Result<Self, ComposeError> {
        let load = |data: &'a Arc<Vec<u8>>| {
            rustybuzz::Face::from_slice(data, 0).ok_or(ComposeError::InvalidFont)
        };
        Ok(Self {
            faces: [
                load(&family.regular)?,
                load(&family.bold)?,
                load(&family.italic)?,
                load(&family.bold_italic)?,
            ],
            missing: BTreeSet::new(),
        })
    }

    fn face(&self, face: Face) -> &rustybuzz::Face<'a> {
        match face {
            Face::Regular => &self.faces[0],
            Face::Bold => &self.faces[1],
            Face::Italic => &self.faces[2],
            Face::BoldItalic => &self.faces[3],
        }
    }

    /// The width of `text` set in `face` at `size` points.
    pub(crate) fn width(&mut self, face: Face, size: f32, text: &str) -> f32 {
        if text.is_empty() {
            return 0.0;
        }
        let font = self.face(face);
        let units_per_em = font.units_per_em().max(1) as f32;
        let mut buffer = rustybuzz::UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let shaped = rustybuzz::shape(font, &[], buffer);
        let mut advance = 0i64;
        let mut missing = Vec::new();
        for (info, position) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            advance += i64::from(position.x_advance);
            if info.glyph_id == 0 {
                // The cluster is the byte offset of the character the glyph stands for.
                if let Some(character) = text
                    .get(info.cluster as usize..)
                    .and_then(|rest| rest.chars().next())
                {
                    missing.push(character);
                }
            }
        }
        self.missing.extend(missing);
        advance as f32 / units_per_em * size
    }

    pub(crate) fn vertical_metrics(&self, face: Face) -> VerticalMetrics {
        let font = self.face(face);
        let units_per_em = font.units_per_em().max(1) as f32;
        VerticalMetrics {
            ascent: f32::from(font.ascender()) / units_per_em,
            descent: -f32::from(font.descender()) / units_per_em,
        }
    }

    /// Every character measured so far that its face has no glyph for, in code-point order.
    pub(crate) fn into_missing(self) -> Vec<char> {
        self.missing.into_iter().collect()
    }
}
