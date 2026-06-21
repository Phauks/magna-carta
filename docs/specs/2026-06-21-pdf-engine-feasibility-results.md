# PDF engine — feasibility-spike results (hayro vs PDFium)

**Status:** In progress — 3 of 4 measurements done · **Date:** 2026-06-21 · **Owner:** Trevor Goldsmith
**Spike design:** [`2026-06-21-pdf-engine-feasibility-spike.md`](2026-06-21-pdf-engine-feasibility-spike.md)
**Harness:** `spikes/pdf-engine-eval` (render + parse), `spikes/pdf-engine-wasm` (size) — throwaway, not workspace members
**Environment:** Rust 1.94.0, Windows 11, hayro 0.7.1 / lopdf 0.41 / pdf-rs 0.10

## Provisional verdict: **leaning GO**

Three of the four measurements are in and all clear the pragmatic bar; the fourth (PDFium-referenced SSIM) is the only one outstanding, and qualitative render fidelity on the legal set is already visibly high. The crux risk the roadmap named — *pure-Rust render fidelity* — is empirically retired in-environment.

---

## 1. Render (hayro) — PASS (milestone 1)

hayro 0.7.1 compiled cleanly (no toolchain wrangling) and rendered every corpus PDF. Spot-checks of the rasterized output:

- **TAMReview.pdf** (23-pp academic paper) — logos, colored sidebars, multi-font text, abstract, hyperlinks, CC badge all faithful.
- **IRS W-9** (fillable AcroForm) — checkboxes, table borders, fine print intact.
- **AO 88 subpoena** (US court form) — court caption, `)` party brackets, signature lines, italic instructions, footnotes correct.

Speed: ~40–260 ms/page at 2× scale, single-threaded, unoptimized upstream. Well inside the "not pathologically slow" gate.

## 2. Parse coverage — PASS

Over a 10-PDF legal-representative corpus (3 US court forms, 2 IRS fillable AcroForms, academic + image + CMYK samples; `corpus.lock` manifest, binaries gitignored):

| Crate | Coverage |
| --- | --- |
| **lopdf** | **10/10 (100%)** |
| **hayro** | **10/10 (100%)** |
| pdf-rs | 9/10 (90%) — fails `basicapi.pdf` |

All three correctly **rejected** a disguised-HTML bad download (no false-accepts). **Finding: adopt `lopdf` as the primary model crate, `pdf-rs` as secondary.** Clears the ≥99% bar for the model layer.

## 3. WASM size — PASS

hayro built to `wasm32-unknown-unknown` with **zero friction** (no getrandom/threading blockers) — itself a derisking signal for client-side-by-default. Size of the render+parse+png path (size-optimized profile, stripped, pre-`wasm-opt`):

| | Bytes | ≈ |
| --- | --- | --- |
| raw | 4,058,896 | 3.87 MB |
| **gzip -9** | **1,631,253** | **1.56 MB** |

Published PDFium WASM builds run ~3–4 MB gzipped, so hayro is **~half the size** — under the ≤~1.5× bar, and *smaller*, not larger. (Exact in-repo diff deferred: no PDFium WASM is installed yet — the viewer UI is still deferred. `wasm-opt` would shave further.)

## 4. PDFium-referenced SSIM fidelity — OUTSTANDING

The one step with toolchain friction (needs a prebuilt PDFium dynamic library for `pdfium-render`). Will quantify the eyeballed fidelity above into a per-page SSIM % and classify any sub-threshold pages. Pending owner go-ahead to pull the PDFium binary.

---

## Findings carried forward

- **Primary model crate = `lopdf`** (100% parse; `pdf-rs` secondary at 90%).
- **hayro API gotchas** (for slice 1): `InterpreterSettings` re-exports from `hayro::hayro_interpret` (not the crate root); load via `Pdf::new(bytes) -> Result`; render via `render(page, &cache, &interp, &settings)` → `pixmap.into_png()`.
- **hayro → wasm is clean** — no platform shims needed for the client target.
- **Known upstream gaps to watch** (from hayro's own docs): knockout groups, non-embedded CID fonts — to confirm against the SSIM classification in step 4.
