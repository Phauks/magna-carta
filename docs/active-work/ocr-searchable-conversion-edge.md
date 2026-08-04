# ocr-searchable-conversion-edge

**Branch:** `claude/ocr-creation-next-steps-6yko0b` · **Off:** main (f47a258) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-16

## Scope

Wire ADR-0030's reserved scanned-PDF→searchable-PDF edge into the conversion orchestrator, so a scanned
PDF can be made searchable through the normal file-converter job flow (upload → submit → poll), not only
the direct `POST /api/v1/ocr/searchable` route. The OCR engine joins the conversion graph as a new engine
`ocr` behind a distinct `searchable-pdf` format node, resolved per-engineId to the already-live OCR
service binding (the dedicated conversion worker is not needed for this hop).

The other deferred OCR seam — discovery ingest→OCR→index — stays deferred: it is blocked on the unbuilt
discovery/search subsystem (no Tantivy/Vectorize index exists yet).

## Files I expect to touch

- `packages/conversion/src/format.ts` — add engine id `ocr`
- `packages/conversion/src/placement.ts` — `ocr` is server-only
- `packages/conversion/src/registry.ts` — the `searchable-pdf` format node + the `pdf → searchable-pdf` edge
- `apps/worker/src/conversions/conversion-engine.ts` — per-engineId `EngineResolver`; the OCR adapter to `OCR_SERVICE`
- `apps/worker/src/conversions/conversion-consumer.ts` — pass the per-engine resolver through
- tests: `packages/conversion/test/**`, `apps/worker/test/conversion-{engine,consumer}.test.ts`
- docs: `changelog.d/`, `docs/decisions/pending/`, `status.d/searchable-pdf-writer.md`
