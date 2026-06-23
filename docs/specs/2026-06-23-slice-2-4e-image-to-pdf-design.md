# Slice 2·4e — image→PDF (pure-Rust, the raster engine's PDF output)

**Status:** design · **Date:** 2026-06-23 · **Area:** File conversion
**Builds on:** 2·4d (the pure-Rust raster engine `containers/raster`, `magna-carta-raster`). **Decision
inputs:** owner chose image→PDF as the next engine — the **memory-safe quick win** (golden rule 14: no
C, no owner-consent needed, unlike LibreOffice/FFmpeg).

## Why this, and why pure Rust

"Turn this scan / photo / exhibit image into a PDF" is a real legal need, and it needs **no C**: the
raster engine already decodes the image with the pure-Rust `image` crate; wrapping that image in a PDF
needs only a **pure-Rust PDF writer** — [`krilla`](https://docs.rs/krilla/) (high-level, ergonomic,
explicit bitmap-image embedding, built on the pure-Rust `pdf-writer`, integrates with the `image`
crate). No PDFium, no C. This is distinct from the *full* PDF engine (PDF→PDF, PDF→image, PDF/A — the
deferred PDFium/EmbedPDF work): image-wrap is a write-only operation a Rust PDF writer covers cleanly.

## Architecture — it extends the raster Container; the worker is unchanged

The orchestrator's **server resolver is engine-agnostic** (`resolveEnginePort(env)` returns the one
`serviceBindingPort` for every `engineId`; the consumer forwards only `from`/`to`/`recipe` to the
convert worker, which forwards to the raster Container). So image→PDF needs **no convert-worker change**
and **no second Container**: the raster Container simply learns to handle `to = "pdf"`, and the registry
gains the edges so pathfinding knows the conversion exists. Two changes:

### 1. The engine — `containers/raster/src/convert.rs` learns `to = "pdf"`

- Add `krilla` (verify the current version + that it's C-free on docs.rs — golden rule 11/14; use the
  minimal feature set, no `svg`/`rayon` unless needed). **At build, scan the `Cargo.lock` for `-sys`/`cc`
  (the Task-1 lesson)** — if krilla drags in any native-C crate, narrow features or reconsider.
- In `convert`, branch BEFORE the `image_format(target)` lookup: when `target_format == "pdf"`, decode
  the source with the existing limited-decode path (reuse it — do not duplicate), then wrap the
  `DynamicImage` in a **single-page PDF** via krilla and return `(pdf_bytes, "application/pdf")`. The
  raster→raster path is unchanged.
- **Page geometry (v1):** the page is sized to the image's aspect ratio with the **longer side = 792 pt
  (11 in)**, the shorter side scaled by aspect; the image fills the page edge-to-edge. This avoids both
  the "huge page" failure (naive 1px=1pt on a 300-DPI scan) and letterboxing, needs no DPI metadata, and
  yields a reasonably-sized page for any aspect. The `recipe` field is the seam for future options
  (fit-to-Letter/A4, native-DPI, margins) — validate the recipe id, default to this geometry.
- A new `ConvertError` arm is not required — decode failures still map to `Decode`; a krilla
  encode/build failure maps to the existing `Encode` arm (→ 500). Never panic on the per-request path.
- The `/convert` route is unchanged — `to = "pdf"` flows through the existing header handling. Add a
  route test that `POST /convert` with `x-target-format: pdf` returns `200` + `application/pdf` + a body
  whose first bytes are `%PDF-`.

### 2. The registry — `packages/conversion` gains the image→PDF edges

- **New `EngineId` `"image-pdf"`** (`format.ts`), **placement `["server"]`** (`placement.ts`
  `ENGINE_PLACEMENTS`) — image→PDF is **server-only** (the browser wasm-vips path cannot write PDF), so
  it must NOT be tagged local, or `canConvertLocally(png, pdf)` would wrongly return true.
- **Edges** (`registry.ts`): `png→pdf`, `jpeg→pdf`, `webp→pdf`, `tiff→pdf`, `gif→pdf`, `bmp→pdf`, each
  `{ engineId: "image-pdf", recipeRef: "image-pdf", weight: 1 }`. (`pdf` is already a registered
  format.) These let pathfinding answer "can I get a PNG to PDF? yes, server-only."
- The raster Container already serves these because it routes by `(from, to)`, not `engineId`; the
  `"image-pdf"` engineId exists for the **registry/placement/UI** layer (so a surface offers
  "convert on the server" for image→PDF and never "on your device").

## Testing (pure Rust + TS, both local)

- **Rust** (`cargo test`, any host): `png→pdf` produces bytes starting `%PDF-` and ending with the PDF
  EOF marker; the page count is 1; a malformed source still errors (not a panic); the raster→raster
  tests are unaffected. Plus the route test (`to = "pdf"` → 200 + `application/pdf`).
- **TS** (`vp test` for `@magna-carta/conversion`): pathfinding finds `png→pdf` (server-only);
  `canConvertLocally("png", "pdf")` is **false**; the new edges are well-formed (the registry fitness
  test passes); placement for `"image-pdf"` is `["server"]`.

## Out of scope (deferred)

- The full PDF engine (PDF→PDF, PDF→image, PDF/A, OCR-sandwich) — PDFium/EmbedPDF, separate.
- Multi-image → multi-page PDF (one image = one page here); recipe-driven page geometry (Letter/A4/DPI).
- LibreOffice (Office→PDF), email→PDF, FFmpeg — the consent-gated / separate engines.

## Open items for the plan

- Confirm krilla's current version + the exact image-embedding API on docs.rs (`krilla::image::Image`
  construction from an `image` `DynamicImage` or encoded bytes, `Page`/`Surface::draw_image`), and that
  its dependency tree is C-free.
- Confirm the recipe id string (`"image-pdf"`) and that the registry fitness test accepts the new engine.
