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

**STATUS — BUILT (all 7 tasks), cargo-verified, not merged.** `containers/bundle/` complete: crate
skeleton + `/ready` + contract (T1), credential-free R2 GET/PUT streaming (T2), ZIP encoder
store/Deflate/AES-256/ZIP64/timestamps (T3), 7z encoder LZMA2/AES-256/header-encryption (T4), 7z
byte-split volumes (T5), `POST /build` handler manifest→spill→encode→split→PUT (T6), Dockerfile + area
CLAUDE.md + R2-stub acceptance gate wired into the pre-push hook (T7). 10 integration tests green;
`cargo fmt`/`clippy -D warnings` clean. The host DID compile the full dep graph (feasibility gate passed).

**Crate-API adjustments vs the plan sketch** (the plan flagged these as docs.rs-confirm points):
- `flate2 = "1"` added as a direct dep — `zip`'s `deflate-flate2` pulls flate2 with no backend; without it
  the `ffi` module is empty (`MZ_* not found`). The direct dep unifies in the pure-Rust `rust_backend`.
- `sevenz-rust2` needs `features = ["aes256"]` (not default); writer is `SevenZWriter` (not `ArchiveWriter`),
  reader is `SevenZReader`; methods are `AesEncoderOptions::new(Password::from(..))` + `lzma::LZMA2Options::with_preset(0..9)`,
  AES-before-LZMA2; entry via `SevenZArchiveEntry::new_file`; time via `nt_time::FileTime: TryFrom<SystemTime>`.
- ZIP `DateTime` converts from `time::PrimitiveDateTime` (not `OffsetDateTime`); `zip_options` is lifetime-
  parameterized because `with_aes_encryption` borrows the password into `FileOptions`.
- Contract enum needs `rename_all_fields = "camelCase"` (serde ≥1.0.157) so `r2_key`→`r2Key` / `bytes_base64`→`bytesBase64`.

**Improvement over the plan sketch:** `build.rs` opens input spill files **lazily** (a `LazyFile` reader)
rather than pre-opening all of them — a bundle can carry thousands of entries and the default FD ulimit is
~1024; the encoders consume entries one at a time, so only one input descriptor stays open.

**7z note for reviewers:** for a tiny archive `sevenz_rust2` writes the header in the clear when AES+LZMA
would inflate it, so a wrong password can `SevenZReader::new`-open it; the content stream is always
encrypted, so the encryption test asserts content recovery (right reads / wrong cannot), not open-fails.

**Owed before/at merge (none blocking the build):**
- Run the Docker acceptance gate (`bash containers/bundle/tests/acceptance.sh`) — needs Docker + python3 + unzip.
- The pre-merge 7-angle adversarial review (testing.md standard).
- Changelog fragment + STATUS update held until the feature is user-reachable (container deployed + Plan 4 UI);
  adding them now would claim a capability that 503s until `BUNDLE_SERVICE` binds.
- Potential follow-up: axum `Json` extractor's default ~2 MiB body cap on `/build` (a manifest with very
  many entries or a large inline CONTENTS could 413) — raise it if real bundles approach the limit.
