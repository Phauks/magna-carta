# Slice 2·4e — image→PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the pure-Rust raster engine (`containers/raster`) convert images to PDF (`to = "pdf"`) using the `krilla` PDF writer, and register the image→PDF edges (server-only) in `@magna-carta/conversion`.

**Architecture:** image→PDF extends the raster Container (decode via the `image` crate → wrap in a single-page PDF via pure-Rust `krilla`). The convert worker is unchanged (engine-agnostic server resolver; routes by `from`/`to`). The registry adds a server-only `"image-pdf"` engineId + the edges so pathfinding knows the conversion exists.

**Tech Stack:** Rust (`image`, `krilla` — pure Rust, no C), `axum`; TypeScript (`@magna-carta/conversion`); `cargo`/`clippy`/`rustfmt`; `vp`.

## Global Constraints

- **Pure Rust, no C/`-sys`** (golden rule 14): `krilla` and its tree must be C-free. **At build, run `cargo tree -i cc` + grep `Cargo.lock` for `-sys`/`cc`/`ravif`/`libfuzzer-sys` — the Task-1 lesson; only `windows-sys` is acceptable.** Use krilla's minimal features (no `svg`/`rayon` unless required).
- **No panic/OOM/hang on the per-request path**: reuse the existing limited decode (`image::Limits`) for the `to="pdf"` path; a malformed image → `ConvertError::Decode` (422); a krilla failure → `ConvertError::Encode` (500). Never `unwrap()` on request input.
- **The `/convert` contract is unchanged** — `to = "pdf"` flows through existing header handling; success → `200` + `Content-Type: application/pdf`.
- **image→PDF is SERVER-ONLY**: engineId `"image-pdf"` placement `["server"]` — never tag it local (or `canConvertLocally` would wrongly allow it).
- Full names; `.ts` extensions; `import type`; no process-ref strings; commit `Cargo.lock`; verify crate pins on docs.rs.
- Rust gate (from `containers/raster/`): `cargo test` + `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings`.

---

### Task 1: image→PDF in the raster engine (`convert.rs`) + the route test

**Files:**
- Modify: `containers/raster/Cargo.toml` (add `krilla`), `containers/raster/src/convert.rs`, `containers/raster/src/lib.rs` (a route test)

**Interfaces:**
- Consumes: the existing `convert(bytes, source_format, target_format, recipe)`, the limited-decode helper, `ConvertError`.
- Produces: `convert` now returns a valid PDF (`%PDF-…`, `application/pdf`) when `target_format == "pdf"`.

- [ ] **Step 1: Verify `krilla` on docs.rs (golden rule 11)** — current version, the image-embedding API (`krilla::image::Image` construction from an `image` `DynamicImage` or from encoded bytes; `Document` → `Page::new(size)` → `Surface::draw_image`/`push_image`), and the minimal feature set. Add `krilla = "<version>"` to `Cargo.toml` (no extra features). Run `cargo build`, then **prove C-free**: `cargo tree -i cc` (must be "not found") + grep `Cargo.lock` for `cc`/`-sys` (only `windows-sys` allowed). If krilla drags in C, narrow features or report BLOCKED.

- [ ] **Step 2: Write the failing tests** in `convert.rs` (`#[cfg(test)]`):

```rust
#[test]
fn wraps_png_into_a_single_page_pdf() {
    let src = png_bytes(120, 80); // existing test helper
    let (out, mime) = convert(&src, "png", "pdf", "image-pdf").expect("convert ok");
    assert_eq!(mime, "application/pdf");
    assert!(out.starts_with(b"%PDF-"), "PDF magic header");
    // a single page: the PDF names one /Type /Page (cheap structural check)
    let text = String::from_utf8_lossy(&out);
    assert_eq!(text.matches("/Type /Page").count().max(text.matches("/Type/Page").count()), 1);
}

#[test]
fn pdf_target_still_rejects_a_malformed_source() {
    let garbage = [0u8, 1, 2, 3, 4, 5, 6, 7];
    assert!(convert(&garbage, "png", "pdf", "image-pdf").is_err());
}
```

(The `/Type /Page` assertion is a loose structural check tolerant of krilla's serialization; if krilla compresses object streams so the marker isn't literal, assert instead that the bytes re-parse via a minimal check — e.g. `lopdf::Document::load_mem(&out)` succeeds with `get_pages().len() == 1` — add `lopdf` as a dev-dependency only if needed.)

- [ ] **Step 3: Run RED.** `cd containers/raster && cargo test pdf` → fail (pdf target currently → `UnsupportedFormat`).

- [ ] **Step 4: Implement.** In `convert`, BEFORE `image_format(target_format)`, branch:

```rust
if target_format == "pdf" {
    let image = decode_source(bytes, source_format)?; // reuse the existing limited-decode path
    let pdf = image_to_pdf(&image).map_err(|_| ConvertError::Encode)?;
    return Ok((pdf, "application/pdf"));
}
```

Add `fn image_to_pdf(image: &DynamicImage) -> Result<Vec<u8>, ...>` using krilla (verify the exact API): a single page sized to the image's aspect with the **longer side = 792.0 pt**, shorter side scaled by aspect; draw the image to fill the page; finish → bytes. Refactor the existing decode into a `decode_source(bytes, source_format) -> Result<DynamicImage, ConvertError>` helper (DRY — both the raster path and the pdf path use it) including the `image::Limits` guard.

- [ ] **Step 5: Run GREEN.** `cargo test` (all, incl. the raster tests) green; `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` clean.

- [ ] **Step 6: Add a route test** in `lib.rs` (`#[cfg(test)]`, `oneshot`): `POST /convert` with a small PNG body + `x-target-format: pdf` → `200`, `content-type: application/pdf`, body starts `%PDF-`. Run green.

- [ ] **Step 7: Commit** — `git add containers/raster && git commit -m "feat(raster): image->PDF output via the pure-Rust krilla writer"`.

---

### Task 2: Register the image→PDF edges (server-only) in `@magna-carta/conversion`

**Files:**
- Modify: `packages/conversion/src/format.ts` (the `EngineId` union), `packages/conversion/src/placement.ts` (`ENGINE_PLACEMENTS`), `packages/conversion/src/registry.ts` (the edges)
- Test: the package's registry / pathfinding / placement tests

**Interfaces:**
- Consumes: the `EngineId` type, `ENGINE_PLACEMENTS`, the edge list, `findPath`, `canConvertLocally`.
- Produces: `png/jpeg/webp/tiff/gif/bmp → pdf` edges under engineId `"image-pdf"` (placement `["server"]`).

- [ ] **Step 1: Read** `format.ts` (the `EngineId` union + `FormatId`s — confirm `"pdf"` exists), `placement.ts` (`ENGINE_PLACEMENTS` shape), `registry.ts` (the edge shape + how raster edges are built), and the existing registry/pathfinding/placement tests (mirror their style).

- [ ] **Step 2: Write the failing tests** (in the package's test files, matching their layout):
  - `findPath("png", "pdf")` is `ok` and its path's single edge has `engineId === "image-pdf"`.
  - `canConvertLocally("png", "pdf")` is `false` (server-only).
  - every raster source (`png`/`jpeg`/`webp`/`tiff`/`gif`/`bmp`) has an edge to `pdf` with engineId `"image-pdf"`.
  - the registry-wellformed/fitness test still passes with the new engine (every engineId in edges is in `ENGINE_PLACEMENTS`).

- [ ] **Step 3: Run RED.** `pnpm --filter @magna-carta/conversion test` → the new assertions fail.

- [ ] **Step 4: Implement.**
  - `format.ts`: add `"image-pdf"` to the `EngineId` union.
  - `placement.ts`: add `"image-pdf": ["server"]` to `ENGINE_PLACEMENTS`.
  - `registry.ts`: add the six edges, e.g. for each `f` in `["png","jpeg","webp","tiff","gif","bmp"]`: `{ from: f, to: "pdf", engineId: "image-pdf", recipeRef: "image-pdf", weight: 1 }`. (Match the file's existing construction idiom — a loop if the raster edges use one, else explicit literals.)

- [ ] **Step 5: Run GREEN.** `pnpm --filter @magna-carta/conversion test` green; `vp check` (or `pnpm check`) clean for the package.

- [ ] **Step 6: Commit** — `git add packages/conversion && git commit -m "feat(conversion): register image->PDF edges (server-only image-pdf engine)"`.

---

### Task 3: Docs, status, and final gates

**Files:**
- Create: `changelog.d/slice-2-4e-image-to-pdf.md`
- Modify: `containers/raster/CLAUDE.md` (note the pdf output), `STATUS.md` (2·4 row only)

- [ ] **Step 1: Changelog** `changelog.d/slice-2-4e-image-to-pdf.md` (`Added`): the raster engine now converts images to PDF (PNG/JPEG/WebP/TIFF/GIF/BMP → PDF) — a single-page PDF wrapping the image, produced entirely in pure Rust (`krilla`), no PDFium/C; server-only. No process-ref strings.

- [ ] **Step 2: `containers/raster/CLAUDE.md`** — add the `to = "pdf"` capability to the contract/notes: image→PDF via the pure-Rust `krilla` writer (memory-safe, no C), single page sized to the image's aspect (longer side 792 pt), the `recipe` seam for future geometry. Keep it accurate, don't duplicate.

- [ ] **Step 3: `STATUS.md`** — append to the 2·4 row only: image→PDF built (pure-Rust `krilla`, server-only edges registered).

- [ ] **Step 4: Final gates.** From `containers/raster/`: `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` — clean. `pnpm --filter @magna-carta/conversion test` green. `pnpm run lint:process-refs` (worktree root) clean. (No convert-worker change, so its suite/dry-run is unaffected — skip.)

- [ ] **Step 5: Commit** — `git add changelog.d containers/raster/CLAUDE.md STATUS.md && git commit -m "docs(image-to-pdf): changelog, raster note, status for slice 2·4e"`.

---

## Self-Review notes

- **Spec coverage:** the engine path + route test (T1), the registry edges + server-only placement (T2), docs/status/gates (T3). The full PDF engine, multi-image PDFs, recipe geometry, and LibreOffice/email/FFmpeg are out of scope per the design.
- **Type consistency:** engineId `"image-pdf"`, recipeRef `"image-pdf"`, `decode_source`/`image_to_pdf`, placement `["server"]` used consistently across tasks.
- **The verified-at-impl unknowns:** krilla's exact image-embedding API + its C-free tree (T1 Step 1), and the registry's edge-construction idiom (T2 Step 1) — both flagged to verify, not guessed.
