# Tabular export rendering — Word and PDF for the export seam

**Status:** Accepted (owner direction, 2026-08-31) · **Area:** Reports / Documents
**Builds on:** the export seam decision
([`a-data-export-is-one-document-and-a-format-is-a-renderer`](../decisions/0411-a-data-export-is-one-document-and-a-format-is-a-renderer.md))
and the accepted rule that an assembled PDF rides the existing conversion edge
([`assembled-pdf-goes-through-the-existing-conversion-edge`](../decisions/0285-assembled-pdf-goes-through-the-existing-conversion-edge.md)).

## What this is

The export menu's fourth and fifth formats: a Word document and a PDF, rendered server-side from
the same tabular export document every other format renders. The owner's direction: **plain
documents now — the job is getting the format right — with themed and letterheaded documents as a
designed seam for later**, and the whole thing seamed for growth, because export must serve many
screens as they quiet down.

## What already exists (verified 2026-08-31)

- The `docx → pdf` conversion edge is **live in production**: the LibreOffice container is built
  (`containers/libreoffice`, `docx→pdf` implemented), the convert worker is deployed, the `CONVERT`
  service binding is present, and `resolveEnginePort` serves a real `libreoffice` port. Several
  documents still describe this as dormant; they are stale.
- Document assembly owns word-processing output and the guarded OOXML package chokepoint
  (`ooxml/package.ts`: caps, byte-reproducible `writePackage`). It is **fill-only** today — nothing
  on the platform can compose a document, and nothing can emit a table.
- The client seam (`apps/web/src/lib/export/`) builds the tabular export document and renders
  text, CSV, and Excel client-side.

## Decisions

1. **The composer is document assembly's second production writer, and it composes tables.**
   `@magna-carta/document-assembly` gains `src/compose/tabular.ts`: a pure function from a
   renderable tabular document to a WordprocessingML package, emitted through the existing
   `writePackage` (pinned timestamps, byte-reproducible), obeying the package's standing rules
   (`xml:space="preserve"` on every `w:t`, one XML declaration per part, content-type overrides
   consistent). Letter page, one-inch margins, a title paragraph, the stamp lines, then each
   section as a bold heading over a bordered table whose header row is bold and repeats across
   page breaks. No renderer, no page model beyond the section properties — layout opinions stay
   LibreOffice's.
2. **Plain is the product; the theme is a seam.** The composer takes the document alone today. The
   future themed treatment is a separate concern the composer's signature reserves: a later
   `frame` parameter naming a firm-registered report template the composer fills — reusing the
   registration ladder and the letterhead machinery, and never a platform-composed second answer
   to what a firm's letterhead looks like.
3. **The wire shape is its own package.** `@magna-carta/export-document` holds the renderable
   document (title, stamp lines, sections of headers and text rows) and its bounded zod schema —
   one home consumed by the web seam and the worker, because a worker cannot import from an app.
   The client maps its richer cells (text + number faces) to text faces at the wire; the composer
   renders text, since WordprocessingML has no typed number cell to preserve.
4. **One route, client-supplied document, bytes back.**
   `POST /api/v1/reports/exports` (`reports.exportRender`, permission `reports:export`, resource
   `firm`, unaudited read-shaped POST in the metadata-tool tradition: pure computation over the
   caller's own payload, nothing stored). Body: the renderable document plus
   `format: "docx" | "pdf"`. The response is the file's bytes. The document arrives from the
   client because the client already holds every figure it contains — the route is a printer, not
   a data source — and the schema's bounds (sections, rows, cell lengths) are the abuse guard.
5. **PDF is the one edge, synchronously, with an honest 503.** The PDF arm calls
   `runConversion("docx", "pdf", composedBytes, resolveEnginePort(env))` — never a new engine,
   adapter, or registry row. A conversion the engine cannot perform is a terminal `422`; an engine
   that is deployed but unreachable (cold container, fault) is a retryable `503`, the
   template-scan precedent, because an Error ID for an engine that is warming is the failure mode
   that rule exists to prevent. If report exports outgrow a synchronous call, the seam is the
   existing conversion job lane, not a new one.
6. **The menu grows two entries.** `Word (.docx)` and `PDF (.pdf)` join the export menu as
   server-rendered formats — async renders over the same document builder, saved through the same
   `saveExport` path with the same stamped filenames.

## Bounds and non-goals

- Schema bounds keep a composed package far under the OOXML chokepoint's 8 MiB caps; a document
  past the bounds is refused by name, never truncated.
- No filing: the rendered file returns to the caller and is stored nowhere. Filing an export to a
  matter is a later, audited decision.
- No new top-level path family (`/api/v1/reports/*` already routes worker-first).
- The trust-compliance pack's "filed artifact" gap is the same missing composer; this slice does
  not build that surface but is the machinery it will stand on.

## Tests

Composer: emitted-package integrity (readPackage round-trip, content-type overrides, integrity
violations empty), escaping, table structure, byte-reproducibility. Route: 401/403, schema-bound
refusals, docx bytes are a readable package, PDF arm against an injected fake engine (the
container cannot run under Miniflare), 503 on an unreachable engine. Client: the two formats
render through the shared menu; a real headless click validated against LibreOffice-converted
output before landing.
