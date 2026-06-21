// Feasibility-spike milestone 1: prove hayro builds and renders a PDF in this
// environment. Usage: pdf-engine-eval <input.pdf> <out_dir> [scale]
// Throwaway — minimal error handling, log-and-continue.
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};

fn main() {
    let mut args = std::env::args().skip(1);
    let input = args.next().expect("usage: pdf-engine-eval <input.pdf> <out_dir> [scale]");
    let out_dir = args.next().expect("missing <out_dir>");
    let scale: f32 = args.next().map(|s| s.parse().unwrap()).unwrap_or(2.0);

    std::fs::create_dir_all(&out_dir).unwrap();
    let bytes = std::fs::read(&input).unwrap();
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
        println!("  page {idx}: {}ms -> {path}", started.elapsed().as_millis());
    }
}
