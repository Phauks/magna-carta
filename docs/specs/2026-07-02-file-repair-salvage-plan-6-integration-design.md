# File Repair & Salvage — Plan 6: integration & closeout (design)

> **Status:** DESIGN — awaiting owner review of the open decisions in "Decision points" before the execution plan is written. This is the last plan of SP2 (File Repair & Salvage); it makes the three built engine pillars + the carving fallback shippable end-to-end.

**Goal:** Wire the inert `recovery-core` engine (ZIP/OOXML, CFB/OLE2, PDF-xref repair pillars + the carving fallback) into the running product: a worker route to diagnose/repair/carve an uploaded file, execution on a proven runtime lane, stateless download of the salvaged output, and opt-in attach-to-matter. Migrate the file-oriented tools into a dedicated `files` subject group. **No UI** (owner decision — no tool-drawer entry, no wrench icon yet); the route is the deliverable, exercised by tests.

---

## What is already true (grounding, verified 2026-07-02)

- **The engine is complete and inert.** `recovery-core` exposes `diagnose(bytes) -> DiagnosisReport`, `repair(bytes) -> Result<RepairResult, RepairError>` (dispatch keyed on `engine_host::format::detect`), and `carve(bytes) -> Result<RepairResult, RepairError>` (a separate explicit entry, NOT in the dispatch). `RepairResult { files: Vec<SalvagedFile{ name, bytes, media_type }>, loss: LossManifest }`. Nothing calls any of it yet.
- **The Container lane is proven.** Two shipped tools — File Type Verifier and Converter — run native Rust in a Cloudflare Container over a service binding (`getContainer` → `container.fetch`), on the exact `engine_host::host` axum skeleton `recovery-core` compiles against natively. This is the de-risked path.
- **A server-side WASM lane does NOT exist in this repo.** Verified: the only Rust→WASM precedent is `pdf-core`, built `wasm-pack --target web` into `packages/pdf/src/pkg` — a *browser* target that runs in the SPA and cannot even initialize under Node (needs `fetch`). `apps/worker/wrangler.jsonc` has **zero** WASM module rules. `recovery-core` compiles to `wasm32-unknown-unknown` as a library check only (the `getrandom/wasm_js` pin) — it has no `crate-type=["cdylib"]`, no `wasm.rs` bindings, no wrapper package. Running it inside the Worker would be net-new, unproven bundling.
- **The subject group is compile-time UI-only.** `SUBJECT_GROUP_ORDER` in `packages/tools/src/types.ts` is never persisted and never an authorization input; moving tools from `documents` → `files` is a catalog edit + test updates, with no data migration and no grant risk.
- **The `files` context tag already exists** (introduced by File Hash & Integrity) — the permission/audit vocabulary for a files group is partly in place.

---

## The lane decision (the pivotal fork — RESOLVED to a single Container lane)

The SP2 design assumed a two-lane model: a **Worker (WASM) default lane** for small files and a **Container (native) heavy lane** for large ones. Verification (above) shows the default half is unbuilt and unprecedented here, while the heavy half is fully proven.

**Decision (owner, 2026-07-02): drop the WASM lane entirely — repairs run on the Container, and only the Container.** Users are content to upload a file and wait a few seconds for a repair; there is no requirement the WASM lane was meant to serve, so a second runtime is pure cost. Rationale:

1. **The Container lane is mandatory regardless.** A Worker isolate has a hard 128 MB memory ceiling; the carving budget alone permits a 256 MB candidate, and large corrupt archives/PDFs will not fit an isolate. The Container path must exist no matter what.
2. **A second runtime is cost without benefit here.** Standing up wasm-bindgen bindings + a `wrangler.jsonc` module rule + a `packages/recovery` wrapper would trailblaze unproven bundling to buy a few seconds of latency users do not need.
3. **One course of action = a simpler system.** With a single lane there is **no lane selector** (`selectRepairLane` is not built) — the route always dispatches to the Container. The only sizing concern left is an upload cap that rejects oversized input before dispatch.
4. **It matches how every engine tool here already ships** (File Type Verifier, Converter are container-backed).

**Consequence — vestigial wasm32 support in `recovery-core`.** The crate carries wasm32-compile machinery solely for the dropped lane: the `getrandom/wasm_js` target pin in `crates/recovery-core/Cargo.toml` and a `wasm32-unknown-unknown` build step in each pillar's gate. With WASM gone these are dead maintenance on a crate that will never run in a browser or isolate. **Recommended cleanup (fold into Plan 6):** remove the `getrandom/wasm_js` pin and drop the wasm build step from the recovery-core gate. This is scoped to `recovery-core` only — `engine-host`'s `wasm_edge.rs` and `pdf-core`'s `wasm.rs` stay, because `pdf-core` genuinely runs as WASM in the SPA.

---

## Integration architecture (container-only v1)

```
POST /api/tools/file-repair            (worker route, defineOpenAPIRoute + zod)
  -> RBAC chokepoint: requires tools:fileRepair
  -> upload-size cap: reject oversized input (no lane selector — one lane)
  -> service binding -> getContainer -> container.fetch(POST /diagnose|/repair|/carve)
       (engine-host axum host running recovery-core native)
  -> response: DiagnosisReport | { files:[{name, media_type, bytes}], loss: LossManifest }
       stateless: bytes streamed back to the caller, audited:false (nothing persisted)

POST /api/tools/file-repair/attach     (opt-in, separate route)
  -> attachRepairedVersion(...) modeled on file-service commitEditedVersion/restoreVersion
  -> commitEffectBatch(firm.firmDatabase) with fileAuditStatement, audited:true, resource:"matter"
  -> N salvaged files -> N new versions / N new files (see Decision D)
```

**Container endpoint shape.** The `engine-host` axum host gains `/diagnose`, `/repair`, `/carve` POST routes (body = raw bytes, `DefaultBodyLimit` set to the upload cap). Each marshals to/from `recovery-core` and returns JSON + (for repair/carve) the salvaged bytes. The honest-loss `LossManifest` rides in the JSON envelope; salvaged bytes are a separate part (multipart or a length-prefixed framing — TBD in the plan, prefer streaming the largest `SalvagedFile` rather than buffering all N).

**Log-safety carries through the seam.** `RecoveredItem.name`/`detail` are owner-facing receipt fields and must never enter the redacted error-log pipeline; only `RepairError::code()` is log-safe. The worker route surfaces a user-facing Error ID on failure, per the standard error pipeline.

**Input-size cap is the host's job** (the engine's `MAX_TOTAL_VALIDATIONS`/count caps bound work, but the route must reject oversized uploads before dispatch). The lane selector's threshold and the hard reject ceiling are set here.

---

## The `files` subject group + permission (the cross-cutting part)

**Subject group (zero-risk):** add `"files"` to `SUBJECT_GROUP_ORDER` (`packages/tools/src/types.ts`); flip `subjectGroup: "documents" → "files"` on the file-oriented tool rows in `packages/tools/src/catalog.ts` (Metadata Inspector/Scrubber, File Hash & Integrity, File Type Verifier, Converter — see Decision A); add the new `file-repair` catalog row. Update any catalog snapshot/subject-group tests. No DB migration.

**Permission (needs the full triple + seeds):** add `tools:fileRepair` to the access-control registry (`packages/access-control/src/registry.ts`); add a per-firm seed migration (`packages/database/drizzle/per-firm/00NN_seed-tools-file-repair.sql` + `meta/_journal.json` + register in `apps/worker/src/per-firm-migrations.ts`); update the "seed unions" e2e arrays that assert the full permission set (`me.test.ts`, `auth-provisioning-e2e.test.ts`). These are the known recurring tool-slice gotchas (see the metadata-tool status memory): tsconfig references, seed unions, `per-firm-migrations.ts`, dual allow-lists, contract regen.

**Contract regen:** after the route lands, regenerate the OpenAPI contract + client (`emit-openapi` + `generate-client`).

---

## Decision points (need owner input before the execution plan)

- **A — Which tools move to `files`?** Proposed: Metadata Inspector/Scrubber, File Hash & Integrity, File Type Verifier, Converter, and the new File Repair. **Open:** does AI-Text Detection (currently `documents`) also move? It analyzes document *content*, not file structure — argument to leave it in `documents`. *Recommend: leave AI-Text Detection in `documents`; move the five structural-file tools.*
- **B — Re-scan repaired output through the malware gate?** The salvaged bytes are reconstructed from a possibly-malicious corrupt input. The existing content tools commit trusted bytes without a re-scan, but repair is different — it emits a *new* file the user will open. *Recommend: run the stateless repair output through the scan engine before attach-to-matter (not on the stateless download, which is the user's own bytes back). Confirm.*
- **C — Stateless-only, or attach-to-matter in this plan?** Owner previously said "no UI." Attach-to-matter has no UI either way (it's a route). *Recommend: build both the stateless route and the opt-in attach route now — attach is the whole point of a legal-evidence tool, and the file-service template makes it cheap.*
- **D — N salvaged files → new versions or new files?** Carving returns N `SalvagedFile`s from one input; the pillars return one. Attach can create N new versions of one file, or N new files. *Recommend: one repaired input file → one new version (modeled on `commitEditedVersion`); carve's N fragments → N new files (each is a distinct recovered document, not a revision of the input). Confirm.*
- **E — Render-verification of repaired PDFs?** Optional enhancement flagged in the Plan 4 doc: verify a repaired PDF via the mainline `pdf-core` hayro render path ("N of M pages decode") on the container lane. *Recommend: defer to a fast-follow; keep Plan 6 to the honest-loss manifest the engine already produces.*

---

## Explicitly deferred / dropped (not this plan)

- **The WASM lane — DROPPED, not deferred** (owner, 2026-07-02). Repairs run on the Container only; there is no second runtime and no lane selector. Fold the vestigial-wasm32 cleanup into Plan 6 (see the lane decision above).
- **UI** — no tool-drawer entry, no wrench icon (owner decision).
- **Magika ML carving** — container-only ONNX enhancement, already deferred in Plan 5.
- **Render-verification** (Decision E) unless the owner pulls it in.

---

## Closeout (on SP2 merge, after Plan 6 builds)

- Run `vp run worktrees` BEFORE any cross-cutting edit; sync `main` before touching shared/generated files.
- Owed at merge: `vp run decisions-build` + `vp run changelog-build` for the engine-host + file-repair fragments.
- Remove the worktree + branch + `docs/active-work/<branch>.md` in one step.
- Then SP3 (retrofit) + the "File Decryption & Recovery" → "File Unlock & Password Recovery" rename — separate, later.
