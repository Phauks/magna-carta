# magna-carta-bundle (containers/bundle) — CLAUDE.md

**Purpose.** The heavy-lane archive encoder for the matter bulk-download ("bundle") path — a
`linux/amd64` Cloudflare Container. An axum HTTP service (`/ready`, `POST /build`) that turns a build
**manifest** into one or more archive volumes: ZIP (store/Deflate, AES-256, ZIP64) and 7z (LZMA2,
AES-256, header encryption), with format-native multi-volume splitting for 7z. It reads each input and
writes each output volume through the owner Worker's `env.R2` binding over `R2_BASE_URL` (outbound
Workers) — the container holds no R2 credentials and does no general egress. This is the heavy lane only;
the plain-ZIP fast lane stays in the Worker (`client-zip`).

**Design home:** `docs/specs/2026-06-25-enhanced-bundling-design.md`. **Worker side (the manifest sender,
R2 mediation, coordinator/queue/routes):** `apps/api-worker/src/downloads/` and `apps/bundle-worker/`.
**Deploy:** [`docs/conventions/operations.md`](../../docs/conventions/operations.md).

## Key files

- `src/lib.rs` — the axum router + `AppState { r2_base_url, http }`; routes `/ready` and `POST /build`.
- `src/contract.rs` — the Rust⇄TS wire contract: `BuildRequest` (manifest) and `BuildResponse`. The
  per-entry `source` discriminator is **flattened** onto the entry (`{ archivePath, mtimeEpochSecs,
  source:"r2", r2Key }` / `{ …, source:"inline", bytesBase64 }`) to byte-match the worker's
  `BundleManifestEntry` (`packages/file-manager/src/bundle-manifest.ts`).
- `src/r2.rs` — credential-free R2 I/O: streaming `GET`/`PUT` against `{R2_BASE_URL}/{key}`. The PUT
  carries an explicit `Content-Length` (the spooled file's size) — R2 rejects an unknown-length body.
- `src/encode.rs` — `encode_zip` and `encode_7z`. Each streams entries into an archive written to a
  **seekable** sink (both writers need `Write + Seek`). For 7z the method chain is **AES-then-LZMA2**
  (compress, then encrypt); header encryption (hides the file list) is on iff `encryptFileNames` is set.
- `src/split.rs` — `split_file_into_volumes`: byte-splits the spooled archive into `.001`, `.002`, …
  each ≤ `maxPartBytes`. This is exactly how a 7z multi-volume set reassembles (concatenate in order).
- `src/build.rs` — the `POST /build` handler: spill each input to disk (R2 GET or inline base64) → encode
  into an output temp file → split (7z only) → PUT each volume → return `BuildResponse`.

## Local rules / invariants

- **The manifest + result JSON is the Rust⇄TS boundary.** `contract.rs`'s `BuildRequest`/`BuildResponse`
  must stay byte-compatible with the worker adapter (`apps/api-worker/src/downloads/bundle-container-adapter.ts`);
  a change is a change on both sides. The flattened entry shape (not a nested `source` object) is load-bearing.
- **Never buffer the whole archive in memory.** Inputs stream from R2 into a temp spill file; the encoded
  archive lives on ephemeral disk (`/tmp`); output streams back to R2 volume-by-volume. The deploy instance
  must be sized for disk spill of the largest bundle, not for holding it in RAM.
- **The password is never logged or persisted.** It arrives in `req.encryption`, is used only by the
  `encode_*` calls, and is never written to disk, returned, or logged. Encrypted bundles are a single
  in-memory-password stream on the Worker side — never queued or cached (operations.md / the worker plan).
- **Split is 7z-only.** ZIP has no Rust writer for PKWARE spanned volumes; the handler rejects
  `format:"zip"` carrying `split` (defense in depth — the TS `validateOptionsForFormat` rejects it first).
- **No runtime egress.** The Container runs `enableInternet = false`; R2 is the only outbound and the owner
  Worker mediates it via `R2_BASE_URL` (the outbound-Workers virtual host). No credentials live here.
- **C-dependency note (golden rule 14).** The archive/encode deps are all pure Rust (zip, sevenz-rust2,
  lzma-rust2, flate2/miniz_oxide, aes/sha2), but `reqwest`'s `rustls-tls` pulls **`ring`** (C + per-arch
  assembly, needs a C compiler) transitively via rustls. So the crate is NOT C-free: the image builder
  (`rust:1-bookworm`) and a dev host both need a C toolchain. This is the same R2-transport `ring` dependency
  tracked under the C-dependency conformance ledger; the scan crate avoids it by keeping reqwest a
  TLS-less dev-dep. It still builds on Windows (MSVC/clang present) and Linux; it is not "no C toolchain."
- **Crate pins are verified against docs.rs before use** (golden rule 11): axum 0.8, zip 8.6 (lean
  `deflate-flate2` + `aes-crypto` features — no bzip2/zstd C deps; `flate2` is declared directly so its
  pure-Rust `rust_backend`/miniz_oxide backend is selected), sevenz-rust2 0.7 (`aes256` feature on),
  reqwest 0.12 (`rustls-tls` → brings `ring`), tokio-util, tempfile, base64, time. `Cargo.lock` committed.
- **`/build` has two lanes** (`build.rs`): buffered (default — encode → optional 7z-split → R2 PUT → JSON
  `BuildResponse`) and streaming (`?stream=1` — encode a single archive, stream it straight back, NEVER
  split and NEVER written to R2). The streaming lane is the worker's encrypted path: the archive and its
  password live only in flight. The CPU-bound encode + split run on `spawn_blocking` so `/ready` stays
  responsive during a long build (a blocked async worker thread would fail the health probe → restart).

## Commands

```
cargo test                                          # unit + integration (encoders, split, /build e2e)
cargo fmt --check && cargo clippy --all-targets -- -D warnings
bash tests/acceptance.sh                            # build the image + R2-stub /build gate (needs Docker + python3 + unzip)
```

## Gotchas

- The engine **cannot run under `@cloudflare/vitest-plugin`** (containers unsupported there), so the
  worker binding is a **deploy-time activation**. Two verifications: the local Docker acceptance gate
  (`tests/acceptance.sh`, in the pre-push hook when `containers/bundle/` changed and Docker is available)
  and — the more faithful one — the bundle worker's guarded **`POST /self-test`** run against the live
  deploy (exercises the real `env.R2` outbound mediation + both lanes; see `docs/conventions/operations.md`
  "Testing a container on Cloudflare"). Until the image deploys and `BUNDLE_SERVICE` binds, the
  heavy/encrypted bundle lanes return 503.
- **7z tiny-archive header fallback.** `sevenz_rust2` writes the header in the clear when AES+LZMA would
  inflate a tiny header (`compress_size + 20 >= size`); with header encryption requested but the archive
  tiny, `SevenZReader::new` can open with a wrong password. The content stream is always encrypted, so the
  meaningful test is content recovery (right password reads, wrong password cannot), not open-fails.
- **`flate2` backend.** `zip`'s `deflate-flate2` feature pulls `flate2` with no backend selected; without a
  direct `flate2` dependency its `ffi` module is empty and the build fails (`MZ_* not found`). Keep the
  direct `flate2 = "1"` dep so the pure-Rust backend is unified in.
