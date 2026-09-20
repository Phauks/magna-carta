# @magna-carta/metadata — local notes

Pure TypeScript engine for the **Metadata Inspector & Scrubber** Tools-area utility: detect a file's
format, report the metadata + content-bearing artifacts it carries (the inspector), and return a cleaned
copy to a chosen degree (the scrubber). No D1, no Hono, no `env`, no Svelte, no network — fully
unit-testable. Consumed by `apps/api-worker/src/routes/files/metadata.ts`; a future matter-action can consume the
same `MetadataPort` directly. Design: `docs/specs/2026-06-22-metadata-tool-design.md`.

- **Shape.** `detect(bytes)` → format → a `MetadataEngine` (`src/ooxml/` for `.docx`, `src/image/` for
  `.jpg`/`.png`). `createMetadataPort()` wraps them with the size cap + typed outcomes
  (`{ ok: false, reason }`, never throws for expected failures). `scrub` re-inspects its OUTPUT so callers
  can confirm `clean`.
- **Every zip read goes through `src/guards.ts`.** `safeUnzip` for content, `zipHasEntry` for detection
  (existence only — it never inflates). Nothing calls `unzipSync` directly: an unguarded inflate anywhere
  makes the caps decorative, and detection runs FIRST, so it is the one that matters most.
- **OOXML scrub is the safety-critical path.** `transformDocumentNodes` (`src/ooxml/scrub.ts`) drops
  `REMOVE_TAGS` (deletions) BEFORE recursing/unwrapping `UNWRAP_TAGS` (insertions) — order matters, or
  deleted text survives a hoist. The walk runs over EVERY content part (`CONTENT_PART_PATTERN` in
  `walk.ts`: document + headers/footers/footnotes/endnotes), not just `document.xml`. Treat any change
  here as redaction-critical: a scrub that requests removal must FULLY remove, and inspect must never
  report a false `clean`.
- **The revision vocabulary is classified in `walk.ts`,** one class per treatment: remove, unwrap, range
  markers, property-change records, cell revisions — plus the two STRUCTURAL cases (`rowIsDeleted`,
  `cellIsDeleted`), where accepting a deletion means dropping the row/cell rather than its marker. Add a
  new revision element to the class it belongs to; `TRACKED_CHANGE_TAGS` (what inspect counts) is derived
  from those sets, so the two halves can never drift apart.
- **Part names live in `src/ooxml/parts.ts`,** shared by inspect and scrub for the same reason: a part
  scrubbed but not inspected passes silently, and a part inspected but not scrubbed never goes `clean`.
  Dropping a part means dropping its `[Content_Types]` Override and the relationships that RESOLVE to it
  (never by target filename — an external hyperlink can end in the same name, and removing it leaves a
  dangling `r:id` that makes a reader declare the document damaged).
- **Image work is segment/chunk surgery, not pixel decoding** (`src/image/`). Assemble output via
  `Uint8Array.set`, never spread-into-push (overflows the stack on large files).
- **Tests are hermetic:** `test/support/docx-fixture.ts` builds docx fixtures with fflate (supports
  `custom`, `comments`, `header`, `settings`, `styles` overrides plus an `extra` map keyed by full part
  name); image tests synthesize JPEG/PNG byte streams.
- **`buildXml` writes the XML declaration; the parser drops the source one** (`ignoreDeclaration`).
  Turning that off puts two declarations in every rewritten part, which is not well-formed XML — a
  "cleaned" document no reader will open, and nothing in a text-content assertion catches it.

## Recurring gotchas (cost real rework — see memory `metadata-tool-status`)

- Pure-package `tsconfig.json` MUST carry its own `compilerOptions` (`allowImportingTsExtensions`,
  `noEmit`, `lib`, `types`) like `packages/whois`; `{extends, include}` alone breaks `.ts` imports under
  `tsc` (TS5097). Vitest (esbuild) does NOT typecheck — only `pnpm check` runs `tsc`.
- Under `noUncheckedIndexedAccess`, `bytes[i]` is `number | undefined`; coalesce (`?? 0`) in bounded
  binary loops.

## Future improvements (deferred — pick up here)

Ordered roughly by value. All sit behind the existing `MetadataEngine` / `MetadataPort` / `detect` seams.

1. **Style- and default-level `w:vanish` detection.** Today only INLINE hidden text (`w:r/w:rPr/w:vanish`)
   is caught. Hidden text applied via a character/paragraph style or the document defaults
   (`styles.xml`, `docDefaults`) is NOT detected — a real redaction gap. Deliberately NOT shipped as a
   partial fix: a half-correct hidden-text detector gives false `clean` confidence, which is worse than a
   known gap. Needs proper style resolution (style inheritance chains + `docDefaults` + vanish toggle
   semantics). Until then, inspect could surface a "styles not analyzed" caveat so `clean` is never
   over-asserted.
2. **Fully-streaming decompression cap.** `safeUnzip` (`src/guards.ts`) pre-checks DECLARED entry sizes via
   fflate's `filter` (catches honest bombs) + a post-inflation backstop, all bounded by the 15 MiB input
   cap — but a zip that UNDER-declares sizes is bounded only by that input cap (a crafted stream can still
   force a large transient allocation → single-isolate OOM). Real fix: fflate's streaming `Unzip`/`unzip`
   (async) with a hard running byte budget that aborts mid-inflation. Ripple: `safeUnzip` →
   `inspectDocx`/`scrubDocx` become async (the port already awaits; `documentEngine` already Promise-wraps).
3. **One unzip per scrub.** A docx scrub inflates twice — once to transform, once to re-inspect the
   output (the port's `clean` confirmation, which is part of the contract and stays). Letting `scrubDocx`
   hand its rebuilt entry map to `inspectDocx` directly would halve the peak, at the cost of widening the
   `MetadataEngine` seam beyond `(bytes) => report`; worth doing only alongside the streaming cap above,
   since both reshape the same call path.
4. **Format breadth.** `.xlsx`/`.pptx` content-artifact scrub (docProps already shared; their tracked
   changes/comments live in `xl/`/`ppt/` parts); TIFF (IFD rewrite); HEIC (ISOBMFF — the original
   Rust→WASM candidate); then PDF (gated on the in-house PDF engine) and legacy `.doc`/`.xls` (OLE).
5. **Rust→WASM image engine.** A measured-trigger swap behind `ImageMetadataEngine` — justified only if a
   forensics tool is greenlit (shared native core) or pure-JS HEIC proves too fragile. Better first-WASM
   candidates (PDF engine, doc/discovery core) are already on the roadmap.
6. **Large-file Container engine** behind the engine interfaces — only if measurement shows the in-worker
   size cap is too limiting.
7. **Matter-action consumer.** "Scrub in place" on a stored file and "auto-scrub before producing/sending",
   consuming this core against R2 bytes (no re-upload). Flips the catalog `matterContext` seam to
   `optional`. The high-value next step — turns an ethereal utility into a guardrail in the discovery/
   production and outbound-comms paths.
8. **Combined single-call endpoint** (inspect + scrub in one request) to avoid the v1 double-upload.

## Adjacent tools that can reuse this substrate

- **Image forensics / AI-image detection** (its own `forensics` subject group, probabilistic): reuses the
  image-metadata reader; pairs with the Safe Website Viewer for evidence work. Reliability/liability
  framing is the core of its own design cycle — never present forensic verdicts as determinations.
- **File hash / integrity** (chain of custody), **Bates stamping**, **PDF redaction** — the discovery-tooling
  family; several become tractable once the PDF engine lands.
