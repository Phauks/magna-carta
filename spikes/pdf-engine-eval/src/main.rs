// Feasibility-spike harness. Throwaway — minimal error handling, log-and-continue.
// Modes:
//   render <input.pdf> <out_dir> [scale]   — hayro render to PNG (milestone 1)
//   parse  <corpus_dir>                     — lopdf + pdf-rs load-coverage over a corpus
// See docs/specs/2026-06-21-pdf-engine-feasibility-spike.md.
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("render") => render_mode(args.collect()),
        Some("parse") => parse_mode(args.next().expect("usage: parse <corpus_dir>")),
        other => {
            eprintln!("unknown mode {other:?}; use `render` or `parse`");
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

fn render_mode(args: Vec<String>) {
    let input = args.first().expect("usage: render <input.pdf> <out_dir> [scale]");
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
        let render_settings = RenderSettings { x_scale: scale, y_scale: scale, ..Default::default() };
        let started = std::time::Instant::now();
        let pixmap = render(page, &cache, &interpreter_settings, &render_settings);
        let png = pixmap.into_png().expect("encode png");
        let path = format!("{out_dir}/page_{idx:03}.png");
        std::fs::write(&path, png).unwrap();
        println!("  page {idx}: {}ms -> {path}", started.elapsed().as_millis());
    }
}

fn parse_mode(dir: String) {
    // malformed PDFs can panic inside the parsers; silence the default hook and catch.
    std::panic::set_hook(Box::new(|_| {}));
    let files = pdfs_in(&dir);
    let (mut lopdf_ok, mut pdf_ok, mut hayro_ok) = (0u32, 0u32, 0u32);

    println!("{:<34} {:>7} {:>7} {:>7}", "file", "lopdf", "pdf-rs", "hayro");
    for path in &files {
        let bytes = std::fs::read(path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();

        let l = catch_unwind(AssertUnwindSafe(|| lopdf::Document::load_mem(&bytes).is_ok())).unwrap_or(false);
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

fn yn(b: bool) -> &'static str {
    if b { "ok" } else { "FAIL" }
}
fn pct(a: u32, b: u32) -> f64 {
    if b == 0 { 0.0 } else { a as f64 * 100.0 / b as f64 }
}
