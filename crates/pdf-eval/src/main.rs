// Regression-harness CLI for the PDF engine.  Modes:
//   smoke         <corpus_dir>                          — parse + render page 0 via pdf-core; exits non-zero on any failure
//   redact-smoke  <pdf>                                 — redact the entire first page and assert the verification gate passes
//   render        <input.pdf> <out_dir> [scale]         — hayro render to PNG
//   parse         <corpus_dir>                          — lopdf + pdf-rs + hayro load-coverage
//   fidelity      <corpus_dir> <pdfium.dll> [dpi]       — hayro-vs-PDFium MSSIM per page (needs pdfium dll at runtime)
//   pdfium        <input.pdf> <pdfium.dll> <out_dir> [dpi] — dump PDFium renders to PNG (needs pdfium dll at runtime)
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};
#[cfg(feature = "pdfium")]
use image::GrayImage;
#[cfg(feature = "pdfium")]
use image_compare::Algorithm;
#[cfg(feature = "pdfium")]
use pdfium_render::prelude::*;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

#[cfg(feature = "pdfium")]
const MAX_PAGES_PER_DOC: usize = 3;

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("smoke") => smoke_mode(args.next().expect("usage: smoke <corpus_dir>")),
        Some("redact-smoke") => redact_smoke_mode(args.next().expect("usage: redact-smoke <pdf>")),
        Some("render") => render_mode(args.collect()),
        Some("parse") => parse_mode(args.next().expect("usage: parse <corpus_dir>")),
        #[cfg(feature = "pdfium")]
        Some("fidelity") => fidelity_mode(args.collect()),
        #[cfg(feature = "pdfium")]
        Some("pdfium") => pdfium_mode(args.collect()),
        #[cfg(not(feature = "pdfium"))]
        Some("fidelity" | "pdfium") => {
            eprintln!("fidelity/pdfium modes require: cargo run -p pdf-eval --features pdfium");
            std::process::exit(2);
        }
        other => {
            eprintln!(
                "unknown mode {other:?}; use smoke | redact-smoke | render | parse | fidelity | pdfium"
            );
            std::process::exit(2);
        }
    }
}

fn pdfs_in(dir: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "pdf").unwrap_or(false))
        .collect();
    v.sort();
    v
}

fn smoke_mode(dir: String) {
    let mut failures = 0;
    for path in pdfs_in(&dir) {
        let bytes = std::fs::read(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy();
        match pdf_core::Document::load(bytes).and_then(|d| d.render_page(0, 72.0, false)) {
            Ok(p) if p.data.len() == (p.width * p.height * 4) as usize => {
                println!("ok   {name}");
            }
            _ => {
                eprintln!("FAIL {name}");
                failures += 1;
            }
        }
    }
    if failures > 0 {
        std::process::exit(1);
    }
}

fn redact_smoke_mode(path: String) {
    let bytes = std::fs::read(&path).unwrap();
    // Redact the entire first page; the gate must pass (the page becomes an image).
    let regions = [pdf_core::RedactionRegion {
        page: 0,
        rect: pdf_core::Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 100_000.0,
            y1: 100_000.0,
        },
        reason: None,
    }];
    match pdf_core::redact(bytes, &regions, &pdf_core::RedactionOptions::default()) {
        Ok(outcome) => {
            println!(
                "ok   redacted page(s) {:?}, {} bytes",
                outcome.report.pages_redacted,
                outcome.pdf.len()
            );
        }
        Err(e) => {
            eprintln!("FAIL redaction gate: {e:?}");
            std::process::exit(1);
        }
    }
}

fn render_mode(args: Vec<String>) {
    let input = args
        .first()
        .expect("usage: render <input.pdf> <out_dir> [scale]");
    let out_dir = args.get(1).expect("missing <out_dir>");
    let scale: f32 = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(2.0);

    std::fs::create_dir_all(out_dir).unwrap();
    let bytes = std::fs::read(input).unwrap();
    let pdf = Pdf::new(bytes).expect("failed to parse PDF");
    let cache = RenderCache::new();
    let interpreter_settings = InterpreterSettings::default();
    let pages = pdf.pages();
    println!("loaded {} page(s) from {input}", pages.len());

    for (idx, page) in pages.iter().enumerate() {
        let render_settings = RenderSettings {
            x_scale: scale,
            y_scale: scale,
            ..Default::default()
        };
        let started = std::time::Instant::now();
        let pixmap = render(page, &cache, &interpreter_settings, &render_settings);
        let png = pixmap.into_png().expect("encode png");
        let path = format!("{out_dir}/page_{idx:03}.png");
        std::fs::write(&path, png).unwrap();
        println!(
            "  page {idx}: {}ms -> {path}",
            started.elapsed().as_millis()
        );
    }
}

fn parse_mode(dir: String) {
    std::panic::set_hook(Box::new(|_| {}));
    let files = pdfs_in(&dir);
    let (mut lopdf_ok, mut pdf_ok, mut hayro_ok) = (0u32, 0u32, 0u32);

    println!(
        "{:<34} {:>7} {:>7} {:>7}",
        "file", "lopdf", "pdf-rs", "hayro"
    );
    for path in &files {
        let bytes = std::fs::read(path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let l = catch_unwind(AssertUnwindSafe(|| {
            lopdf::Document::load_mem(&bytes).is_ok()
        }))
        .unwrap_or(false);
        let p = catch_unwind(AssertUnwindSafe(|| parse_with_pdf_rs(path))).unwrap_or(false);
        let h = catch_unwind(AssertUnwindSafe(|| Pdf::new(bytes.clone()).is_ok())).unwrap_or(false);
        lopdf_ok += l as u32;
        pdf_ok += p as u32;
        hayro_ok += h as u32;
        println!("{name:<34} {:>7} {:>7} {:>7}", yn(l), yn(p), yn(h));
    }
    let n = files.len() as u32;
    println!("\nparse coverage over {n} file(s):");
    println!("  lopdf : {lopdf_ok}/{n}  ({:.1}%)", pct(lopdf_ok, n));
    println!("  pdf-rs: {pdf_ok}/{n}  ({:.1}%)", pct(pdf_ok, n));
    println!("  hayro : {hayro_ok}/{n}  ({:.1}%)", pct(hayro_ok, n));
}

fn parse_with_pdf_rs(path: &Path) -> bool {
    pdf::file::FileOptions::cached().open(path).is_ok()
}

// --- fidelity: hayro vs PDFium, MSSIM per page (PDFium is the reference) ---

#[cfg(feature = "pdfium")]
fn fidelity_mode(args: Vec<String>) {
    let dir = args
        .first()
        .expect("usage: fidelity <corpus_dir> <pdfium.dll> [dpi]");
    let dll = args.get(1).expect("missing <pdfium.dll>");
    let dpi: f32 = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(150.0);
    let scale = dpi / 72.0;

    let pdfium = Pdfium::new(Pdfium::bind_to_library(dll).expect("bind pdfium"));

    println!("hayro vs PDFium @ {dpi} DPI — MSSIM (1.000 = identical to PDFium)\n");
    println!("{:<32} {:>4} {:>13} {:>8}", "file", "pg", "dims", "mssim");

    let mut scores: Vec<f64> = Vec::new();
    for path in pdfs_in(dir) {
        let bytes = std::fs::read(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();

        let pdf = match Pdf::new(bytes.clone()) {
            Ok(p) => p,
            Err(_) => {
                println!("{name:<32}  (hayro parse failed)");
                continue;
            }
        };
        let doc = match pdfium.load_pdf_from_byte_slice(&bytes, None) {
            Ok(d) => d,
            Err(_) => {
                println!("{name:<32}  (pdfium parse failed)");
                continue;
            }
        };
        let n = pdf.pages().len().min(MAX_PAGES_PER_DOC);
        for idx in 0..n {
            let r = catch_unwind(AssertUnwindSafe(|| page_mssim(&pdf, &doc, idx, scale)))
                .ok()
                .flatten();
            match r {
                Some((w, h, s)) => {
                    println!("{name:<32} {idx:>4} {w}x{h:>9} {s:>8.3}");
                    scores.push(s);
                }
                None => println!("{name:<32} {idx:>4} {:>13} {:>8}", "-", "ERR"),
            }
        }
    }

    if !scores.is_empty() {
        scores.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = scores.len();
        let mean = scores.iter().sum::<f64>() / n as f64;
        let median = scores[n / 2];
        let ge98 = scores.iter().filter(|&&s| s >= 0.98).count();
        let min = scores[0];
        println!("\n{n} page(s) compared:");
        println!("  mean MSSIM   : {mean:.3}");
        println!("  median MSSIM : {median:.3}");
        println!("  min MSSIM    : {min:.3}");
        println!(
            "  >= 0.98      : {ge98}/{n}  ({:.1}%)",
            pct(ge98 as u32, n as u32)
        );
    }
}

#[cfg(feature = "pdfium")]
fn page_mssim(pdf: &Pdf, doc: &PdfDocument, idx: usize, scale: f32) -> Option<(u32, u32, f64)> {
    // hayro page -> grayscale on white (the reference dimensions)
    let cache = RenderCache::new();
    let interp = InterpreterSettings::default();
    let pages = pdf.pages();
    let page = pages.get(idx)?;
    let settings = RenderSettings {
        x_scale: scale,
        y_scale: scale,
        ..Default::default()
    };
    let png = render(page, &cache, &interp, &settings).into_png().ok()?;
    let hgray = luma_on_white(&image::load_from_memory(&png).ok()?.to_rgba8());
    let (w, h) = (hgray.width(), hgray.height());

    // PDFium page -> grayscale on white at the same target dimensions.
    // (PDFium renders on a transparent background, so we must flatten over white
    // to compare like-for-like with hayro.)
    let ppage = doc.pages().get(idx as i32).ok()?;
    let cfg = PdfRenderConfig::new()
        .set_target_width(w as i32)
        .set_maximum_height(h as i32);
    let prgba = ppage
        .render_with_config(&cfg)
        .ok()?
        .as_image()
        .ok()?
        .to_rgba8();
    let prgba = if prgba.width() == w && prgba.height() == h {
        prgba
    } else {
        image::imageops::resize(&prgba, w, h, image::imageops::FilterType::Triangle)
    };
    let pgray = luma_on_white(&prgba);

    let sim =
        image_compare::gray_similarity_structure(&Algorithm::MSSIMSimple, &hgray, &pgray).ok()?;
    Some((w, h, sim.score))
}

// Dump PDFium's own render to PNG, for eyeballing against hayro's output.
#[cfg(feature = "pdfium")]
fn pdfium_mode(args: Vec<String>) {
    let input = args
        .first()
        .expect("usage: pdfium <input.pdf> <pdfium.dll> <out_dir> [dpi]");
    let dll = args.get(1).expect("missing <pdfium.dll>");
    let out_dir = args.get(2).expect("missing <out_dir>");
    let dpi: f32 = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(150.0);

    std::fs::create_dir_all(out_dir).unwrap();
    let bytes = std::fs::read(input).unwrap();
    let pdfium = Pdfium::new(Pdfium::bind_to_library(dll).expect("bind pdfium"));
    let doc = pdfium
        .load_pdf_from_byte_slice(&bytes, None)
        .expect("pdfium load");
    for (idx, page) in doc.pages().iter().enumerate() {
        let w = (page.width().value * dpi / 72.0) as i32;
        let cfg = PdfRenderConfig::new()
            .set_target_width(w)
            .set_maximum_height((page.height().value * dpi / 72.0) as i32);
        let rgba = page
            .render_with_config(&cfg)
            .unwrap()
            .as_image()
            .unwrap()
            .to_rgba8();
        let g = luma_on_white(&rgba);
        let path = format!("{out_dir}/page_{idx:03}.png");
        g.save(&path).unwrap();
        println!(
            "  pdfium page {idx}: {}x{} -> {path}",
            g.width(),
            g.height()
        );
    }
}

// Flatten RGBA over a white background, then convert to grayscale (Rec. 601).
#[cfg(feature = "pdfium")]
fn luma_on_white(img: &image::RgbaImage) -> GrayImage {
    GrayImage::from_fn(img.width(), img.height(), |x, y| {
        let p = img.get_pixel(x, y).0;
        let a = p[3] as f32 / 255.0;
        let over = |c: u8| c as f32 * a + 255.0 * (1.0 - a);
        let l = 0.299 * over(p[0]) + 0.587 * over(p[1]) + 0.114 * over(p[2]);
        image::Luma([l.round().clamp(0.0, 255.0) as u8])
    })
}

fn yn(b: bool) -> &'static str {
    if b {
        "ok"
    } else {
        "FAIL"
    }
}

fn pct(a: u32, b: u32) -> f64 {
    if b == 0 {
        0.0
    } else {
        a as f64 * 100.0 / b as f64
    }
}
