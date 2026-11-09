# magna-carta-scan (containers/scan) — CLAUDE.md

**Purpose.** The malware-scan engine for the untrusted-file pipeline — the **repo's first Rust crate**,
run as a `linux/amd64` Cloudflare Container. An axum HTTP service (`/ready`, `POST /scan`) fans each
file body to three engines and reports their **raw facts** as a `RawScanResult` matching the worker's
`MalwareScanPort` contract: **clamd** (signatures), **yara-x** (heuristic rules), and **structural
heuristics** (PDF/Office/archive). The engine decides nothing — the per-firm verdict is computed app-side
from those facts (`packages/file-manager/src/verdict.ts`), so the full rule corpus is scanned once and a
firm's policy can re-tier it with no re-scan. Detection-only — it reports, never rewrites or destroys (no CDR).

**White paper:** _Performance & concurrency model_ (sandbox-hardened processing). **Worker side:**
`apps/api-worker/src/files/{scan-container,container-scan-adapter,scan-port-binding,scan-warm}.ts`. **Deploy:**
[`docs/conventions/operations.md`](../../docs/conventions/operations.md) §11.

## Key files

- `src/lib.rs` — the axum router + `AppState` (compiled `Rules` behind an `Arc`, clamd address, caps,
  engine version); `POST /scan` runs all three engines concurrently and returns their raw facts as a
  `RawScanResult` (HTTP 200). An in-process engine panic/fault is the **only** 503 (`engines_unavailable`).
- `src/clamav.rs` — clamd scan over **loopback TCP** (`clamav_client::tokio::Tcp`); `clean()` is bool-only,
  so the signature name is parsed from the raw INSTREAM reply.
- `src/yara.rs` — runtime rule loading + scanning: `deserialize_rules` restores the baked blob at boot
  (no startup recompile); `yara_scan` returns matching identifiers. `build_rules` (fail-fast compile) is
  the empty/dev path; `compile_tolerant` (skip + log incompatible rules) is the build-time path.
- `src/forge.rs` + `src/bin/build-yara-rules.rs` — build-time YARA Forge bundling: parse the package,
  bake EVERY tier with its score/tier side-map (the full corpus), compile with yara-x, serialize the blob
  the runtime loads. Each match carries `{ruleId, tier, score, isSuspicious}` so the app can tier app-side.
- `src/heuristics/{mod,pdf,office}.rs` — `inspect()` dispatches by magic bytes: PDF (lopdf) active-content
  / encrypted; OLE/CFB (cfb) macros / `EncryptedPackage`; ZIP (zip) archive caps + OOXML macros. Size/ratio
  checks read entry **metadata** only, so a zip bomb is caught before expansion.
- `src/identify.rs` — the **Magika** content-type identification engine behind `POST /identify`. Runs
  Google Magika's ML model (EMBEDDED in the `magika` crate, no runtime egress, no external model file) and
  returns the **raw facts** `RawIdentifyResult` (`label`, `score`, `group`, `magikaVersion`, `modelVersion`)
  — no verdict, no extension recommendation: the app decides whether the content type matches the claimed
  extension (`apps/api-worker/src/routes/file-type.ts`). The session takes `&mut self`, so it lives behind a
  `Mutex` shared via `Arc<IdentifyEngine>` in `AppState`; inference runs on a `spawn_blocking` thread and a
  fault maps to the same retryable 503 as the scan path. NOTE: magika 1.1 is **not** pure Rust — it infers
  through `ort` (ONNX Runtime, C++); see Local rules.
- `src/raw.rs` — the `RawScanResult` facts and the `clam_fact` / `heuristic_fact` mappers. This struct's
  JSON byte-matches `packages/file-manager/src/scan-port.ts`'s `RawScanResult` — the Rust⇄TS boundary.
  The engine reports facts only; precedence and the clean/flagged/unscanned decision live app-side in
  `packages/file-manager/src/verdict.ts`.
- `Dockerfile` / `entrypoint.sh` — multi-stage build; clamd + a **build-time-baked** signature DB **and
  YARA rule blob** (the build fetches the latest YARA Forge `extended` release and runs `build-yara-rules`);
  the entrypoint raises clamd's scan-size limits to the inspectable-size cap and exports the baked rules
  tag (see Local rules).

## Local rules / invariants

- **`RawScanResult` is the Rust⇄TS boundary.** Its JSON must stay identical to `scan-port.ts`'s
  `RawScanResult`; the worker adapter re-validates it with zod. A change is a change on both sides. The
  engine reports facts only — the clean/flagged/unscanned decision is `verdict.ts`'s, not the container's.
- **Fail safe, never silent-clean.** The engine reports raw facts; it never fabricates a clean. clamd going
  dark is reported as the raw fact `clam: { state: unavailable }` with **HTTP 200** — the app-side verdict
  layer raises that to a retryable fault (so the ingest queue re-scans), never a clean. The **only** 503 is
  an in-process **engine panic/fault** (`engines_unavailable` in `lib.rs::finish`): yara/heuristics run under
  `spawn_blocking` + `catch_unwind`, and a yara scan timeout/error (`yara_scan` is `set_timeout`-bounded and
  returns `Err`) collapses to the same 503 — never a swallowed no-match, never clean. A clamd **timeout**
  (the whole exchange — connect + INSTREAM write + read — is bounded in `clamav.rs`) or a clamd reply with
  **any non-OK record** surfaces as `clam: unavailable`, never a masked clean: `interpret_reply` parses the
  reply record-by-record so a `FOUND` can never be hidden by a sibling `OK`. A locked file → the raw
  `heuristic: encrypted` fact (→ `unscanned`/encrypted app-side; re-scanning cannot help); active content
  is a raw `heuristic: active-content` fact (a clean-with-badge signal app-side, never a quarantine alone).
  A running container always booted with clamd ready, so it never self-reports the no-engine state — that
  honest `engineVersion: null` + `clam: unavailable` is the engine-less launch adapter's alone
  (`packages/file-manager/src/scan-port.ts`).
- **No reachable panic/abort on the per-file path.** Ordinary engine panics are caught; the one fault
  `catch_unwind` cannot catch is a **stack overflow → SIGABRT**, which a recursive PDF parser can hit on a
  crafted deeply-nested PDF (lopdf's unbounded-recursion DoS, fixed in 0.42; the guards below stay as
  defense-in-depth — clamd + yara scan the raw bytes regardless). `heuristics::pdf` guards it on two fronts before
  `Document::load_mem`: a cheap iterative max-nesting-depth pre-check on the raw bytes, AND — because lopdf
  also decompresses and recursively parses `/Type /ObjStm` object streams, where nesting is invisible to a
  raw-byte scan — keeping any object-stream-bearing file away from `load_mem` entirely (it routes to an
  inflate-then-scan active-content fallback instead). Don't reintroduce a `load_mem` call for a PDF that
  carries an object stream; the structured walk is a detection aid, not the safety net (clamd + yara still
  scan the raw bytes), so trading it for guaranteed abort-safety on those files is deliberate.
- **Bounded engine memory.** The nested-archive walk (`heuristics/mod.rs`) accounts each level's REAL
  materialized bytes (not the forgeable declared size) against `max_uncompressed_bytes` before recursing,
  and `MAX_NESTED_BYTES` is sized so `max_depth * MAX_NESTED_BYTES` fits the instance — the recursion holds
  every level's buffer live at once.
- **clamd limits track the inspectable-size cap.** `entrypoint.sh` raises clamd's `StreamMaxLength` /
  `MaxScanSize` / `MaxFileSize` to 2048M (= `fileManager.inspectableSizeCapBytes`, 2 GiB) so clamd scans
  every file the pipeline feeds it; the two must stay aligned, and the deploy instance must be sized for a
  full-size scan (the service buffers the body, clamd its own copy, atop the resident clamd DB **and the
  resident `Arc<yara_x::Rules>` + yara-x per-scan working set**) — operations.md §11.
- **The `/scan` body limit tracks the cap too.** axum's `Bytes` extractor defaults to a 2 MiB body limit
  — every real document would 413 before reaching any engine; `router()` raises `/scan` to 2 GiB
  (`MAX_SCAN_BODY_BYTES` = `fileManager.inspectableSizeCapBytes`). Keep it aligned with the clamd limits.
- **`/identify` runs Magika with an embedded model — but on a C++ backend (golden rule 14 flag).** The
  identification model ships inside the `magika` crate, so there is **no runtime egress and no external
  model file** — the running container stays sealed. However, magika 1.1 has **no pure-Rust backend**: it
  infers through `ort` (ONNX Runtime, a C++ library). We pull the prebuilt runtime via `ort`'s
  `download-binaries` feature, which fetches it **at build time** and **statically links** it — the same
  build-time-fetch / runtime-sealed pattern as the baked clamd DB and YARA corpus, so the linked binary
  needs no system `onnxruntime.so` and no network at run time. ONNX Runtime is a **C/C++ dependency**;
  it is **owner-consented** under golden rule 14 (magika was chosen as the identification engine and
  ONNX Runtime is an inherent consequence — the design's "pure-Rust" assumption was incorrect).
  The runtime stage carries `libstdc++6` and `libgomp1` (C++ standard library + OpenMP): onnxruntime
  is statically linked into the binary but its C++ code still calls into these shared system libs at
  run time, so they must be present in the container. The container remains egress-free (`enableInternet
  = false`) — no onnxruntime network traffic at run time. On a dev host the `ort` link requires
  `download-binaries` (already on by default for the crate); without it the link fails
  (`unresolved external OrtGetApiBase`). Identification returns **raw facts**; the app decides the
  extension verdict.
- **No runtime egress.** The Container runs `enableInternet = false`; the signature DB (freshclam) **and
  the YARA rule blob (`build-yara-rules`, the latest YARA Forge release)** are baked at image build, and a
  refresh is an image rebuild. The resolved Forge tag is the engine-version `yara-rules/<tag>` component
  (drives re-scan staleness — a new release on a nightly rebuild re-scans the fleet, an unchanged one does
  not). A corrupt/unreadable baked blob is **fatal at boot**, never a silent fall-back to a rule-less scan.
  clamd is loopback-TCP only.
- **Cross-platform compile.** Talk to clamd over `Tcp` (loopback), not the Unix-socket client (which is
  `#[cfg(unix)]` and won't build on a Windows dev host).
- **Crate pins are verified against docs.rs before use** (golden rule 11): axum 0.8, yara-x 1.18,
  lopdf 0.44, cfb 0.14, zip 8.6 (lean `deflate-flate2` features — no bzip2/zstd C deps). Cargo.lock is
  committed (binary crate).

## Commands

```
cargo test                                   # unit + integration (the EICAR test is #[ignore]d — needs clamd)
cargo fmt --check && cargo clippy --all-targets -- -D warnings
CLAMD_ADDRESS=127.0.0.1:3310 cargo test -- --ignored   # the EICAR test against a live clamd
bash tests/eicar_e2e.sh                      # build the image + EICAR acceptance gate (needs Docker)
node harness/scan-proxy.mjs                  # browser harness vs a running container (harness/README.md)
```

## Gotchas

- The engine **cannot run under `@cloudflare/vitest-plugin`** (containers unsupported there —
  workers-sdk#10408), so the worker binding is a **deploy-time activation** and the EICAR acceptance gate
  runs in the `scan-container` CI job, not the local worker suite.
- yara rules are the **YARA Forge `extended`** package (`YARA_FORGE_TIER` ARG), fetched + compiled +
  serialized at image build, with the FP-prone heuristic `_SUSP_` pocket (score < `YARA_MIN_SUSP_SCORE`,
  default 75) dropped. The dev/test build (no `YARA_RULES_PATH` env) runs **rule-less** on clamd + the
  structural heuristics, so clamd signatures (incl. EICAR) and the test suite work without any yara rules.
- Structural inspection covers **PDF, OLE, and ZIP** only. Archive bombs/nesting/encryption in other
  formats (7z, RAR, gzip, bzip2, xz, tar) are not structurally caught — clamd scans their contents, but
  an encrypted non-ZIP archive serializes as `clean` rather than `unscanned`. Documented follow-up.
- Encrypted **ZIP** entries are flagged via `by_index_raw` (metadata only). `by_index` returns an error
  for an encrypted entry, so the archive walk would `continue` past it and serialize the whole archive as
  `clean` — don't switch the walk back to `by_index`.
- Archive nesting is detected by **content** (a leading-byte peek for an archive magic), not the `.zip`
  filename, and ZIP inspection runs regardless of leading bytes (prepended-stub / polyglot zips), so a
  rename or junk prefix cannot bypass the caps. A forged-size single-level bomb still relies on clamd.
