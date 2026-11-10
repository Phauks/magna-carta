# General File Converter Tool — Design (buildable-now foundation)

**Date:** 2026-06-22
**Status:** Designed — buildable-now foundation only; widget + server route + engines deferred.
**Scope:** A general, **matter-free** File Converter in the Tools area — drop a file, pick a target
format, get the converted file back, with no upload to an individual matter. This slice builds only
the two **pure, buildable-now pieces**; everything UI-facing or engine-heavy is correctly gated.

## The one-path decision (recap — see `2026-06-21-slice-2-4a-conversion-core-design.md`)

The conversion **core** (`@magna-carta/conversion`) is the single shared path: both the
matter-attached converter and this Tool call `runConversion`. Engine **placement** follows the
parity model (web/desktop parity; desktop adds local accelerations with a server fallback): the
**server-side converter is authoritative** (all formats, including Office/AV via Containers — now
substrate-enabled by slice 2·1), and **client-side image conversion (wasm-vips in the browser) is an
optional later accelerator**, not a divergent second converter. This Tool is that one path **minus
the save-to-matter step**.

## Piece 2 — file-facing helpers in `@magna-carta/conversion` (`src/file.ts`, export `./file`)

Pure utilities over the existing registry + runner, using the Web `File`/`Blob` APIs (present in
Node 18+, Workers, and browsers — the package stays pure: no UI/D1/Hono/env). These are what both the
eventual widget/route and any local accelerator call, so they are reuse-positive, never throwaway.

- **`detectFormat(file: { name: string; type?: string }): FormatId | undefined`** — maps a file's
  MIME `type` (preferred) or filename extension (case-insensitive fallback) to a registered `FormatId`
  via `FORMATS` (`mediaType` / `extensions`). Unknown → `undefined`.
- **`availableTargets(file): readonly FormatId[]`** — `availableConversions(detectFormat(file))`; the
  "Convert to…" options for that file (empty when the source is unrecognized).
- **`convertFile(file, to, resolve?): Promise<FileConversionResult>`** — reads bytes via
  `file.arrayBuffer()`, runs `runConversion(source, to, bytes)`, and on success returns
  `{ ok: true, blob: Blob([bytes], { type: mediaType }), filename }` where `filename` is the source
  name with its extension swapped to the target's primary extension (`photo.png` → `photo.webp`).
  Failures are `{ ok: false, reason, detail? }` — the runner's reasons
  (`unsupported-edge` | `engine-not-implemented` | `adapter-error`) plus a new `unknown-source-format`
  when detection fails.

`FileConversionResult` and a minimal structural `FileLike` (`{ name; type?; arrayBuffer() }`) are
exported so callers need not depend on the DOM `File` type.

## Piece 1 — the Tools catalog entry

- **`@magna-carta/access-control`** — register `"tools:fileConverter"` in the permission registry
  (one line, with a short purpose comment).
- **`@magna-carta/tools`** — add a **`documents`** subject group to `SUBJECT_GROUP_ORDER` +
  `SubjectGroup`, and the catalog row:
  `{ id: "file-converter", name: "File Converter", icon: "file-cog", subjectGroup: "documents",
  permission: assertPermission("tools:fileConverter"), contextTags: ["none"],
  backing: { kind: "library" }, matterContext: "none" }`. Update the catalog test.

## Deferred (correctly gated)

- **The interactive widget** (drop-zone → format picker → convert → download) — rides the 0·7a
  design-system shell, like every other Tools widget.
- **The server route + Container engines** for Office/AV/email — the **authoritative** path; its
  Queue/Container/Durable-Object substrate landed with slice 2·1, so it becomes its own design cycle
  (orchestrator, transient-convert route, the LibreOffice fork-pool / FFmpeg sandbox engine bodies).
- **The optional client-side image accelerator** (wasm-vips in the browser) — the parity fast-path.
- **Role-seeding** — granting `tools:fileConverter` to roles is a per-firm migration; like firm-usage,
  the permission is _registered_ now and _granted_ when the surface lands. No role holding it yet is
  correct (there is no UI to gate). This also keeps the slice off the migration-numbering churn.

## Testing (TDD)

- `detectFormat`: by extension (case-insensitive), by MIME type, unknown → `undefined`.
- `availableTargets`: a PNG file → its reachable image targets.
- `convertFile`: a real PNG `File` → WebP (asserts a `image/webp` `Blob` + `.webp` filename, via
  wasm-vips); unknown source → `unknown-source-format`; unsupported target (png→mp4) →
  `unsupported-edge`; deferred engine (docx→pdf) → `engine-not-implemented`.
- `@magna-carta/tools`: the catalog test covers the new `file-converter` row + the `documents` group;
  the existing catalog-purity fitness still passes (no new impure imports).
