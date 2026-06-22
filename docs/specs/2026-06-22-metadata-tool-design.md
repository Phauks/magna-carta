# Metadata Inspector & Scrubber — design

**Status:** Accepted (design) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ ("pure utilities are libraries, not plugins").
**Builds on:** the Tools area (`docs/specs/2026-06-16-tools-area-design.md`, ADR-0101) · the file-converter tool · the conversion package's port/registry shape (`packages/conversion`).
**ADRs (new, to record):**

- **ADR-BBBB** — Metadata-tool architecture: ephemeral/stateless inspect+scrub, the `MetadataPort` seam with a size cap, the document/image engine split behind interfaces, and scrub semantics.

> **Language decision (settled 2026-06-22).** An earlier draft put the image engine in Rust → WASM (the
> repo's first WASM module), shared with a future forensics tool. On review that did not pay for itself: the
> scrubber's image job is metadata-segment surgery (easy in TypeScript for JPEG/PNG/TIFF), the only genuinely
> JS-hard format is HEIC (rare, usually converted first), and the reuse case rested on an undesigned,
> uncommitted forensics tool whose real Rust value (pixel analysis) is a separate build anyway. The tool is
> therefore **all-TypeScript behind an `ImageMetadataEngine` interface**; Rust → WASM is a measured-trigger
> swap behind that interface (§8), justified only when forensics is greenlit or JS HEIC proves too fragile.
> Better first-WASM candidates (the PDF engine, the doc/discovery core) are already on the roadmap.

A law firm's most common metadata hazard is **inadvertent disclosure**: sending a `.docx` that still carries
tracked changes, comments, hidden text, author/firm names, or edit history can leak privileged work product.
This design adds an ethereal Tools-area utility — **Metadata Inspector & Scrubber** — that shows exactly what a
file carries (the _inspector_) and produces a cleaned copy to a chosen degree (the _scrubber_). It is built
core-first so the same engine can later back a matter-action ("scrub this file in place", "auto-scrub before
producing/sending"), per the Tools-area principle: _do matter-grade work without committing it to a matter._

This tool is **all-TypeScript**, with its document and image work behind small swappable engine interfaces. A
separate future tool (image forensics / AI-image detection, subject group `forensics`) may reuse this tool's
image-metadata reader but is **out of scope here** — see §8.

---

## 0. Why this is two tools, not one

The first instinct is to fold "inspect/scrub a file" and "is this image tampered / AI-generated" into one
image tool. They are deliberately kept apart:

- **Different purpose and risk.** The scrubber is _deterministic outbound hygiene_ — remove field X, accept
  change Y; every run is identical and safe to rely on. Forensics is _probabilistic inbound analysis_ —
  heuristics and ML that can be wrong, in an evidence context where a confident-looking wrong answer is a
  liability. Fusing a "reliable" tool with a "caveated guess" tool blurs the one line that must stay crisp.
- **Different substrate breadth.** The scrubber is multi-format (OOXML now; PDF/legacy later) and most of its
  code is zip/XML surgery unrelated to images. Forensics is image-only and most of its code is
  pixel/compression analysis unrelated to documents.
- **The only real overlap is reading image metadata** (EXIF/IPTC/XMP) — the scrubber reads it to _strip_ it,
  forensics reads the same to _interpret_ it (the "Adobe Photoshop" software tag, XMP edit history,
  thumbnail-vs-image mismatch are classic tamper signals). That is a single shared low-level capability — image
  metadata reading — not a reason to merge the tools. Forensics, if built, can reuse this tool's
  `ImageMetadataEngine` (§2) or reimplement that thin reader; either way the bulk of forensics (pixel analysis)
  is its own build.

So: two tools in two subject groups (`documents` vs `forensics`).

## 1. Module placement

Mirroring the codebase's structure-vs-UI seam and the existing tool packages (`whois`, `safe-browse`,
`conversion`):

- **`@magna-carta/metadata`** — new **pure** TypeScript package. No D1, no Hono, no `env`, no Svelte, no
  network — fully unit-testable. Files (indicative):
  - `src/port.ts` — `MetadataPort` (`inspect`, `scrub`) + the result/option types.
  - `src/detect.ts` — real-format detection (magic bytes, not extension) → engine selection.
  - `src/report.ts` — the `MetadataReport` / `Finding` model (§4).
  - `src/ooxml/` — the OOXML engine (implements `DocumentMetadataEngine`; §3).
  - `src/image/` — the image engine (implements `ImageMetadataEngine`; TypeScript; §3).
  - `src/scrub.ts` — `scrubAll` / `scrubSelected` orchestration over the engines.
  - Dependencies: a Workers-compatible zip lib (`fflate`) + an XML parser + a small JPEG/PNG/TIFF
    metadata-segment library (or hand-rolled segment walking). Nothing from the integration framework or
    credentials.
- **`@magna-carta/tools`** — one new catalog row (§5); no logic.
- **`@magna-carta/access-control`** — one new `tools:metadataScrubber` permission.
- **The Worker** — a new route module (§5) registered through the chokepoint, plus a migration seeding the
  permission to roles.
- **The shell (design-system / web app)** — the `id → Svelte entry component` map and the widget UI; lands
  with the design-system Tools shell, exactly as the other tools' widgets do. Until then the route is
  exercised via the throwaway `/__dev/web-tools` demo page.

Direction: `tools` ← shell; `metadata` ← worker route ← shell. `metadata` depends only on leaf libraries.

## 2. Architecture — Approach C (port seam)

The engine runs **where it is cheapest and most testable**, behind a port so heavier execution can be swapped
in later only if measurement justifies it (golden rule 10 — seam now, heavy machinery when measured):

```
MetadataPort
 ├─ inspect(bytes, filename) → MetadataReport
 └─ scrub(bytes, filename, options) → { bytes, report }   // report = re-inspection of the OUTPUT

 detect(bytes) → "ooxml-word" | "ooxml-cell" | "ooxml-slide" | "image-jpeg" | … | "unsupported"
   ├─ OOXML  → DocumentMetadataEngine (TypeScript: fflate + XML surgery)   [in-worker]
   └─ image  → ImageMetadataEngine    (TypeScript: segment/chunk surgery)  [in-worker]
```

The two engines sit behind small interfaces (`DocumentMetadataEngine`, `ImageMetadataEngine`), each exposing
`inspect` + `scrub`. The interface is the seam: a heavier implementation (a Container engine for large files, or
a Rust → WASM image engine — §8) can be swapped in later without touching `MetadataPort`, the route, or the UI.

- **OOXML engine — TypeScript, in-worker.** `fflate` unzips the package in memory; the engine reads/edits the
  relevant parts (§3) and re-zips. The hard part — accepting tracked changes — is _logic, not throughput_, so
  TS is appropriate; it matches the in-worker precedent of `whois`/`safe-browse` and runs in the Vitest worker
  pool with real bindings (fast iteration, easy fixtures). The Cloudflare Container binding is deploy-time-only
  and cannot run in the local test pool, so a container engine would inherit a test-integration gap for no
  benefit on the small files this tool targets.
- **Image engine — TypeScript, in-worker.** Stripping image metadata is _segment/chunk surgery_, not pixel
  decoding: walk JPEG APPn markers, PNG ancillary chunks, or TIFF IFDs and drop the metadata-bearing ones. This
  is well within TS's reach and keeps the tool single-language, single-toolchain, and fast to ship. It touches
  only headers/segments, never decodes pixels, so it stays well within the isolate memory budget. See the
  language decision note above and §8 for why Rust → WASM was rejected for v1.
- **Size cap.** This is an ephemeral, small-file tool: it refuses files over a configured threshold with a
  clear message rather than doing heavy work on the hot path. The interface lets a Container engine take large
  files later — a named seam, built only if measured.

## 3. What gets inspected and scrubbed

**OOXML (`.docx`, `.xlsx`, `.pptx`)** — a ZIP of XML parts. The engine targets:

- `docProps/core.xml` — `dc:creator`, `cp:lastModifiedBy`, `dcterms:created`/`modified`, `cp:revision`,
  `dc:title`/`subject`/`description`, `cp:keywords`, `cp:category`, `cp:contentStatus`, `cp:lastPrinted`.
- `docProps/app.xml` — `Company`, `Manager`, `Template`, `TotalTime`, `Application`, `AppVersion`.
- `docProps/custom.xml` — custom document properties.
- main content + headers/footers (`word/document.xml`, `xl/…`, `ppt/…`) — **tracked changes**
  (`w:ins`/`w:del`/`w:moveFrom`/`w:moveTo` and the `*Change` revision records) and **hidden text**
  (`w:vanish`); format-specific equivalents for cells/slides.
- comments parts (`word/comments*.xml`, `people.xml`, and the xlsx/pptx equivalents) — comments and the author
  names attached to them.

**Images (`.jpg`/`.jpeg`, `.png`, `.tiff`)** — EXIF/IPTC/XMP including **GPS coordinates**, capture device,
timestamps, the **software tag** (e.g. "Adobe Photoshop"), and XMP edit history; plus thumbnail data. **HEIC is
deferred** (§8) — it is an ISOBMFF container with thin JS support and is the rarest scrub target (an iPhone
capture format, usually converted to JPEG before use).

## 4. Behaviour & data model

**Inspect** returns a structured `MetadataReport`: `Finding`s grouped by **category** —
`identifying-metadata`, `tracked-changes`, `comments`, `hidden-content`, `custom-properties` (documents);
`camera-gps`, `software`, `edit-history` (images) — each `Finding` carrying a **risk level**
(`high`/`medium`/`low`), a human label, a count, and a default scrub action.

**Scrub** offers:

- **One-click "Make safe to send"** — the safe default: strip identifying metadata, **accept** all tracked
  changes, **delete** comments, **remove** hidden text, drop custom properties; strip all image metadata.
- **Granular toggles** — derived from the findings, letting the user keep specific items.

The core exposes both `scrubAll(bytes, filename)` and `scrubSelected(bytes, filename, options)`. Scrub is a
_transformation_ of content-bearing artifacts (accepting changes / deleting comments changes what the document
contains), which the UI states plainly. The input is **never mutated**; a fresh cleaned copy is returned, and
the returned `report` is a **re-inspection of the output** so the UI can confirm "clean". Nothing is persisted
— the tool is stateless and record-less (the ethereal principle).

## 5. Worker surface

Through the chokepoint, registered with full `RouteMeta`:

- `POST /api/v1/metadata/inspect` — accepts an uploaded file, returns `MetadataReport` JSON.
- `POST /api/v1/metadata/scrub` — accepts the file + scrub options, returns the cleaned **binary** plus a
  re-inspection confirmation.

Both: permission `tools:metadataScrubber`, `resource: "firm"`, no matter binding. Stateless **double-upload**
(inspect, then scrub) is the v1 trade-off — simplest and record-less; a combined single-call variant is a
later option noted here, not built. New catalog row in `@magna-carta/tools`:

```
id: "metadata-scrubber", name: "Metadata Inspector & Scrubber", icon: "file-search" (Lucide),
subjectGroup: "documents", permission: tools:metadataScrubber, contextTags: ["none"],
backing: { kind: "library" }, matterContext: "none"
```

`matterContext: "none"` now; the seam to `optional` (attach output/audit to a matter) is the future
matter-action consumer of the same core.

## 6. Security

- **Decompression-bomb guards** on OOXML unzip: cap total inflated size, entry count, and per-entry
  compression ratio — refuse rather than expand (echoing the scan engine's `AlertExceedsMax` precedent).
- **Size cap** on the input (§2), enforced before any processing.
- **Real-format validation** by magic bytes, not extension — reject a non-OOXML payload masquerading as a zip.
- **Redaction by default** (golden rule 4): file contents and extracted metadata values are **never** logged;
  errors correlate by ID only. Processing is in-memory; nothing is written to R2 or D1.

## 7. Testing

- **TS core:** fixtures — a `.docx` (and `.xlsx`/`.pptx`) with known author, comments, tracked changes, and
  hidden text — with golden `scrub → re-inspect → assert clean` assertions, plus assertions that scrubbing
  preserves the visible document body.
- **Image engine:** fixtures — JPEG with GPS EXIF, PNG text chunks, TIFF IFDs — with golden
  `scrub → re-inspect → assert no metadata remains` assertions, and a check that the decoded image is
  byte-for-byte unchanged except for the removed segments.
- **Worker route:** Vitest worker pool (real bindings) for `inspect`/`scrub` happy paths + permission gating.
- **Security:** decompression-bomb, oversize, and masquerade-format fixtures each return a clean refusal.

## 8. Out of scope / future seams

- **Image forensics / AI-image detection** — a separate future tool, subject group `forensics`, that may reuse
  this tool's `ImageMetadataEngine` for its metadata-signal reads. Tamper-localization (ELA,
  JPEG-ghost/double-compression, clone detection, PRNU/noise, metadata-based signals) and AI-origin detection
  (C2PA / Content Credentials provenance — defensible; ML classifiers — probabilistic, likely
  integration-backed) are **investigative aids that flag regions/indicators for a qualified examiner, never
  determinations**. Reliability/liability framing is the core of that tool's own design cycle and is not
  settled here.
- **HEIC** — deferred behind `ImageMetadataEngine`. Trigger: real demand for HEIC scrubbing; until then, route
  HEIC through the existing file converter to JPEG first, then scrub.
- **Rust → WASM image engine** — a measured-trigger swap behind `ImageMetadataEngine`, justified only if the
  forensics tool is greenlit (and wants a shared native core) **or** pure-JS handling (esp. HEIC) proves too
  fragile. The WASM toolchain itself is better introduced by the PDF engine / doc-discovery core already on the
  roadmap; if those land first, this engine inherits the toolchain rather than founding it.
- **PDF** (info-dictionary/XMP inspect+scrub; annotations/redaction) — deferred behind the same `MetadataPort`
  until the in-house PDF engine and Phase 2 deployment land.
- **Legacy `.doc`/`.xls`** (OLE compound) — deferred.
- **Large-file Container engine** behind the engine interfaces — built only if measurement shows the in-worker
  path's size cap is too limiting.
- **Combined single-call inspect+scrub** endpoint — to avoid double-upload of large files.
- **Matter-action consumer** — "scrub in place" / "auto-scrub before producing/sending", consuming the same
  core against R2 bytes (no re-upload); flips this tool's `matterContext` seam to `optional`.
