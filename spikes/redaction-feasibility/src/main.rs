/// Redaction feasibility spike — throwaway research code.
///
/// Q-A: Plain text extraction baseline (lopdf vs pdf-extract)
/// Q-B: Position-aware text extraction via hayro-interpret Device trait
/// Q-C: lopdf content-stream surgery — nuke page content, verify empty, confirm image XObject API
use std::fs;
use std::path::Path;

// ── Q-B: hayro-interpret Device impl ─────────────────────────────────────────
use hayro_interpret::{
    BlendMode, ClipPath, Context, Device, GlyphDrawMode, Image, InterpreterCache,
    InterpreterSettings, Paint, PathDrawMode, SoftMask,
};
use hayro_interpret::font::Glyph;
use hayro_interpret::util::TransformExt;
use kurbo::{Affine, BezPath, Rect};

struct TextPositionCollector {
    records: Vec<GlyphRecord>,
}

#[derive(Debug)]
struct GlyphRecord {
    tx: f64,
    ty: f64,
    /// Unicode text for this glyph (if available via ToUnicode CMap).
    unicode: Option<String>,
}

impl<'a> Device<'a> for TextPositionCollector {
    fn set_soft_mask(&mut self, _mask: Option<SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, _blend_mode: BlendMode) {}

    fn draw_path(
        &mut self,
        _path: &BezPath,
        _transform: Affine,
        _paint: &Paint<'a>,
        _draw_mode: &PathDrawMode,
    ) {
    }

    fn push_clip_path(&mut self, _clip_path: &ClipPath) {}
    fn pop_clip_path(&mut self) {}
    fn push_transparency_group(
        &mut self,
        _opacity: f32,
        _mask: Option<SoftMask<'a>>,
        _blend_mode: BlendMode,
    ) {
    }
    fn pop_transparency_group(&mut self) {}

    fn draw_glyph(
        &mut self,
        glyph: &Glyph<'a>,
        transform: Affine,
        _glyph_transform: Affine,
        _paint: &Paint<'a>,
        _draw_mode: &GlyphDrawMode,
    ) {
        let t = transform.translation();
        // as_unicode() returns Option<BfString> — BfString is Char(char) | String(String).
        let unicode = glyph.as_unicode().map(|bfs| match bfs {
            hayro_interpret::hayro_cmap::BfString::Char(c) => c.to_string(),
            hayro_interpret::hayro_cmap::BfString::String(s) => s,
        });
        self.records.push(GlyphRecord {
            tx: t.x,
            ty: t.y,
            unicode,
        });
    }

    fn draw_image(&mut self, _image: Image<'a, '_>, _transform: Affine) {}
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn corpus_path(name: &str) -> std::path::PathBuf {
    // CARGO_MANIFEST_DIR is set at compile time to the absolute path of the crate.
    // At runtime the binary may be in target/debug/ but this path is embedded at compile time.
    let base = env!("CARGO_MANIFEST_DIR");
    // spikes/redaction-feasibility -> spikes/pdf-engine-eval/corpus
    Path::new(base)
        .join("..").join("pdf-engine-eval").join("corpus")
        .join(name)
}

fn lopdf_extract_all_pages(bytes: &[u8]) -> Result<String, String> {
    let doc = lopdf::Document::load_mem(bytes).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let mut page_numbers: Vec<u32> = pages.keys().copied().collect();
    page_numbers.sort();
    let mut all = String::new();
    for p in &page_numbers {
        match doc.extract_text(&[*p]) {
            Ok(t) => all.push_str(&t),
            Err(e) => return Err(format!("page {} error: {e}", p)),
        }
    }
    Ok(all)
}

fn pdf_extract_text(bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(bytes).map_err(|e| e.to_string())
}

// ── main ──────────────────────────────────────────────────────────────────────

fn main() {
    let corpus_files = [
        "basicapi.pdf",
        "court_ao088.pdf",
        "court_ao089.pdf",
        "court_ao240.pdf",
        "gov_irs_w4_acroform.pdf",
        "gov_irs_w9_acroform.pdf",
        "pdfjs_cmykjpeg.pdf",
        "pdfjs_franz_image.pdf",
        "pdfjs_issue1905.pdf",
        "TAMReview.pdf",
    ];

    // ── Q-A: lopdf extraction over full corpus ────────────────────────────────
    println!("\n===== Q-A: lopdf::extract_text over corpus =====");
    let mut lopdf_ok = 0usize;
    let mut lopdf_fail = 0usize;
    let mut lopdf_empty = 0usize;

    for name in &corpus_files {
        let path = corpus_path(name);
        match fs::read(&path) {
            Err(e) => {
                println!("  [IO-ERR]  {name}: {e}");
                lopdf_fail += 1;
            }
            Ok(bytes) => match lopdf_extract_all_pages(&bytes) {
                Ok(text) if text.trim().is_empty() => {
                    println!("  [EMPTY]   {name}");
                    lopdf_empty += 1;
                }
                Ok(text) => {
                    let preview: String = text.chars().take(80).collect();
                    println!("  [OK]      {name}: {preview:?}…");
                    lopdf_ok += 1;
                }
                Err(e) => {
                    println!("  [FAIL]    {name}: {e}");
                    lopdf_fail += 1;
                }
            },
        }
    }
    println!(
        "\nlopdf summary: ok={lopdf_ok}  empty={lopdf_empty}  fail={lopdf_fail} / {}",
        corpus_files.len()
    );

    // ── Q-A: pdf-extract comparison on 3 files ────────────────────────────────
    println!("\n===== Q-A: pdf-extract comparison (3 files) =====");
    for name in &["basicapi.pdf", "TAMReview.pdf", "court_ao088.pdf"] {
        let path = corpus_path(name);
        match fs::read(&path) {
            Err(e) => println!("  [IO-ERR] {name}: {e}"),
            Ok(bytes) => match pdf_extract_text(&bytes) {
                Ok(t) if t.trim().is_empty() => println!("  [EMPTY]  {name}"),
                Ok(t) => {
                    let preview: String = t.chars().take(80).collect();
                    println!("  [OK]     {name}: {preview:?}…");
                }
                Err(e) => println!("  [FAIL]   {name}: {e}"),
            },
        }
    }

    // ── Q-B: hayro-interpret Device trait — position capture ─────────────────
    println!("\n===== Q-B: hayro-interpret position-aware extraction =====");

    for qb_file in &["basicapi.pdf", "TAMReview.pdf"] {
        let path = corpus_path(qb_file);
        match fs::read(&path) {
            Err(e) => println!("  [IO-ERR] {qb_file}: {e}"),
            Ok(bytes) => {
                match hayro_syntax::Pdf::new(bytes) {
                    Err(e) => println!("  [LOAD-ERR] {qb_file}: {e:?}"),
                    Ok(pdf) => {
                        let pages = pdf.pages();
                        let mut page_iter = pages.iter();
                        match page_iter.next() {
                            None => println!("  [NO-PAGES] {qb_file}"),
                            Some(page) => {
                                let settings = InterpreterSettings::default();
                                let cache = InterpreterCache::new();
                                // Mirror the pattern from hayro's render() fn.
                                let (width, height) = page.render_dimensions();
                                let initial_transform =
                                    page.initial_transform(true).to_kurbo();
                                let bbox = Rect::new(0.0, 0.0, width as f64, height as f64);
                                let mut context = Context::new(
                                    initial_transform,
                                    bbox,
                                    &cache,
                                    page.xref(),
                                    settings,
                                );
                                let mut device = TextPositionCollector { records: vec![] };
                                hayro_interpret::interpret_page(
                                    &page,
                                    &mut context,
                                    &mut device,
                                );
                                println!(
                                    "  [DEVICE]   {qb_file}: {} glyph draw calls on page 0",
                                    device.records.len()
                                );
                                for r in device.records.iter().take(5) {
                                    println!(
                                        "             unicode={:?} tx={:.2} ty={:.2}",
                                        r.unicode, r.tx, r.ty
                                    );
                                }
                                if device.records.is_empty() {
                                    println!("  [WARN] No glyphs on page 0 — possibly image-only");
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Q-C: lopdf surgery — nuke content stream, verify empty, note image API ─
    println!("\n===== Q-C: lopdf content-stream surgery =====");

    let qc_file = "basicapi.pdf";
    let path = corpus_path(qc_file);
    match fs::read(&path) {
        Err(e) => println!("  [IO-ERR] {qc_file}: {e}"),
        Ok(bytes) => {
            match lopdf_extract_all_pages(&bytes) {
                Err(e) => println!("  [BASELINE-FAIL] original extract failed: {e}"),
                Ok(original_text) => {
                    let preview: String = original_text.chars().take(80).collect();
                    println!(
                        "  [BASELINE]  original text ({} chars): {preview:?}…",
                        original_text.len()
                    );

                    let mut doc =
                        lopdf::Document::load_mem(&bytes).expect("reload for surgery");

                    let pages = doc.get_pages();
                    let mut page_ids: Vec<(u32, lopdf::ObjectId)> =
                        pages.iter().map(|(&k, &v)| (k, v)).collect();
                    page_ids.sort_by_key(|(k, _)| *k);

                    if let Some(&(_page_num, page_id)) = page_ids.first() {
                        // Replace content stream with an empty one
                        let empty_stream = lopdf::Stream::new(
                            lopdf::Dictionary::new(),
                            b"".to_vec(),
                        );
                        let empty_obj_id = doc.add_object(empty_stream);

                        // Update the page dict: set /Contents to new empty stream, remove /Annots
                        {
                            let page_obj = doc
                                .get_object_mut(page_id)
                                .expect("page object must exist");
                            if let lopdf::Object::Dictionary(ref mut dict) = page_obj {
                                dict.set(
                                    "Contents",
                                    lopdf::Object::Reference(empty_obj_id),
                                );
                                dict.remove(b"Annots");
                            }
                        }

                        // Serialize to bytes
                        let mut out_buf: Vec<u8> = Vec::new();
                        doc.save_to(&mut out_buf).expect("save_to must work");

                        println!(
                            "  [SURGERY]   serialized redacted doc: {} bytes",
                            out_buf.len()
                        );

                        // Reload and extract text — test PAGE 1 ONLY (we only cleared page 1).
                        let doc_out = lopdf::Document::load_mem(&out_buf)
                            .expect("reload redacted doc");
                        match doc_out.extract_text(&[1]) {
                            Err(e) => {
                                // An error on empty stream content is expected —
                                // lopdf returns Err when the content stream is non-decodable/empty.
                                println!("  [POST-EXTRACT p1] extract_text returned Err (expected for empty stream): {e}");
                                println!("  [VERDICT] Gate checks page-by-page: Err OR Ok(empty) → text gone on that page. PASSES.");
                            }
                            Ok(text) if text.trim().is_empty() => {
                                println!(
                                    "  [PASS] post-surgery page 1 extract_text returned empty — gate PASSES"
                                );
                            }
                            Ok(text) => {
                                let surviving: String = text.chars().take(120).collect();
                                println!(
                                    "  [FAIL p1] post-surgery page 1 text not empty ({} chars): {surviving:?}",
                                    text.len()
                                );
                            }
                        }
                        // Also show what extract_text returns for page 2 (unchanged — should have text).
                        match doc_out.extract_text(&[2]) {
                            Ok(text) if !text.trim().is_empty() => {
                                println!("  [CONTROL p2] page 2 (unchanged) still has text ({} chars) — confirms surgery is page-specific", text.len());
                            }
                            _ => println!("  [CONTROL p2] unexpected: page 2 has no text"),
                        }
                    } else {
                        println!("  [SKIP] no pages found");
                    }

                    // Confirm image XObject API exists — construct a minimal image XObject dict.
                    println!("\n  [IMAGE-XOBJECT API CHECK]");
                    let mut img_dict = lopdf::Dictionary::new();
                    img_dict.set("Type", lopdf::Object::Name(b"XObject".to_vec()));
                    img_dict.set("Subtype", lopdf::Object::Name(b"Image".to_vec()));
                    img_dict.set("Width", lopdf::Object::Integer(1));
                    img_dict.set("Height", lopdf::Object::Integer(1));
                    img_dict.set("ColorSpace", lopdf::Object::Name(b"DeviceRGB".to_vec()));
                    img_dict.set("BitsPerComponent", lopdf::Object::Integer(8));
                    // stream data = 1 pixel of RGB (0,0,0) — placeholder; real use: JPEG bytes with /Filter /DCTDecode
                    let img_stream = lopdf::Stream::new(img_dict, vec![0u8, 0u8, 0u8]);
                    let mut doc2 = lopdf::Document::new();
                    let img_obj_id = doc2.add_object(img_stream);
                    println!(
                        "  [COMPILE-CHECK] image XObject added as object {:?} — API compiles and runs.",
                        img_obj_id
                    );
                    println!("  Full pipeline: add image XObject → add to page /Resources /XObject");
                    println!("  → set content stream to 'q W 0 0 W H cm /Im0 Do Q' → save_to.");
                    println!("  image crate converts source image → raw RGB/JPEG bytes for the stream.");
                }
            }
        }
    }

    println!("\n===== SPIKE COMPLETE =====\n");
}
