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

**Pre-merge 7-angle adversarial review DONE (2026-06-27, Opus 4.8)** — 7 parallel reviewers (correctness,
security, memory/resource, Rust⇄TS contract, crate-API/build/deploy, spec/invariants, test quality). 1
Critical + 7 Important confirmed and FIXED (commits 139a5ae, a13b802):
- **Critical — streaming lane added.** The merged worker `buildStream` POSTs `/build?stream=1` and pipes
  the body to the client as the archive (encrypted lane, `outputKeyPrefix:""`); the container ignored the
  query, returned JSON, and PUT to R2 under key `""`. Added a real streaming branch: encode a single
  archive, stream it straight back (octet-stream), NEVER split, NEVER written to R2. So `/build` now has
  TWO lanes (buffered→PUT→JSON, and `?stream=1`→stream-back).
- **7z `store`** now uses `SevenZMethod::COPY` (was LZMA2 preset 0 — silently compressed).
- **`spawn_blocking`** wraps the CPU-bound encode+split (a blocked async worker thread would fail `/ready`
  → orchestrator restarts mid-build).
- **`maxPartBytes==0`** → 422 (was a handler panic); **volume-count cap (100k)** bounds a tiny-part explosion.
- **`r2_key`/`output_key_prefix`** rejected if they carry a scheme / absolute path / `..` segment.
- Doc/test fixes: CLAUDE.md no longer claims "pure Rust / no C toolchain" (reqwest rustls-tls pulls
  `ring`, C/asm — noted under golden-rule-14); `acceptance.sh` re-ported off `--network host` to
  published-port + `host.docker.internal` (works on Docker Desktop); reqwest connect-timeout; +9 tests
  (streaming, zip+split 422, missing-R2, 7z store, ZIP timestamp, 7z header-encryption on/off, split
  boundaries, volume cap). 21 integration tests green, fmt/clippy clean. Verdict: mergeable.

**On-Cloudflare self-test ADDED (2026-06-27).** Because Workers Builds builds the image remotely and a
container can't run under the Miniflare pool, the truest test is the live deploy. `apps/bundle-worker` now
has a guarded **`POST /self-test`** (`src/self-test.ts`): runs the deployed container through `/ready`, a
buffered ZIP build (R2 + inline, verified back in R2), the streaming encrypted lane (archive returned,
nothing persisted), and a 7z split — cleans up all R2 objects, returns a JSON report. Disabled by default
(404 unless `BUNDLE_SELF_TEST_KEY` secret is set AND presented as `x-self-test-key`; constant-time
compare) — safe on prod. 17 worker tests green, `vp check` clean. Procedure in operations.md "Testing a
container on Cloudflare"; it's the template other container subsystems copy, and demotes the Docker
`acceptance.sh` to an optional fast smoke. (Required `pnpm install` in the worktree first — vite-plus
wasn't linked.)

**Owed before/at merge:**
- Run the Docker acceptance gate (`bash containers/bundle/tests/acceptance.sh`) — needs Docker + python3 +
  unzip; can't run on this host. Wired into the pre-push hook when `containers/bundle/` changed.
- Changelog fragment ADDED (`changelog.d/enhanced-bundling.md`). STATUS row still folded under 2·1 (shared
  row, not edited on a branch).
- Deferred minors (non-blocking): transient R2 error → 422 (vs 502/503 — worker re-queues on any throw, so
  retry behavior is unaffected); error strings may include the internal R2 URL/key (recipient is the trusted
  worker; no password); axum `Json` ~2 MiB body cap on `/build` (many-entry manifest could 413 — raise if
  real bundles approach it); retained input spills make peak disk ≈ inputs + 2× archive (document at sizing).
