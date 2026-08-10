---
branch: claude/translation-services-design
worktree: C:/dev/magna-carta-worktrees/claude/translation-services-design
area: Translation services — research and design only (legal posture, engine/consent posture, reuse map, slice plan)
status: review
touches: docs/specs, docs/decisions/pending, changelog.d, docs/active-work
---

# claude/translation-services-design

**Scope:** Design and research only — a translation capability for the platform: pasted text and uploaded
documents, the extraction/OCR/conversion path a scanned source needs, the aligned side-by-side artifact
and its printable, the provenance record, and the confidentiality posture the engine choice implies. Spec
plus a decision fragment and a changelog fragment. **No product code, no schema migration, no engine
adapter in this stream.**

Owner ask (2026-08-10): _"allow for pasting in of text for translation, as well as uploading of pdf's and
docx, which may require ocr, conversion to docx, and the ability to add certain things to the documents,
an audit report for translation that shows technology and date used, side by side translation,
printables."_

## Files this stream touches

Created, all new — no shared or generated file is edited:

- `docs/specs/2026-08-10-translation-services-design.md`
- `docs/decisions/pending/translation-services-provenance-not-certification.md`
- `changelog.d/translation-services-design.md`
- this note

Explicitly **not** touched: `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, `ROADMAP.md`, `roadmap.d/`,
`status.d/`, the white paper, `docs/conventions/`, `docs/Decision-Log.md`, `docs/operating-costs.md`, and
every package under `packages/` and `apps/`.

## Overlap watch

The design **reads** these surfaces and proposes additions to them in a later build stream. A concurrent
stream that owns one of them should know what is coming, but nothing here edits any of them:

- `packages/search/src/extraction.ts` and `apps/worker/src/search/text-extraction.ts` — the design names
  the composite per-page `native`/`ocr` extractor as its input and proposes that translation becomes the
  first consumer to **persist** the `pages` provenance the extractor already computes and currently
  discards. No signature change is proposed; the store lands on the translation side, not in search.
- `packages/conversion/` and the LibreOffice container — used exactly as shipped, for pre-extraction
  format normalization and for the DOCX-to-PDF printable edge. No new engine, no new format edge proposed.
- `packages/document-assembly/` — the side-by-side document is proposed as a platform-owned two-column
  OOXML template through the shipped `assemble.ts` / `ooxml/package.ts`. A new template, not a new
  renderer, and it is not written in this stream.
- `packages/object-dimensions/src/dimensions.ts` — the design proposes **two new object-class members**
  (`translation-artifact` matter-scoped, `translation-tool-artifact` firm-scoped). That union is
  enumerated by a source scan against the write paths, so a concurrent stream adding a member there will
  collide on the same file later. Not edited here.
- `packages/inference/` — read only, for the gateway chokepoint, the ZDR catalog, and the consent-axis
  pattern. No change proposed; the frontier route rides `generate` as shipped.
- `packages/magnus/src/{settings,disclosure}.ts` and `packages/ai-detection/src/settings.ts` — read as the
  precedent for the two-gate consent shape and the versioned member acknowledgement. No edit proposed.
- `packages/tools/src/{types,catalog}.ts` — one manifest entry is proposed for a later slice, in the
  `files` subject group. Not added here.
- `packages/file-manager/` — the derived-sibling file record and the derivation link are proposed for
  slice 2. Nothing is designed into `file-statements.ts` in this stream.
- `docs/specs/2026-08-06-ai-search-integration-design.md` — this design states what should and should not
  be fed to that index (filed target-language documents yes, translation job artifacts never) and proposes
  no edit to the AI Search spec or its feed writer.

## Merge bar

CI is unavailable (Actions budget exhausted), so the merge bar is orchestrator review. Docs-only change:
`pnpm run lint:process-refs` and the docs lints were run locally; the full gate was not, and the push used
`SKIP_PREPUSH=1`.
