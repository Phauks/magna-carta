---
number: 413
slug: a-render-endpoint-is-a-printer-not-a-data-source
status: Accepted
date: 2026-08-31
area: Reports
summary: "Word and PDF export renders server-side from the same tabular export document every client format renders, through one route that behaves as a printer: the client sends the document it already holds, the platform composes a plain WordprocessingML package through document assembly's guarded writer, and the PDF arm rides the one live docx-to-pdf conversion edge, synchronously, answering an unreachable engine with a retryable 503 rather than an Error ID. Plain is the product on the owner's direction; the themed and letterheaded treatment is a reserved seam that will fill a firm-registered report template, never a platform-composed second answer to the firm's letterhead. The composer is document assembly's second production writer and the platform's first table emitter; the wire shape lives in its own package because a worker cannot import from an app. Nothing is stored: filing an export is a later, audited decision. Spec: docs/specs/2026-08-31-tabular-export-rendering-design.md."
---

**A server that renders a report the caller already holds is a printer, and a printer neither
stores, guesses, nor styles beyond what it was handed.**

**Context:** The export seam renders text, CSV, and Excel client-side; Word and PDF cannot be
composed in a browser without violating the platform's one-renderer rules. The inventory
(2026-08-31) found the docx-to-pdf edge live in production and exactly one gap: nothing on the
platform composes a document — document assembly is fill-only and no table emitter exists.

**Decision:** as the summary states, with the details and bounds in the spec. The choices worth
holding to when this grows:

- The composer lives in `@magna-carta/document-assembly` beside `assemble` and `fillFormTemplate`,
  under the package's standing rules — the OOXML chokepoint, byte-reproducibility, whitespace
  preservation — and emits no renderer opinions; layout stays the office suite's.
- The theme seam is a parameter naming a firm-registered template to fill, reusing the
  registration ladder and letterhead machinery; a platform-composed letterhead is refused for the
  reason two standing decisions already record.
- The PDF arm is `runConversion` over the existing registry row. No report format may add an
  engine, an adapter, or an edge.
- The route's abuse guard is the wire schema's bounds; a document past them is refused by name.
