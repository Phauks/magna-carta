//! The model-tier benchmark: for each corpus document, extract ground truth from the
//! document's own text layer, render and degrade the page the way a scanner would, run
//! recognition, and score the result against the ground truth. One JSON line per
//! document plus a per-tier summary -- the regression baseline every later model
//! upgrade is measured against, and the evidence the tier choice rests on rather than
//! the vendor's marketing numbers.

pub mod degrade;
pub mod score;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use ocr_core::engine::{ModelPaths, PaddleRecognizer};
use ocr_core::Recognizer;
use pdf_core::Document;
use serde::Serialize;

use crate::bench::degrade::degrade;
use crate::bench::score::{character_error_rate, median, reading_order_text, PositionedText};

/// Rasterization density. Matches `RENDER_DPI` in `validate::operations::ocr` -- the
/// floor the production recognition container renders at, so this benchmark exercises
/// the same input scale a real request would.
const RENDER_DPI: f32 = 300.0;

/// A fixed, arbitrary degradation recipe -- mild skew, light sensor noise, and a
/// realistic JPEG quality -- applied identically to every document and every tier.
/// Fixed rather than randomized per run: a tier-to-tier comparison and a later
/// regression check are only meaningful if every run degrades the same page the same
/// way. The values approximate a document scanned slightly askew on a flatbed.
const SKEW_DEGREES: f32 = 1.5;
const NOISE_MAGNITUDE: u8 = 10;
const JPEG_QUALITY: u8 = 75;
const DEGRADE_SEED: u64 = 20260709;

/// One document's measured result for one tier.
#[derive(Debug, Clone, Serialize)]
pub struct DocumentResult {
    pub document: String,
    /// Character error rate between the ground truth and the recognized text, with
    /// both put into the same canonical top-to-bottom, left-to-right reading order
    /// first (see `score::reading_order_text`). This is what makes the number a
    /// recognition-quality measurement: a page whose glyphs paint in a different
    /// order than they read visually no longer inflates the edit distance just for
    /// being reordered.
    pub character_error_rate: f64,
    /// The same character error rate computed the old way: ground truth and
    /// recognized text concatenated in their raw paint/detection order, with no
    /// reading-order normalization. Kept alongside `character_error_rate` so a report
    /// shows how much the normalization changed each document's score, not as a
    /// metric to optimize against.
    pub character_error_rate_raw: f64,
    /// Mean, over every true glyph box, of the largest overlap fraction it has with
    /// any recognized word or line box in the same page-pixel space. 1.0 means every
    /// true glyph sits fully inside some recognized box; 0.0 means recognition found
    /// nothing over the true text at all.
    pub word_box_overlap: f64,
    pub recognized_lines: usize,
    pub undecoded_regions: usize,
    pub recognition_millis: u128,
}

/// A tier's result: identity, cold-start cost, on-disk size, and the per-document
/// measurements. `documents` is what a later run diffs for a regression; the other
/// fields are what the tier trade-off (accuracy vs. image size vs. cold start) is
/// actually weighed against.
#[derive(Debug, Clone, Serialize)]
pub struct TierResult {
    pub tier: String,
    pub model_version: String,
    pub model_load_millis: u128,
    pub total_model_bytes: u64,
    pub documents_scored: usize,
    pub documents_skipped: usize,
    pub mean_character_error_rate: f64,
    pub mean_word_box_overlap: f64,
}

/// Everything one tier needed to run, kept for the JSONL detail report.
pub struct TierRun {
    pub summary: TierResult,
    pub documents: Vec<DocumentResult>,
}

/// Run one tier's model over every PDF in `corpus`. A document whose page 0 has no
/// extractable ground-truth text (e.g. an image-only page) is skipped rather than
/// scored as a perfect zero, which would flatter every tier equally on documents that
/// carry no signal at all. Fails only if the model itself cannot load; a single
/// document's failure is recorded and the run continues.
pub fn run_tier(
    tier_name: &str,
    models: ModelPaths,
    corpus: &[PathBuf],
) -> Result<TierRun, String> {
    let total_model_bytes = file_size(&models.detection_onnx)
        + file_size(&models.recognition_onnx)
        + file_size(&models.recognition_yaml);

    let load_started = Instant::now();
    let recognizer = PaddleRecognizer::load(models)
        .map_err(|e| format!("{tier_name}: model load failed ({})", e.code()))?;
    let model_load_millis = load_started.elapsed().as_millis();
    let model_version = recognizer.provenance().model_version;

    let mut documents = Vec::new();
    let mut skipped = 0usize;
    for path in corpus {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.display().to_string());
        match score_one_document(&recognizer, path, &name) {
            Ok(Some(result)) => documents.push(result),
            Ok(None) => {
                skipped += 1;
                println!("  skip  {name}  (no ground-truth text on page 0)");
            }
            Err(detail) => {
                skipped += 1;
                println!("  error {name}  ({detail})");
            }
        }
    }

    let mean_character_error_rate = mean(documents.iter().map(|d| d.character_error_rate));
    let mean_word_box_overlap = mean(documents.iter().map(|d| d.word_box_overlap));

    Ok(TierRun {
        summary: TierResult {
            tier: tier_name.to_string(),
            model_version,
            model_load_millis,
            total_model_bytes,
            documents_scored: documents.len(),
            documents_skipped: skipped,
            mean_character_error_rate,
            mean_word_box_overlap,
        },
        documents,
    })
}

/// Render page 0, degrade it, recognize it, and score against the page's own text
/// layer. `Ok(None)` means the page carried no ground truth to score against.
fn score_one_document(
    recognizer: &PaddleRecognizer,
    path: &Path,
    name: &str,
) -> Result<Option<DocumentResult>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
    let document = Document::load(bytes).map_err(|e| format!("load: {e:?}"))?;

    let glyphs = document
        .page_text_glyphs(0)
        .map_err(|e| format!("text extraction: {e:?}"))?;
    if glyphs.is_empty() {
        // page_text_glyphs already drops whitespace-only glyphs, so an empty vector
        // means the page carried no visible text at all -- nothing to score against.
        return Ok(None);
    }

    let page_size = document
        .page_size(0)
        .map_err(|e| format!("page_size: {e:?}"))?;
    let rendered = document
        .render_page(0, RENDER_DPI, false)
        .map_err(|e| format!("render: {e:?}"))?;
    let clean = rendered
        .to_rgb_image()
        .ok_or_else(|| "raster conversion failed".to_string())?;
    let scanned = degrade(
        &clean,
        SKEW_DEGREES,
        NOISE_MAGNITUDE,
        JPEG_QUALITY,
        DEGRADE_SEED,
    );

    let recognition_started = Instant::now();
    let recognized = recognizer
        .recognize(&scanned)
        .map_err(|e| format!("recognize: {}", e.code()))?;
    let recognition_millis = recognition_started.elapsed().as_millis();

    // The raw paint/detection-order text, kept only to report how much reading-order
    // normalization changes the score (character_error_rate_raw below).
    let truth_text_raw: String = glyphs.iter().map(|g| g.text.as_str()).collect();
    let recognized_text_raw: String = recognized.lines.iter().map(|l| l.text.as_str()).collect();

    // Reading-order normalization. `TextGlyph::rect` is in redaction Rect space --
    // display points, bottom-left origin, y increasing UPWARD (see
    // `pdf_core::detect::to_display_rect`: y1 is a glyph's top edge and is the larger
    // value, y0 its bottom edge and the smaller value). `reading_order_text` sorts on
    // a y that increases DOWNWARD, so each glyph's vertical center is flipped here via
    // `page_size.height_pt - center_y`. The recognized `Quad.bounds()`, by contrast,
    // is already in the render's pixel space (top-left origin, y increasing downward)
    // -- no flip needed there.
    let truth_tolerance = {
        let heights: Vec<f32> = glyphs.iter().map(|g| g.rect.y1 - g.rect.y0).collect();
        let m = median(&heights);
        if m > 0.0 {
            m
        } else {
            1.0
        }
    };
    let truth_units: Vec<PositionedText> = glyphs
        .iter()
        .map(|g| {
            let center_y_up = (g.rect.y0 + g.rect.y1) / 2.0;
            PositionedText {
                text: g.text.clone(),
                x: g.rect.x0,
                y: page_size.height_pt - center_y_up,
            }
        })
        .collect();
    let truth_text = reading_order_text(&truth_units, truth_tolerance);

    // Each recognized line is already internally left-to-right (the recognizer reads
    // words within a line in order), so it is treated as one reading-order unit
    // positioned at its box's top-left corner -- only the line-to-line order is
    // normalized, never the words within a line.
    let recognized_tolerance = {
        let heights: Vec<f32> = recognized
            .lines
            .iter()
            .map(|l| {
                let (_, y_min, _, y_max) = l.quad.bounds();
                y_max - y_min
            })
            .collect();
        let m = median(&heights);
        if m > 0.0 {
            m
        } else {
            1.0
        }
    };
    let recognized_units: Vec<PositionedText> = recognized
        .lines
        .iter()
        .map(|l| {
            let (x_min, y_min, _, _) = l.quad.bounds();
            PositionedText {
                text: l.text.clone(),
                x: x_min,
                y: y_min,
            }
        })
        .collect();
    let recognized_text = reading_order_text(&recognized_units, recognized_tolerance);

    let character_error_rate = character_error_rate(&truth_text, &recognized_text);
    let character_error_rate_raw =
        crate::bench::score::character_error_rate(&truth_text_raw, &recognized_text_raw);

    // Convert each true glyph's display-point rect (bottom-left origin, matching
    // `page_size`) into the same top-left-origin pixel space `render_page` produces
    // at `RENDER_DPI`, so it is comparable to the recognizer's own pixel-space boxes.
    // This is approximate for a non-zero skew: the degradation step rotates the raster
    // about its center after these truth boxes were computed from the undegraded
    // layout, so a truth box near a page edge can drift a few pixels from where its
    // text actually landed post-rotation. Acceptable for a mild scanner-realistic
    // skew; not exact per-glyph ground truth once skew is non-zero.
    let scale = RENDER_DPI / 72.0;
    let truth_boxes: Vec<(f32, f32, f32, f32)> = glyphs
        .iter()
        .map(|g| {
            let top = (page_size.height_pt - g.rect.y1) * scale;
            let bottom = (page_size.height_pt - g.rect.y0) * scale;
            (g.rect.x0 * scale, top, g.rect.x1 * scale, bottom)
        })
        .collect();
    let recognized_boxes: Vec<(f32, f32, f32, f32)> = recognized
        .lines
        .iter()
        .flat_map(|line| {
            if line.word_quads.is_empty() {
                vec![line.quad.bounds()]
            } else {
                line.word_quads
                    .iter()
                    .map(|q| q.bounds())
                    .collect::<Vec<_>>()
            }
        })
        .collect();
    let word_box_overlap = mean_best_overlap(&truth_boxes, &recognized_boxes);

    Ok(Some(DocumentResult {
        document: name.to_string(),
        character_error_rate,
        character_error_rate_raw,
        word_box_overlap,
        recognized_lines: recognized.lines.len(),
        undecoded_regions: recognized.undecoded_regions,
        recognition_millis,
    }))
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let values: Vec<f64> = values.collect();
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Mean, over every truth box, of its largest overlap fraction with any recognized
/// box. Empty truth (nothing to compare) reports 0.0 rather than dividing by zero.
fn mean_best_overlap(truth: &[(f32, f32, f32, f32)], recognized: &[(f32, f32, f32, f32)]) -> f64 {
    if truth.is_empty() {
        return 0.0;
    }
    let total: f64 = truth
        .iter()
        .map(|t| {
            recognized
                .iter()
                .map(|r| overlap_fraction(*t, *r))
                .fold(0.0_f64, f64::max)
        })
        .sum();
    total / truth.len() as f64
}

/// Fraction of `truth`'s area covered by its intersection with `recognized`.
fn overlap_fraction(truth: (f32, f32, f32, f32), recognized: (f32, f32, f32, f32)) -> f64 {
    let (tx0, ty0, tx1, ty1) = truth;
    let (rx0, ry0, rx1, ry1) = recognized;
    let intersection_width = (tx1.min(rx1) - tx0.max(rx0)).max(0.0);
    let intersection_height = (ty1.min(ry1) - ty0.max(ry0)).max(0.0);
    let intersection_area = (intersection_width * intersection_height) as f64;
    let truth_area = ((tx1 - tx0) * (ty1 - ty0)).max(0.0) as f64;
    if truth_area <= 0.0 {
        return 0.0;
    }
    (intersection_area / truth_area).min(1.0)
}

/// One JSON object per document, across every tier that ran.
pub fn write_jsonl(runs: &[TierRun], path: &Path) -> std::io::Result<()> {
    let mut file = std::fs::File::create(path)?;
    for run in runs {
        for document in &run.documents {
            let line = serde_json::json!({
                "tier": run.summary.tier,
                "document": document.document,
                "character_error_rate": document.character_error_rate,
                "character_error_rate_raw": document.character_error_rate_raw,
                "word_box_overlap": document.word_box_overlap,
                "recognized_lines": document.recognized_lines,
                "undecoded_regions": document.undecoded_regions,
                "recognition_millis": document.recognition_millis,
            });
            writeln!(file, "{line}")?;
        }
    }
    Ok(())
}

/// The three tiers PP-OCRv6 publishes, in ascending size order.
pub const TIER_NAMES: [&str; 3] = ["tiny", "small", "medium"];

/// Build `ModelPaths` for `tier`, looking under `root/<tier>/{detection,recognition}/`
/// -- the layout `containers/ocr`'s build-time fetch also uses.
pub fn model_paths_for(root: &Path, tier: &str) -> ModelPaths {
    let base = root.join(tier);
    ModelPaths {
        detection_onnx: base.join("detection/inference.onnx"),
        recognition_onnx: base.join("recognition/inference.onnx"),
        recognition_yaml: base.join("recognition/inference.yml"),
        model_version: format!("PP-OCRv6_{tier}@benchmark"),
    }
}

/// The born-digital, text-bearing PDFs already committed to the repository that this
/// benchmark manufactures ground truth from. Anchored on `CARGO_MANIFEST_DIR` so the
/// mode works regardless of the process's working directory.
///
/// Every `.pdf` under `corpus-ci/` (see `corpus-ci/SOURCES.md` for what each one is
/// and where it came from) plus this crate's own `tests/fixtures/hello.pdf`, so a
/// future addition to `corpus-ci/` is picked up automatically rather than needing a
/// second edit here. `tests/fixtures/scanned.pdf` is deliberately never added: it is
/// image-only, so `page_text_glyphs` finds nothing on it and it would only ever show
/// up as a skip. `pdf-core`'s own `tests/fixtures/hello.pdf` fixture is byte-identical
/// to this crate's copy and lives outside `corpus-ci/`, so there is no risk of this
/// crate's copy being counted twice.
pub fn default_corpus() -> Vec<PathBuf> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut corpus: Vec<PathBuf> = std::fs::read_dir(manifest_dir.join("corpus-ci"))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|path| path.extension().map(|ext| ext == "pdf").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    corpus.sort();
    corpus.push(manifest_dir.join("tests/fixtures/hello.pdf"));
    corpus.into_iter().filter(|path| path.exists()).collect()
}

/// `ocr-benchmark` CLI mode. Reads `MAGNA_CARTA_OCR_TIERS` for the directory holding
/// `{tiny,small,medium}/{detection,recognition}/inference.{onnx,yml}`; runs whichever
/// of the three tier subdirectories are actually present (a machine that cannot fetch
/// or run all three still produces a partial, honest result rather than failing
/// outright), writes a JSONL detail report and `ocr-benchmark-baseline.json`, and
/// prints a summary table.
pub fn ocr_benchmark_mode() {
    let root = match std::env::var("MAGNA_CARTA_OCR_TIERS") {
        Ok(value) => PathBuf::from(value),
        Err(_) => {
            eprintln!("MAGNA_CARTA_OCR_TIERS must point at a directory of tier model files");
            std::process::exit(2);
        }
    };
    let corpus = default_corpus();
    if corpus.is_empty() {
        eprintln!("no corpus documents found");
        std::process::exit(2);
    }
    println!("corpus: {} document(s)", corpus.len());

    let mut runs = Vec::new();
    for tier in TIER_NAMES {
        let tier_dir = root.join(tier);
        if !tier_dir.is_dir() {
            println!("\n{tier}: skipped (no directory at {})", tier_dir.display());
            continue;
        }
        println!("\n{tier}:");
        let models = model_paths_for(&root, tier);
        match run_tier(tier, models, &corpus) {
            Ok(run) => runs.push(run),
            Err(detail) => println!("  {tier} failed: {detail}"),
        }
    }

    if runs.is_empty() {
        eprintln!("no tier produced a result");
        std::process::exit(1);
    }

    println!(
        "\n{:<8} {:>10} {:>12} {:>10} {:>9} {:>8} {:>10}",
        "tier", "load(ms)", "bytes", "scored", "skipped", "cer", "overlap"
    );
    for run in &runs {
        let s = &run.summary;
        println!(
            "{:<8} {:>10} {:>12} {:>10} {:>9} {:>8.4} {:>10.4}",
            s.tier,
            s.model_load_millis,
            s.total_model_bytes,
            s.documents_scored,
            s.documents_skipped,
            s.mean_character_error_rate,
            s.mean_word_box_overlap
        );
    }

    let report_path = Path::new("pdf-eval/ocr-benchmark-report.jsonl");
    if let Err(e) = write_jsonl(&runs, report_path) {
        eprintln!("warning: could not write {}: {e}", report_path.display());
    }

    let baseline_path = Path::new("pdf-eval/ocr-benchmark-baseline.json");
    let summaries: Vec<&TierResult> = runs.iter().map(|r| &r.summary).collect();
    match std::fs::File::create(baseline_path) {
        Ok(file) => {
            if let Err(e) = serde_json::to_writer_pretty(file, &summaries) {
                eprintln!("warning: could not write {}: {e}", baseline_path.display());
            }
        }
        Err(e) => eprintln!("warning: could not create {}: {e}", baseline_path.display()),
    }
}

#[cfg(test)]
mod corpus_tests {
    use super::*;

    #[test]
    fn default_corpus_enumerates_corpus_ci_and_adds_hello_once() {
        let corpus = default_corpus();
        let names: Vec<String> = corpus
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();

        // Every PDF actually present under corpus-ci/ shows up without a second edit
        // to this file being needed.
        let corpus_ci_pdf_count =
            std::fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("corpus-ci"))
                .unwrap()
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().map(|x| x == "pdf").unwrap_or(false))
                .count();
        assert!(
            corpus_ci_pdf_count >= 10,
            "expected the widened corpus-ci/ to hold at least 10 PDFs, found {corpus_ci_pdf_count}"
        );

        // hello.pdf is added exactly once (this crate's tests/fixtures copy, not
        // pdf-core's separate fixture of the same name).
        assert_eq!(names.iter().filter(|n| *n == "hello.pdf").count(), 1);

        // scanned.pdf is image-only and must never appear.
        assert!(!names.iter().any(|n| n == "scanned.pdf"));

        // corpus-ci/ contents plus hello.pdf, no more and no less.
        assert_eq!(corpus.len(), corpus_ci_pdf_count + 1);
    }
}
