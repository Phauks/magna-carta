---
category: Added
---

**Conversion — image-to-PDF via the pure-Rust raster engine.** The raster engine (`containers/raster/`) now converts raster images (PNG, JPEG, WebP, TIFF, GIF, BMP) directly to PDF. Output is a single-page PDF whose page dimensions are set to the image's natural aspect ratio with the longer side at 792 pt, produced entirely in pure Rust via the `krilla` PDF writer — no PDFium, no C codec libraries, no memory-unsafe code in the conversion path. The `image-pdf` edges are registered in `@magna-carta/conversion` as server-only (a PDF-capable container is required; the format is not producible locally in the browser). The `recipe` seam is forwarded through for future page-geometry control.
