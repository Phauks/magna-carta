---
category: Added
audience: public
---

The export menu gains the two document formats, rendered server-side through the platform's one
printer: `POST /api/v1/reports/exports` takes the tabular document the client already holds (wire
shape and bounds in the new `@magna-carta/export-document` package), composes a plain
word-processing package through document assembly's guarded writer (`compose/tabular.ts`, this
package's first table emitter — byte-reproducible, header rows repeating across pages, figure
columns right-aligned), and for PDF carries those bytes across the registry's one docx-to-pdf edge,
answering an honest 503 when the office-suite engine is unreachable rather than an Error ID. The
route rides the chokepoint under the new `reports:export` permission (seeded to Owner/Admin), and a
failed render surfaces as a toast carrying the server's own words — the design-system Toaster is
now mounted at the app root for it. Spec:
`docs/specs/2026-08-31-tabular-export-rendering-design.md`.

## Public

**Reports now download as Word and PDF.** The Download Report menu on Firm Usage gains **Word
(.docx)** and **PDF (.pdf)** alongside Excel, CSV, and plain text — a clean, printable document
with the same figures the page shows: a title, the generation date and time, and each section as a
table whose header row repeats across pages. If the document engine is briefly unavailable the page
tells you plainly and you can simply try again.
