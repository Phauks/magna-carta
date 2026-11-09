# magna-carta-raster (containers/raster) — CLAUDE.md

**Purpose.** The raster image conversion engine for the document-conversion pipeline — a pure-Rust
Cloudflare Container. An axum HTTP service (`GET /ready`, `POST /convert`) decodes the source image
and re-encodes it to the target format using the `image` crate. **No C codec libraries** — all codec
work is pure Rust, so untrusted bytes never touch a memory-unsafe C library. This is the deliberate
contrast to libvips (which links C codecs like libjpeg-turbo, libpng, libwebp): the `image` crate's
Rust-only implementations trade peak throughput for complete memory safety on adversarial input.

**White paper:** _Performance & concurrency model_ (sandbox-hardened processing). **Worker side:**
`apps/convert-worker/src/raster-engine-container.ts` (the `RasterEngineContainer` Durable Object),
`apps/convert-worker/src/forward-convert.ts` (the `/convert` proxy), and
`apps/api-worker/src/conversions/conversion-engine.ts` (the app-worker `serviceBindingPort` adapter that
calls this engine over the `CONVERT` service binding). **Deploy:**
[`docs/conventions/operations.md`](../../docs/conventions/operations.md).

## Key files

- `src/lib.rs` — the axum router; `POST /convert` extracts `x-source-format`, `x-target-format`,
  and `x-recipe` from request headers, calls `convert()`, and maps `ConvertError` variants to HTTP
  status codes (415 unsupported, 422 decode failure, 500 encode failure). `GET /ready` returns 200.
- `src/convert.rs` — `convert()`: maps format identifiers → `image::ImageFormat`, applies
  `decode_limits()` before decoding, handles the JPEG alpha-flatten path (JPEG has no alpha channel;
  RGBA input is composited to RGB before encoding), then encodes to the target format. When
  `target_format == "pdf"`, delegates to `image_to_pdf()` instead: derives page dimensions (longer
  side 792 pt, shorter side proportional to preserve aspect ratio), embeds the decoded image as RGBA
  pixels into a `krilla` PDF document, and returns the serialised PDF bytes — pure Rust, no PDFium,
  no C. The shared `decode_source()` helper applies `decode_limits()` before decoding and is used by
  both the raster-to-raster and image-to-PDF code paths so the bomb guard fires exactly once.
  `ConvertError` is the Rust⇄TS boundary error type.
- `Dockerfile` — multi-stage build; `ca-certificates` only in the runtime image (no codec apt
  packages — pure Rust needs none); no `entrypoint.sh` (nothing to configure at start-up).

## Local rules / invariants

- **`ConvertResponse` is the Rust⇄TS boundary.** The worker adapter reads the response body as raw
  bytes and the `Content-Type` header for the MIME type. A successful `POST /convert` returns
  `200 OK` with the encoded image bytes as the body and the canonical MIME string (e.g. `image/webp`)
  as `Content-Type`. Error status codes map to adapter-thrown errors. Do not add a JSON envelope —
  the adapter expects bytes + `Content-Type`, nothing else.
- **`image::Limits` are the bomb-guard — never remove or relax them.** `decode_limits()` in
  `convert.rs` sets `max_alloc` (512 MiB), `max_image_width` (40 000 px), and `max_image_height`
  (40 000 px) on the `ImageReader` before decoding. These reject pixel bombs and decompression bombs
  before any allocation happens. The values are calibrated above any legitimate legal document image;
  do not raise them without a documented use case.
- **The `/convert` body limit is 256 MiB — do not raise it to match the general ingest cap.**
  axum buffers the full request body in RAM before `image::Limits` (the bomb-guard in `convert.rs`)
  can run. A 2 GiB cap would allow the buffered body + decoded surface (≤ 512 MiB) + encode output
  to approach the Container instance ceiling. 256 MiB keeps the peak comfortably within the instance
  budget while accepting any realistic raster source. Encoded image files are far smaller than the
  worker's general 2 GiB ingest cap; the two caps are deliberately different.
- **Pure Rust: no C/-sys crates in the dependency tree.** The `image` crate is configured with
  `default-features = false` to exclude the AVIF encoder (which pulls in `ravif`/`rav1e`/`cc`).
  Only pure-Rust codecs are enabled: png, jpeg, gif, webp, tiff, bmp. The `krilla` PDF writer is
  also pure Rust — no PDFium, no C. Any new format addition must be pure Rust; a C codec dep is a
  CI violation.
- **`image_to_pdf` produces one page — do not add multi-page logic here.** The function takes a
  single decoded `DynamicImage` and writes exactly one page. If multi-image PDFs are needed, that
  is an orchestration concern (calling the engine once per image and merging at the registry level),
  not a concern of this single-page primitive.
- **Page geometry is image-aspect-ratio–preserving — do not introduce fixed page sizes.** The longer
  side is anchored at 792 pt; the shorter side is computed proportionally. The `recipe` header
  (`_recipe` in `convert()`) is the designated extension point for future geometry variants (e.g.
  US Letter padding, A4 fit). Add geometry variants via `recipe` dispatch rather than new endpoints.
- **JPEG alpha-flatten is required — do not remove it.** JPEG has no alpha channel. When the decoded
  image has alpha and the target format is JPEG, `convert()` calls `into_rgb8()` (compositing alpha
  against an opaque black background) before encoding. Skipping this step causes the encode to fail
  or silently corrupt the output.
- **No runtime egress.** The Container runs with `enableInternet = false`. `ca-certificates` is
  installed so TLS calls within the private network can verify certificates; the service itself makes
  no outbound requests.
- **Crate pins are verified against docs.rs before use** (see [`docs/conventions/code-style.md`](../../docs/conventions/code-style.md)):
  axum 0.8, image 0.25 (pure-Rust features only). Cargo.lock is committed (binary crate).

## Commands

```
cargo test                                   # full unit + integration suite — runs on any host, no Docker needed
cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

Unlike the scan container, **the full test suite runs under `cargo test` on any host** — there are
no C daemons, no system libraries, and no Docker required for tests. The Docker image is only needed
to validate the build and serve path; the codec logic is testable entirely in-process. When
LibreOffice and FFmpeg engines land as separate containers, their test strategies will differ (those
engines bind C runtimes), but this engine will remain host-testable.

## Gotchas

- The engine **cannot run under `@cloudflare/vitest-plugin`** (containers unsupported there),
  so the worker binding is a deploy-time activation; route the acceptance gate through a container
  CI job rather than the local worker suite.
- `image::ImageFormat::WebP` encoding is supported in `image` 0.25 (lossless, pure Rust). Lossy
  WebP encoding is not available without pulling in `libwebp`; if lossy compression is needed for
  specific recipes, design a separate recipe path rather than enabling a C dep.
- The `x-recipe` header is required by the router and forwarded to `convert()` as `_recipe`, where
  it is currently unused. It is the extension point for future per-recipe transforms (resize, quality
  tuning, colour profile conversion). Keep it wired through even while the value is ignored.
- GIF encoding supports only a 256-colour palette (an `image` crate limitation). A GIF-to-GIF
  transcode through a full-colour intermediate (`DynamicImage`) may shift colours. This is a known
  limitation; do not add a special-case bypass without testing round-trip fidelity.
