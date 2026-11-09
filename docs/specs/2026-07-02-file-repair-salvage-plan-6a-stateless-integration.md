# File Repair & Salvage — Plan 6a: stateless integration (engine → container → routes)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (fresh subagent per task, empirically verify every report, opus whole-plan adversarial review + fix rounds before merge). Steps use checkbox (`- [ ]`) syntax.
>
> **Status:** ready to build. Design resolved in `2026-07-02-file-repair-salvage-plan-6-integration-design.md` (owner decisions A–E). This is the FIRST of two closeout plans; **Plan 6b** (attach-to-matter) follows. Cross-cutting — run `vp run worktrees` + confirm the seed-migration number against `main` immediately before Task 5.

**Goal:** Make the inert `recovery-core` engine reachable and usable, stateless: a native Container hosts diagnose/repair/carve; a dedicated `recovery-worker` fronts it; the app worker exposes three permissioned tool routes that stream a file to the container, **re-scan the repaired/carved output through the malware gate before returning it** (Decision B), and hand back the honest-loss result. Plus the `documents → files` group rename, the `tools:fileRepair` permission, contract regen, and removal of the now-dead wasm32 support. **No UI. No attach-to-matter** (that is Plan 6b). No persistence — nothing is stored.

**Architecture (single Container lane — the WASM lane was dropped, owner 2026-07-02):**

```
app worker  POST /api/v1/file-repair/{diagnose|repair|carve}   (defineOpenAPIRoute + chokepoint RBAC tools:fileRepair)
   -> upload-size cap (readInspectableSizeCap) rejects oversized input
   -> c.env.RECOVERY_SERVICE.fetch("http://recovery/{diagnose|repair|carve}")   (service binding, streamed body)
        recovery-worker  getContainer(env.RECOVERY_ENGINE,"recovery").fetch(...)  (Container DO, scale-to-zero, no egress)
           containers/recovery  axum on engine_host::host  ->  recovery_core::{diagnose|repair|carve}
           <- JSON: DiagnosisReport | { files:[{name,media_type,contentBase64}], loss }
   -> (repair/carve only) re-scan each returned file: resolveScanPort(c.env).scan(bytes,meta) + computeVerdict(raw, firmPolicy)
        clean -> return bytes; not-clean -> withhold bytes, 422 problem carrying the verdict reason (no content)
   <- JSON to caller; audited:false, nothing persisted
```

## Global constraints

- **Never overclaim** — the honest-loss `LossManifest` crosses to TS verbatim; the container marshals it faithfully (`fully_recovered`, `synthesized`, per-item `recovered`/`detail`). No route logic reinterprets it.
- **Log-safety** — `RecoveredItem.name`/`detail` and `SalvagedFile.name` are owner-facing receipt fields; they must NEVER enter the redacted error-log pipeline. Route failures surface a stable Problem code + a user-facing Error ID (the standard error pipeline), never file content.
- **`recovery-core` stays a pure, serde-free, I/O-free engine.** All HTTP/JSON marshalling lives in `containers/recovery` (the host), mapping from `recovery_core` types — the same "engine parses, host hosts" split `engine_host::wasm_edge` used for the WASM boundary.
- **Memory-safe only** (golden rule 14) — the container adds `serde`/`serde_json`/`base64` (all pure Rust). No new C dependency; `recovery-core` already resolves the pure-Rust DEFLATE backend.
- **No egress from the container** (`enableInternet = false`) — it processes untrusted bytes.
- No process-doc citations in source (golden rule 13). Full names, no shorthand (golden rule 12). Verify every library API against current docs before use (golden rule 11): `@cloudflare/containers` 0.3.7, axum 0.8, Hono zod-openapi.

## Template map (clone these — do not reinvent)

| Concern                                               | Clone from                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container engine host (axum)                          | `crates/engine-host/src/host.rs` (`ready_app`/`with_panic_net`/`serve`); `containers/raster/{Cargo.toml,src/main.rs,src/lib.rs,Dockerfile}` for crate shape                                            |
| Container DO class                                    | `apps/convert-worker/src/raster-engine-container.ts` (`RasterEngineContainer`)                                                                                                                         |
| Worker getContainer dispatch                          | `apps/convert-worker/src/index.ts`                                                                                                                                                                     |
| container.fetch proxy                                 | `apps/convert-worker/src/forward-convert.ts`                                                                                                                                                           |
| Worker wrangler (container + DO + migration)          | `apps/convert-worker/wrangler.jsonc` (no cron — recovery scales to zero, no baked data to refresh)                                                                                                     |
| App-worker service binding                            | `apps/worker/wrangler.jsonc` `services[]` (the `CONVERT` entry)                                                                                                                                        |
| Tool route (bytes → container over a service binding) | `apps/worker/src/routes/files/file-type.ts` (streams to `c.env.SCAN_SERVICE`)                                                                                                                          |
| Route base64 JSON envelope                            | `apps/worker/src/routes/files/metadata.ts` (`decodeBase64`/`encodeBase64`, `failureProblem`, `RouteMeta`)                                                                                              |
| Re-scan output                                        | `apps/worker/src/files/scan-port-binding.ts` (`resolveScanPort`) + `apps/worker/src/routes/files/scan-diagnose.ts:110-125` (lazy `await import`, `computeVerdict`)                                     |
| Route registration                                    | `apps/worker/src/app.ts` (import + `registerXRoutes(app, chokepoint)`)                                                                                                                                 |
| Permission + seed triple                              | the `tools:fileTypeVerifier` slice: `packages/access-control/src/registry.ts` + `packages/database/drizzle/per-firm/0032_seed-tools-file-type-verifier.sql` + `apps/worker/src/per-firm-migrations.ts` |

---

### Task 1: `containers/recovery` — the native engine host + JSON contract

**Files:** create `containers/recovery/{Cargo.toml, Dockerfile, .gitignore, CLAUDE.md, src/main.rs, src/lib.rs, src/dto.rs}`.

**Interfaces produced (the container HTTP contract, consumed by the recovery-worker and, through it, the app route):**

- `GET /ready -> 200 "ok"` (from `engine_host::host::ready_app`).
- `POST /diagnose` (body: raw file bytes, `application/octet-stream`) `-> 200 application/json` = `DiagnosisReportDto { detectedFormat: string|null, corruption: string[], recoverability: string, repairSupported: bool, carveSuggested: bool, detail: string }`.
- `POST /repair` (body: raw bytes) `-> 200` = `RepairResultDto { files: [{ name, mediaType: string|null, contentBase64 }], loss: LossManifestDto }`; on `RepairError` `-> 422` = `{ code }` where `code` is `RepairError::code()` (a fixed, content-free string).
- `POST /carve` (body: raw bytes) `-> 200` = same `RepairResultDto`; `422 { code }` when nothing carvable.
- `LossManifestDto { fullyRecovered: bool, synthesized: string[], items: [{ name, recovered: bool, detail: string }] }`.

- [ ] **Step 1: Confirm `recovery-core` is a `crates/Cargo.toml` workspace member** (the pillars ran `cargo test --manifest-path crates/Cargo.toml -p recovery-core`, so it should be). If it is not listed in `members`, add it. The container path-deps it either way.

- [ ] **Step 2: `containers/recovery/Cargo.toml`** — standalone crate (own `Cargo.lock`, NOT a `crates/` member, mirroring `containers/raster`). Lib + thin bin split. Path-dep the harness + engine; add pure-Rust marshalling deps:

```toml
[package]
name = "magna-carta-recovery"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
name = "magna_carta_recovery"
path = "src/lib.rs"

[[bin]]
name = "magna-carta-recovery"
path = "src/main.rs"

[dependencies]
# The shared container host skeleton (/ready, body cap, panic net, :8080 serve). This is the FIRST
# container to build on the harness; raster/scan predate it and hand-rolled axum.
engine_host = { path = "../../crates/engine-host", package = "magna-carta-engine-host" }
# The repair/salvage engine — diagnose/repair/carve. Pure, I/O-free; this host owns all HTTP/JSON.
recovery-core = { path = "../../crates/recovery-core" }
tokio = { version = "1", features = ["full"] }
axum = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"
```

- [ ] **Step 3: `src/dto.rs`** — the JSON contract structs (`#[derive(serde::Serialize)]`, `#[serde(rename_all = "camelCase")]`) and `From<recovery_core::…>` mappings. Map `RecoverySalvagedFile.bytes` → `contentBase64` via `base64::engine::general_purpose::STANDARD.encode`. Map `Recoverability`/`CorruptionKind`/detected `Format` to their existing string forms (reuse whatever `Display`/`as_str` the engine exposes; if none, add a `&'static str` mapping HERE in the host, never content-bearing). Keep every `detail` verbatim from the engine (it is already a fixed literal).

- [ ] **Step 4: `src/lib.rs`** — `pub fn router() -> axum::Router` with the three POST routes; each handler reads `axum::body::Bytes`, calls the engine, and returns `axum::Json<Dto>` (or `(StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"code": e.code()})))`). Body cap comes from `engine_host::host::ready_app`. Write handler unit tests (spawn on an ephemeral port like `host.rs` tests do): `/ready` → ok; `/diagnose` on a known-corrupt fixture → expected `recoverability`; `/repair` round-trips a fixture and the JSON `loss.fullyRecovered` matches the engine; `/carve` on an embedded-JPEG buffer returns ≥1 file. Reuse the pillars' existing test fixtures.

- [ ] **Step 5: `src/main.rs`** — 6 lines, the harness entry:

```rust
#[tokio::main]
async fn main() -> std::io::Result<()> {
    let app = engine_host::host::with_panic_net(engine_host::host::ready_app(
        magna_carta_recovery::router(),
    ));
    engine_host::host::serve(app).await
}
```

- [ ] **Step 6: `Dockerfile` + repo-root build context (the reference pattern for ALL harness-hosted engine containers).** Unlike raster/scan (self-contained crates whose build context is their own dir), a harness-hosted engine container path-deps shared `crates/*` (here `engine-host` + `recovery-core`), so its build context MUST be a common ancestor — the repo root. This is a first-class, verified wrangler capability: the container object takes `image` (the Dockerfile path) and a sibling **`image_build_context`** (both string fields, confirmed in the wrangler config schema), so the Dockerfile can live in `containers/recovery/` while the build context is the repo root. Write:
  - `containers/recovery/Dockerfile` — `rust:1-bookworm` build stage with `WORKDIR /src`, then (paths RELATIVE TO REPO ROOT, the context): `COPY crates/engine-host crates/engine-host`, `COPY crates/recovery-core crates/recovery-core`, `COPY containers/recovery containers/recovery`, then `WORKDIR /src/containers/recovery && cargo build --release`; `debian:bookworm-slim` runtime, `EXPOSE 8080`, entrypoint the bin. (`containers/recovery` carries its own `Cargo.lock`, copied with it.)
  - A repo-root-scoped `.dockerignore` (or a `containers/recovery/.dockerignore` honored for its context) that excludes everything except those three trees — so the uploaded build context stays small even though it is rooted at the repo. This keeps the Cloudflare Workers Builds image build fast.
    This is deliberately established as the **canonical engine-container build pattern** (see Task 8 Step 3): the next harness-hosted engine copies this Dockerfile + `image_build_context` shape rather than re-solving it.

- [ ] **Step 7: `containers/recovery/CLAUDE.md`** — local rules: pure-Rust only; engine stays serde-free (host marshals); `cargo test` runs without Docker; the `image_build_context` = repo-root pattern from Step 6, and that recovery is the reference container-on-`engine_host::host` implementation.

- [ ] **Step 8: Gate + commit** — `cd containers/recovery && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`; citation grep clean. Commit `feat(recovery-container): axum host for diagnose/repair/carve on engine-host`.

---

### Task 2: `apps/recovery-worker` — the dedicated container worker

**Files:** create `apps/recovery-worker/{package.json, wrangler.jsonc, tsconfig.json, src/index.ts, src/recovery-engine-container.ts, src/forward.ts}` + a test. Clone `apps/convert-worker/**` verbatim, renaming Raster→Recovery, convert→recovery.

**Interfaces produced:** a deployable worker `magna-carta-recovery` that routes `POST /diagnose|/repair|/carve` to the container instance; nothing else (404 otherwise).

- [ ] **Step 1: `src/recovery-engine-container.ts`** — `export class RecoveryEngineContainer extends Container { defaultPort = 8080; requiredPorts = [8080]; sleepAfter = "5m"; enableInternet = false; pingEndpoint = "ready"; }` (identical to `RasterEngineContainer`).
- [ ] **Step 2: `src/forward.ts`** — the `container.fetch` proxy (clone `forward-convert.ts`), generalized to forward the incoming path (`/diagnose|/repair|/carve`) to `http://recovery<path>`, streaming the body (`duplex: "half"`, pass `signal`), returning the container response verbatim.
- [ ] **Step 3: `src/index.ts`** — `getContainer(env.RECOVERY_ENGINE, "recovery")`; route the three POST paths to `forward(...)`, else 404. Export the DO class. `Bindings = { RECOVERY_ENGINE: DurableObjectNamespace<RecoveryEngineContainer> }`.
- [ ] **Step 4: `wrangler.jsonc`** (clone `convert-worker`, NO cron): `name: "magna-carta-recovery"`; `durable_objects.bindings: [{ name: "RECOVERY_ENGINE", class_name: "RecoveryEngineContainer" }]`; `migrations: [{ tag: "v1", new_sqlite_classes: ["RecoveryEngineContainer"] }]`. The `containers` entry uses the repo-root build context from Task 1 Step 6. VERIFIED against the wrangler config schema: `image` (the Dockerfile path) and `image_build_context` (the build-context dir) are **sibling** string fields on the container object — NOT a nested object. Paths are relative to this wrangler file at `apps/recovery-worker/`:

```jsonc
"containers": [
  {
    "class_name": "RecoveryEngineContainer",
    "image": "../../containers/recovery/Dockerfile",
    "image_build_context": "../../",
    "max_instances": 5,
    "instance_type": "standard-1",
  },
],
```

Note: `wrangler deploy --dry-run` on a container worker tries to build the image with local Docker even in dry-run and fails without it — pass `--containers-rollout=none` to validate the worker bundle + config without Docker (the image itself builds in Cloudflare Workers Builds on push).

- [ ] **Step 5: `package.json`** (clone convert-worker): `@cloudflare/containers: "catalog:"`; scripts `build`/`dev`/`deploy`/`test`. `pnpm-workspace.yaml` `apps/*` glob auto-includes it.
- [ ] **Step 6: Test** — clone convert-worker's forward test: inject a fake container fetcher, assert path forwarding + streamed body + verbatim response passthrough for each of the three paths.
- [ ] **Step 7: Gate + commit** — `pnpm --filter magna-carta-recovery test`; `pnpm --filter magna-carta-recovery exec wrangler deploy --dry-run`. Commit `feat(recovery-worker): dedicated container worker for the repair engine`.

---

### Task 3: App-worker service binding

**Files:** modify `apps/worker/wrangler.jsonc`, `apps/worker/src/app.ts` (Bindings type).

- [ ] **Step 1:** In `apps/worker/wrangler.jsonc` `services[]` (the SINGLE array — the file warns duplicate top-level keys are dropped), add `{ "binding": "RECOVERY_SERVICE", "service": "magna-carta-recovery" }` beside `CONVERT`.
- [ ] **Step 2:** Add `RECOVERY_SERVICE: Fetcher` (or the existing service-binding type used for `SCAN_SERVICE`/`CONVERT`) to the app worker's `Bindings` type.
- [ ] **Step 3:** `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run` typechecks the binding. Commit `feat(worker): bind the recovery service`.

---

### Task 4: Rename the `documents` subject group to `files` + add the File Repair catalog row

**Files:** modify `packages/tools/src/types.ts`, `packages/tools/src/catalog.ts`, and the tools tests.

**Rationale (Decision A):** `documents` is already the file-utilities bucket (its comment says so; it holds converter/metadata/hash/type-verifier/ai-text-detection). This is a rename, not a split — all five stay grouped, AI-Text Detection included.

- [ ] **Step 1:** In `types.ts`, change the `SUBJECT_GROUP_ORDER` entry `"documents"` → `"files"` and update its trailing comment to name the file-utilities family (drop the "documents" wording). The `SubjectGroup` union follows automatically.
- [ ] **Step 2:** In `catalog.ts`, the compiler now flags every `subjectGroup: "documents"` — change all five (file-converter, metadata-scrubber, file-hash-integrity, file-type-verifier, ai-text-detection) to `"files"`.
- [ ] **Step 3:** Add the File Repair row (place it beside the other file tools):

```ts
{
  id: "file-repair",
  name: "File Repair & Salvage",
  icon: "wrench", // Lucide; confirm the name is a real Lucide icon before committing
  subjectGroup: "files",
  permission: assertPermission("tools:fileRepair"),
  contextTags: ["file", "none"],
  backing: { kind: "library" }, // no external integration (the container is internal infra, not a connected integration)
  matterContext: "optional", // stateless by default; opt-in attach-to-matter arrives in Plan 6b
},
```

- [ ] **Step 4:** Update any tools test asserting the subject-group set or catalog snapshot (grep the tools package tests for `"documents"` and for catalog counts). `assertPermission("tools:fileRepair")` validates at module load — it FAILS here until Task 5 registers the key, so Task 5 must land in the same change set (or before this compiles). Sequence Task 5's registry step first if the module-load assertion blocks the build.
- [ ] **Step 5:** `pnpm --filter @magna-carta/tools test` + typecheck. Commit `refactor(tools): rename the documents subject group to files + add File Repair`.

---

### Task 5: The `tools:fileRepair` permission + per-firm seed

**Files:** modify `packages/access-control/src/registry.ts`; create `packages/database/drizzle/per-firm/00NN_seed-tools-file-repair.sql`; modify `packages/database/drizzle/per-firm/meta/_journal.json`, `apps/worker/src/per-firm-migrations.ts`; update the seed-union e2e arrays.

> **RUN FIRST:** `vp run worktrees` + `ls packages/database/drizzle/per-firm/*.sql | tail`. Latest is `0034_seed-tools-ai-text-detection`; take the next free number, but a tools-area stream (`decryption-tool`, `wellbeing-resources`) may have merged to `main` and claimed it — renumber against `main` right before writing. Never hand-edit a rendered/ordered file blindly.

- [ ] **Step 1:** Add `tools:fileRepair` to the access-control registry (mirror `tools:fileTypeVerifier`) with the same role grants the sibling file tools use.
- [ ] **Step 2:** Create the seed migration `00NN_seed-tools-file-repair.sql` cloning `0032_seed-tools-file-type-verifier.sql` (grant the new permission to the same roles). Register it in `meta/_journal.json` (correct idx/tag/when) and in `apps/worker/src/per-firm-migrations.ts` (the ordered loader).
- [ ] **Step 3:** Update the "seed unions" e2e arrays that assert the full permission set — grep for `fileTypeVerifier`/`aiTextDetection` across `apps/worker/test` (known homes: `me.test.ts`, `auth-provisioning-e2e.test.ts`) and add `tools:fileRepair` everywhere they enumerate the tool permissions.
- [ ] **Step 4:** Run the worker integration/e2e suites that exercise seeding (Miniflare). Commit `feat(access-control): tools:fileRepair permission + per-firm seed`.

---

### Task 6: The three stateless app-worker routes (with re-scan on return)

**Files:** create `apps/worker/src/routes/files/file-repair.ts`; modify `apps/worker/src/app.ts`; regenerate the contract.

**Interfaces produced:** `POST /api/v1/file-repair/{diagnose,repair,carve}` — `permission: "tools:fileRepair"`, `resource: "firm"`, `audited: false`, `rateLimit: "expensive"`, `idempotency: "optional"`. Request body streams to the container; responses mirror the container DTOs (diagnose passthrough; repair/carve gated by the re-scan).

- [ ] **Step 1:** Write the route module cloning `file-type.ts` (RouteMeta shape, size cap via `readInspectableSizeCap`, `503` when the service binding is absent, stream `body` to `c.env.RECOVERY_SERVICE.fetch("http://recovery/<op>", { method:"POST", body, duplex:"half" })`, `rawDto = schema.parse(await response.json())` at the trust boundary). Three routes; diagnose returns the report verbatim.
- [ ] **Step 2 (Decision B — the re-scan gate, repair + carve only):** after a 200 from the container, for EACH returned file decode its `contentBase64` and re-scan it before returning:

```ts
// Lazy import — resolveScanPort pulls @cloudflare/containers, whose extensionless internal import
// breaks the static OpenAPI-emit graph if imported at module top (see scan-diagnose.ts).
const { resolveScanPort } = await import("../files/scan-port-binding.ts");
const { computeVerdict } = await import("@magna-carta/file-manager/verdict");
const { readFirmScanPolicy } = await import(/* the firm scan-policy reader scan-diagnose uses */);
const raw = await resolveScanPort(c.env).scan(bytes, { sizeBytes: bytes.length, sniffedContentType: file.mediaType ?? null });
const verdict = computeVerdict(raw, await readFirmScanPolicy(firm.firmDatabase));
```

Repaired/carved bytes are reconstructed from possibly-malicious input, so they are never trusted. **If any returned file's verdict is not `clean`, withhold ALL bytes** and respond `422` with a Problem whose `detail` names the scan reason (a stable code, never content) — the honest `loss` manifest MAY still be returned so the user learns what was recoverable, but not the flagged bytes. Only when every file is `clean` return the `contentBase64` payload. (Align the not-clean branch with the firm scan policy the download gate uses — `block`/`informed-access`/`allow-and-flag`; for this stateless v1, non-clean = withhold. Note the firm-policy alignment as a Plan-6b refinement.)

- [ ] **Step 3:** `registerFileRepairRoutes(app, chokepoint)` — one import + one call in `app.ts` beside `registerFileTypeRoutes`.
- [ ] **Step 4:** Regenerate the contract: `vp run emit-openapi` (or the repo's OpenAPI emit script) + `generate-client`. Commit the regenerated artifacts with the route.
- [ ] **Step 5:** Route tests — a fake `RECOVERY_SERVICE` fetcher + a fake scan port: (a) diagnose passthrough; (b) repair with a clean re-scan returns bytes; (c) repair whose re-scan flags withholds bytes + 422 + no content in the problem; (d) missing binding → 503; (e) oversized body → the size-cap problem; (f) chokepoint denies without `tools:fileRepair`. Commit `feat(worker): stateless file-repair routes with re-scan on return`.

---

### Task 7: Remove the vestigial wasm32 support from `recovery-core`

**Files:** modify `crates/recovery-core/Cargo.toml`; drop the wasm build step from the recovery-core gate/docs (the pillar plan docs' gate lines, any `vp run` wasm step scoped to recovery-core).

**Rationale:** the WASM lane is gone; `recovery-core` runs only native in the container. The `getrandom/wasm_js` pin + `cargo build --target wasm32-unknown-unknown` step existed solely for that lane. Scoped to `recovery-core` ONLY — `engine-host`'s `wasm_edge.rs` + `pdf-core`'s `wasm.rs` STAY (`pdf-core` runs as WASM in the SPA).

- [ ] **Step 1:** Remove the `[target.'cfg(target_arch = "wasm32")'.dependencies] getrandom = { … "wasm_js" }` block from `crates/recovery-core/Cargo.toml`.
- [ ] **Step 2:** Confirm nothing builds `recovery-core` for wasm (grep for `recovery-core` + `wasm` in package.json/scripts — only `packages/pdf` has a wasm build; recovery-core's was the manual gate step). Drop the wasm build line from the recovery-core verification gate.
- [ ] **Step 3:** `cargo test/fmt/clippy` on recovery-core (native) still green. Commit `chore(recovery-core): drop dead wasm32 support (single container lane)`.

---

### Task 8: Docs, status, and fragments

**Files:** `ROADMAP.md`, `STATUS.md` (own slice row only), `changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`.

- [ ] **Step 1:** `changelog.d/file-repair-salvage.md` fragment — the tool is reachable (diagnose/repair/carve), stateless, re-scans output.
- [ ] **Step 2:** `docs/decisions/pending/file-repair-single-container-lane.md` ADR fragment — record the WASM-lane-dropped / single-Container-lane decision and the `documents→files` rename (the engine-host + carving ADR fragments are owed at SP2 merge too — see the design doc closeout).
- [ ] **Step 3 (the reusable-leverage step): capture the canonical engine-container pattern in the engine-host seam standard.** recovery is the first harness-hosted engine container, and we will have many more (raster/scan/bundle exist; SP3 retrofits pdf-core/decryption-core; conversion 2·4, OCR, Tantivy are planned). Add a short "Hosting a pure-Rust engine in a Container" section to the engine-host seam convention (`docs/conventions/engine-host-seam.md` — the standard the framework design anticipated; create it if absent) documenting the reference pattern this plan established: engine crate stays pure in `crates/`; a thin `containers/<engine>` host on `engine_host::host::{ready_app, with_panic_net, serve}`; the `image_build_context` = repo-root Dockerfile shape + `.dockerignore`; a dedicated `apps/<engine>-worker` (Container DO + `getContainer` + forward proxy) reached from the app worker by a service binding. So the NEXT engine copies the pattern instead of re-deriving it. Note (do NOT build now) the future SP3-scope extraction of a shared `container-worker` base across the 4 near-identical workers.
- [ ] **Step 4:** `STATUS.md` — update the File Repair slice row (built/tested for 6a). `ROADMAP.md` — reflect stateless File Repair shipped, attach-to-matter (6b) next.
- [ ] **Step 5:** Commit `docs(file-repair): changelog + ADR fragments + engine-container convention + status`.

---

## Whole-plan review (before merge)

- [ ] Opus adversarial review of the full 6a change set, with these load-bearing checks: (1) the `LossManifest` crosses container→worker→client with `fully_recovered`/`synthesized`/per-item fidelity intact — no route logic softens an honest loss into an overclaim; (2) the re-scan gate cannot leak flagged bytes on ANY path (repair, carve, multi-file carve where one fragment is clean and another flagged → withhold ALL); (3) no file content in any Problem/log (only stable codes + Error ID); (4) the `documents→files` rename left no dangling `"documents"` reference and no tool lost its permission; (5) the container never gets internet egress; (6) size cap enforced before dispatch. Fix rounds, then a sonnet re-review confirming fixes hold.
- [ ] Then **Plan 6b** (attach-to-matter): the untrusted-repaired-output ingest path (reuse the scan gate + `commitVersion`/`quarantineVersion`, NOT the trusted `commitEditedVersion` path), repair→1-new-version / carve→N-new-files (Decision D), `file.repaired` audit. NEVER edit `ingest-core.ts`.

## Notes for the implementer

- **The one novel piece is Task 1 Step 6** — the `image_build_context` = repo-root Dockerfile for a container that builds on the shared `crates/` harness. It is a verified wrangler capability (schema-confirmed), not a hack, and it is deliberately the reference pattern future engine containers copy (Task 8 Step 3). It is NOT locally buildable (no local Docker — images build in Cloudflare Workers Builds on push); `wrangler deploy --dry-run` validates the worker bundle but not the image build, so the image is proven by the in-cloud build on first push. Everything else is cloning a proven template.
- **Use `engine_host::host`, do not hand-roll axum.** recovery is the first NEW engine after the harness landed and is its reference container consumer (raster/scan/bundle predate the harness and are SP3's retrofit targets, not the pattern to copy). The shared `with_panic_net`/body-cap/`/ready` are safety-critical (never-crash-the-container, never a silently-wrong success) and must be shared, not re-derived.
- **`file-type.ts` reaches its container directly off `c.env.SCAN_SERVICE`** (no dedicated helper) — the repair route does the same off `c.env.RECOVERY_SERVICE`. The dedicated `recovery-worker` (Task 2) is what owns the `getContainer` DO call; the app worker only holds the service binding.
- **Re-scan uses the inline port** (`resolveScanPort(...).scan(...)` + `computeVerdict`), the `scan-diagnose.ts` pattern — NOT the queued `maybeEnqueueRescanOnAccess` path (that is for stored versions; here there is no stored version yet).
- **`matterContext: "optional"`** on the catalog row is the seam Plan 6b fills; 6a ships stateless-only.
