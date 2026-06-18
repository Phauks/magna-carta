# magna-carta-scan (containers/scan) — CLAUDE.md

**Purpose.** The malware-scan engine for the untrusted-file pipeline — the **repo's first Rust crate**,
run as a `linux/amd64` Cloudflare Container. An axum HTTP service (`/ready`, `POST /scan`) fans each
file body to three engines and combines them into one verdict matching the worker's `MalwareScanPort`
contract: **clamd** (signatures), **yara-x** (heuristic rules), and **structural heuristics**
(PDF/Office/archive). Detection-only — it reports, never rewrites or destroys (no CDR).

**White paper:** _Performance & concurrency model_ (sandbox-hardened processing). **Worker side:**
`apps/worker/src/files/{scan-container,container-scan-adapter,scan-port-binding,scan-warm}.ts`. **Deploy:**
[`docs/conventions/operations.md`](../../docs/conventions/operations.md) §9.

## Key files

- `src/lib.rs` — the axum router + `AppState` (compiled `Rules` behind an `Arc`, clamd address, caps,
  engine version); `POST /scan` runs all three engines and returns the combined verdict.
- `src/clamav.rs` — clamd scan over **loopback TCP** (`clamav_client::tokio::Tcp`); `clean()` is bool-only,
  so the signature name is parsed from the raw INSTREAM reply.
- `src/yara.rs` — `build_rules` (compile once) + `yara_scan` (matching identifiers).
- `src/heuristics/{mod,pdf,office}.rs` — `inspect()` dispatches by magic bytes: PDF (lopdf) active-content
  / encrypted; OLE/CFB (cfb) macros / `EncryptedPackage`; ZIP (zip) archive caps + OOXML macros. Size/ratio
  checks read entry **metadata** only, so a zip bomb is caught before expansion.
- `src/verdict.rs` — `combine()` (precedence: infected > suspicious > unscanned > clean+activeContent) →
  the `ScanResult` serde union, byte-matching `packages/file-manager/src/scan-port.ts`.
- `Dockerfile` / `entrypoint.sh` — multi-stage build; clamd + a **build-time-baked** signature DB.

## Local rules / invariants

- **`ScanResult` is the Rust⇄TS boundary.** Its JSON must stay identical to `scan-port.ts`; the worker
  adapter re-validates it with zod. A change is a change on both sides.
- **Fail safe, never silent-clean.** clamd unavailable → `unscanned`/no-engine; an unparseable/locked file
  → `unscanned`/encrypted or `clean` (clamd/yara still scan); active content is a clean-with-badge signal,
  never a quarantine on its own. The worker adapter throws (retries the queue) on any non-200/malformed.
- **No runtime egress.** The Container runs `enableInternet = false`; the signature DB is baked at image
  build (freshclam), and a refresh is an image rebuild. clamd is loopback-TCP only.
- **Cross-platform compile.** Talk to clamd over `Tcp` (loopback), not the Unix-socket client (which is
  `#[cfg(unix)]` and won't build on a Windows dev host).
- **Crate pins are verified against docs.rs before use** (golden rule 11): axum 0.8, yara-x 1.18,
  lopdf 0.41, cfb 0.14, zip 8.6 (lean `deflate-flate2` features — no bzip2/zstd C deps). Cargo.lock is
  committed (binary crate).

## Commands

```
cargo test                                   # unit + integration (the EICAR test is #[ignore]d — needs clamd)
cargo fmt --check && cargo clippy --all-targets -- -D warnings
CLAMD_ADDRESS=127.0.0.1:3310 cargo test -- --ignored   # the EICAR test against a live clamd
bash tests/eicar_e2e.sh                      # build the image + EICAR acceptance gate (needs Docker)
```

## Gotchas

- The engine **cannot run under `@cloudflare/vitest-pool-workers`** (containers unsupported there —
  workers-sdk#10408), so the worker binding is a **deploy-time activation** and the EICAR acceptance gate
  runs in the `scan-container` CI job, not the local worker suite.
- yara starts **rule-less** today; the YARA-Forge corpus + rule-directory loading bake into the image as a
  follow-up. clamd signatures (incl. EICAR) work without any yara rules.
- Structural inspection covers **PDF, OLE, and ZIP** only. Archive bombs/nesting/encryption in other
  formats (7z, RAR, gzip, bzip2, xz, tar) are not structurally caught — clamd scans their contents, but
  an encrypted non-ZIP archive serializes as `clean` rather than `unscanned`. Documented follow-up.
- Archive nesting is detected by **content** (a leading-byte peek for an archive magic), not the `.zip`
  filename, and ZIP inspection runs regardless of leading bytes (prepended-stub / polyglot zips), so a
  rename or junk prefix cannot bypass the caps. A forged-size single-level bomb still relies on clamd.
