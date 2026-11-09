# Decryption Slice 1, Plan 2 of 2 — WASM wrapper + Worker backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `crates/decryption-core` usable from the app: compile it to WASM, wrap it as `@magna-carta/decryption`, and expose audited, permission-gated Worker routes for **inspect** (detect + extract recovery hash) and **unlock** (strip-with-key decrypt) — the non-UI backend that completes Slice 1. The Tools-area Svelte widget is deferred (post-0.7) and out of scope.

**Architecture:** A WASM edge (`crates/decryption-core/src/wasm.rs`) exposes `detect`/`stripWithKey`/`extractHash`/`verifyGuess` (the `rayon` dictionary engine is cfg-gated to native — bulk recovery runs in a Container in a later slice, never in the Worker/client). `packages/decryption` wraps the wasm (mirroring `packages/pdf`). Two Worker routes call the wasm in-band behind the chokepoint, gated by a new `tools:decryption` permission, requiring a per-job ownership attestation, and writing a redacted audit record (never the password or file content). File bytes ride in the request body (base64) with a size cap for v1; ephemeral-R2 upload is a later-slice concern (arrives with the recovery job model).

**Tech Stack:** Rust + wasm-bindgen/wasm-pack (target web), `@magna-carta/decryption` (TS), Hono + `@hono/zod-openapi` (OpenAPI code-as-contract), `@magna-carta/access-control`, Drizzle per-firm migration, `@magna-carta/data-access` audit statements, Miniflare integration tests.

## Global Constraints

- **Pure Rust, no C — including the wasm build.** `rayon` does NOT target `wasm32`: make it a `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]` entry and `#[cfg(not(target_arch = "wasm32"))]`-gate `mod dictionary` + its re-exports. The wasm edge must NOT reference `run_dictionary`. If any other dependency (`office-crypto`, `cfb`, `zip`, `lopdf`, RustCrypto) fails to compile for `wasm32-unknown-unknown`, STOP and report BLOCKED — do not hack around it.
- **RustCrypto stays on the 0.10/0.4 generation; reuse, don't add deps.** Mirror `crates/pdf-core`'s wasm32 dep block (`wasm-bindgen 0.2`, `serde`, `serde-wasm-bindgen 0.6`, `js-sys 0.3`, `getrandom 0.4` with `wasm_js`).
- **Full names, no shorthand** (golden rule 12): `@magna-carta/decryption`, `tools:decryption`, `stripWithKey`, `extractHash`, `verifyGuess`, `detect`. No `db`/`dal`/`id` shorthand.
- **No process-doc references in source / OpenAPI descriptions** (golden rule 13): consumer-facing strings carry no "Plan/slice/ADR" — state the reasoning or point to a file.
- **Redact by default** (golden rule 4): audit records carry who · file content hash · format · rung(=`strip`) · outcome · attestation — NEVER the password, the supplied bytes, or decrypted content.
- **OpenAPI is code-as-contract:** after adding/altering routes, re-emit `apps/worker/openapi/openapi.json`, regenerate `@magna-carta/api-client`, and update the conformance committed-operations list — all in the same task.
- **Mirror the precedents exactly** (read them first): routes → `apps/worker/src/routes/files/metadata.ts` (inspect/scrub shape) and `apps/worker/src/routes/files/file-integrity.ts` (the audited-route + audit-statement shape); wasm wrapper → `packages/pdf` (`package.json` `build:wasm`, `src/index.ts` `ensureReady`, `.gitignore` ignoring `src/pkg/`); permission → `packages/access-control/src/registry.ts`; migration → `packages/database/drizzle/per-firm/0020_seed-tools-metadata-scrubber.sql` + registration in `apps/worker/src/per-firm-migrations.ts`; catalog → `packages/tools/src/catalog.ts`.
- **Gate per task:** Rust tasks → `cargo test/clippy -D warnings/fmt` for `decryption-core` + `wasm-pack build`. TS/Worker tasks → `pnpm check` (the full fmt+lint+typecheck+svelte-check gate) AND the relevant `vp test` suites (Vitest unit + the Miniflare worker integration). Commit only when green.
- **Commit hygiene:** `git add` only the files a task changes — never `git add -A` (gitignored `.superpowers/` scratch must stay out).

---

### Task 1: WASM edge on `decryption-core` (+ cfg-gate rayon)

**Files:**

- Create: `crates/decryption-core/src/wasm.rs`
- Modify: `crates/decryption-core/Cargo.toml` (wasm32 deps; rayon → native-only target dep)
- Modify: `crates/decryption-core/src/lib.rs` (`#[cfg(target_arch="wasm32")] mod wasm;`; cfg-gate `mod dictionary` + its re-exports to non-wasm)

**Interfaces:**

- Produces (wasm-bindgen exports, camelCase to JS): `detect(bytes: &[u8]) -> Option<String>` (format name or null), `stripWithKey(bytes: &[u8], password: &str) -> Result<JsValue, JsError>` (→ `{ bytes: Uint8Array, filenameHint?: string }`), `extractHash(bytes: &[u8]) -> Result<JsValue, JsError>` (→ `{ format, hash, hashcatMode }`), `verifyGuess(hash: &str, format: &str, candidate: &str) -> bool` (parse the hash for the format, then verify). Errors carry a stable code string (`wrongPassword`/`notEncrypted`/`unsupported`/`malformed`), never file content.

- [ ] **Step 1: cfg-gate rayon + dictionary**

In `Cargo.toml` move `rayon` out of `[dependencies]` into:

```toml
[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
rayon = "1"
```

In `lib.rs` change `mod dictionary; pub use dictionary::{run_dictionary, verify};` to:

```rust
#[cfg(not(target_arch = "wasm32"))]
mod dictionary;
#[cfg(not(target_arch = "wasm32"))]
pub use dictionary::{run_dictionary, verify};
```

- [ ] **Step 2: add the wasm32 dep block** (mirror `crates/pdf-core/Cargo.toml`)

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
js-sys = "0.3"
getrandom = { version = "0.4", features = ["wasm_js"] }
```

- [ ] **Step 3: write `src/wasm.rs`** — `#[wasm_bindgen]` free functions delegating to the crate API. `detect` returns the `Format` as a lowercase string or `None`. `stripWithKey`/`extractHash` map `Result<_, DecryptError/ExtractError>` to `Err(JsError::new(stable_code))` and serialize the success value with `serde_wasm_bindgen::to_value`. `verifyGuess` dispatches on the `format` string to the right adapter's `parse_hash` + `verify_guess` (return `false` on parse failure — never panic). Add `#![cfg-gate]` appropriately so the module only compiles for wasm32.

- [ ] **Step 4: verify native unchanged + wasm builds**

Run: `cd crates && cargo test -p decryption-core && cargo clippy -p decryption-core --all-targets -- -D warnings && cargo fmt -p decryption-core -- --check`
Expected: native 45 tests still pass (dictionary still present on native), clippy/fmt clean.
Run: `cd crates/decryption-core && wasm-pack build --target web --out-dir ../../packages/decryption/src/pkg --release --no-opt`
Expected: SUCCESS, emits `decryption_core_bg.wasm` + JS bindings. **If a dependency fails to compile for wasm32, STOP → BLOCKED** (report which crate; the fix is likely a feature flag or cfg-gating that format's path to native-only, which reshapes Task 2).

- [ ] **Step 5: commit** (`crates/decryption-core/Cargo.toml`, `src/lib.rs`, `src/wasm.rs`)

```
git commit -m "feat(decryption): wasm-bindgen edge (detect/strip/extract/verify); rayon native-only"
```

---

### Task 2: `@magna-carta/decryption` WASM wrapper package

**Files:**

- Create: `packages/decryption/package.json`, `packages/decryption/src/index.ts`, `packages/decryption/.gitignore` (`src/pkg/`), `packages/decryption/tsconfig.json`, `packages/decryption/test/wrapper.test.ts`
- (Generated, gitignored: `packages/decryption/src/pkg/`)

**Interfaces:**

- Consumes: the wasm exports from Task 1.
- Produces (TS, mirroring `packages/pdf/src/index.ts`): `ensureReady(wasmInput?)`, and typed wrappers `detectFormat(bytes: Uint8Array): "pdf"|"zip"|"ooxml"|null`, `stripWithKey(bytes, password): { bytes: Uint8Array; filenameHint?: string }`, `extractHash(bytes): { format; hash; hashcatMode }`, `verifyGuess(hash, format, candidate): boolean`. Errors surface as a typed error carrying the stable code.

- [ ] **Step 1: scaffold** package.json/tsconfig/.gitignore mirroring `packages/pdf` (read it). `build:wasm` script = the Step-4 wasm-pack command from Task 1. `exports` → `./src/index.ts`.
- [ ] **Step 2: write the failing wrapper test** (`test/wrapper.test.ts`, vitest, Node): load the wasm via `ensureReady` (read the wasm bytes from `src/pkg`), then assert `detectFormat` on a `%PDF` header → `"pdf"`, and round-trip the checked-in PDF fixture bytes (`crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf`, password `test`) through `stripWithKey` → output starts with `%PDF`, and `extractHash` → `verifyGuess(hash,"pdf","test") === true`.
- [ ] **Step 3: run it, see it fail** (`pnpm --filter @magna-carta/decryption test`) — fails until index.ts exists.
- [ ] **Step 4: implement `src/index.ts`** (mirror `packages/pdf`'s `ensureReady` + free()/dispose discipline; here the calls are stateless free functions, so no handle lifecycle — just `ensureReady` then call).
- [ ] **Step 5: run the test → pass**, then `pnpm check` for the package.
- [ ] **Step 6: commit** (the package files; NOT `src/pkg/`).

```
git commit -m "feat(decryption): @magna-carta/decryption wasm wrapper"
```

---

### Task 3: register the `tools:decryption` permission

**Files:** Modify `packages/access-control/src/registry.ts`.

- [ ] **Step 1:** add `"tools:decryption"` to the `PERMISSIONS` array, alphabetically within the `tools:` group (read the file for ordering).
- [ ] **Step 2:** run `pnpm --filter @magna-carta/access-control test` + `pnpm check` for the package → green. (This permission is now referenceable as a compile-checked literal in route metadata.)
- [ ] **Step 3: commit** `git commit -m "feat(decryption): register tools:decryption permission"`

---

### Task 4: per-firm migration seeding `tools:decryption`

**Files:**

- Create: `packages/database/drizzle/per-firm/0023_seed-tools-decryption.sql` (+ the Drizzle journal entry it requires — mirror exactly how `0022_seed-tools-file-integrity` is journaled).
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + map entry).

- [ ] **Step 1:** copy `0020_seed-tools-metadata-scrubber.sql` → `0023_seed-tools-decryption.sql`, replacing the permission with `tools:decryption` and generating fresh `role_permission` ids; seed it onto the SAME default roles the metadata migration targets (read that file for the exact role ids + the all-roles set). Add the journal entry (`packages/database/drizzle/per-firm/meta/_journal.json` or equivalent — mirror the 0022 entry).
- [ ] **Step 2:** in `apps/worker/src/per-firm-migrations.ts` add the import and the `"0023_seed-tools-decryption": seedToolsDecryptionSql` map entry (mirror the 0022 lines).
- [ ] **Step 3: verify** the migration applies: run the database package migration tests + `vp test` worker provisioning subset. (Note: `per_firm_schema_version` assertions now expect `0023` — see Task 8.)
- [ ] **Step 4: commit** `git commit -m "feat(decryption): seed tools:decryption (migration 0023)"`

---

### Task 5: Worker route `POST /api/v1/decryption/inspect`

**Files:**

- Create: `apps/worker/src/routes/files/decryption.ts` (with `registerDecryptionRoutes(app, chokepoint)`; this task adds the inspect route, Task 6 adds unlock).
- Modify: `apps/worker/src/app.ts` (import + call `registerDecryptionRoutes`).

**Interfaces:**

- Request (zod): `{ fileBase64: string; attestation: { authorized: true } }`. Response: `{ format: "pdf"|"zip"|"ooxml"; hash: string; hashcatMode: number }`.
- RouteMeta: `permission: "tools:decryption"`, `surface: "app"`, `authenticated: true`, `resource: "firm"`, `audited: true`, `idempotency: "optional"`, `rateLimit: "expensive"`, `operationId: "decryption.inspect"`.

- [ ] **Step 1:** read `apps/worker/src/routes/files/metadata.ts` (route shape, base64 chunked decode helpers) and `file-integrity.ts` (audit-statement write).
- [ ] **Step 2: write the failing route test** (`apps/worker/test/decryption-route.test.ts`, Miniflare): POST `/api/v1/decryption/inspect` with the PDF fixture base64 + `attestation.authorized=true` and a principal holding `tools:decryption` → 200 `{format:"pdf", hashcatMode:10500|..., hash:"$pdf$..."}`; without the permission → 403; missing/`false` attestation → 400 (a stable problem code).
- [ ] **Step 3: run it, see it fail.**
- [ ] **Step 4: implement** the route in `decryption.ts`: validate body, enforce a size cap (read the cap helper used by metadata/file-integrity, e.g. `readInspectableSizeCap`), decode base64 → bytes, call `@magna-carta/decryption` `ensureReady` + `extractHash`, map `ExtractError` codes → 400 problems (no content echoed), and on success write a redacted audit record (`event: "decryption.inspected"`, metadata: actor, `fileSha256` of the input, `format`, `outcome:"extracted"`, attestation) via `insertAuditLogStatement` + `commitEffectBatch`. Register `registerDecryptionRoutes` in `app.ts`.
- [ ] **Step 5: run the test → pass**, then `pnpm check`.
- [ ] **Step 6: commit** `git commit -m "feat(decryption): POST /api/v1/decryption/inspect (detect + extract hash, audited)"`

---

### Task 6: Worker route `POST /api/v1/decryption/unlock`

**Files:** Modify `apps/worker/src/routes/files/decryption.ts`, `apps/worker/test/decryption-route.test.ts`.

**Interfaces:**

- Request: `{ fileBase64: string; password: string; attestation: { authorized: true } }`. Response: `{ decryptedBase64: string; filenameHint?: string }`.
- RouteMeta: same as inspect but `operationId: "decryption.unlock"`.

- [ ] **Step 1: write the failing test:** unlock the PDF fixture with `password:"test"` + attestation + permission → 200, `decryptedBase64` decodes to bytes starting `%PDF`; wrong password → 400 `wrongPassword`; missing attestation → 400; no permission → 403. Assert an audit record is written (and that NO test asserts the password appears anywhere in the audit/response).
- [ ] **Step 2: run, see fail.**
- [ ] **Step 3: implement:** size cap → decode → `ensureReady` + `stripWithKey(bytes, password)`; map `DecryptError::WrongPassword→400 wrongPassword`, `NotEncrypted→400 notEncrypted`, `Unsupported→400`, `Malformed→400 malformed`; on success base64-encode the decrypted bytes. Write a redacted audit record (`event:"decryption.unlocked"`, metadata: actor, `fileSha256`, `format`, `outcome:"decrypted"`, attestation — **never** the password or any plaintext).
- [ ] **Step 4: run → pass**, `pnpm check`.
- [ ] **Step 5: commit** `git commit -m "feat(decryption): POST /api/v1/decryption/unlock (strip-with-key, audited, redacted)"`

---

### Task 7: catalog manifest row

**Files:** Modify `packages/tools/src/catalog.ts`.

- [ ] **Step 1:** add one `ToolManifest` row (read the file + its `CLAUDE.md`):

```ts
{
  id: "file-decryption",
  name: "File Decryption & Recovery",
  icon: "lock-open",
  subjectGroup: "documents",
  permission: assertPermission("tools:decryption"),
  contextTags: ["file"],
  backing: { kind: "library" },
  matterContext: "none",
},
```

- [ ] **Step 2:** run `pnpm --filter @magna-carta/tools test` (incl. the purity fitness test) + `pnpm check` → green.
- [ ] **Step 3: commit** `git commit -m "feat(decryption): tools catalog manifest row"`

---

### Task 8: reconcile the conformance + provisioning test "unions"

**Files (read each, update only what the new permission/routes require):**

- `apps/worker/test/conformance.test.ts` — add `decryption.inspect` + `decryption.unlock` to the **committed-operations list** (sorted). They are `audited:true` → do **NOT** add them to `NON_MUTATING_POST_ALLOW_LIST`.
- `apps/worker/test/auth-provisioning-e2e.test.ts` — add `"tools:decryption"` to the Owner/seeded permissions array (alphabetical); bump the expected `per_firm_schema_version` to the `0023` tag.
- `packages/database/test/node-sqlite.test.ts`, `apps/worker/test/me.test.ts`, `apps/worker/test/firms.test.ts` — union `tools:decryption` into the exact role-grant/permission assertions (and the latest-migration-tag assertion) wherever they enumerate seeded permissions.

- [ ] **Step 1:** grep these files for `tools:fileIntegrity`/`tools:metadataScrubber` and `0022` to find every assertion that enumerates the permission set or the latest migration tag; add `tools:decryption` / bump to `0023` in each.
- [ ] **Step 2:** run the full worker + database suites (`vp test`) → green.
- [ ] **Step 3: commit** `git commit -m "test(decryption): union tools:decryption + migration 0023 into conformance/provisioning assertions"`

---

### Task 9: OpenAPI emit + api-client regen + snapshot

**Files:** `apps/worker/openapi/openapi.json` (regenerated), `@magna-carta/api-client` generated output, the openapi snapshot test fixture if separate.

- [ ] **Step 1:** `pnpm --filter @magna-carta/worker run emit-openapi` → regenerates `openapi.json` with the two new operations.
- [ ] **Step 2:** regenerate the client: `pnpm --filter @magna-carta/api-client run generate` (read its package.json for the exact script name).
- [ ] **Step 3:** run the OpenAPI snapshot + conformance contract tests → green (they were failing until regen).
- [ ] **Step 4: commit** `git commit -m "chore(decryption): emit OpenAPI + regenerate api-client for decryption routes"`

---

### Task 10: end-to-end Miniflare integration test

**Files:** Create/extend `apps/worker/test/decryption-e2e.test.ts` (or fold into the existing worker integration suite).

- [ ] **Step 1: write** an end-to-end test against the assembled Worker (the Miniflare integration harness `vp test` runs): provision a firm, authenticate a principal with `tools:decryption`, POST `/inspect` then `/unlock` with the PDF fixture, assert the decrypted bytes + that exactly one audit record per call exists with the redacted shape (no password/plaintext), and that a principal WITHOUT the permission gets 403 on both.
- [ ] **Step 2: run → pass** (`vp test` worker integration), `pnpm check`.
- [ ] **Step 3: commit** `git commit -m "test(decryption): end-to-end inspect+unlock through the Worker (Miniflare)"`

---

## Self-Review

**Spec coverage (design §1 module placement, §2 core API surfacing, §5 data model, §6 auth boundary, §10 catalog):**

- `packages/decryption` WASM wrapper → Tasks 1–2. ✓
- Worker routes inspect+unlock → Tasks 5–6. ✓
- `tools:decryption` permission + Owner/Admin seed → Tasks 3–4. ✓
- Per-job attestation + redacted audit (never password/content) → Tasks 5–6, asserted in 6 + 10. ✓
- Catalog manifest (`documents`, `file` tag, library, matterContext none) → Task 7. ✓
- OpenAPI code-as-contract + client + conformance → Tasks 8–9. ✓
- **Deferred / out of scope (stated):** the Tools-area Svelte widget (post-0.7); ephemeral-R2 upload for large files (arrives with the recovery job model); the recovery rungs (Slice 2/3); native-OOXML-strip / office-crypto removal (separate follow-up). In-band base64 bytes + a size cap stand in for R2 in v1 — matches how `metadata`/`file-integrity` handle bytes today.

**Placeholder scan:** the route/migration/wrapper tasks intentionally say "mirror `<concrete file path>`" rather than re-pasting 200-line boilerplate — every such reference names an exact existing file to copy the shape from, plus the specific deltas (RouteMeta values, schemas, audit event names, permission string). The exact values that matter (operationIds, permission, migration tag, manifest row, error codes) are spelled out.

**Cross-task consistency:** `tools:decryption` (registry Task 3 → migration Task 4 → route meta Tasks 5/6 → catalog Task 7 → test unions Task 8); operationIds `decryption.inspect`/`decryption.unlock` (routes 5/6 → conformance 8 → OpenAPI 9 → e2e 10); migration tag `0023` (Task 4 → assertions Task 8). Audited routes are excluded from the non-mutating allow-list by design (Task 8).

## Execution Handoff

This is Plan 2 of 2 for Slice 1. After it lands green, Slice 1's backend is complete (server-side strip + extract, audited, permissioned); the only remaining Slice-1 piece is the deferred Tools-area UI widget (post-0.7). The recovery rungs are Slices 2–3.
