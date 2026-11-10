//! Write an invisible text layer over a scanned page, turning an image-only PDF into
//! one that is selectable, copyable, and searchable. The text and its boxes come from
//! the OCR engine (recognized text in the page's displayed frame); this module places
//! that text back onto the page it was read from, drawn in render mode 3 (neither filled
//! nor stroked) so nothing new is visible, counter-rotating it on a rotated page so the
//! invisible layer lines up with the displayed glyphs.
//!
//! The layer is strictly additive, following the same non-destructive append rule as
//! Bates stamping in `bates.rs`: existing objects and bytes are untouched, and the
//! layer is a new content stream plus one shared font per document. What copy-paste
//! and search extract is governed by a `ToUnicode` CMap, not by any rendered glyph —
//! which is why the font need not be embedded: an invisible glyph is never drawn.

use std::collections::{BTreeMap, BTreeSet};

use lopdf::{dictionary, Document, Object, Stream};

use crate::guard::{guard_input, GuardLimits};
use crate::PdfError;

/// The preferred name for the layer's font in each page's `/Font` resources. Distinctive,
/// but not assumed free: [`free_font_name`] suffixes it if a target page already carries a
/// font under this exact name, so the layer never clobbers a page's own resource.
const FONT_RESOURCE_NAME: &[u8] = b"MagnaCartaOcr";

/// Default glyph advance, in 1000-unit glyph space. One em per character: a run's total
/// advance is then its character count times the font size, which the per-run horizontal
/// scale (`Tz`) rescales to the recognized box width.
const DEFAULT_WIDTH: i64 = 1000;

/// Assign each distinct character used across the document a two-byte code (a CID), starting
/// at 1 — CID 0 is `.notdef`. Deterministic: characters in sorted order, so the output is
/// byte-identical run to run.
///
/// Each *character* (Unicode scalar) is one code, rather than the code being a raw UTF-16
/// code unit. A non-BMP character (an emoji, a CJK Extension-B ideograph) is a surrogate
/// *pair* in UTF-16; keying the code on the code unit would emit two lone surrogates whose
/// `ToUnicode` destinations cannot decode, and the character would silently vanish from the
/// extracted text — which redaction reads, so a name it could not see it could not redact.
/// One code per character maps cleanly to one multi-unit `ToUnicode` destination.
fn assign_character_codes(pages: &[PageTextLayer]) -> BTreeMap<char, u16> {
    let mut characters: BTreeSet<char> = BTreeSet::new();
    for page in pages {
        for run in &page.runs {
            characters.extend(run.text.chars());
        }
    }
    let mut codes = BTreeMap::new();
    for (index, character) in characters.into_iter().enumerate() {
        // A document with more than 65535 distinct characters is absurd (all of CJK is
        // ~20k); stop rather than wrap a code. Excess characters get no code and are
        // skipped by `run_operator` — never mis-encoded.
        let Ok(code) = u16::try_from(index + 1) else {
            break;
        };
        codes.insert(character, code);
    }
    codes
}

/// One recognized run of text and the box it occupies, in the page's **displayed** bottom-left
/// frame — the frame the OCR engine reads, i.e. the page after the viewer applies `/Rotate`. On a
/// page with no `/Rotate` the displayed frame is the unrotated user space; on a rotated page the
/// writer counter-rotates the run so it lines up with the displayed content. A run is typically a
/// word; it may be a whole line where per-word boxes are unavailable.
#[derive(Debug, Clone, PartialEq)]
pub struct TextRun {
    pub text: String,
    /// Four corners of the run's quad, in the displayed bottom-left frame. Placement uses the
    /// axis-aligned bounds; a rotated quad is placed upright within its bounds (skew is not yet
    /// honored).
    pub quad: [(f32, f32); 4],
}

/// The recognized runs for one page, addressed by zero-based page index.
#[derive(Debug, Clone, PartialEq)]
pub struct PageTextLayer {
    pub page_index: usize,
    pub runs: Vec<TextRun>,
}

/// Write an invisible text layer over the named pages of `input` and return the new PDF.
///
/// Additive and deterministic: every existing byte is preserved, one font (Type0 /
/// Identity-H, non-embedded, with a `ToUnicode` CMap) is shared across the document, and
/// the same inputs produce byte-identical output. A page named with no runs, or a
/// `page_index` past the end of the document, is skipped rather than erroring — the
/// caller's OCR result decides which pages carry a layer.
pub fn write_searchable_text_layer(
    input: Vec<u8>,
    pages: &[PageTextLayer],
) -> Result<Vec<u8>, PdfError> {
    guard_input(&input, &GuardLimits::default()).map_err(|_| PdfError::Rejected)?;
    let mut doc = Document::load_mem(&input).map_err(|_| PdfError::Parse)?;
    if crate::guard::is_locked(&doc) {
        return Err(PdfError::Encrypted);
    }

    // One code per distinct character across the whole document, so one shared ToUnicode
    // CMap covers the whole layer. Sorted, so the CMap and the codes are deterministic.
    let codes = assign_character_codes(pages);

    // Nothing to write: no run carried any text. Return the input unchanged rather than
    // rewrite it, so a no-op stays a no-op down to the byte.
    if codes.is_empty() {
        return Ok(input);
    }

    let font_id = add_font(&mut doc, &codes);

    // get_pages is 1-based and in reading order; page_index is 0-based. Resolve the target
    // pages up front so the font's resource name can be chosen free of every one of them.
    let page_ids: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();
    let targets: Vec<(usize, lopdf::ObjectId)> = pages
        .iter()
        .enumerate()
        .filter_map(|(index, page)| {
            page_ids
                .iter()
                .find(|(number, _)| *number as usize == page.page_index + 1)
                .map(|(_, id)| (index, *id))
        })
        .collect();
    let font_name = free_font_name(&doc, targets.iter().map(|(_, id)| *id));

    for (index, page_id) in targets {
        let geometry = PageGeometry::resolve(&doc, page_id);
        let content = page_content(&pages[index].runs, &codes, &font_name, &geometry);
        if content.is_empty() {
            continue;
        }
        merge_font_resource(&mut doc, page_id, font_id, &font_name);
        append_content(&mut doc, page_id, content);
    }

    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).map_err(|_| PdfError::Render)?;
    Ok(bytes)
}

/// A target page's placement geometry: its normalized `/Rotate` and unrotated MediaBox, resolved
/// once per page so every run on it counter-rotates into the same displayed frame.
struct PageGeometry {
    rotation: i64,
    llx: f32,
    lly: f32,
    width: f32,
    height: f32,
}

impl PageGeometry {
    /// Resolve from the page dictionary. A page with no resolvable MediaBox falls back to a
    /// zero-origin, zero-size, unrotated frame — which reduces the placement matrix to the plain
    /// translation the unrotated path already used, so a missing box never makes placement worse.
    fn resolve(doc: &Document, page_id: lopdf::ObjectId) -> Self {
        let (llx, lly, width, height) = match crate::surgery::resolve_mediabox(doc, page_id) {
            Some([llx, lly, urx, ury]) => (llx, lly, urx - llx, ury - lly),
            None => (0.0, 0.0, 0.0, 0.0),
        };
        let rotation = crate::surgery::resolve_rotate(doc, page_id).rem_euclid(360);
        Self {
            rotation,
            llx,
            lly,
            width,
            height,
        }
    }
}

/// The content stream for one page's runs: each run an invisible (`3 Tr`) text-showing
/// operator placed and scaled to its box. Empty when no run is placeable.
fn page_content(
    runs: &[TextRun],
    codes: &BTreeMap<char, u16>,
    font_name: &[u8],
    geometry: &PageGeometry,
) -> Vec<u8> {
    let mut out = String::new();
    for run in runs {
        if let Some(op) = run_operator(run, codes, font_name, geometry) {
            out.push_str(&op);
        }
    }
    out.into_bytes()
}

/// One run's operators, or `None` when the run is degenerate (no text, or a box with no
/// height or width to place it in).
fn run_operator(
    run: &TextRun,
    codes: &BTreeMap<char, u16>,
    font_name: &[u8],
    geometry: &PageGeometry,
) -> Option<String> {
    if run.text.is_empty() {
        return None;
    }
    let (x_min, y_min, x_max, y_max) = bounds(&run.quad);
    let height = y_max - y_min;
    let width = x_max - x_min;
    // A box with no height or width places nothing; a non-finite box (a NaN/inf corner)
    // is refused rather than turned into a nonsense matrix.
    if !height.is_finite() || !width.is_finite() || height <= 0.0 || width <= 0.0 {
        return None;
    }
    // One two-byte code per character, from the shared assignment. `assign_character_codes`
    // gave every character a code, so a miss only means the >65535-distinct-character cap
    // was hit; that character is dropped rather than mis-encoded.
    let glyphs: Vec<u16> = run
        .text
        .chars()
        .filter_map(|c| codes.get(&c).copied())
        .collect();
    if glyphs.is_empty() {
        return None;
    }
    // The run's nominal advance is one em per character at this font size; scale it
    // horizontally so the placed run spans exactly its recognized box width. That is what
    // makes a selection highlight land on the word rather than drift off it.
    let font_size = height;
    let nominal = glyphs.len() as f32 * font_size;
    let horizontal_scale = 100.0 * width / nominal;

    let hex: String = glyphs.iter().map(|code| format!("{code:04X}")).collect();

    // The run's box is in the *displayed* bottom-left frame (the OCR reads the rendered,
    // rotation-applied page), so `(x_min, y_min)` is the displayed origin. `text_matrix` maps
    // that origin to a text matrix whose linear part counter-rotates the glyphs to read upright
    // on the displayed page and whose translation lands them in unrotated user space, where the
    // content is drawn. On an unrotated page the linear part is the identity and this reduces to
    // a translation to `(llx + x_min, lly + y_min)`.
    let [a, b, c, d, e, f] = crate::surgery::text_matrix(
        geometry.rotation,
        geometry.llx,
        geometry.lly,
        geometry.width,
        geometry.height,
        x_min,
        y_min,
    );

    // 3 Tr = render mode "neither fill nor stroke": the text is present and extractable but
    // never painted. Size comes from `Tf` and the width fit from `Tz` alone — putting the font
    // size on the matrix diagonal too would scale the run a second time (the glyphs would extract
    // at a box many times larger than the recognized one, throwing off selection and any
    // position-based redaction), so the matrix carries only rotation and position, never size.
    // `font_name` is ASCII by construction (the constant plus a decimal suffix), so it is valid
    // UTF-8 and a valid PDF resource name.
    Some(format!(
        "q BT 3 Tr /{name} {size:.4} Tf {scale:.4} Tz {a:.4} {b:.4} {c:.4} {d:.4} {e:.4} {f:.4} Tm <{hex}> Tj ET Q\n",
        name = String::from_utf8_lossy(font_name),
        size = font_size,
        scale = horizontal_scale,
    ))
}

/// Axis-aligned bounds `(x_min, y_min, x_max, y_max)` of a quad.
fn bounds(quad: &[(f32, f32); 4]) -> (f32, f32, f32, f32) {
    let xs = quad.map(|p| p.0);
    let ys = quad.map(|p| p.1);
    (
        xs.iter().copied().fold(f32::INFINITY, f32::min),
        ys.iter().copied().fold(f32::INFINITY, f32::min),
        xs.iter().copied().fold(f32::NEG_INFINITY, f32::max),
        ys.iter().copied().fold(f32::NEG_INFINITY, f32::max),
    )
}

/// Add the shared Type0 font (with its descendant CIDFont, descriptor, and ToUnicode
/// CMap) once per document and return the Type0 font's id. Non-embedded: the glyph
/// program is never used because the text is invisible; extraction rides the ToUnicode
/// CMap and selection geometry rides the widths and text matrix.
fn add_font(doc: &mut Document, codes: &BTreeMap<char, u16>) -> lopdf::ObjectId {
    let to_unicode_id = doc.add_object(Object::Stream(Stream::new(
        dictionary! {},
        to_unicode_cmap(codes).into_bytes(),
    )));

    let descriptor_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"FontDescriptor".to_vec()),
        "FontName" => Object::Name(b"MagnaCartaOcr".to_vec()),
        // Symbolic: the font uses its own character set rather than a standard encoding.
        "Flags" => Object::Integer(4),
        "FontBBox" => Object::Array(vec![0.into(), 0.into(), 1000.into(), 1000.into()]),
        "ItalicAngle" => Object::Integer(0),
        "Ascent" => Object::Integer(1000),
        "Descent" => Object::Integer(0),
        "CapHeight" => Object::Integer(1000),
        "StemV" => Object::Integer(0),
    });

    let cid_font_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Font".to_vec()),
        "Subtype" => Object::Name(b"CIDFontType2".to_vec()),
        "BaseFont" => Object::Name(b"MagnaCartaOcr".to_vec()),
        "CIDSystemInfo" => dictionary! {
            "Registry" => Object::string_literal("Adobe"),
            "Ordering" => Object::string_literal("Identity"),
            "Supplement" => Object::Integer(0),
        },
        "FontDescriptor" => Object::Reference(descriptor_id),
        "CIDToGIDMap" => Object::Name(b"Identity".to_vec()),
        "DW" => Object::Integer(DEFAULT_WIDTH),
    });

    doc.add_object(dictionary! {
        "Type" => Object::Name(b"Font".to_vec()),
        "Subtype" => Object::Name(b"Type0".to_vec()),
        "BaseFont" => Object::Name(b"MagnaCartaOcr".to_vec()),
        // Identity-H: the two-byte codes in the text string are used directly as CIDs (each
        // is a character's assigned code); the ToUnicode CMap maps them back to text.
        "Encoding" => Object::Name(b"Identity-H".to_vec()),
        "DescendantFonts" => Object::Array(vec![Object::Reference(cid_font_id)]),
        "ToUnicode" => Object::Reference(to_unicode_id),
    })
}

/// Build a `ToUnicode` CMap mapping each assigned two-byte code to its character's UTF-16BE
/// encoding — two bytes for a BMP character, four (a surrogate pair) for a non-BMP one, so
/// an extractor recovers the whole scalar rather than a broken half. Entries are emitted in
/// sorted code order and chunked into blocks of 100 (the CMap `bfchar` block limit), so the
/// output is deterministic.
fn to_unicode_cmap(codes: &BTreeMap<char, u16>) -> String {
    let mut cmap = String::from(
        "/CIDInit /ProcSet findresource begin\n\
         12 dict begin\n\
         begincmap\n\
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /Adobe-Identity-UCS def\n\
         /CMapType 2 def\n\
         1 begincodespacerange\n\
         <0000> <ffff>\n\
         endcodespacerange\n",
    );
    // Emit in code order (the codes were assigned in sorted-character order, so this is
    // deterministic and stable).
    let mut entries: Vec<(u16, char)> = codes.iter().map(|(c, code)| (*code, *c)).collect();
    entries.sort_unstable_by_key(|(code, _)| *code);
    for chunk in entries.chunks(100) {
        cmap.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for (code, character) in chunk {
            let mut destination = String::new();
            let mut buffer = [0u16; 2];
            for unit in character.encode_utf16(&mut buffer) {
                destination.push_str(&format!("{unit:04X}"));
            }
            cmap.push_str(&format!("<{code:04X}> <{destination}>\n"));
        }
        cmap.push_str("endbfchar\n");
    }
    cmap.push_str(
        "endcmap\n\
         CMapName currentdict /CMap defineresource pop\n\
         end\n\
         end\n",
    );
    cmap
}

/// Register the shared font under `font_name` in the page's `/Font` resources, preserving
/// every resource the page already has (inherited or not) — the same non-destructive merge
/// Bates stamping performs. `font_name` is chosen by [`free_font_name`] to be free on every
/// target page, so this never overwrites a font the page already carries.
fn merge_font_resource(
    doc: &mut Document,
    page_id: lopdf::ObjectId,
    font_id: lopdf::ObjectId,
    font_name: &[u8],
) {
    let existing_resources: lopdf::Dictionary =
        crate::surgery::resolve_inherited_resources(doc, page_id)
            .cloned()
            .unwrap_or_default();
    let mut font_dict: lopdf::Dictionary = match existing_resources.get(b"Font") {
        Ok(font_obj) => crate::surgery::resolve_dict(doc, font_obj)
            .cloned()
            .unwrap_or_default(),
        Err(_) => lopdf::Dictionary::new(),
    };
    font_dict.set(font_name.to_vec(), Object::Reference(font_id));
    let mut merged = existing_resources;
    merged.set(b"Font", Object::Dictionary(font_dict));
    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
        page_dict.set(b"Resources", Object::Dictionary(merged));
    }
}

/// Choose a `/Font` resource name that is free on every target page. Prefers
/// [`FONT_RESOURCE_NAME`]; if any target page already carries a font under that exact name,
/// suffixes it with the smallest integer that is free on all of them. So the layer's font
/// is added without ever replacing a font the page's own content refers to.
fn free_font_name(doc: &Document, page_ids: impl Iterator<Item = lopdf::ObjectId>) -> Vec<u8> {
    let mut taken: BTreeSet<Vec<u8>> = BTreeSet::new();
    for page_id in page_ids {
        if let Some(resources) = crate::surgery::resolve_inherited_resources(doc, page_id) {
            if let Ok(font_obj) = resources.get(b"Font") {
                if let Some(fonts) = crate::surgery::resolve_dict(doc, font_obj) {
                    for (key, _) in fonts.iter() {
                        taken.insert(key.to_vec());
                    }
                }
            }
        }
    }
    if !taken.contains(FONT_RESOURCE_NAME) {
        return FONT_RESOURCE_NAME.to_vec();
    }
    let base = String::from_utf8_lossy(FONT_RESOURCE_NAME);
    for suffix in 0u32.. {
        let candidate = format!("{base}{suffix}").into_bytes();
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!("the set of taken names is finite")
}

/// Append `content` as a new content stream drawn last, handling all three `/Contents`
/// shapes (single reference, array, or absent). Mirrors `bates::stamp_page`'s append so
/// the layer never rewrites an existing stream — untouched bytes stay byte-identical.
fn append_content(doc: &mut Document, page_id: lopdf::ObjectId, content: Vec<u8>) {
    let stream_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, content)));
    let contents = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|dict| dict.get(b"Contents").ok().cloned());
    match contents {
        Some(Object::Reference(old_id)) => {
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(
                    b"Contents",
                    Object::Array(vec![
                        Object::Reference(old_id),
                        Object::Reference(stream_id),
                    ]),
                );
            }
        }
        Some(Object::Array(mut arr)) => {
            arr.push(Object::Reference(stream_id));
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Contents", Object::Array(arr));
            }
        }
        _ => {
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Contents", Object::Reference(stream_id));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal, valid single-page US-Letter PDF, built so it round-trips through both
    /// the lopdf writer and the hayro reader the assertions use.
    fn blank() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Pages".to_vec()),
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let page_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
            "Contents" => Object::Reference(content_id),
            "Resources" => Object::Dictionary(dictionary! { "Font" => Object::Dictionary(dictionary! {}) }),
        });
        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages_dict.set("Count", Object::Integer(1));
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize blank pdf");
        bytes
    }

    /// A one-page PDF with the given unrotated MediaBox and `/Rotate`, so a test can exercise
    /// placement on a rotated page.
    fn blank_rotated(width: i64, height: i64, rotation: i64) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Pages".to_vec()),
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let page_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![0.into(), 0.into(), width.into(), height.into()]),
            "Rotate" => Object::Integer(rotation),
            "Contents" => Object::Reference(content_id),
            "Resources" => Object::Dictionary(dictionary! { "Font" => Object::Dictionary(dictionary! {}) }),
        });
        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages_dict.set("Count", Object::Integer(1));
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize rotated pdf");
        bytes
    }

    fn run(text: &str, x_min: f32, y_min: f32, x_max: f32, y_max: f32) -> TextRun {
        TextRun {
            text: text.to_string(),
            quad: [
                (x_min, y_min),
                (x_max, y_min),
                (x_max, y_max),
                (x_min, y_max),
            ],
        }
    }

    /// An unrotated US-Letter geometry, matching `blank()`'s MediaBox — the frame the direct
    /// `run_operator` tests place into.
    fn unrotated_letter() -> PageGeometry {
        PageGeometry {
            rotation: 0,
            llx: 0.0,
            lly: 0.0,
            width: 612.0,
            height: 792.0,
        }
    }

    #[test]
    fn the_written_text_is_extractable_but_invisible() {
        let out = write_searchable_text_layer(
            blank(),
            &[PageTextLayer {
                page_index: 0,
                runs: vec![run("INVOICE", 72.0, 700.0, 200.0, 720.0)],
            }],
        )
        .unwrap();

        let document = crate::Document::load(out).unwrap();
        // Extractable: the recognized text round-trips through the ToUnicode CMap, which is
        // also what lets redaction find and remove it later.
        let glyphs = document.page_text_glyphs(0).unwrap();
        let extracted: String = glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            extracted.contains("INVOICE"),
            "expected the layer's text to be extractable, got {extracted:?}"
        );
        // Invisible: a human eye sees nothing new, so the OCR skip-gate still reads the page
        // as a scan rather than a text page.
        let visible = document.page_visible_text_coverage(0).unwrap();
        assert!(
            visible < 0.001,
            "the layer must add no visible ink, got coverage {visible}"
        );
    }

    #[test]
    fn the_layer_is_placed_at_the_recognized_box_not_grossly_oversized() {
        // The invisible run must occupy roughly its recognized box, so selection highlights
        // and position-based redaction land on it. Regression guard for the double-scale bug
        // (font size on both Tf and the text-matrix diagonal), which rendered the run about
        // an order of magnitude larger than its box.
        let out = write_searchable_text_layer(
            blank(),
            &[PageTextLayer {
                page_index: 0,
                runs: vec![run("Hello", 100.0, 100.0, 260.0, 120.0)],
            }],
        )
        .unwrap();
        let doc = crate::Document::load(out).unwrap();
        let glyphs = doc.page_text_glyphs(0).unwrap();
        assert!(!glyphs.is_empty(), "the run must be extractable");
        let mut x0 = f32::INFINITY;
        let mut y0 = f32::INFINITY;
        let mut x1 = f32::NEG_INFINITY;
        let mut y1 = f32::NEG_INFINITY;
        for glyph in &glyphs {
            x0 = x0.min(glyph.rect.x0.min(glyph.rect.x1));
            y0 = y0.min(glyph.rect.y0.min(glyph.rect.y1));
            x1 = x1.max(glyph.rect.x0.max(glyph.rect.x1));
            y1 = y1.max(glyph.rect.y0.max(glyph.rect.y1));
        }
        let (width, height) = (x1 - x0, y1 - y0);
        // Box is 160 x 20. Allow a generous font-metric margin, but nothing near the ~10x
        // blow-up the bug produced.
        assert!(
            height < 40.0,
            "height must be near the 20pt box, got {height}"
        );
        assert!(
            width < 320.0,
            "width must be near the 160pt box, got {width}"
        );
        assert!(
            x0 > 60.0 && x1 < 300.0,
            "x range must sit around the box, got [{x0},{x1}]"
        );
        assert!(
            y0 > 80.0 && y1 < 145.0,
            "y range must sit around the box, got [{y0},{y1}]"
        );
    }

    /// Centroid of the rendered glyphs on page 0, in hayro's render frame (rotation applied) — the
    /// same raw observation `bates.rs`'s rotation test trusts, so it reflects where the invisible
    /// layer actually renders on the displayed page.
    fn rendered_centroid(out: Vec<u8>) -> (f64, f64) {
        use hayro::hayro_syntax::Pdf;
        let pdf = Pdf::new(out).expect("load written pdf");
        let obs = crate::textpos::observe_page(&pdf, 0).expect("observe page");
        let centers: Vec<kurbo::Point> = obs
            .glyphs
            .iter()
            .filter(|g| !g.text.is_empty())
            .map(|g| g.bbox.center())
            .collect();
        assert!(!centers.is_empty(), "the run must render glyphs");
        let n = centers.len() as f64;
        (
            centers.iter().map(|p| p.x).sum::<f64>() / n,
            centers.iter().map(|p| p.y).sum::<f64>() / n,
        )
    }

    #[test]
    fn rotation_does_not_move_the_layer_off_the_displayed_content() {
        // The OCR engine reads the displayed (rotation-applied) page, so a run's box is in the
        // displayed frame. On a rotated page the writer must counter-rotate the run into user space
        // (where content is drawn) so that, once the viewer re-applies /Rotate, the invisible layer
        // renders on the same displayed spot as it would on an unrotated page — otherwise selection
        // and position-based redaction miss the visible glyphs.
        //
        // The invariant: the SAME displayed box on an unrotated page and on a rotated page of the
        // SAME displayed dimensions must RENDER at the same place. This checks the rendered position
        // (as `bates.rs` does), not a readback frame. A correct counter-rotation makes the rendered
        // centroids agree; the old /Rotate-ignoring placement drove them apart (the rotated layer
        // rendered off the displayed content entirely).
        //
        // Displayed frame 300 wide x 200 high, run "Hi" at displayed box [50,20,90,40].
        let placed = |input: Vec<u8>| {
            rendered_centroid(
                write_searchable_text_layer(
                    input,
                    &[PageTextLayer {
                        page_index: 0,
                        runs: vec![run("Hi", 50.0, 20.0, 90.0, 40.0)],
                    }],
                )
                .unwrap(),
            )
        };
        // Unrotated page whose MediaBox already is the displayed frame.
        let flat = placed(blank_rotated(300, 200, 0));
        // Quarter-turn pages whose unrotated MediaBox, once /Rotate is applied, displays as 300x200.
        for (rotation, w, h) in [(90, 200, 300), (270, 200, 300)] {
            let rotated = placed(blank_rotated(w, h, rotation));
            assert!(
                (rotated.0 - flat.0).abs() < 3.0 && (rotated.1 - flat.1).abs() < 3.0,
                "r={rotation}: layer must render where the unrotated layer does; \
                 flat={flat:?} rotated={rotated:?}"
            );
        }
    }

    #[test]
    fn a_page_with_no_runs_is_returned_unchanged() {
        let input = blank();
        let out = write_searchable_text_layer(
            input.clone(),
            &[PageTextLayer {
                page_index: 0,
                runs: vec![],
            }],
        )
        .unwrap();
        assert_eq!(out, input, "a no-op must not rewrite a single byte");
    }

    #[test]
    fn an_empty_run_list_is_a_no_op() {
        let input = blank();
        assert_eq!(
            write_searchable_text_layer(input.clone(), &[]).unwrap(),
            input
        );
    }

    #[test]
    fn the_same_inputs_produce_byte_identical_output() {
        let pages = [PageTextLayer {
            page_index: 0,
            runs: vec![run("Hello", 72.0, 700.0, 160.0, 720.0)],
        }];
        let first = write_searchable_text_layer(blank(), &pages).unwrap();
        let second = write_searchable_text_layer(blank(), &pages).unwrap();
        assert_eq!(first, second, "the writer must be deterministic");
    }

    #[test]
    fn non_latin_text_round_trips() {
        // Greek and CJK (BMP) each get a code whose ToUnicode destination recovers them.
        // This is the coverage a Latin-only standard-14 layer would silently drop.
        let out = write_searchable_text_layer(
            blank(),
            &[PageTextLayer {
                page_index: 0,
                runs: vec![run("Ελλάδα 中文", 72.0, 700.0, 260.0, 720.0)],
            }],
        )
        .unwrap();
        let document = crate::Document::load(out).unwrap();
        let extracted: String = document
            .page_text_glyphs(0)
            .unwrap()
            .iter()
            .map(|g| g.text.as_str())
            .collect();
        assert!(
            extracted.contains('中') && extracted.contains('Ε'),
            "expected CJK and Greek to round-trip, got {extracted:?}"
        );
    }

    #[test]
    fn oversize_input_is_rejected() {
        let mut bytes = blank();
        bytes.resize(300 * 1024 * 1024, b' ');
        assert_eq!(
            write_searchable_text_layer(bytes, &[]).unwrap_err(),
            PdfError::Rejected
        );
    }

    #[test]
    fn an_existing_font_of_the_same_name_is_not_clobbered() {
        // A page that already carries a font literally named /MagnaCartaOcr. The layer must
        // register under a different name, leaving that font's reference intact — otherwise
        // the page's own visible text, drawn with that font, would break.
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Pages".to_vec()),
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let existing_font_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Font".to_vec()),
            "Subtype" => Object::Name(b"Type1".to_vec()),
            "BaseFont" => Object::Name(b"Helvetica".to_vec()),
        });
        let page_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
            "Contents" => Object::Reference(content_id),
            "Resources" => Object::Dictionary(dictionary! {
                "Font" => Object::Dictionary(dictionary! {
                    "MagnaCartaOcr" => Object::Reference(existing_font_id),
                }),
            }),
        });
        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages_dict.set("Count", Object::Integer(1));
        }
        let mut input = Vec::new();
        doc.save_to(&mut input).unwrap();

        let out = write_searchable_text_layer(
            input,
            &[PageTextLayer {
                page_index: 0,
                runs: vec![run("SCAN", 72.0, 700.0, 160.0, 720.0)],
            }],
        )
        .unwrap();

        // The page's /Font still maps /MagnaCartaOcr to the original font, and our layer's
        // font was added under a different, suffixed name.
        let reloaded = Document::load_mem(&out).unwrap();
        let page = reloaded.get_pages().into_values().next().unwrap();
        let resources = reloaded
            .get_dictionary(page)
            .unwrap()
            .get(b"Resources")
            .unwrap();
        let fonts = resources
            .as_dict()
            .unwrap()
            .get(b"Font")
            .unwrap()
            .as_dict()
            .unwrap();
        assert_eq!(
            fonts.get(b"MagnaCartaOcr").unwrap().as_reference().unwrap(),
            existing_font_id,
            "the page's own /MagnaCartaOcr font must be untouched"
        );
        assert!(
            fonts.get(b"MagnaCartaOcr0").is_ok(),
            "the layer's font must be registered under a suffixed name"
        );
    }

    #[test]
    fn a_run_gets_an_invisible_operator_and_a_degenerate_run_does_not() {
        let word = run("word", 0.0, 0.0, 50.0, 10.0);
        let codes = assign_character_codes(&[PageTextLayer {
            page_index: 0,
            runs: vec![word.clone()],
        }]);
        let geometry = unrotated_letter();
        assert!(run_operator(&word, &codes, FONT_RESOURCE_NAME, &geometry)
            .unwrap()
            .contains("3 Tr"));
        // No height, no width, no text: nothing to place.
        assert!(run_operator(
            &run("word", 0.0, 0.0, 50.0, 0.0),
            &codes,
            FONT_RESOURCE_NAME,
            &geometry
        )
        .is_none());
        assert!(run_operator(
            &run("", 0.0, 0.0, 50.0, 10.0),
            &codes,
            FONT_RESOURCE_NAME,
            &geometry
        )
        .is_none());
    }

    #[test]
    fn a_non_bmp_character_round_trips_instead_of_vanishing() {
        // An astral scalar (here a CJK Extension-B ideograph, the kind that turns up in a
        // Chinese or Japanese proper name) is a surrogate pair in UTF-16. Encoding it as one
        // code with a four-byte ToUnicode destination recovers the whole character; the
        // earlier one-identity-entry-per-code-unit scheme dropped it silently, which would
        // also have hidden it from redaction.
        let text = "A\u{20000}B";
        let out = write_searchable_text_layer(
            blank(),
            &[PageTextLayer {
                page_index: 0,
                runs: vec![run(text, 72.0, 700.0, 200.0, 720.0)],
            }],
        )
        .unwrap();
        let document = crate::Document::load(out).unwrap();
        let extracted: String = document
            .page_text_glyphs(0)
            .unwrap()
            .iter()
            .map(|g| g.text.as_str())
            .collect();
        assert!(
            extracted.contains('\u{20000}'),
            "the non-BMP character must survive extraction, got {extracted:?}"
        );
    }
}
