// Minimal exported entrypoint that keeps hayro's full parse+render+png path
// live in the linked artifact, so the wasm size reflects the real client cost.
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};

#[no_mangle]
pub extern "C" fn render_first_page_png_len(ptr: *const u8, len: usize, scale: f32) -> usize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
    let pdf = match Pdf::new(bytes) {
        Ok(p) => p,
        Err(_) => return 0,
    };
    let cache = RenderCache::new();
    let interp = InterpreterSettings::default();
    let pages = pdf.pages();
    let Some(page) = pages.iter().next() else {
        return 0;
    };
    let settings = RenderSettings { x_scale: scale, y_scale: scale, ..Default::default() };
    let pixmap = render(page, &cache, &interp, &settings);
    pixmap.into_png().map(|p| p.len()).unwrap_or(0)
}
