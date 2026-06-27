# PDF engine slice 1 — core + render — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the first Rust+WASM foundation in the monorepo and a PDF core that loads, inspects, and renders pages to raster, exposed as `@magna-carta/pdf`.

**Architecture:** A target-agnostic Rust crate (`crates/pdf-core`, `hayro` render) with a thin `#[wasm_bindgen]` edge compiled only for `wasm32`; a TS wrapper (`packages/pdf`) over the `wasm-pack` output; a dev-only native harness (`crates/pdf-eval`) carrying the permanent regression suite. One core, two thin edges.

**Tech Stack:** Rust (hayro 0.7, image 0.25, wasm-bindgen 0.2, wasm-pack), TypeScript (`@magna-carta/pdf`), Vitest, `vp` tooling.

**Design spec:** [`2026-06-21-pdf-slice-1-core-render-design.md`](2026-06-21-pdf-slice-1-core-render-design.md). **Feasibility GO:** [`2026-06-21-pdf-engine-feasibility-results.md`](2026-06-21-pdf-engine-feasibility-results.md).

**Worktree:** execute on the existing `pdf-engine-roadmap` worktree — the design spec and the throwaway spike harness (re-homed in Task 5) already live here; a fresh worktree off `main` would lose both and split the lineage.

## Global Constraints

- **Rust edition 2021**; crates `publish = false`; pin `hayro = "0.7"`, `image = "0.25"`, `wasm-bindgen = "0.2"`. Re-verify versions/licenses at build (golden rule 11).
- **No shorthand names** (golden rule 12): `@magna-carta/pdf`, `PdfDocument`, `renderPage` — spell out; "pdf" is an allowed universal term.
- **No process references in code/tests/strings** (golden rule 13): no ADR-NNNN, "slice 1", "spike". State reasoning inline or cite a `docs/conventions/` path.
- **Client WASM is a public generic primitive** (ADR-0090): minification only, **no source maps**; nothing proprietary in the core.
- **`pdf-core` is a pure compute library**: fallible ops return typed `Result`/throw typed JS errors — no logging, no Error-IDs inside the core (golden rule 4 lives at the consuming Worker, not here).
- **TDD**: every task writes the failing test first, watches it fail, implements minimally, watches it pass, commits.
- **hayro API (verified):** `Pdf::new(Vec<u8>) -> Result<Pdf, _>`; `pdf.pages()` → `.len()`, `.iter().nth(i) -> Option<Page>`; `page.render_dimensions() -> (f32, f32)` (points); `hayro::render(&page, &RenderCache::new(), &InterpreterSettings::default(), &RenderSettings { x_scale, y_scale, ..Default::default() }) -> Pixmap`; `pixmap.into_png() -> Result<Vec<u8>, _>`. `InterpreterSettings` imports from `hayro::hayro_interpret`.

---

### Task 1: Cargo workspace + `pdf-core` load & page count

**Files:**

- Create: `crates/Cargo.toml`
- Create: `crates/pdf-core/Cargo.toml`
- Create: `crates/pdf-core/src/lib.rs`
- Create: `crates/pdf-core/tests/fixtures/blank.pdf` (a minimal one-page PDF — content below)
- Test: in `crates/pdf-core/src/lib.rs` (`#[cfg(test)]` module)

**Interfaces:**

- Produces: `pdf_core::Document::load(bytes: Vec<u8>) -> Result<Document, PdfError>`; `Document::page_count(&self) -> usize`; `enum PdfError { Parse, PageOutOfRange, Render }`.

- [ ] **Step 1: Create the workspace manifest** `crates/Cargo.toml`

```toml
[workspace]
resolver = "2"
members = ["pdf-core", "pdf-eval"]

[workspace.package]
edition = "2021"
publish = false

[workspace.dependencies]
hayro = "0.7"
image = "0.25"
```

- [ ] **Step 2: Create** `crates/pdf-core/Cargo.toml`

```toml
[package]
name = "pdf-core"
version = "0.0.0"
edition.workspace = true
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
hayro = { workspace = true }
image = { workspace = true }

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"

[profile.release]
opt-level = "z"
lto = true
strip = true
```

- [ ] **Step 3: Add the test fixture** `crates/pdf-core/tests/fixtures/blank.pdf`

A minimal valid single-page PDF (deterministic, hand-authored — no redistribution concern). Write exactly:

```
%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
178
%%EOF
```

- [ ] **Step 4: Write the failing test** in `crates/pdf-core/src/lib.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> Vec<u8> {
        include_bytes!("../tests/fixtures/blank.pdf").to_vec()
    }

    #[test]
    fn loads_and_counts_one_page() {
        let doc = Document::load(blank()).expect("loads");
        assert_eq!(doc.page_count(), 1);
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(Document::load(b"not a pdf".to_vec()), Err(PdfError::Parse)));
    }
}
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `cargo test -p pdf-core`
Expected: FAIL — `Document` / `PdfError` not defined.

- [ ] **Step 6: Implement minimally** — top of `crates/pdf-core/src/lib.rs`

```rust
use hayro::hayro_syntax::Pdf;

/// What a PDF operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum PdfError {
    Parse,
    PageOutOfRange,
    Render,
}

/// A parsed PDF held in memory.
pub struct Document {
    pdf: Pdf,
}

impl Document {
    pub fn load(bytes: Vec<u8>) -> Result<Self, PdfError> {
        Pdf::new(bytes).map(|pdf| Document { pdf }).map_err(|_| PdfError::Parse)
    }

    pub fn page_count(&self) -> usize {
        self.pdf.pages().len()
    }
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `cargo test -p pdf-core`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add crates/Cargo.toml crates/pdf-core
git commit -m "feat(pdf-core): cargo workspace + document load and page count"
```

---

### Task 2: `page_size` + `render_page`

**Files:**

- Modify: `crates/pdf-core/src/lib.rs`

**Interfaces:**

- Consumes: `Document`, `PdfError` (Task 1).
- Produces: `Document::page_size(&self, index: usize) -> Result<PageSize, PdfError>` where `pub struct PageSize { pub width_pt: f32, pub height_pt: f32 }`; `Document::render_page(&self, index: usize, dpi: f32, encode_png: bool) -> Result<RenderedPage, PdfError>` where `pub struct RenderedPage { pub data: Vec<u8>, pub width: u32, pub height: u32, pub png: bool }` (`data` is RGBA8 unless `png`).

- [ ] **Step 1: Write the failing test** (append to the `tests` module)

```rust
#[test]
fn reports_letter_page_size() {
    let doc = Document::load(blank()).unwrap();
    let size = doc.page_size(0).unwrap();
    assert!((size.width_pt - 612.0).abs() < 1.0);
    assert!((size.height_pt - 792.0).abs() < 1.0);
    assert_eq!(doc.page_size(5), Err(PdfError::PageOutOfRange));
}

#[test]
fn renders_rgba_at_dpi() {
    let doc = Document::load(blank()).unwrap();
    let page = doc.render_page(0, 72.0, false).unwrap();
    assert!(!page.png);
    assert_eq!(page.width, 612);
    assert_eq!(page.height, 792);
    // RGBA8 == 4 bytes per pixel
    assert_eq!(page.data.len(), (page.width * page.height * 4) as usize);
}

#[test]
fn renders_png_when_asked() {
    let doc = Document::load(blank()).unwrap();
    let page = doc.render_page(0, 72.0, true).unwrap();
    assert!(page.png);
    assert_eq!(&page.data[1..4], b"PNG");
}
```

- [ ] **Step 2: Run, verify it fails**

Run: `cargo test -p pdf-core`
Expected: FAIL — `page_size` / `render_page` not defined.

- [ ] **Step 3: Implement** — add to `lib.rs`

```rust
use hayro::hayro_interpret::InterpreterSettings;
use hayro::{render, RenderCache, RenderSettings};

pub struct PageSize {
    pub width_pt: f32,
    pub height_pt: f32,
}

/// Rendered raster. `data` is RGBA8 (row-major, 4 bytes/pixel) unless `png`.
pub struct RenderedPage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub png: bool,
}

impl Document {
    pub fn page_size(&self, index: usize) -> Result<PageSize, PdfError> {
        let pages = self.pdf.pages();
        let page = pages.iter().nth(index).ok_or(PdfError::PageOutOfRange)?;
        let (width_pt, height_pt) = page.render_dimensions();
        Ok(PageSize { width_pt, height_pt })
    }

    pub fn render_page(&self, index: usize, dpi: f32, encode_png: bool) -> Result<RenderedPage, PdfError> {
        let pages = self.pdf.pages();
        let page = pages.iter().nth(index).ok_or(PdfError::PageOutOfRange)?;
        let scale = dpi / 72.0;
        let settings = RenderSettings { x_scale: scale, y_scale: scale, ..Default::default() };
        let png = render(page, &RenderCache::new(), &InterpreterSettings::default(), &settings)
            .into_png()
            .map_err(|_| PdfError::Render)?;
        if encode_png {
            // dimensions come from decoding the header cheaply
            let dims = image::load_from_memory(&png).map_err(|_| PdfError::Render)?;
            return Ok(RenderedPage { width: dims.width(), height: dims.height(), data: png, png: true });
        }
        // OPTIMIZATION SEAM: this round-trips through PNG to get *straight* RGBA8.
        // Direct access exists (pixmap.width()/height()/data_as_u8_slice(), vello_common
        // Pixmap) but yields PREMULTIPLIED RGBA (PremulRgba8) — a canvas wants straight
        // alpha, so the direct path must un-premultiply first. The PNG round-trip already
        // returns straight RGBA; keep it until the un-premultiply path is benchmarked.
        let img = image::load_from_memory(&png).map_err(|_| PdfError::Render)?.to_rgba8();
        let (width, height) = (img.width(), img.height());
        Ok(RenderedPage { data: img.into_raw(), width, height, png: false })
    }
}
```

(The `use image::GenericImageView` trait is needed for `.width()/.height()` on `DynamicImage`; add `use image::GenericImageView;` at the top if the compiler asks.)

- [ ] **Step 4: Run, verify it passes**

Run: `cargo test -p pdf-core`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/lib.rs
git commit -m "feat(pdf-core): page size and render-to-raster (rgba8 or png)"
```

---

### Task 3: WASM boundary + `wasm-pack` build

**Files:**

- Create: `crates/pdf-core/src/wasm.rs`
- Modify: `crates/pdf-core/src/lib.rs` (wire the module)

**Interfaces:**

- Consumes: `Document`, `PageSize`, `RenderedPage`, `PdfError` (Tasks 1–2).
- Produces (JS, via wasm-bindgen): class `PdfDocument` with `static load(bytes: Uint8Array)`, getter `pageCount`, `pageSize(index) -> PageSize`, `renderPage(index, dpi, encodePng) -> RenderedPage`, `free()`. `PageSize { widthPt, heightPt }`, `RenderedPage { data, width, height, png }`.

- [ ] **Step 1: Write the wasm boundary** `crates/pdf-core/src/wasm.rs`

```rust
//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here.
use crate::{Document, PdfError};
use wasm_bindgen::prelude::*;

impl From<PdfError> for JsError {
    fn from(e: PdfError) -> Self {
        JsError::new(match e {
            PdfError::Parse => "failed to parse PDF",
            PdfError::PageOutOfRange => "page index out of range",
            PdfError::Render => "failed to render page",
        })
    }
}

#[wasm_bindgen]
pub struct PdfDocument {
    inner: Document,
}

#[wasm_bindgen]
pub struct PageSize {
    #[wasm_bindgen(js_name = widthPt, readonly)]
    pub width_pt: f32,
    #[wasm_bindgen(js_name = heightPt, readonly)]
    pub height_pt: f32,
}

#[wasm_bindgen]
pub struct RenderedPage {
    data: Vec<u8>,
    #[wasm_bindgen(readonly)]
    pub width: u32,
    #[wasm_bindgen(readonly)]
    pub height: u32,
    #[wasm_bindgen(readonly)]
    pub png: bool,
}

#[wasm_bindgen]
impl RenderedPage {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.data.clone()
    }
}

#[wasm_bindgen]
impl PdfDocument {
    pub fn load(bytes: Vec<u8>) -> Result<PdfDocument, JsError> {
        Ok(PdfDocument { inner: Document::load(bytes)? })
    }

    #[wasm_bindgen(getter, js_name = pageCount)]
    pub fn page_count(&self) -> usize {
        self.inner.page_count()
    }

    #[wasm_bindgen(js_name = pageSize)]
    pub fn page_size(&self, index: usize) -> Result<PageSize, JsError> {
        let s = self.inner.page_size(index)?;
        Ok(PageSize { width_pt: s.width_pt, height_pt: s.height_pt })
    }

    #[wasm_bindgen(js_name = renderPage)]
    pub fn render_page(&self, index: usize, dpi: f32, encode_png: bool) -> Result<RenderedPage, JsError> {
        let p = self.inner.render_page(index, dpi, encode_png)?;
        Ok(RenderedPage { data: p.data, width: p.width, height: p.height, png: p.png })
    }
}
```

- [ ] **Step 2: Wire the module** — add to the top of `crates/pdf-core/src/lib.rs`

```rust
#[cfg(target_arch = "wasm32")]
mod wasm;
```

- [ ] **Step 3: Verify native build is unbroken**

Run: `cargo test -p pdf-core`
Expected: PASS (5 tests) — the wasm module is cfg'd out natively.

- [ ] **Step 4: Build the wasm package**

Run: `wasm-pack build crates/pdf-core --target web --out-dir ../../packages/pdf/src/pkg --release`
Expected: emits `packages/pdf/src/pkg/pdf_core.js`, `pdf_core_bg.wasm`, `pdf_core.d.ts`. (If `wasm-pack` is absent: `cargo install wasm-pack`.)

- [ ] **Step 5: Confirm the wasm artifact exists and is reasonable**

Run: `ls -la packages/pdf/src/pkg/pdf_core_bg.wasm`
Expected: a `.wasm` file in the low-MB range (feasibility measured ~1.6 MB gzipped).

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/wasm.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf-core): wasm-bindgen boundary and wasm-pack build"
```

---

### Task 4: `@magna-carta/pdf` TS wrapper + JS test

**Files:**

- Create: `packages/pdf/package.json`
- Create: `packages/pdf/tsconfig.json`
- Create: `packages/pdf/src/index.ts`
- Create: `packages/pdf/test/render.test.ts`
- Create: `packages/pdf/test/fixtures/blank.pdf` (copy of Task 1's fixture)
- Create: `packages/pdf/.gitignore` (`src/pkg/`)

**Interfaces:**

- Consumes: the wasm-pack `PdfDocument` (Task 3).
- Produces: `loadDocument(bytes: Uint8Array): Promise<PdfDocument>` and the `PdfDocument` wrapper class with `pageCount`, `pageSize(i)`, `renderPage(i, opts?)`, `[Symbol.dispose]()` / `free()`.

- [ ] **Step 1: Create** `packages/pdf/package.json`

```json
{
  "name": "@magna-carta/pdf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "build:wasm": "wasm-pack build ../../crates/pdf-core --target web --out-dir ../../packages/pdf/src/pkg --release"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create** `packages/pdf/tsconfig.json`

```json
{
  "extends": "@magna-carta/tsconfig/base.json",
  "include": ["src", "test"]
}
```

(If `@magna-carta/tsconfig/base.json` is not the correct shared path, match a sibling package's `tsconfig.json` in `packages/`.)

- [ ] **Step 3: Write the typed wrapper** `packages/pdf/src/index.ts`

```ts
import init, { PdfDocument as WasmDocument } from "./pkg/pdf_core.js";

let ready: Promise<unknown> | undefined;
async function ensureReady(): Promise<void> {
  ready ??= init();
  await ready;
}

export interface PageSize {
  widthPt: number;
  heightPt: number;
}

export interface RenderedPage {
  data: Uint8Array;
  width: number;
  height: number;
  encoding: "rgba8" | "png";
}

export interface RenderOptions {
  dpi?: number;
  encodePng?: boolean;
}

/** A parsed PDF. Call `free()` (or use `using`) to release wasm memory. */
export class PdfDocument {
  private constructor(private readonly handle: WasmDocument) {}

  static async load(bytes: Uint8Array): Promise<PdfDocument> {
    await ensureReady();
    return new PdfDocument(WasmDocument.load(bytes));
  }

  get pageCount(): number {
    return this.handle.pageCount;
  }

  pageSize(index: number): PageSize {
    const s = this.handle.pageSize(index);
    return { widthPt: s.widthPt, heightPt: s.heightPt };
  }

  renderPage(index: number, opts: RenderOptions = {}): RenderedPage {
    const png = opts.encodePng ?? false;
    const r = this.handle.renderPage(index, opts.dpi ?? 150, png);
    return { data: r.data, width: r.width, height: r.height, encoding: png ? "png" : "rgba8" };
  }

  free(): void {
    this.handle.free();
  }

  [Symbol.dispose](): void {
    this.free();
  }
}

export async function loadDocument(bytes: Uint8Array): Promise<PdfDocument> {
  return PdfDocument.load(bytes);
}
```

- [ ] **Step 4: Add the fixture and write the failing test** `packages/pdf/test/render.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDocument } from "../src/index.js";

const blank = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/blank.pdf", import.meta.url))),
);

describe("@magna-carta/pdf", () => {
  it("loads, counts pages, and reports size", async () => {
    const doc = await loadDocument(blank);
    expect(doc.pageCount).toBe(1);
    const size = doc.pageSize(0);
    expect(Math.round(size.widthPt)).toBe(612);
    expect(Math.round(size.heightPt)).toBe(792);
    doc.free();
  });

  it("renders a page to rgba8", async () => {
    const doc = await loadDocument(blank);
    const page = doc.renderPage(0, { dpi: 72 });
    expect(page.encoding).toBe("rgba8");
    expect(page.width).toBe(612);
    expect(page.data.length).toBe(page.width * page.height * 4);
    doc.free();
  });
});
```

- [ ] **Step 5: Build wasm, then run the test, verify it passes**

Run: `pnpm --filter @magna-carta/pdf run build:wasm && pnpm --filter @magna-carta/pdf test`
Expected: PASS (2 tests). (If wasm `init()` needs the `.wasm` URL under Node/Vitest, pass the file bytes to `init()` — adjust `ensureReady` to `init(readFileSync(pkgWasmPath))`; confirm against the wasm-bindgen `web` target loader.)

- [ ] **Step 6: Commit**

```bash
git add packages/pdf
git commit -m "feat(pdf): @magna-carta/pdf typed wrapper over the wasm core"
```

---

### Task 5: Re-home the regression harness as `crates/pdf-eval`

**Files:**

- Create: `crates/pdf-eval/Cargo.toml`
- Create: `crates/pdf-eval/src/main.rs` (port the spike's render/parse/fidelity modes)
- Create: `crates/pdf-eval/corpus.lock` (the manifest from the spike)
- Create: `crates/pdf-eval/corpus-ci/` (a few small committed permissive PDFs for CI smoke)
- Create: `crates/pdf-eval/.gitignore` (`/target/`, `/corpus/`, `/pdfium/`, `/out/`)

**Interfaces:**

- Consumes: `pdf-core` (native `rlib`) for a shared render path; `lopdf`/`pdf`/`pdfium-render`/`image-compare` as before.
- Produces: a CLI with `parse <dir>`, `render <pdf> <out>`, `fidelity <dir> <pdfium.dll>`, and a new `smoke <dir>` that exits non-zero if any file fails to parse+render.

- [ ] **Step 1: Create** `crates/pdf-eval/Cargo.toml` (dev-only; not shipped)

```toml
[package]
name = "pdf-eval"
version = "0.0.0"
edition.workspace = true
publish = false

[dependencies]
pdf-core = { path = "../pdf-core" }
hayro = { workspace = true }
image = { workspace = true }
lopdf = "0.41"
pdf = "0.10"
pdfium-render = "0.9"
image-compare = "0.5"
```

- [ ] **Step 2: Port the harness** — copy the spike's `spikes/pdf-engine-eval/src/main.rs` into `crates/pdf-eval/src/main.rs`, then add a `smoke` mode:

```rust
// Add to the match in main():  Some("smoke") => smoke_mode(args.next().expect("usage: smoke <corpus_dir>")),

fn smoke_mode(dir: String) {
    let mut failures = 0;
    for path in pdfs_in(&dir) {
        let bytes = std::fs::read(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy();
        match pdf_core::Document::load(bytes).and_then(|d| d.render_page(0, 72.0, false)) {
            Ok(p) if p.data.len() == (p.width * p.height * 4) as usize => println!("ok   {name}"),
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
```

- [ ] **Step 3: Add the committed CI corpus** — place 3 small, permissively-licensed/public-domain PDFs in `crates/pdf-eval/corpus-ci/` (e.g. a public-domain government form and two pdf.js Apache-licensed test PDFs; record each source in a header comment in `corpus.lock`). Keep total < 1 MB.

- [ ] **Step 4: Run the smoke gate, verify it passes**

Run: `cargo run -p pdf-eval --release -- smoke crates/pdf-eval/corpus-ci`
Expected: every file prints `ok`, exit 0.

- [ ] **Step 5: Verify parse coverage still works (regression of the spike finding)**

Run: `cargo run -p pdf-eval --release -- parse crates/pdf-eval/corpus-ci`
Expected: lopdf and hayro 100% over the committed corpus.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-eval
git commit -m "feat(pdf-eval): permanent regression harness with CI smoke gate"
```

---

### Task 6: `vp` + CI integration and docs

**Files:**

- Modify: the `vp` task config (the runner under `tooling/` or the root scripts that `vp run build-all` / `vp check` dispatch — inspect first)
- Modify: the CI workflow under `.github/workflows/`
- Create: `packages/pdf/README.md`
- Create: `changelog.d/pdf-engine-core-render.md`
- Create: `docs/decisions/pending/pdf-engine-pure-rust-core.md`
- Create: `docs/decisions/pending/hayro-dependency-doctrine.md`
- Create: `docs/decisions/pending/rust-workspace-layout.md`
- Modify: `ROADMAP.md`, `STATUS.md` (own slice row only)

**Interfaces:**

- Consumes: everything above.
- Produces: a green `cargo fmt --check`, `cargo clippy`, `cargo test`, `wasm-pack build`, and `pdf-eval smoke` in CI; the documentation trail (golden rule 5).

- [ ] **Step 1: Inspect the existing build/CI wiring**

Run: `ls .github/workflows && ls tooling && cat .github/workflows/*.y*ml | head -60`
Expected: identify where the pnpm `check`/`test` gate runs so a Rust job can sit beside it.

- [ ] **Step 2: Add a Rust CI job** to the workflow (mirror the existing job's triggers):

```yaml
rust-pdf-core:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with:
        components: rustfmt, clippy
        targets: wasm32-unknown-unknown
    - run: cargo fmt --manifest-path crates/Cargo.toml --check
    - run: cargo clippy --manifest-path crates/Cargo.toml -- -D warnings
    - run: cargo test --manifest-path crates/Cargo.toml
    - run: cargo run --manifest-path crates/Cargo.toml -p pdf-eval --release -- smoke crates/pdf-eval/corpus-ci
    - run: cargo install wasm-pack && wasm-pack build crates/pdf-core --target web --out-dir /tmp/pkg --release
```

- [ ] **Step 3: Wire `vp`** — add cargo fmt/clippy/test to what `vp check` runs and the wasm build to `vp run build-all`, following the runner's existing task-definition pattern (from Step 1). Show the diff; keep the pnpm gate intact.

- [ ] **Step 4: Verify the gates locally**

Run: `cargo fmt --manifest-path crates/Cargo.toml --check && cargo clippy --manifest-path crates/Cargo.toml -- -D warnings && cargo test --manifest-path crates/Cargo.toml`
Expected: all green.

- [ ] **Step 5: Write the docs** — `packages/pdf/README.md` (what it is, the API, the `free()` rule, the rgba8 default; **no process refs**), the three ADR fragments (frontmatter per [`docs/conventions/`](../conventions/); pure-rust-core / hayro-doctrine / workspace-layout), the changelog fragment, and the `ROADMAP.md` + `STATUS.md` slice rows.

- [ ] **Step 6: Commit**

```bash
git add .github packages/pdf/README.md changelog.d docs/decisions/pending ROADMAP.md STATUS.md tooling
git commit -m "ci(pdf-engine): rust+wasm build gate, vp wiring, and docs"
```

---

## Self-Review

**Spec coverage:** §1 in-scope items → workspace+pdf-core (T1–2), wasm build (T3), `@magna-carta/pdf` (T4), build integration (T6), permanent harness (T5). §3 API → T1–4. §4 toolchain/ADR-0090 → T3, T6. §5 error boundary → `PdfError` (T1) + JS marshalling (T3) + Global Constraints. §6 testing → committed CI smoke (T5), local fidelity (ported in T5), TS test (T4), determinism (renders are deterministic; covered by exact-byte-length asserts and the smoke gate). §8 ADRs → T6 fragments. All covered.

**Placeholder scan:** no TBD/TODO; every code step shows code; the two "confirm against the loader/accessor" notes are explicit fallbacks with the working path given, not blanks.

**Type consistency:** `Document`/`PdfError`/`PageSize`/`RenderedPage` defined T1–2 and consumed unchanged in T3; JS `PdfDocument.load/pageCount/pageSize/renderPage/free` defined T3 and consumed unchanged in T4; `renderPage(index, dpi, encodePng)` arity consistent across Rust, wasm, and TS.

**Note on the spec:** the design names `pdf-core = lopdf + hayro`; this plan puts `lopdf` in `pdf-eval` (parse-coverage) and keeps `pdf-core` on `hayro` only, since the slice-1 API needs no model access (YAGNI). `lopdf` enters `pdf-core` with the redaction/model slice. This is a deliberate, recorded narrowing, consistent with the spec deferring deep-model access (§7).
