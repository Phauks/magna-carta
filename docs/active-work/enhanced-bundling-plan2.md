# enhanced-bundling-plan2

**Scope.** Enhanced Bundling Plan 2 — the dedicated Rust Container `containers/bundle` (the heavy-lane
encoder). axum service (`/ready`, `POST /build`) mirroring `containers/scan`: ZIP (Deflate/store, AES-256,
ZIP64) + 7z (LZMA2, AES-256, header encryption) encoders, 7z byte-split multi-volume, R2 I/O via the
outbound-Workers base URL, disk-spool output. Plan:
`docs/specs/2026-06-25-enhanced-bundling-plan-2-container-implementation-plan.md`.

Plans 1 + 3 (TS core + worker orchestration) are already MERGED to main; the heavy/encrypted bundle lanes
return 503 until this container's image deploys and `BUNDLE_SERVICE` binds (operations.md). UI (Plan 4)
deferred to 0.7.

**Files I expect to create.** `containers/bundle/` (Cargo.toml, src/{lib,main,contract,r2,encode,split,
build}.rs, tests/, Dockerfile, CLAUDE.md). Later: a CI image-build acceptance gate (mirror
`containers/scan`); `apps/bundle-worker/wrangler.jsonc` already references `../../containers/bundle/Dockerfile`.

**Verification.** `cargo test` / `cargo clippy` locally (pure-Rust crate compiles on a dev host). The live
container is a deploy-time activation (can't run under the worker test pool) — the Docker acceptance gate
runs in CI. Crate pins (zip 8.6, sevenz-rust2 0.7, axum 0.8, reqwest 0.12) verified against docs.rs as built.
