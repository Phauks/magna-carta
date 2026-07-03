# PDF engine — feasibility spike (hayro vs PDFium) — design

**Status:** Draft (spike design) · **Date:** 2026-06-21 · **Owner:** Trevor Goldsmith
**Roadmap home:** [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md) §10 (this is the named pre-slice-1 spike)
**Gates:** nothing downstream proceeds until this produces a go/no-go.

The roadmap picks a pure-Rust **compose-and-fill-gaps** engine over `hayro` (render) + `krilla`/`pdf-writer` (write) + `lopdf`/`pdf-rs` (model), but flags `hayro`'s maturity and unoptimized performance as the primary risk. This spike resolves that risk **with evidence, not opinion**: it measures `hayro` against the incumbent PDFium on fidelity, speed, WASM size, and parse coverage, and outputs a go/no-go.

The spike is a **throwaway measurement instrument** — not shipped, not in the workspace build. Its only durable output is a results note.

---

## 1. Scope

**In:** a Rust harness that runs one corpus through `hayro` and `pdfium-render` (PDFium) and reports four measurements; a curated public corpus; a results note with a go/no-go recommendation and a list of fidelity gaps worth upstreaming.

**Out:** any shipped engine code; the slice-1 design (follows only on a go); redaction/forms/sign (later slices); editing fidelity (render only here); real confidential firm PDFs (feasibility needs _representative_, not _privileged_, documents — see §3).

---

## 2. Architecture

A standalone crate at `spikes/pdf-engine-eval/`, **excluded from the workspace** (its own `Cargo.toml`, not a workspace member), so it never enters CI or the shipped build. Structure:

- `src/main.rs` — CLI: `eval --corpus <dir> --out <dir> [--dpi 150] [--engine both|hayro|pdfium]`.
- `src/render.rs` — render a page to an RGBA raster with each engine at a fixed DPI.
- `src/fidelity.rs` — per-page similarity (SSIM + raw pixel-diff %) with PDFium as reference; classify failures.
- `src/speed.rs` — per-page wall-clock (median/p95), warmup excluded.
- `src/parse.rs` — `lopdf` + `pdf-rs` load over the corpus; success/failure tally.
- `src/report.rs` — emit `results.json` + a human Markdown summary.
- A separate tiny step measures **WASM size** (§4.3) — a `wasm32-unknown-unknown` build of a minimal `hayro`-render entrypoint, gzipped, vs the PDFium WASM the EmbedPDF stack ships.

PDFium binary: `pdfium-render` loads a prebuilt PDFium dynamic library; the harness documents the exact build it pulled (so "reference" is reproducible).

---

## 3. Corpus (public only — no confidential firm data)

Three tiers, staged under `spikes/pdf-engine-eval/corpus/` (gitignored; a `corpus.lock` manifest records sources + hashes so it's reproducible without committing binaries):

1. **Regression suites** — the pdf.js and PDFBox test PDFs `hayro` already targets (permissive licenses). Broad correctness signal across the format.
2. **Legal-representative set (~10–15, weighted heaviest in the verdict)** — hand-picked from public sources: a court e-filing, an image-only scanned page, a fillable **AcroForm** court form, a Bates-stamped production page, an annotated PDF, a PDF/A, a multi-column brief with embedded fonts.
3. **Pathological** — a few known-malformed PDFs (the long tail PDFium survives from years of hardening).

Confidential firm PDFs are **deliberately excluded**: feasibility is about engine capability on document _shapes_, and using privileged material would violate the confidentiality principle for no measurement gain.

---

## 4. Measurements

### 4.1 Fidelity (primary)

Render every page with both engines to RGBA at fixed DPI; score each page against PDFium with **SSIM** (and record raw pixel-diff %). For every page below threshold, classify the cause into buckets — **fonts** (non-embedded CID is a known `hayro` gap), **knockout groups** (known gap), **shading/gradients**, **transparency**, **other** — so a failure is _diagnosed_. Report: % pages ≥ threshold overall and per-tier, and the worst offenders with their bucket.

### 4.2 Speed

Per-page render wall-clock, `hayro` vs PDFium, median + p95, warmup iterations discarded. Reported per tier (the legal set matters most).

### 4.3 WASM size

Gzipped `wasm32` artifact of a minimal `hayro` render entrypoint vs the PDFium WASM the current EmbedPDF/client stack ships. This is the client-bundle cost of the "client-side-by-default" principle and a real adoption gate.

### 4.4 Parse coverage

`lopdf` and `pdf-rs` load success rate across the whole corpus — a proxy for model robustness before we build the redaction/forms layers on it.

---

## 5. Go/no-go criteria (pragmatic bar)

**Go** if all hold on the **legal-representative set** (tier 2), with the regression suite as a secondary signal:

- **Fidelity:** ≥ 95% of pages at **SSIM ≥ 0.98** vs PDFium, **and** the sub-threshold failures fall in _fixable/upstreamable_ buckets (fonts, knockout, shading) — not fundamental interpreter gaps.
- **Speed:** `hayro` ≤ **3×** PDFium median per-page. (Generous on purpose — upstream perf is an acknowledged TODO and an area we can contribute; this gate is "not pathologically slow," not "already fast.")
- **WASM size:** ≤ **~1.5×** the PDFium WASM, ideally smaller.
- **Parse coverage:** ≥ **99%** of the corpus loads in `lopdf`/`pdf-rs`.

**No-go / wait** if fidelity failures are fundamental, speed is > 3× with no clear optimization path, or parse coverage is low enough to threaten the gap-build layers. A no-go is **"wait for `hayro` to mature,"** not "abandon the strategy" — the roadmap's parallel-track posture means PDFium keeps shipping meanwhile (roadmap §8).

**Conditional go** is an allowed verdict: go _for a specific capability_ (e.g. preview rendering) while a weak area (e.g. complex forms) waits.

---

## 6. Output

A results note `docs/specs/2026-06-2x-pdf-engine-feasibility-results.md` containing: the four measurement tables, the verdict against §5, the classified fidelity-gap list (candidate `hayro` upstream contributions), and the exact corpus + PDFium build used. On a go, the slice-1 spec follows and raises the `pdf-engine-pure-rust-core` and `hayro-dependency-doctrine` ADRs (roadmap §10).

---

## 7. Risks & limitations (honest)

- **PDFium as the fidelity _reference_ is an assumption**, not ground truth — PDFium can itself be wrong on a page. Mitigation: spot-check the worst-diff pages by eye; a diff means "differs from PDFium," which the human read resolves.
- **Toolchain friction on Windows** — `pdfium-render` needs a prebuilt PDFium library; the WASM build needs the `wasm32` target. The harness records exactly what it pulled; if a step can't run locally, the note says so rather than guessing.
- **Corpus is representative, not exhaustive** — a green spike de-risks but does not guarantee the long tail; that is what the slice-1 parallel-evaluation track (PDFium stays live) is for.
- **Throwaway, so under-engineered on purpose** — no broad error handling beyond "log and continue per file"; the goal is numbers, not a product.
