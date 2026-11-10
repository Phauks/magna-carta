//! Native text-layer extraction: a page's own glyphs, reassembled into reading-order
//! lines, plus the judgement of whether the page still has anything recognition could add.
//!
//! This is the memory-safe half of composite extraction. A born-digital PDF already
//! carries its text; reading it back is strictly better than photographing the page and
//! guessing at the pixels -- it is faster, exact, and it returns the characters the author
//! actually wrote rather than a recognizer's best reading of a picture of them. Recognition
//! is for pages whose words exist only as pixels.
//!
//! Both answers come out of ONE observation pass. They used to be two (`page_visible_text_coverage`
//! and `page_raster_coverage` each interpret the page from scratch), and a caller that wants text
//! as well would have made it three. Interpreting a page is the expensive part; doing it once and
//! answering everything from the result is the whole reason this module holds the pass rather than
//! calling out for each fact.
//!
//! WHAT THIS DOES NOT DO. Reading order is single-column: glyphs are grouped by vertical
//! position and read left to right, so a two-column page interleaves its columns on each
//! line. Every word is still present and every word is still on its own page, which is what
//! a keyword index needs; a layout-aware reading order is a different, larger problem and
//! belongs with the discovery extraction engine when it gets one. Right-to-left and vertical
//! scripts are likewise read in geometric order, not logical order.

use std::cmp::Ordering;

use crate::detect::to_display_rect;
use crate::textpos::{observe_page, PageObservation};
use crate::{Document, PdfError, Rect};

/// The share of a page that must be covered by visible text before its text layer is
/// judged complete enough that recognition would add nothing -- whatever else is on the
/// page. Born-digital body text runs well above this even on a sparse page; a stamp, a
/// page number, or a caption runs an order of magnitude below.
pub const TEXT_LAYER_COVERAGE: f32 = 0.02;

/// The share of a page that must be raster image before the page is treated as a scan --
/// something whose content is pixels, and therefore has words only recognition can reach.
pub const SCANNED_PAGE_RASTER_COVERAGE: f32 = 0.5;

/// How far apart two glyph baselines may sit vertically and still be read as one line, as a
/// multiple of the page's typical glyph height. Glyphs set on one line share a baseline
/// exactly, so the tolerance is there for a baseline that drifts (a scan's recognized words,
/// each placed on its own) and stays well under the whole height or more of line leading.
const LINE_TOLERANCE: f32 = 0.5;

/// The smallest gap that can be a word break, as a multiple of the line's own type height.
/// In 14-point body text, letters inside a word sit about 2 points apart and words about 5;
/// a third of the height falls between the two at any size.
const WORD_GAP_HEIGHT_SHARE: f32 = 0.35;

/// The smallest gap that can be a word break, as a multiple of the line's own median gap.
/// The absolute floor above is not sufficient on its own, because letters are not always set
/// at their natural widths -- see [`word_gap_for`].
const WORD_GAP_MEDIAN_MULTIPLE: f32 = 2.0;

/// Does this page still need recognizing? Presence of a glyph is emphatically not the
/// test, and getting this wrong is expensive in both directions.
///
/// Two glyphs answer "yes, there is text here" while leaving the page's actual content
/// unread: an *invisible* text layer (excluded from the coverage measure, in
/// [`PageTextFacts::text_coverage`]), and a **Bates stamp** -- a dozen real, visible glyphs
/// in the corner of an otherwise scanned page. This product stamps productions itself, so a
/// skip-on-presence rule would silently discard the content of every stamped scanned page
/// it was ever asked to read. That is the failure this function exists to prevent.
///
/// So text is weighed against what it sits on. A page that is mostly raster and carries
/// only a sprinkling of text is a scan someone wrote on -- recognize it. A page drawn as
/// text and vectors is born-digital: whatever text it has is already better than anything
/// recognition could produce from a picture of it, so leave it alone even where there is
/// little of it. And a page dense with text needs nothing from us regardless of what is
/// underneath.
///
/// Where the signals are ambiguous the tie goes to recognizing: recognizing a page that
/// already had text costs some duplicate lines a caller can see and drop, while skipping a
/// page that did not costs the page, silently.
pub fn needs_recognition(text_coverage: f32, raster_coverage: f32) -> bool {
    if text_coverage >= TEXT_LAYER_COVERAGE {
        return false;
    }
    let is_scan = raster_coverage >= SCANNED_PAGE_RASTER_COVERAGE;
    // Sparse text on a page that is not a scan: born-digital and simply sparse. Nothing to
    // recognize -- there is no picture of words here, only words.
    if !is_scan && text_coverage > 0.0 {
        return false;
    }
    true
}

/// One reconstructed line of a page's own text layer, with the box it occupies in the
/// page's displayed bottom-left frame -- the same frame [`Document::page_text_glyphs`]
/// reports and the recognition engine reads, so a native line and a recognized line are
/// directly comparable.
#[derive(Debug, Clone)]
pub struct TextLayerLine {
    pub text: String,
    pub rect: Rect,
}

/// Everything one observation of a page can say about its text: what the text layer holds,
/// how much of the page is text and how much is picture, and whether recognition still has
/// work to do here.
#[derive(Debug, Clone)]
pub struct PageTextFacts {
    /// Zero-based, as the recognition engine reports it.
    pub page_index: usize,
    /// The page's own text, in reading order. Empty for a page whose words are only pixels.
    pub lines: Vec<TextLayerLine>,
    /// The share of the page covered by text a human eye can actually see. Invisible text
    /// is excluded deliberately: an invisible layer must not persuade the gate that a
    /// scanned page has already been read, and the previous run's own recognition layer is
    /// invisible by construction.
    pub text_coverage: f32,
    /// The share of the page covered by raster images -- what tells a scan from a drawing.
    pub raster_coverage: f32,
    /// [`needs_recognition`] over the two coverages above.
    pub needs_recognition: bool,
}

struct PositionedGlyph {
    text: String,
    rect: Rect,
    order: usize,
    /// Where the glyph's advance starts and ends, when the font declares one.
    advance_span: Option<(f32, f32)>,
    /// The y of the baseline the glyph was set on, in the displayed frame.
    baseline: f32,
}

/// The horizontal distance from the end of `previous` to the start of `next`.
///
/// Measured between ADVANCES when both glyphs have one: that is the distance the document
/// itself left between them, zero inside a word and a space wide between words. The inked
/// boxes are the fallback, and a worse one, because every glyph's box is narrower than its
/// advance by its side bearings and the bearings differ per glyph. Two digits "1" set solid
/// sit further apart, box to box, than the words of a tightly set line, so a box-only
/// measure reads "2011" as "201 1" and a search for the year no longer finds the page.
fn gap_between(previous: &PositionedGlyph, next: &PositionedGlyph) -> f32 {
    match (previous.advance_span, next.advance_span) {
        (Some((_, previous_end)), Some((next_start, _))) => next_start - previous_end,
        _ => next.rect.x0 - previous.rect.x1,
    }
}

/// How much of a page is text a reader can see, and how much of it is picture. One home for
/// the two measurements, so the gate that routes a page and the reports that describe it can
/// never be computed differently.
pub(crate) struct PageCoverages {
    pub text: f32,
    pub raster: f32,
}

fn share(area: f64, page_area: f64) -> f32 {
    if page_area <= 0.0 {
        return 0.0;
    }
    // Boxes may overlap, so the sum is clamped rather than pretending to be an exact union.
    ((area / page_area) as f32).clamp(0.0, 1.0)
}

pub(crate) fn coverages(observation: &PageObservation) -> PageCoverages {
    let page_area = (observation.width_pt as f64) * (observation.height_pt as f64);
    // Invisible glyphs are excluded here and only here: hidden-but-extractable text is real
    // text to an extractor and no text at all to a reader, and this measures the reader's view.
    let ink: f64 = observation
        .glyphs
        .iter()
        .filter(|glyph| !glyph.invisible && !crate::redact::is_whitespace_glyph(&glyph.text))
        .map(|glyph| glyph.bbox.width().abs() * glyph.bbox.height().abs())
        .sum();
    // Vector fills are not counted -- only image XObjects, the thing a scanner produces.
    let raster: f64 = observation
        .covers
        .iter()
        .filter(|cover| cover.is_image)
        .map(|cover| cover.bbox.width().abs() * cover.bbox.height().abs())
        .sum();
    PageCoverages {
        text: share(ink, page_area),
        raster: share(raster, page_area),
    }
}

/// The page's typical glyph height, used to scale both the line tolerance and the word gap
/// so the reconstruction works the same on 8-point boilerplate and a 48-point cover page.
/// The median rather than the mean: one oversized drop-cap or a full-page watermark glyph
/// would drag a mean far enough to merge every line on the page into one.
fn typical_height(glyphs: &[PositionedGlyph]) -> f32 {
    let mut heights: Vec<f32> = glyphs
        .iter()
        .map(|glyph| glyph.rect.y1 - glyph.rect.y0)
        .filter(|height| *height > 0.0)
        .collect();
    if heights.is_empty() {
        // Type3 glyphs observe as a point, and a page of nothing but those has no height to
        // measure. One point keeps the tolerances positive and finite rather than collapsing
        // every glyph onto its own line.
        return 1.0;
    }
    heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    heights[heights.len() / 2]
}

/// Where a glyph sits on its line: the baseline it was set on, which is the y of its own
/// origin and so is the same for every glyph of the line.
///
/// Neither edge of the glyph's inked box will do. A full stop is a tenth the height of the
/// letters around it, so box centres disagree by most of an x-height. Box bottoms agree for
/// letters that stand on the baseline and for nothing else: a hyphen and a quotation mark
/// float above it and a descender hangs below, so a line reading `"2026-03-01 judgment"`
/// came back as three lines, its punctuation on one and the tails of its letters on another.
fn baseline_y(glyph: &PositionedGlyph) -> f32 {
    glyph.baseline
}

/// The gap, in points, at or above which a space belongs between two of this line's glyphs.
///
/// SPACES ARE NOT IN THE DOCUMENT TO BE READ. A space character has no outline, so the
/// interpreter never draws it and the observation never sees it; every space in the returned
/// text is inferred from the distance between the glyphs on either side of where it was.
/// That is not a shortcut, it is the only signal there is.
///
/// A threshold taken from the type height alone is not enough, because a line's letters are
/// not always set at their natural widths. The invisible layer
/// [`crate::write_searchable_text_layer`] writes onto a scan stretches each recognized run to
/// the width of the box it was recognized in, spreading its letters several points apart --
/// wider than the space between words in ordinary body text. A fixed threshold therefore
/// reads this product's own searchable PDFs as one space per letter.
///
/// So the threshold is the larger of two measurements of the same line: a floor from its type
/// height, and twice its own median gap. On body text the median gap is a fraction of the
/// floor and the floor governs; on a stretched line the median rises with the stretch and
/// carries the threshold above the letter gaps with it.
fn word_gap_for(glyphs: &[PositionedGlyph]) -> f32 {
    let height = typical_height(glyphs);
    let mut gaps: Vec<f32> = glyphs
        .windows(2)
        // Negative where glyph boxes overlap -- kerning, or a faux-bold double strike. An
        // overlap is emphatically not a word break, so it contributes zero, not a negative
        // that would drag the median below every real gap.
        .map(|pair| gap_between(&pair[0], &pair[1]).max(0.0))
        .collect();
    let median = if gaps.is_empty() {
        0.0
    } else {
        gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
        gaps[gaps.len() / 2]
    };
    (height * WORD_GAP_HEIGHT_SHARE)
        .max(median * WORD_GAP_MEDIAN_MULTIPLE)
        .max(f32::MIN_POSITIVE)
}

/// Join one line's glyphs into its text, inserting a space wherever the horizontal gap says
/// a space belongs.
fn join_line(glyphs: &[PositionedGlyph], word_gap: f32) -> String {
    let mut text = String::new();
    let mut previous: Option<&PositionedGlyph> = None;
    for glyph in glyphs {
        // A glyph that IS whitespace ends the gap reasoning for that position: the document
        // said there is a space here, which outranks any measurement of one. Rare -- an
        // outline font's space is never drawn -- but a Type3 font's space is a procedure and
        // does reach the observer.
        if crate::redact::is_whitespace_glyph(&glyph.text) {
            if !text.ends_with(' ') && !text.is_empty() {
                text.push(' ');
            }
            previous = Some(glyph);
            continue;
        }
        if let Some(previous) = previous {
            if gap_between(previous, glyph) > word_gap && !text.ends_with(' ') {
                text.push(' ');
            }
        }
        text.push_str(&glyph.text);
        previous = Some(glyph);
    }
    text.trim().to_string()
}

fn union(a: Rect, b: Rect) -> Rect {
    Rect {
        x0: a.x0.min(b.x0),
        y0: a.y0.min(b.y0),
        x1: a.x1.max(b.x1),
        y1: a.y1.max(b.y1),
    }
}

fn reconstruct_lines(observation: &PageObservation) -> Vec<TextLayerLine> {
    // Invisible glyphs are kept, unlike in the coverage measure. An invisible text layer is
    // exactly what `write_searchable_text_layer` puts on a scan after recognition, so
    // dropping invisible glyphs here would make this product's own searchable PDFs read as
    // having no text -- the very bug this module exists to close, reintroduced one layer up.
    let mut glyphs: Vec<PositionedGlyph> = observation
        .glyphs
        .iter()
        // A space has no outline, so its box is empty and sits at the frame's origin
        // rather than on its line: it says nothing about where the line is, and spaces are
        // inferred from the gaps between inked glyphs in any case.
        .filter(|glyph| !glyph.text.trim().is_empty())
        .map(|glyph| PositionedGlyph {
            text: glyph.text.clone(),
            rect: to_display_rect(glyph.bbox, observation.height_pt),
            order: glyph.order,
            baseline: observation.height_pt - glyph.baseline as f32,
            advance_span: glyph
                .advance_span
                .map(|(start, end)| (start as f32, end as f32)),
        })
        .collect();
    if glyphs.is_empty() {
        return Vec::new();
    }

    let height = typical_height(&glyphs);
    let line_tolerance = height * LINE_TOLERANCE;

    // Down the page first (y decreases downward in the displayed frame), then left to right,
    // then paint order so two glyphs stacked at the same spot keep the order the document
    // drew them in rather than an arbitrary one.
    glyphs.sort_by(|a, b| {
        baseline_y(b)
            .partial_cmp(&baseline_y(a))
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.rect.x0.partial_cmp(&b.rect.x0).unwrap_or(Ordering::Equal))
            .then_with(|| a.order.cmp(&b.order))
    });

    let mut lines: Vec<Vec<PositionedGlyph>> = Vec::new();
    let mut anchor = f32::NAN;
    for glyph in glyphs {
        let y = baseline_y(&glyph);
        // Compare against the line's FIRST glyph rather than a running mean: a line of
        // gradually rising superscripts would otherwise walk its own threshold up the page
        // and swallow the line above it.
        if lines.is_empty() || (anchor - y).abs() > line_tolerance {
            anchor = y;
            lines.push(Vec::new());
        }
        if let Some(line) = lines.last_mut() {
            line.push(glyph);
        }
    }

    lines
        .into_iter()
        .filter_map(|mut line| {
            line.sort_by(|a, b| {
                a.rect
                    .x0
                    .partial_cmp(&b.rect.x0)
                    .unwrap_or(Ordering::Equal)
                    .then_with(|| a.order.cmp(&b.order))
            });
            let text = join_line(&line, word_gap_for(&line));
            if text.is_empty() {
                return None;
            }
            let rect = line
                .iter()
                .map(|glyph| glyph.rect)
                .reduce(union)
                .unwrap_or(Rect {
                    x0: 0.0,
                    y0: 0.0,
                    x1: 0.0,
                    y1: 0.0,
                });
            Some(TextLayerLine { text, rect })
        })
        .collect()
}

/// The most pages one text-extraction call will interpret when the caller has no ceiling of
/// its own to give. Page count is declared in the file and wholly attacker-controlled, so the
/// walk has to end somewhere; but the ceiling sits far above any real filing or production,
/// because a document refused here has its words left out of search, and to the person
/// searching that is indistinguishable from the document holding none.
pub const MAX_TEXT_EXTRACTION_PAGES: usize = 50_000;

impl Document {
    /// Read page `index`'s own text layer and measure what the page is made of, in one
    /// observation pass. Returns `PageOutOfRange` if the page cannot be observed -- which a
    /// caller must never treat as "this page has no text layer", because a page we failed to
    /// look at is not a page we looked at and found empty.
    pub fn page_text_facts(&self, index: usize) -> Result<PageTextFacts, PdfError> {
        let observation = observe_page(&self.pdf, index).ok_or(PdfError::PageOutOfRange)?;
        let measured = coverages(&observation);
        Ok(PageTextFacts {
            page_index: index,
            lines: reconstruct_lines(&observation),
            text_coverage: measured.text,
            raster_coverage: measured.raster,
            needs_recognition: needs_recognition(measured.text, measured.raster),
        })
    }

    /// Every page's text facts, in page order. Refuses a document with more than `max_pages`
    /// pages rather than interpreting an unbounded number of them: page count is declared in
    /// the file and wholly attacker-controlled, and each page costs a full interpret.
    pub fn document_text_facts(&self, max_pages: usize) -> Result<Vec<PageTextFacts>, PdfError> {
        if self.page_count() > max_pages {
            return Err(PdfError::Rejected);
        }
        (0..self.page_count())
            .map(|index| self.page_text_facts(index))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(name: &str) -> Document {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        Document::load(std::fs::read(path).expect("fixture")).expect("loads")
    }

    fn page_text(document: &Document, index: usize) -> String {
        document
            .page_text_facts(index)
            .unwrap()
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn a_born_digital_page_reads_back_its_own_words_with_the_spaces_in_them() {
        // The whole point: the characters the author wrote, not a recognizer's reading of a
        // picture of them. Concatenating glyphs would give "Thesellershallindemnify" -- the
        // word gaps are what make this a text extractor rather than a glyph dump.
        let document = load("born_digital.pdf");
        assert_eq!(
            page_text(&document, 0),
            "The seller shall indemnify the buyer\nagainst all environmental liability\narising before the closing date."
        );
        assert_eq!(
            page_text(&document, 1),
            "Schedule B: excluded liabilities\nand the survival period."
        );
    }

    #[test]
    fn lines_come_back_down_the_page_not_in_paint_order() {
        let document = load("born_digital.pdf");
        let facts = document.page_text_facts(0).unwrap();
        let tops: Vec<f32> = facts.lines.iter().map(|line| line.rect.y1).collect();
        assert!(
            tops.windows(2).all(|pair| pair[0] > pair[1]),
            "lines must descend the page: {tops:?}"
        );
    }

    #[test]
    fn a_born_digital_page_needs_no_recognition_even_when_its_text_is_sparse() {
        let document = load("born_digital.pdf");
        for index in 0..document.page_count() {
            let facts = document.page_text_facts(index).unwrap();
            assert!(
                facts.text_coverage < TEXT_LAYER_COVERAGE,
                "this fixture is deliberately sparse, so the gate is tested on its harder branch: {}",
                facts.text_coverage
            );
            assert!(!facts.needs_recognition, "page {index}");
        }
    }

    #[test]
    fn a_scan_yields_no_native_text_and_is_sent_to_recognition() {
        let document = load("scan_only.pdf");
        let facts = document.page_text_facts(0).unwrap();
        assert!(facts.lines.is_empty());
        assert!(facts.raster_coverage > 0.9);
        assert!(facts.needs_recognition);
    }

    #[test]
    fn a_mixed_document_routes_each_page_on_its_own_evidence() {
        // A scan appended to a born-digital contract is the document that proves the routing
        // has to be per page: whole-document routing loses either the contract or the scan.
        let document = load("mixed_text_and_scan.pdf");
        let facts = document.document_text_facts(100).unwrap();
        assert_eq!(facts.len(), 3);

        assert!(!facts[0].needs_recognition);
        assert_eq!(
            facts[0]
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec![
                "This agreement is made between",
                "the parties named in Schedule A."
            ]
        );

        assert!(facts[1].needs_recognition);
        assert!(facts[1].lines.is_empty());

        // Page 2 is a scan carrying a Bates stamp. The stamp is real, extractable text --
        // and it is emphatically not the page's content, so the page still goes to
        // recognition. Both facts are true at once, which is why provenance is per page and
        // not per document.
        assert!(facts[2].needs_recognition);
        assert_eq!(
            facts[2]
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["EXHIBIT 000123"]
        );
    }

    #[test]
    fn an_invisible_text_layer_is_extractable_even_though_it_does_not_count_as_coverage() {
        // What recognition writes back onto a scan is an invisible layer. If extraction
        // skipped invisible glyphs, a document this product had already made searchable
        // would extract to nothing.
        let runs = vec![crate::TextRun {
            text: "INVOICE 4471".to_string(),
            quad: [(72.0, 700.0), (200.0, 700.0), (200.0, 712.0), (72.0, 712.0)],
        }];
        let layered = crate::write_searchable_text_layer(
            std::fs::read(format!(
                "{}/tests/fixtures/scan_only.pdf",
                env!("CARGO_MANIFEST_DIR")
            ))
            .unwrap(),
            &[crate::PageTextLayer {
                page_index: 0,
                runs,
            }],
        )
        .expect("writes a layer");
        let document = Document::load(layered).unwrap();
        let facts = document.page_text_facts(0).unwrap();
        assert_eq!(
            facts
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["INVOICE 4471"]
        );
        // ...and the page still measures as a scan, so a re-run would still recognize it.
        assert!(facts.text_coverage < TEXT_LAYER_COVERAGE);
        assert!(facts.needs_recognition);
    }

    #[test]
    fn a_blank_page_has_no_lines_rather_than_one_empty_one() {
        let document = load("blank.pdf");
        assert!(document.page_text_facts(0).unwrap().lines.is_empty());
    }

    #[test]
    fn a_page_past_the_end_is_out_of_range_not_an_empty_page() {
        assert_eq!(
            load("blank.pdf").page_text_facts(7).err(),
            Some(PdfError::PageOutOfRange)
        );
    }

    #[test]
    fn a_document_far_longer_than_one_hundred_pages_reads_back_every_page() {
        use lopdf::{dictionary, Object, Stream};
        // 250 pages, each carrying its own page number as text: long enough to cross the old
        // one-hundred-page refusal twice over, and every page individually checkable.
        const PAGE_COUNT: usize = 250;
        let mut doc = lopdf::Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let mut kids = Vec::new();
        for number in 1..=PAGE_COUNT {
            let content = format!("BT /F1 24 Tf 72 700 Td (Exhibit page {number}) Tj ET");
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
                "Contents" => content_id,
            });
            kids.push(Object::Reference(page_id));
        }
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => kids, "Count" => PAGE_COUNT as i64,
            }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("save");

        let document = Document::load(bytes).expect("loads");
        let facts = document
            .document_text_facts(MAX_TEXT_EXTRACTION_PAGES)
            .expect("every page is read");
        assert_eq!(facts.len(), PAGE_COUNT);
        for (index, page) in facts.iter().enumerate() {
            assert_eq!(page.page_index, index);
            assert!(!page.needs_recognition);
            let text: Vec<&str> = page.lines.iter().map(|line| line.text.as_str()).collect();
            assert_eq!(text, vec![format!("Exhibit page {}", index + 1)]);
        }
    }

    #[test]
    fn a_document_with_more_pages_than_the_cap_is_refused_before_it_is_interpreted() {
        assert_eq!(
            load("born_digital.pdf").document_text_facts(1).err(),
            Some(PdfError::Rejected)
        );
    }

    #[test]
    fn a_bates_stamp_does_not_make_a_scanned_page_look_like_it_has_a_text_layer() {
        // The trap this gate exists to avoid. A scanned page carrying a Bates stamp is
        // ~100% raster and a fraction of a percent text -- if the presence of the stamp's
        // glyphs counted as a text layer, every stamped page of a scanned production would
        // be skipped and its content lost. This product stamps productions itself.
        assert!(
            needs_recognition(0.001, 1.0),
            "a stamped scan must still be recognized"
        );
        // The same page before it was stamped.
        assert!(needs_recognition(0.0, 1.0));
        // A scan whose text layer is invisible reads as zero *visible* coverage, so it
        // arrives here indistinguishable from an unstamped scan -- and is recognized. That
        // is what lets a result be replaced by a better one later.
        assert!(needs_recognition(0.0, 0.98));
    }

    #[test]
    fn a_born_digital_page_is_left_alone_however_sparse_its_text() {
        // Dense body text: nothing to add.
        assert!(!needs_recognition(0.25, 0.0));
        // A title page with one line on it: still born-digital. Its own text layer beats
        // anything recognition could read off a picture of it, so it is not re-recognized
        // merely for being sparse.
        assert!(!needs_recognition(0.002, 0.0));
        // Text over a small illustration is still a text page.
        assert!(!needs_recognition(0.05, 0.2));
    }

    #[test]
    fn a_page_with_neither_text_nor_raster_is_recognized_rather_than_assumed_empty() {
        // Nothing observed at all. It could be a scan the observer could not see into;
        // the tie goes to looking, since skipping would lose the page silently.
        assert!(needs_recognition(0.0, 0.0));
    }
}
