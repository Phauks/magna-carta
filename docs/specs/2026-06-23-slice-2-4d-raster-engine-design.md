# Slice 2·4d — the raster conversion engine (`containers/raster`, pure-Rust)

**Status:** design · **Date:** 2026-06-23 · **Area:** File conversion
**Builds on:** 2·4c (the `magna-carta-convert` worker + the `CONVERT` service-binding seam — the
orchestration calls `resolveEnginePort`, the worker's `/convert` proxy forwards to an engine Container).
**Decision inputs:** owner chose **Rust + axum** for the engine, then the **pure-Rust `image` crate**
over native libvips on memory-safety grounds (golden rule 14). **Precedent:** `containers/scan` (the
repo's Rust-container pattern).

## Why pure-Rust `image`, not libvips

The engine parses **untrusted, privileged** document bytes. Native libvips delegates decoding to a
stack of C codecs (libjpeg/png/webp/tiff) with a real memory-safety history; golden rule 14 says prefer
the memory-safe library. The pure-Rust [`image`](https://crates.io/crates/image) crate decodes/encodes
the common rasters with pure-Rust decoders — a malformed image is an `Err`/caught panic, not memory
corruption — and it **builds and tests on any host** (no C toolchain), so unlike scan's C SIMD matcher
we need **no feature-gating and no Docker-only testing**: `cargo test` runs the real conversion locally.
The Container sandbox (`enableInternet=false`, stateless, network-isolated) stays as defense-in-depth.
Trade accepted: full-image-in-memory (no libvips streaming), no ICC color management, narrower exotic
formats — all either future or other-engine (LibreOffice/FFmpeg/PDF) territory; the `ConversionPort`
seam lets us swap the engine if a real large-image/color need appears.

## Honest naming (rename the 2·4c placeholder)

2·4c shipped a placeholder named for libvips. Since the engine is the `image` crate, rename for the
**role**, not a library (golden rules 12/13), all within `apps/convert-worker` + `containers/`:

| 2·4c (placeholder)                                         | 2·4d (accurate)                       |
| ---------------------------------------------------------- | ------------------------------------- |
| `LibvipsContainer` (class)                                 | `RasterEngineContainer`               |
| `LIBVIPS_CONTAINER` (binding)                              | `RASTER_ENGINE`                       |
| `getContainer(env.…, "libvips")`                           | `getContainer(env.…, "raster")`       |
| `src/libvips-container.ts`                                 | `src/raster-engine-container.ts`      |
| `containers/convert/` (placeholder Dockerfile + CLAUDE.md) | `containers/raster/` (the real crate) |
| migration `new_sqlite_classes: ["LibvipsContainer"]`       | `["RasterEngineContainer"]`           |

The app worker is unaffected — it only knows the `CONVERT` service binding and the `/convert` HTTP
contract; the engine's internal name is invisible to it. The `magna-carta-convert` worker keeps its
name (it hosts engine Containers; raster is the first, LibreOffice/FFmpeg join later as their own
Container classes + dirs).

## The engine — `containers/raster/` (Rust crate `magna-carta-raster`)

A lib (router + conversion logic, unit-testable) + a thin binary serving `:8080`, mirroring
`containers/scan`'s layout. **Pure Rust** — no `-sys`/C deps.

- **`Cargo.toml`** — `magna-carta-raster`, `[lib]` + `[[bin]]`. Deps: `tokio` (full), `axum` 0.8,
  `image` (latest stable — verify on docs.rs per golden rule 11). Likely no serde (the contract is
  bytes+headers, not JSON). `Cargo.lock` committed. Pins verified against docs.rs.
- **`src/lib.rs`** — `router()` building the axum `Router`:
  - `GET /ready` → `200` (the Container boot-readiness probe / `pingEndpoint`).
  - `POST /convert` — a `Bytes` body (the source bytes) + the headers `x-source-format`,
    `x-target-format`, `x-recipe`; runs `convert(...)`; returns `200` with the encoded bytes +
    `Content-Type`, or a `4xx`/`5xx` (which the worker proxy/app adapter map to `adapter-error`).
    **Raise the body limit** off axum's 2 MiB default to the convertible-size cap (mirror scan's
    `MAX_SCAN_BODY_BYTES` ← `fileManager` cap) via `DefaultBodyLimit`.
- **`src/convert.rs`** — the pure conversion: `convert(bytes, source_format, target_format, recipe) ->
  Result<(Vec<u8>, mime: &'static str), ConvertError>`.
  - Parse `source_format`/`target_format` strings (`png`/`jpeg`/`jpg`/`webp`/`tiff`/`gif`/`bmp`) →
    `image::ImageFormat`; unknown → `ConvertError::UnsupportedFormat` (→ 4xx).
  - Decode with **explicit `image::Limits`** (max allocation + max dimensions) so a pixel/decompression
    bomb is rejected, not OOM — the analog of scan's bomb guards. Use a reader with the declared
    `source_format` (don't trust extension; the header names it). Decode failure → `ConvertError`.
  - Re-encode the `DynamicImage` to `target_format`; map `target_format` → MIME
    (`image/png`, `image/jpeg`, `image/webp`, `image/tiff`, `image/gif`, `image/bmp`).
  - `recipe` (`"raster"` today) = a plain transcode; the field is the seam for future options (resize,
    quality) — validate it's a known recipe, ignore otherwise for now.
- **`src/main.rs`** — bind `0.0.0.0:8080`, serve `router()`.
- **`Dockerfile`** — multi-stage: `FROM rust:1-bookworm AS build` → `cargo build --release` → a slim
  runtime (`debian:bookworm-slim` + the binary; **no apt codec installs** — pure Rust, so the runtime
  image is just the binary + `ca-certificates`). `EXPOSE 8080`, run the binary directly (no
  `entrypoint.sh` — nothing to configure, unlike clamd).
- **`CLAUDE.md`** — purpose, the `/convert` + `/ready` contract, the `image`-crate + `Limits` rules, the
  bytes↔TS boundary note (the worker adapter expects bytes + Content-Type), and that this engine —
  unlike scan — **runs its full test suite on any host** (pure Rust).

## Testing (the payoff — real conversions, locally)

`cargo test` exercises the real engine (no Docker, no fakes):

- raster round-trips: decode a tiny in-test PNG → encode WebP/JPEG/TIFF → assert the output's magic
  bytes / that it re-decodes to the same dimensions.
- unknown source/target format → `UnsupportedFormat` (4xx).
- a malformed body → decode error (not a panic, not a hang).
- the `image::Limits` guard: an oversized-dimensions header/image → rejected before allocation.
- the router: `/ready` → 200; `/convert` happy path via an in-process axum test (e.g. `tower::ServiceExt`
  `oneshot`); the raised body limit accepts a >2 MiB body.
  `cargo fmt --check && cargo clippy --all-targets -- -D warnings` clean.
  A Docker build/serve smoke test (build the image, `POST /convert`) is an optional CI gate — but because
  the engine is pure Rust, the local suite already covers the real conversion path; the Docker test only
  proves the image builds + serves.

## Worker changes (the rename + pointing at the real image)

- `apps/convert-worker/src/raster-engine-container.ts` (renamed) — `class RasterEngineContainer extends
  Container` (`enableInternet=false`, `defaultPort=8080`, `pingEndpoint="ready"`, the 2·4c
  scale-to-zero `sleepAfter`).
- `apps/convert-worker/src/index.ts` — rename the import/binding/instance; route `POST /convert` →
  `forwardConvert(getContainer(env.RASTER_ENGINE, "raster"))`.
- `apps/convert-worker/wrangler.jsonc` — rename the `containers` `class_name` + image path
  (`../../containers/raster/Dockerfile`), the `durable_objects` binding, and the migration class.
- `forward-convert.ts` is unchanged (engine-agnostic proxy).
- Delete the `containers/convert/` placeholder (replaced by `containers/raster/`).

## Out of scope (deferred)

- LibreOffice / FFmpeg / PDF engines (their own Container classes + dirs + workers as decided).
- Deploying `magna-carta-convert` + binding it (deploy-time).
- The UI (0·7a).
- The **wasm-vips → `image`** unification of the browser raster path (a golden-rule-14 follow-up — see
  the C-dependency conformance note; `image` compiles to WASM, so the browser path could share this
  engine and drop wasm-vips — a separate decision/slice).

## Open items for the plan

- Confirm the current `image` crate version + the exact `Limits`/encode API on docs.rs (golden rule 11).
- Decide the convertible-size body cap value (reuse the `fileManager` inspectable/convertible cap the
  worker already references, kept aligned like scan's).
