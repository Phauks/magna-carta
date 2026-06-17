# Slice 2·1 — Plan 2: Scan-engine Container — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan character:** this plan builds a greenfield Rust service in a Cloudflare Container plus its Docker image. The TypeScript glue (the `Container` class, the `MalwareScanPort` adapter, the end-to-end test) is code-complete and test-driven; the Rust scan logic is **milestone-structured** — each task names the exact crate API, a concrete code sketch, and the build/verification command, but the Rust internals are implemented against the live `docs.rs` API at build time (golden rule 11). The acceptance gate for the whole plan is **EICAR detected end-to-end through the real `MalwareScanPort`.**

**Goal:** Replace the engine-less `unscannedAdapter` with a real detection-only malware scanner — ClamAV (signature) + yara-x (heuristic rules) + our own Rust structural heuristics for PDF and Office — running in a Cloudflare Container behind the `MalwareScanPort` contract Plan 1 widened.

**Architecture:** A long-lived `clamd` daemon plus a Rust HTTP service share a Container (Linux `amd64`). The Rust service listens on port 8080, accepts `POST /scan` with the file bytes as a streaming body, fans the bytes to (1) `clamd` over a local socket via `clamav-client`, (2) `yara-x`, and (3) the structural heuristics, then returns a JSON `ScanResult`. A `ScanContainer extends Container` Durable Object in the Worker proxies to it; the `containerScanAdapter` implements `MalwareScanPort` by POSTing the body and mapping the JSON back to the `ScanResult` union. The adapter is selected in Plan 1's `resolveScanPort` seam. Detection-only — no Content Disarm & Reconstruction.

**Tech Stack:** Rust (axum or hyper HTTP, `clamav-client` 2.2.0, `yara-x` 1.17.0, `lopdf`, `cfb`, `zip`, `quick-xml`, `tokio`); ClamAV/`clamd` + `freshclam` in the image; `@cloudflare/containers` 0.3.7 (`Container` class, DO-backed); TypeScript worker glue; Vitest + `cloudflare:test`.

## Global Constraints

- **Version pins:** `@cloudflare/containers` 0.3.7 · `clamav-client` 2.2.0 · `yara-x` 1.17.0. Verify each against `docs.rs`/npm at build time — the Rust 1.x crates have evolving minor APIs (golden rule 11).
- **Container is `linux/amd64` only.** clamd loads a ~1–2 GiB signature DB into RAM → **`instance_type: "standard-1"`** (4 GiB) minimum; size up only if measured.
- **No outbound internet from the scan path** (`enableInternet = false`): the container processes untrusted bytes; signature updates run via `freshclam` on a controlled schedule, not per-scan (white paper, *Performance & concurrency model* — sandbox-hardened processing).
- **Self-host only; no data-holding SaaS** — privileged client content never leaves our compute (golden rule 4; the white paper's *borrow expertise, never custody*).
- **Detection-only, no CDR at launch.** The scanner reports; it never rewrites or destroys the original.
- **No process references in source/tests** (golden rule 13). **Full names** (golden rule 12).
- **The `ScanResult` JSON contract is the boundary** — the Rust service and the TS adapter must agree on it exactly; it mirrors `packages/file-manager/src/scan-port.ts` (Plan 1, Task 1).

---

## The contract (Rust ⇄ TypeScript boundary)

`POST /scan` request: the raw file bytes (streaming body); query/header `?size=<bytes>` and `?contentType=<sniffed>` carry the metadata `MalwareScanPort.scan`'s `meta` provides.

`200 OK` JSON response — exactly one of (mirrors the `ScanResult` union):

```json
{ "verdict": "clean", "engineVersion": "clamav/1.x+yara-x/1.17.0+heuristics/1" }
{ "verdict": "infected", "engineVersion": "...", "signature": "Eicar-Test-Signature" }
{ "verdict": "unscanned", "reason": "encrypted", "engineVersion": "..." }
{ "verdict": "suspicious", "reason": "decompression-bomb", "engineVersion": "..." }
```

`oversize` is never returned — Plan 1's `runIngest` decides it before the engine is called. The adapter treats any non-200 or malformed body as a thrown error (the consumer retries the queue message), **never** as a silent `clean`.

---

## File Structure

**New `containers/scan/` (a new Cargo workspace member / standalone crate):**
- `Cargo.toml` — the crate + pinned deps.
- `Dockerfile` — multi-stage: build the Rust binary, then a runtime image with `clamav`/`clamd`/`freshclam` + the binary + an entrypoint that starts clamd and the HTTP service.
- `entrypoint.sh` — start `freshclam` (initial DB), launch `clamd`, wait for its socket, exec the Rust server.
- `src/main.rs` — the HTTP server (port 8080), `/ready` health, `POST /scan`.
- `src/clamav.rs` — `clamav-client` integration (socket scan).
- `src/yara.rs` — `yara-x` compile-once + scan.
- `src/heuristics/mod.rs`, `src/heuristics/pdf.rs`, `src/heuristics/office.rs` — structural checks + archive caps.
- `src/verdict.rs` — combine the three engines into one `ScanResult` JSON.
- `tests/` — Rust unit tests (EICAR, an `/OpenAction` PDF, a nested-zip bomb fixture).

**Modified `apps/worker/`:**
- `src/files/scan-container.ts` (new) — `ScanContainer extends Container`.
- `src/files/container-scan-adapter.ts` (new) — `containerScanAdapter(env): MalwareScanPort`.
- `src/files/scan-port-binding.ts` — select the container adapter when its binding is present (Plan 1's seam).
- `src/files/scan-warm.ts` (new) — the cron poke that keeps one instance warm.
- `src/index.ts` — export `ScanContainer`; route the warm-poke cron.
- `wrangler.jsonc` — the `containers` block, the `SCAN_CONTAINER` DO binding + `new_sqlite_classes` migration, the warm cron.

---

## Task 1: Scaffold the Rust scan service (HTTP skeleton)

**Files:** Create `containers/scan/Cargo.toml`, `containers/scan/src/main.rs`. Test: `containers/scan/tests/health.rs`.

**Interfaces:**
- Produces: an HTTP server on `:8080` with `GET /ready` → `200 "ok"` and `POST /scan` returning a stub `{"verdict":"unscanned","reason":"no-engine","engineVersion":null}` (filled in by later tasks).

- [ ] **Step 1: Write `Cargo.toml`** with pinned deps:

```toml
[package]
name = "magna-carta-scan"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
axum = "0.7"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clamav-client = { version = "2.2.0", features = ["tokio"] }
yara-x = "1.17.0"
lopdf = "0.34"
cfb = "0.10"
zip = "2"
quick-xml = "0.36"
```

(Confirm the latest compatible minor of each against crates.io at build time; pin exact versions in the lockfile.)

- [ ] **Step 2: Write the failing health test**

```rust
// containers/scan/tests/health.rs
// Spawns the server on an ephemeral port, GETs /ready, asserts 200 "ok".
// (Use reqwest in dev-dependencies + tokio::test.)
```

- [ ] **Step 3: Run it and confirm it fails** — `cargo test -p magna-carta-scan` → FAIL (no server).

- [ ] **Step 4: Implement the axum skeleton** in `main.rs`:

```rust
use axum::{routing::{get, post}, Router, Json, body::Bytes};
use serde_json::json;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/ready", get(|| async { "ok" }))
        .route("/scan", post(scan));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn scan(_body: Bytes) -> Json<serde_json::Value> {
    Json(json!({ "verdict": "unscanned", "reason": "no-engine", "engineVersion": null }))
}
```

- [ ] **Step 5: Run (PASS) + commit**

```bash
cargo test -p magna-carta-scan
git add containers/scan/Cargo.toml containers/scan/src/main.rs containers/scan/tests/health.rs
git commit -m "feat(scan): rust http skeleton with /ready and stub /scan"
```

---

## Task 2: ClamAV integration (`clamav-client` over a socket)

**Files:** Create `containers/scan/src/clamav.rs`; modify `main.rs`. Test: `containers/scan/tests/clamav_eicar.rs` (gated on a running clamd — see Step 2).

**Interfaces:**
- Produces: `async fn clamav_scan(bytes: &[u8]) -> ClamVerdict` where `ClamVerdict = Clean | Infected(String) | Unavailable`, scanning a local clamd at `/run/clamav/clamd.sock` via `clamav_client::Socket` + `tokio::scan_stream` (or `scan_buffer`), interpreting the response with `clamav_client::clean()` and parsing the signature name out of the `... FOUND` line.

- [ ] **Step 1: Write the failing test** — feed the EICAR test string to `clamav_scan`; expect `Infected(sig)` where `sig` contains `EICAR`. (Marked `#[ignore]` unless `CLAMD_SOCKET` is set, so CI without clamd skips it; the Docker integration test in Task 8 is the real gate.)

- [ ] **Step 2: Implement** per the verified 2.2.0 API:

```rust
// containers/scan/src/clamav.rs
use clamav_client::{Socket, clean};

pub enum ClamVerdict { Clean, Infected(String), Unavailable }

pub async fn clamav_scan(bytes: &[u8]) -> ClamVerdict {
    let conn = Socket { socket_path: "/run/clamav/clamd.sock" };
    match clamav_client::tokio::scan_buffer(bytes, conn, None).await {
        Ok(resp) => match clean(&resp) {
            Ok(true) => ClamVerdict::Clean,
            Ok(false) => ClamVerdict::Infected(parse_signature(&resp)),
            Err(_) => ClamVerdict::Unavailable,
        },
        Err(_) => ClamVerdict::Unavailable,
    }
}

// "stream: Eicar-Test-Signature FOUND" -> "Eicar-Test-Signature"
fn parse_signature(resp: &str) -> String {
    resp.rsplit_once(' ').map(|(s, _)| s).unwrap_or(resp)
        .trim_start_matches("stream:").trim().to_string()
}
```

(Confirm `tokio::scan_buffer` vs `tokio::scan_stream` signatures on docs.rs for 2.2.0; prefer the streaming variant if the body is large.)

- [ ] **Step 3: Run (the test gates on clamd; otherwise it is `#[ignore]`d) + commit**

```bash
git add containers/scan/src/clamav.rs containers/scan/src/main.rs containers/scan/tests/clamav_eicar.rs
git commit -m "feat(scan): clamd socket scanning via clamav-client"
```

---

## Task 3: yara-x integration (compile-once, scan-buffer)

**Files:** Create `containers/scan/src/yara.rs`; modify `main.rs`. Test: `containers/scan/tests/yara_match.rs`.

**Interfaces:**
- Produces: `fn build_rules(sources: &[&str]) -> yara_x::Rules` (compile once at startup) and `fn yara_scan(rules: &Rules, bytes: &[u8]) -> Vec<String>` (matching-rule identifiers), per the verified 1.17.0 API (`Compiler::new().add_source(...).build()`, `Scanner::new(&rules).scan(bytes)?.matching_rules()`).

- [ ] **Step 1: Write the failing test** — compile a trivial rule (`rule t { strings: $a = "malicious" condition: $a }`), scan a buffer containing "malicious", assert the identifier `t` comes back; scan a clean buffer, assert empty.

- [ ] **Step 2: Implement** per the sketch in the contract research:

```rust
// containers/scan/src/yara.rs
use yara_x::{Compiler, Rules, Scanner};

pub fn build_rules(sources: &[&str]) -> Rules {
    let mut compiler = Compiler::new();
    for src in sources { compiler.add_source(*src).expect("rule compiles"); }
    compiler.build()
}

pub fn yara_scan(rules: &Rules, bytes: &[u8]) -> Vec<String> {
    let mut scanner = Scanner::new(rules);
    match scanner.scan(bytes) {
        Ok(results) => results.matching_rules().map(|r| r.identifier().to_string()).collect(),
        Err(_) => Vec::new(),
    }
}
```

The real rule corpus is the YARA-Forge-Core feed, baked into the image at build (Task 7). The `Rules` value is `Send+Sync` — compile once at startup, share by reference; allocate one `Scanner` per request.

- [ ] **Step 3: Run (PASS) + commit**

```bash
git add containers/scan/src/yara.rs containers/scan/tests/yara_match.rs
git commit -m "feat(scan): yara-x rule compile + buffer scan"
```

---

## Task 4: Structural heuristics — PDF + Office + archive caps

**Files:** Create `containers/scan/src/heuristics/{mod.rs,pdf.rs,office.rs}`. Tests: `containers/scan/tests/heuristics.rs`.

**Interfaces:**
- Produces: `fn inspect(bytes: &[u8], sniffed: Option<&str>, caps: &ArchiveCaps) -> Heuristic` where `Heuristic = Clean | Suspicious(Reason) | Encrypted`, with `Reason ∈ { DecompressionBomb, ArchiveNesting, ArchiveEntryCount, PdfActiveContent, OfficeMacro }`. `ArchiveCaps` mirrors the Plan 1 `archiveCapsDefinition` (`maxDepth`, `maxEntries`, `maxUncompressedBytes`, `maxExpansionRatio`).

- [ ] **Step 1: Write the failing tests**, one per signal, with fixtures:
  - a PDF containing `/OpenAction` + `/JS` → `Suspicious(PdfActiveContent)`.
  - an `.xlsm`/OLE with a `vbaProject.bin` → `Suspicious(OfficeMacro)`.
  - a zip nested deeper than `maxDepth` → `Suspicious(ArchiveNesting)`.
  - a zip whose uncompressed:compressed ratio exceeds `maxExpansionRatio` → `Suspicious(DecompressionBomb)`.
  - a password-protected zip/PDF → `Encrypted`.
  - a plain PDF/docx → `Clean`.

- [ ] **Step 2: Implement** the checks (milestone-level; exact accessor names confirmed against `lopdf`/`cfb`/`zip` docs at build):
  - `pdf.rs`: parse with `lopdf::Document::load_mem`; walk for `/OpenAction`, `/AA`, `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`; an encrypted PDF that fails to load without a password → `Encrypted`.
  - `office.rs`: OLE (`cfb::CompoundFile`) → look for `VBA`/`macros` storages; OOXML (`zip` + `quick-xml`) → look for `vbaProject.bin` / `[Content_Types].xml` macro markers; an encrypted OOXML (the `EncryptedPackage` OLE stream) → `Encrypted`.
  - `mod.rs`: archive walk with a depth counter, entry counter, cumulative uncompressed-size and per-entry ratio guards against `caps`; the first cap breach short-circuits to the matching `Suspicious`.

- [ ] **Step 3: Run (PASS) + commit**

```bash
git add containers/scan/src/heuristics/ containers/scan/tests/heuristics.rs
git commit -m "feat(scan): pdf/office structural heuristics + archive bomb caps"
```

---

## Task 5: Combine into the `ScanResult` verdict

**Files:** Create `containers/scan/src/verdict.rs`; wire `POST /scan` in `main.rs`. Test: `containers/scan/tests/verdict.rs`.

**Interfaces:**
- Consumes: `ClamVerdict` (Task 2), yara identifiers (Task 3), `Heuristic` (Task 4).
- Produces: the precedence rule → the `ScanResult` JSON (the contract above).

Precedence (most-dangerous wins, but evasion-signals before clean):
1. clamd `Infected` **or** any yara match → `infected` (signature = clamd's name, else the yara identifier).
2. heuristic `Suspicious(reason)` → `suspicious` with the mapped reason (`DecompressionBomb`→`decompression-bomb`, `ArchiveNesting`→`archive-nesting`, `ArchiveEntryCount`→`archive-entry-count`; `PdfActiveContent`/`OfficeMacro` → **`infected`** with a synthetic signature, since active content in an unscannable wrapper is treated as a positive, not merely suspicious — confirm this mapping with the owner if active-content should be a softer signal).
3. heuristic `Encrypted` **or** clamd `Unavailable` with no other signal → `unscanned` (`reason: "encrypted"` / `"no-engine"`).
4. else → `clean`.

- [ ] **Step 1: Write the failing test** — a table-driven test over (clam, yara, heuristic) tuples asserting the JSON verdict for each precedence branch.

- [ ] **Step 2: Implement** `combine(...) -> ScanResult` + `serde::Serialize` for the tagged union (use `#[serde(tag = "verdict", rename_all = "lowercase")]`), and have `/scan` read the body + `?size`/`?contentType`, run all three engines (clamd + yara streamed/buffered, heuristics), and return `Json(combine(...))`. Build `engineVersion` from the clamd version + `yara_x::VERSION` + a heuristics revision constant.

- [ ] **Step 3: Run (PASS) + commit**

```bash
git add containers/scan/src/verdict.rs containers/scan/src/main.rs containers/scan/tests/verdict.rs
git commit -m "feat(scan): combine engines into the ScanResult verdict"
```

---

## Task 6: The Dockerfile + entrypoint (clamd + the service)

**Files:** Create `containers/scan/Dockerfile`, `containers/scan/entrypoint.sh`. Test: a local `docker build` + smoke (Task 8 is the full EICAR gate).

- [ ] **Step 1: Write the multi-stage Dockerfile** (`linux/amd64`):

```dockerfile
# build
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p magna-carta-scan

# runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y clamav clamav-daemon clamav-freshclam ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/magna-carta-scan /usr/local/bin/scan
COPY containers/scan/entrypoint.sh /entrypoint.sh
COPY containers/scan/rules/ /opt/yara-rules/   # YARA-Forge-Core, vendored at build
RUN chmod +x /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Write `entrypoint.sh`** — run `freshclam` once (initial DB; no scheduled internet at runtime per the no-egress rule — DB refresh is a controlled image-rebuild or a separate signed-update job, a documented seam), start `clamd`, wait for `/run/clamav/clamd.sock`, then `exec /usr/local/bin/scan`.

- [ ] **Step 3: Build locally**

Run: `docker build --platform linux/amd64 -t magna-carta-scan -f containers/scan/Dockerfile .`
Expected: a clean build.

- [ ] **Step 4: Commit**

```bash
git add containers/scan/Dockerfile containers/scan/entrypoint.sh
git commit -m "feat(scan): dockerfile bundling clamd + the rust scan service"
```

---

## Task 7: The `ScanContainer` class + `MalwareScanPort` adapter

**Files:** Create `apps/worker/src/files/scan-container.ts`, `apps/worker/src/files/container-scan-adapter.ts`; modify `apps/worker/src/files/scan-port-binding.ts`, `apps/worker/src/index.ts`, `apps/worker/wrangler.jsonc`, `apps/worker/package.json` (add `@cloudflare/containers`). Test: `apps/worker/test/container-scan-adapter.test.ts`.

**Interfaces:**
- Consumes: the `ScanResult` JSON contract; Plan 1's `resolveScanPort` seam.
- Produces: `ScanContainer extends Container` (defaultPort 8080, `sleepAfter` generous, `enableInternet = false`); `containerScanAdapter(env): MalwareScanPort` that POSTs the body to the singleton container and maps the JSON to `ScanResult`, **throwing** on any non-200/malformed response.

- [ ] **Step 1: Write the failing test** — a fake container stub whose `fetch` returns each `ScanResult` JSON shape; assert `containerScanAdapter` returns the matching typed `ScanResult`; assert a 500 or malformed body **throws** (never returns `clean`).

- [ ] **Step 2: Implement**

```typescript
// apps/worker/src/files/scan-container.ts
import { Container } from "@cloudflare/containers";
export class ScanContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "30m";        // generous; the warm-poke cron keeps one instance alive
  enableInternet = false;    // untrusted bytes never reach the network
  pingEndpoint = "ready";
}
```

```typescript
// apps/worker/src/files/container-scan-adapter.ts
import { getContainer } from "@cloudflare/containers";
import type { MalwareScanPort, ScanResult } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../app.ts";

export function containerScanAdapter(env: Bindings): MalwareScanPort {
  return {
    async scan(body, meta) {
      const container = getContainer(env.SCAN_CONTAINER, "scan");
      const url = `http://scan/scan?size=${meta.sizeBytes}&contentType=${encodeURIComponent(meta.sniffedContentType ?? "")}`;
      const response = await container.fetch(new Request(url, { method: "POST", body }));
      if (response.status !== 200) {
        throw new Error(`scan container returned ${response.status}`);
      }
      return parseScanResult(await response.json());
    },
  };
}
// parseScanResult validates the JSON against the ScanResult union (zod) and throws on a mismatch —
// an unrecognized verdict is a fault, never a silent clean.
```

In `scan-port-binding.ts`, return `containerScanAdapter(env)` when `env.SCAN_CONTAINER` is bound, else `unscannedAdapter`. Export `ScanContainer` from `index.ts`. Add the `containers` + `durable_objects` + `migrations` blocks to `wrangler.jsonc`:

```jsonc
"containers": [
  { "class_name": "ScanContainer", "image": "../../containers/scan/Dockerfile",
    "max_instances": 5, "instance_type": "standard-1" }
],
"durable_objects": { "bindings": [{ "name": "SCAN_CONTAINER", "class_name": "ScanContainer" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["ScanContainer"] }]
```

- [ ] **Step 3: Run (PASS)** — `pnpm --filter @magna-carta/worker exec vitest run test/container-scan-adapter.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/files/scan-container.ts apps/worker/src/files/container-scan-adapter.ts apps/worker/src/files/scan-port-binding.ts apps/worker/src/index.ts apps/worker/wrangler.jsonc apps/worker/package.json apps/worker/test/container-scan-adapter.test.ts
git commit -m "feat(worker): ScanContainer + MalwareScanPort container adapter"
```

---

## Task 8: EICAR end-to-end acceptance gate

**Files:** Create `containers/scan/tests/eicar_e2e.rs` (or a docker-compose smoke script). Modify CI to build the image + run the gate.

**Interfaces:** Consumes the whole stack.

- [ ] **Step 1: Write the gate** — `docker run` the image, POST the EICAR string to `/scan`, assert `{"verdict":"infected", "signature": <contains EICAR>}`; POST a clean PDF, assert `{"verdict":"clean"}`; POST an `/OpenAction`+`/JS` PDF, assert the active-content verdict; POST a nested-zip bomb fixture, assert `{"verdict":"suspicious","reason":"decompression-bomb"}`.

- [ ] **Step 2: Run it** — `docker build … && <run the gate>` → all assertions PASS.

- [ ] **Step 3: Add the CI job** — a workflow step that builds `containers/scan` and runs the EICAR gate (the image build is `linux/amd64`; gate it to run on changes under `containers/scan/**`).

- [ ] **Step 4: Commit**

```bash
git add containers/scan/tests/eicar_e2e.rs .github/workflows/
git commit -m "test(scan): EICAR end-to-end acceptance gate + CI"
```

---

## Task 9: Warm-pool poke + observability

**Files:** Create `apps/worker/src/files/scan-warm.ts`; modify `apps/worker/src/index.ts`, `apps/worker/wrangler.jsonc`.

**Interfaces:** Produces `pokeScanContainer(env)` — a cron handler that `fetch`es `/ready` on the singleton container before `sleepAfter` lapses, keeping the signature DB resident.

- [ ] **Step 1: Write the failing test** — `pokeScanContainer` calls the container's `/ready`; a fake stub records the hit.

- [ ] **Step 2: Implement** the poke; route a cron (`*/20 * * * *`, inside the 30m `sleepAfter`) in `index.ts`; add it to `wrangler.jsonc` `triggers.crons`. Emit a container-health telemetry event (warm/cold, scan latency) onto the 0·6 pipeline.

- [ ] **Step 3: Run (PASS) + the worker suite + check + commit**

```bash
git add apps/worker/src/files/scan-warm.ts apps/worker/src/index.ts apps/worker/wrangler.jsonc apps/worker/test/scan-warm.test.ts
git commit -m "feat(worker): keep one scan container warm + health telemetry"
```

---

## Task 10: Cost/ops docs + full gate

**Files:** Modify `docs/operating-costs.md` (the ~$35–50/mo warm Container line), `docs/conventions/operations.md` (the freshclam refresh runbook + image rebuild), `STATUS.md`/`ROADMAP.md`.

- [ ] **Step 1:** Run the full gate — `pnpm check`, `pnpm run lint:process-refs`, the worker suite, `cargo test -p magna-carta-scan`, the EICAR gate.
- [ ] **Step 2:** Record the operating cost + the signature-refresh runbook (freshclam cadence, the no-runtime-egress posture, the image-rebuild trigger).
- [ ] **Step 3:** Update STATUS/ROADMAP — 2·1 Plan 2 done; `resolveScanPort` now returns the real engine in production.
- [ ] **Step 4: Commit**

```bash
git add docs/operating-costs.md docs/conventions/operations.md STATUS.md ROADMAP.md
git commit -m "docs: scan container operating cost + signature-refresh runbook"
```

---

## Self-Review

**Spec coverage (2·1 design, Part A):** engine roster ClamAV+yara-x+heuristics (Tasks 2-4); socket-not-FFI (Task 2); detection-only/no CDR (whole plan); Office+PDF scope (Task 4); EICAR validator (Task 8); warm-pool + observability (Task 9); the `unscanned`/`infected`/`suspicious` mapping agreeing with Plan 1's `ScanResult` (Tasks 5, 7). ✓

**Placeholder scan:** the Rust internals are milestone-structured by design (greenfield), but every task names the exact crate API, a concrete sketch, and a verification command — not "implement the scanner." The one genuinely open product call (active-content PDF/Office → `infected` vs a softer `suspicious`) is flagged in Task 5 for owner confirmation, not silently chosen.

**Type consistency:** the `ScanResult` JSON contract (top of plan) is identical to `packages/file-manager/src/scan-port.ts` (Plan 1, Task 1); `ArchiveCaps` (Task 4) mirrors `archiveCapsDefinition` (Plan 1, Task 4); the adapter throws-not-defaults on fault (Task 7), matching the consumer's retry semantics.

**Cross-plan ordering:** Plan 1 must land first (the widened port + `resolveScanPort` seam). Plan 2 is otherwise independent of Plan 3.
