---
number: 532
slug: a-tabular-export-pdf-is-composed-by-the-pdf-composer
status: Accepted
date: 2026-11-13
area: Reports
summary: "Every tabular export's PDF (a report, the bulk download, the download tray, a conflicts report, a Directory printout) is composed in the browser by the platform's PDF composer, crates/pdf-compose-core through @magna-carta/pdf-compose, in a Web Worker. The export route renders Word only; its PDF arm, the Word document carried across the office suite's conversion edge, is removed, so there is one way such a PDF is made."
---

**A tabular export's PDF is composed by the platform's PDF composer, and only by it.** The owner's ruling, 2026-11-13, taken before the financial, productivity and operational reports shipped.

**Context.** The export menu's PDF was a Word document composed by document assembly and converted by the office-suite engine (`POST /api/v1/reports/exports` with `format: "pdf"`, the spec `docs/specs/2026-08-31-tabular-export-rendering-design.md`). The platform has since gained a memory-safe Rust PDF composer, already used for the signing Certificate of Completion. Two ways to make the same PDF would be two answers to what a report looks like on paper.

**Decision.**

- `apps/web/src/lib/export/render-pdf.ts` maps the tabular export document onto the composer's document (a title, the generation stamp, a heading and a table per section, landscape past six columns, page numbers in the footer) and composes it in `render-pdf.worker.ts`. Every PDF caller of the export seam goes through it.
- The export route keeps Word alone; `format` keeps its one value, so a later format is a new member rather than a new route. A request for `pdf` is a 422.
- The composer joins the SPA's wasm build (`rust-wasm-build` in `vite.config.ts`).

**Consequences.** A report's PDF no longer needs the office-suite engine, so it works where that engine is warming or absent, and no request leaves the device. Document assembly's PDF (a merged template) still rides the conversion edge: that is a word-processing package carrying a firm's letterhead, which this ruling does not touch. The composer's bundled fonts cover Latin, Greek and Cyrillic; a character outside them draws as an empty box.
