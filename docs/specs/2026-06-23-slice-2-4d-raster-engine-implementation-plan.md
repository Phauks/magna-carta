# Slice 2·4d — Raster Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `containers/raster/` (`magna-carta-raster`) — a pure-Rust + axum HTTP service that decodes/encodes rasters with the `image` crate — and rename the 2·4c libvips placeholder to its role (`RasterEngineContainer`).

**Architecture:** Mirrors `containers/scan` (a Rust lib + thin `:8080` binary, multi-stage Dockerfile), but **pure Rust** — the `image` crate, no C/`-sys` deps — so the full suite runs under `cargo test` on any host (no Docker-only testing, no feature-gating). The service honors the `/convert` + `/ready` contract already frozen by the `magna-carta-convert` worker.

**Tech Stack:** Rust, `axum` 0.8, `tokio`, the `image` crate (verify current version on docs.rs — golden rule 11; likely 0.25.x). `cargo`/`clippy`/`rustfmt`. The worker side is TypeScript (`apps/convert-worker`).

## Global Constraints

- **Pure Rust only — no C/C++ or `-sys` deps** (golden rule 14). If anything you'd add pulls in native C, STOP and surface it.
- **Memory-safety guards:** decode with explicit `image::Limits` (max allocation + max dimensions) so a pixel/decompression bomb is rejected before allocation — never a panic/OOM/hang on the per-request path.
- **The `/convert` contract is frozen** (do not change it): `POST /convert`, body = source bytes, headers `x-source-format` / `x-target-format` / `x-recipe`; response `200` + encoded bytes + `Content-Type`, or `4xx`/`5xx`. `GET /ready` → `200`.
- **Raise the axum body limit** off the 2 MiB default to the convertible-size cap (mirror scan's `MAX_SCAN_BODY_BYTES`).
- Full names (`RasterEngineContainer`, not abbreviations); `.ts` extensions + `import type` on the worker side; **no process-ref strings** in source (`pnpm run lint:process-refs`); commit `Cargo.lock`; pins verified on docs.rs.
- **Mirror `containers/scan`** for crate layout, Dockerfile shape, and CLAUDE.md style — read those files.
- Rust gate: `cargo test` + `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings`, run from `containers/raster/`.

---

### Task 1: Scaffold the `containers/raster` crate

**Files:**
- Create: `containers/raster/Cargo.toml`, `containers/raster/src/lib.rs`, `containers/raster/src/main.rs`, `containers/raster/.gitignore`
- Reference: `containers/scan/Cargo.toml`, `containers/scan/.gitignore`

**Interfaces:**
- Produces: crate `magna-carta-raster` with `pub fn router() -> axum::Router` (just `GET /ready` → 200 for now) and a binary serving it on `:8080`.

- [ ] **Step 1: `Cargo.toml`** — package `magna-carta-raster`, `edition = "2021"`, `publish = false`; `[lib]` (path `src/lib.rs`) + `[[bin]]` (name `magna-carta-raster`, path `src/main.rs`). Deps: `tokio = { version = "1", features = ["full"] }`, `axum = "0.8"`, `image = "<latest stable from docs.rs>"`. Dev-deps: `tower = { version = "0.5", features = ["util"] }` (for `oneshot` router tests), `http-body-util = "0.1"`. `.gitignore` = `/target`.

- [ ] **Step 2: `src/lib.rs`** — `pub fn router() -> Router { Router::new().route("/ready", get(|| async { StatusCode::OK })) }`.

- [ ] **Step 3: `src/main.rs`** — `#[tokio::main]` bind `0.0.0.0:8080`, `axum::serve(listener, magna_carta_raster::router()).await`.

- [ ] **Step 4: Verify.** From `containers/raster/`: `cargo build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` — all clean. (`image`'s first compile downloads/builds its pure-Rust codec deps — allow time.)

- [ ] **Step 5: Commit** — `git add containers/raster && git commit -m "feat(raster): scaffold the magna-carta-raster crate"` (Cargo.lock is created by the build — add it).

---

### Task 2: The conversion core (`src/convert.rs`)

**Files:**
- Create: `containers/raster/src/convert.rs`
- Modify: `containers/raster/src/lib.rs` (add `mod convert;`)

**Interfaces:**
- Produces: `pub enum ConvertError { UnsupportedFormat, Decode, Encode }` (or similar); `pub fn convert(bytes: &[u8], source_format: &str, target_format: &str, recipe: &str) -> Result<(Vec<u8>, &'static str), ConvertError>` returning the encoded bytes + the MIME string.

- [ ] **Step 1: Write the failing tests** in `src/convert.rs` (`#[cfg(test)] mod tests`). Generate fixtures in-test (don't commit binaries): build a tiny `image::RgbaImage`, encode it to PNG bytes with the `image` crate, then feed those to `convert`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, RgbaImage};
    use std::io::Cursor;

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img).write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn transcodes_png_to_webp_preserving_dimensions() {
        let src = png_bytes(8, 5);
        let (out, mime) = convert(&src, "png", "webp", "raster").expect("convert ok");
        assert_eq!(mime, "image/webp");
        // re-decode the output and check dimensions survived
        let decoded = image::load_from_memory_with_format(&out, ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (8, 5));
    }

    #[test]
    fn rejects_unsupported_target_format() {
        let src = png_bytes(4, 4);
        assert!(matches!(convert(&src, "png", "mp4", "raster"), Err(ConvertError::UnsupportedFormat)));
    }

    #[test]
    fn rejects_malformed_source_bytes() {
        let garbage = [0u8, 1, 2, 3, 4, 5, 6, 7];
        assert!(convert(&garbage, "png", "webp", "raster").is_err());
    }
}
```

- [ ] **Step 2: Run — verify fail.** `cargo test convert` → fails to compile (`convert` undefined).

- [ ] **Step 3: Implement `convert`.** Verify the exact `image` 0.25 API on docs.rs first (`ImageReader::set_format`/`with_format`, the `limits(...)` signature, `ImageFormat` variant names). Pattern:

```rust
use image::{DynamicImage, ImageFormat, ImageReader};
use image::imageops::FilterType; // only if a recipe needs resizing later
use std::io::Cursor;

#[derive(Debug, PartialEq)]
pub enum ConvertError { UnsupportedFormat, Decode, Encode }

// Map a registry format id -> image::ImageFormat. Unknown -> None (caller returns UnsupportedFormat).
fn image_format(id: &str) -> Option<ImageFormat> {
    Some(match id {
        "png" => ImageFormat::Png,
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        "tiff" => ImageFormat::Tiff,
        "gif" => ImageFormat::Gif,
        "bmp" => ImageFormat::Bmp,
        _ => return None,
    })
}

fn mime_for(fmt: ImageFormat) -> &'static str {
    match fmt {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Tiff => "image/tiff",
        ImageFormat::Gif => "image/gif",
        ImageFormat::Bmp => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn decode_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    // bound memory + dimensions so a pixel/decompression bomb is rejected before allocation.
    limits.max_alloc = Some(512 * 1024 * 1024); // 512 MiB working set per image (tune to the instance)
    limits.max_image_width = Some(40_000);
    limits.max_image_height = Some(40_000);
    limits
}

pub fn convert(
    bytes: &[u8],
    source_format: &str,
    target_format: &str,
    _recipe: &str,
) -> Result<(Vec<u8>, &'static str), ConvertError> {
    let src = image_format(source_format).ok_or(ConvertError::UnsupportedFormat)?;
    let dst = image_format(target_format).ok_or(ConvertError::UnsupportedFormat)?;

    let mut reader = ImageReader::new(Cursor::new(bytes));
    reader.set_format(src);
    reader.limits(decode_limits());
    let image: DynamicImage = reader.decode().map_err(|_| ConvertError::Decode)?;

    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, dst).map_err(|_| ConvertError::Encode)?;
    Ok((out.into_inner(), mime_for(dst)))
}
```

(Adjust to the verified API. JPEG can't carry alpha — if `write_to` errors on an RGBA→JPEG path, convert to RGB before encoding; add a test if you hit it.)

- [ ] **Step 4: Run — verify pass.** `cargo test convert` green; `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` clean.

- [ ] **Step 5: Commit** — `git add containers/raster && git commit -m "feat(raster): pure-Rust image convert core with decode limits"`.

---

### Task 3: The `/convert` route (`src/lib.rs`)

**Files:**
- Modify: `containers/raster/src/lib.rs`

**Interfaces:**
- Consumes: `convert(...)`, `ConvertError` (Task 2).
- Produces: `router()` now serving `POST /convert` with the frozen contract + a raised body limit.

- [ ] **Step 1: Write the failing router tests** (in `lib.rs` `#[cfg(test)]`, using `tower::ServiceExt::oneshot`): a `POST /convert` with a small PNG body + `x-source-format: png` / `x-target-format: webp` / `x-recipe: raster` → 200, `content-type: image/webp`, non-empty body; an unknown `x-target-format` → 4xx; `GET /ready` → 200. (Build the PNG bytes the same way as Task 2.)

- [ ] **Step 2: Run — verify fail** (`/convert` route missing). `cargo test` → fail.

- [ ] **Step 3: Implement the route.** Add `POST /convert` reading `axum::body::Bytes` + the three headers (`HeaderMap`), calling `convert`, mapping `Ok((bytes, mime))` → a `200` response with `Content-Type: mime` and the bytes, `Err(UnsupportedFormat)` → `415`, `Err(Decode)` → `422`, `Err(Encode)` → `500`. A missing required header → `400`. Apply `DefaultBodyLimit::max(MAX_CONVERT_BODY_BYTES)` (a `const`, = the convertible-size cap — pick the value the worker's `fileManager` cap uses; document it in a comment) to the `/convert` route.

- [ ] **Step 4: Run — verify pass.** `cargo test` green; fmt + clippy clean.

- [ ] **Step 5: Commit** — `git add containers/raster && git commit -m "feat(raster): POST /convert route over the image convert core"`.

---

### Task 4: Dockerfile + CLAUDE.md

**Files:**
- Create: `containers/raster/Dockerfile`, `containers/raster/CLAUDE.md`
- Reference: `containers/scan/Dockerfile`, `containers/scan/CLAUDE.md`

- [ ] **Step 1: `Dockerfile`** — multi-stage, mirroring scan but with **no codec apt installs** (pure Rust):

```dockerfile
# The raster conversion engine: a pure-Rust (image crate) axum service on :8080. No C codec libraries —
# untrusted image bytes are decoded by memory-safe Rust. Build context is this directory.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --bin magna-carta-raster

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/magna-carta-raster /usr/local/bin/raster
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/raster"]
```

- [ ] **Step 2: `CLAUDE.md`** — purpose (the raster engine; pure-Rust `image`, not libvips — golden rule 14); the `/convert` + `/ready` contract; the `image::Limits` bomb-guard + the body-limit-tracks-the-cap rules; the bytes↔TS boundary (the worker adapter expects bytes + `Content-Type`); and that — unlike scan — **the full suite runs under `cargo test` on any host** (no Docker needed for tests; the Docker image only validates build+serve). Mirror scan's CLAUDE.md structure.

- [ ] **Step 3: Verify** the Dockerfile is well-formed (no build required here; the image build is a deploy/CI step). `cargo test` still green. Commit — `git add containers/raster && git commit -m "feat(raster): Dockerfile + area CLAUDE.md"`.

---

### Task 5: Rename the worker placeholder + point at the real image

**Files:**
- Rename: `apps/convert-worker/src/libvips-container.ts` → `apps/convert-worker/src/raster-engine-container.ts`
- Modify: `apps/convert-worker/src/index.ts`, `apps/convert-worker/wrangler.jsonc`
- Delete: `containers/convert/` (the placeholder Dockerfile + CLAUDE.md)

- [ ] **Step 1:** `git mv apps/convert-worker/src/libvips-container.ts apps/convert-worker/src/raster-engine-container.ts`; rename the class `LibvipsContainer` → `RasterEngineContainer` inside it (keep `enableInternet=false`, `defaultPort=8080`, `pingEndpoint="ready"`, the scale-to-zero `sleepAfter="5m"`); update its comment to name the pure-Rust `image` engine.

- [ ] **Step 2:** `index.ts` — update the import + the `Bindings` field `LIBVIPS_CONTAINER` → `RASTER_ENGINE` (type `DurableObjectNamespace<RasterEngineContainer>`), the `export { ... }`, and `getContainer(env.RASTER_ENGINE, "raster")`.

- [ ] **Step 3:** `wrangler.jsonc` — `containers[].class_name` → `RasterEngineContainer`, `image` → `../../containers/raster/Dockerfile`; `durable_objects.bindings` name → `RASTER_ENGINE`, class → `RasterEngineContainer`; migration `new_sqlite_classes` → `["RasterEngineContainer"]`.

- [ ] **Step 4:** `git rm -r containers/convert` (the placeholder is replaced by `containers/raster`).

- [ ] **Step 5: Verify.** `pnpm --filter @magna-carta/convert-worker test` (the `forward-convert` test is engine-agnostic — still green); `cd apps/convert-worker && vp check` clean; `pnpm run lint:process-refs` clean. The worker `wrangler deploy --dry-run` now builds the real Rust image — if Docker/network make that too slow or unavailable in this environment, note it (the image build is a deploy/CI gate, not a hard local gate; the local gates are the crate's `cargo test` + the worker's `vp check`/`forward-convert`). Commit — stage `apps/convert-worker` + the `containers/convert` deletion with `git add -A containers apps/convert-worker` (NOT a hand-listed path that names the deleted file — `git add` stages nothing if any pathspec is missing). `git commit -m "refactor(convert-worker): rename the libvips placeholder to RasterEngineContainer; point at containers/raster"`.

---

### Task 6: Docs, status, and final gates

**Files:**
- Create: `changelog.d/slice-2-4d-raster-engine.md`
- Modify: `STATUS.md` (the 2·4 row only), `apps/worker/CLAUDE.md` (the conversion note: the raster engine is now built in pure Rust)

- [ ] **Step 1: Changelog** `changelog.d/slice-2-4d-raster-engine.md` (`Added`): the `magna-carta-convert` worker's raster engine is now a pure-Rust (`image` crate) service — memory-safe decoding of untrusted image bytes, no native libvips/C codecs; covers PNG/JPEG/WebP/TIFF/GIF/BMP; the engine image is a deploy-time build. No process-ref strings.

- [ ] **Step 2: `apps/worker/CLAUDE.md`** — update the conversion deploy-time note: the engine is the pure-Rust raster service in `containers/raster/` (memory-safe per golden rule 14); to activate, build/deploy `magna-carta-convert` (its `RasterEngineContainer` image) and the `CONVERT` binding selects it.

- [ ] **Step 3: `STATUS.md`** — edit only the 2·4 row: the raster engine built (pure-Rust `image`, runs under `cargo test`); deploy of the worker remains.

- [ ] **Step 4: Final gates.** From `containers/raster/`: `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` — all clean. From the worktree: `pnpm --filter @magna-carta/convert-worker test` green; `cd apps/convert-worker && vp check` clean; `pnpm run lint:process-refs` clean.

- [ ] **Step 5: Commit** — `git add changelog.d apps/worker/CLAUDE.md STATUS.md && git commit -m "docs(raster-engine): changelog, deploy note, status for slice 2·4d"`.

---

## Self-Review notes

- **Spec coverage:** crate scaffold (T1), convert core + limits (T2), the route + body limit (T3), Dockerfile + CLAUDE (T4), the worker rename + placeholder deletion (T5), docs/status/gates (T6). LibreOffice/FFmpeg/UI/deploy + the wasm-vips→image browser unification are out of scope per the design.
- **Type consistency:** `convert(bytes, source_format, target_format, recipe) -> Result<(Vec<u8>, &'static str), ConvertError>`, `RasterEngineContainer`, `RASTER_ENGINE`, instance `"raster"` used consistently across tasks.
- **The one verified-at-impl unknown:** the exact `image` 0.25 decode/limits/encode method names (T2 Step 3 says verify on docs.rs — golden rule 11). JPEG-from-RGBA may need an RGB conversion (flagged in T2).
- **git-add discipline** (T5 Step 5): stage with `git add -A`/dirs when a deletion is in the commit — never name the deleted path.
