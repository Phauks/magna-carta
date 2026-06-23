# slice-2-4d-raster-engine — active work

**Branch:** `slice-2-4d-raster-engine` (off `main`). **Area:** File conversion — the raster engine.

**Scope.** Build `containers/raster/` (`magna-carta-raster`): a pure-Rust + axum HTTP service
(`POST /convert`, `GET /ready`) that decodes/encodes rasters with the **pure-Rust `image` crate** (not
native libvips — golden rule 14, memory safety). Plus rename the 2·4c placeholder for honest naming:
`LibvipsContainer`→`RasterEngineContainer`, `LIBVIPS_CONTAINER`→`RASTER_ENGINE`,
`containers/convert/`→`containers/raster/`, within `apps/convert-worker`.

**Files I expect to touch:**
- `containers/raster/**` (new Rust crate: Cargo.toml/lock, src/{lib,convert,main}.rs, Dockerfile, CLAUDE.md, tests)
- `apps/convert-worker/src/{index.ts, raster-engine-container.ts}` (rename), `wrangler.jsonc`
- delete `containers/convert/` (placeholder)
- `docs/specs/2026-06-23-slice-2-4d-raster-engine-*.md`, `changelog.d/`, STATUS.md (my row only)

**Out of scope:** LibreOffice/FFmpeg/PDF engines; deploying the worker; UI; the wasm-vips→`image`
browser-path unification (a golden-rule-14 follow-up).

**Note:** the app worker is unaffected (it only knows the `CONVERT` service binding + the `/convert`
HTTP contract). golden rule 14 landed on main 0edb6ba.
