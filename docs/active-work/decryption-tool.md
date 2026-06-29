# decryption-tool — HANDOVER

**Stream:** File Decryption & Recovery — a new ethereal Tools-area utility (subject group `documents`).
**Owner:** Trevor Goldsmith · **Branch:** `decryption-tool` · **Worktree:** `C:/dev/magna-carta-worktrees/decryption-tool` · **Off** `main` `413b43b` · **HEAD:** `fd8502f` (49 commits) · **NOT merged** (owner keeps building before merge).

> **Read this whole file first.** It is the single source of truth for picking this up cold.

---

## 1. What this tool is

Unlock a locked file when you HAVE the password (strip-with-key) + RECOVER an unknown password (the dictionary/cracking path) across encrypted containers. v1 formats: **PDF, ZIP, OOXML** (7-Zip + legacy Office/RAR deferred). One in-house core (`crates/decryption-core`) behind a `FormatAdapter` trait; a `RecoveryBackend` port with a light→heavy escalation ladder (Cloudflare CPU → desktop GPU → cloud GPU → external-forensic seam); every job under a `tools:decryption` permission + per-job ownership attestation + redacted audit boundary.

**Authoritative docs (read in order):**
- Parent design: `docs/specs/2026-06-26-decryption-tool-design.md`
- Slice 1 Plan 1 (core): `docs/specs/2026-06-26-decryption-core-slice-1-implementation-plan.md`
- Slice 1 Plan 2 (backend): `docs/specs/2026-06-26-decryption-slice-1-plan-2-worker-implementation-plan.md`
- Slice 2 design: `docs/specs/2026-06-26-decryption-slice-2-recovery-design.md`
- Slice 2 Plan 1 (engine+container): `docs/specs/2026-06-26-decryption-slice-2-plan-1-engine-container-implementation-plan.md`

---

## 2. What is BUILT (done, reviewed, green)

All via subagent-driven TDD (per-task implement + two-stage review + fix loops + an opus final whole-branch review per plan).

**Slice 1 — core + backend (server-side strip/extract works end-to-end):**
- `crates/decryption-core` (pure Rust → also wasm): `FormatAdapter` trait + magic-byte `detect()` + PDF/ZIP/OOXML adapters, each `strip_with_key` / `extract_hash` (→ `$pdf$`/`$zip2$`/`$office$` hash + hashcat mode) / `verify_guess`; a `run_dictionary` (rayon, native-only); top-level façade; `src/wasm.rs` wasm-bindgen edge. Crypto cross-validated vs REAL hashcat `example_hashes` (10700/13600/9600) AND independent fixtures.
- `packages/decryption` (`@magna-carta/decryption`): wasm wrapper (mirrors `packages/pdf`); `ensureReady` accepts `Uint8Array | ArrayBuffer | WebAssembly.Module`.
- Worker: `apps/worker/src/routes/decryption.ts` — audited `POST /api/v1/decryption/inspect` (detect+extract) + `/unlock` (strip-with-key). `tools:decryption` permission (registry + per-firm migration `0023`), catalog row (`file-decryption`, `documents` group), OpenAPI + api-client regenerated, conformance unioned. The wasm runs IN the Worker via `import …decryption_core_bg.wasm` + ambient `apps/worker/wasm-modules.d.ts`; `apps/worker/scripts/emit-openapi.mts` has a `.wasm`-stub plugin (emit-time only).

**Slice 2 Plan 1 — recovery engine + container (the "muscle" for one shard):**
- `decryption-core` gained: `rules.rs` (best64 hashcat rule engine; real `best64.rule`), `shard.rs` (`split_keyspace`, `ShardSpec`), `recover.rs` (`recover_shard(job, words, spec, rules) -> ShardOutcome{found, candidates_tried}`, rayon, native-only, clamps inverted/oob spec — no panic), `tier.rs` (`recovery_tier(format, mode) -> CfCapable | GpuRequired`; unknown → GpuRequired safe-default; + wasm/TS `recoveryTier`).
- `containers/recovery` — a native Rust bin (axum) `POST /recover-shard` + `GET /ready` over baked wordlists; receives the **HASH only, never the file**; validates+clamps the shard range (→400). Dockerfile (BuildKit cache-mounts + `/artifacts` binary-extraction; **build context = repo root** for the `decryption-core` path dep). Bundled clean-license wordlists: **NCSC-100k (OGL v3.0, NOTICES), 10k-common (MIT), best64.rule (MIT)**. `tests/recover_e2e.sh` acceptance script wired into `tooling/git-hooks/pre-push`.
- `apps/recovery-worker` — Cloudflare Container app (mirrors `apps/scan-worker`): `RecoveryEngineContainer extends Container` (`enableInternet=false`, port 8080, `pingEndpoint="ready"`); routing in `forward-recovery.ts` (extracted for node-pool testability).

**Verify green:** `cd crates && cargo test -p decryption-core` (66) · `cd containers/recovery && cargo test` · `pnpm --filter @magna-carta/decryption test` · `pnpm --filter @magna-carta/recovery-worker test` (10) · `pnpm --filter @magna-carta/worker test apps/worker/test/decryption-route.test.ts` + `…/decryption-e2e.test.ts` + conformance + openapi-snapshot.

---

## 3. THE NEXT TASK — Slice 2 Plan 2 (NOT written yet)

The orchestration that makes recovery callable through the app and fans shards across the container fleet. **Start by invoking `superpowers:writing-plans`** to write `docs/specs/2026-06-26-decryption-slice-2-plan-2-orchestration-implementation-plan.md`, then execute it **subagent-driven** (`superpowers:subagent-driven-development`).

What it must build (per the Slice 2 design §4/§6/§7):
1. **`RecoveryJob` Durable Object coordinator** — state machine `queued → triaging → running → found | exhausted | needs_gpu | cancelled` + progress (candidates tried / total). State lives in **DO SQLite, NOT a new D1 table** (mirror `apps/worker/src/downloads/bundle-coordinator.ts` `BundleBuildCoordinator`). It `split_keyspace`s, enqueues one shard message per shard on a **recovery Queue**, aggregates progress, and **first-hit-cancels** the rest.
2. **Recovery Queue** — producer + consumer in `apps/worker/wrangler.jsonc`; consumer handler routed in `apps/worker/src/index.ts` `queue()` (mirror the `BUNDLE_BUILD` / `bundle-consumer.ts` pattern). The consumer dispatches a shard to `apps/recovery-worker` via a **service binding** and reports the result back to the DO.
3. **Routes** (permission `tools:decryption`, per-job attestation, audited — never the password): `POST /api/v1/decryption/recover` (extract_hash via wasm → `recovery_tier` → CF-capable: create job + enqueue shards / slow: `needs_gpu` → returns `{jobId, tier, status}`), `GET …/recover/{jobId}` (status/progress; on `found` surface password once to the authorized requester), `DELETE …/recover/{jobId}` (cancel). **Button-initiated only — nothing cracks automatically.** No file persistence (only the extracted hash enters the job/queue/container).
4. OpenAPI re-emit + api-client regen + conformance unions + a Miniflare e2e.

**Precedents to mirror:** `apps/worker/src/downloads/bundle-coordinator.ts` (job DO), `bundle-consumer.ts` (queue consumer), `apps/worker/src/routes/downloads.ts` + `bundle-status.ts` (create-job + status routes), `apps/scan-worker/src/files/scan-port-binding.ts` (how the app worker reaches a container via service binding). DO must be re-exported from `apps/worker/src/index.ts` or the binding fails at deploy; migrations tag must be unique per new DO class.

**CRITICAL CARRY-FORWARD:** Plan-1's `apps/recovery-worker/src/index.ts` pins a single instance id `getContainer(env.RECOVERY_ENGINE, "recovery")`. The coordinator/consumer **must address DISTINCT instance ids** (e.g. `getContainer(env.RECOVERY_ENGINE, \`${jobId}:${shardIndex}\`)`) to actually fan shards out across containers.

**Design recap (already decided — don't re-litigate):** button-initiated; format-band router (fast/medium → CF Rung 1, slow KDF → `needs_gpu` seam — GPU rungs are later slices); the CF pass runs the full NCSC-100k wordlist, amplified by best64 when the format finishes within a bounded sharded cap; CF v1 uses MODEST real sharding (a few containers) to prove the coordinator. The platform-generic fan-out primitive is DEFERRED, but the next non-recovery domain needing container fan-out MUST consolidate by extracting it from this coordinator (ADR-EEEE).

---

## 4. Process & conventions (FOLLOW THESE)

- **SDD subagent-driven:** fresh subagent per task; after each, generate a review package (`<skill>/scripts/review-package BASE HEAD`) and dispatch a task reviewer (spec + quality); fix Critical/Important, record Minors; opus final whole-branch review per plan. Ledgers (gitignored): `.superpowers/sdd/progress*.md` — the recovery-plan-1 ledger is `progress-slice2-plan1.md` (write `progress-slice2-plan2.md` for the next).
- **Commit hygiene:** `git add` ONLY the task's named files — NEVER `git add -A`. `.superpowers/` and `containers/*/target/` are gitignored; keep them out.
- **Local-formatter churn:** `pnpm check` / `vp check --fix` reformats ~38 PRE-EXISTING files (prettier drift on `STATUS.md`, `packages/pdf`, `docs/specs`, etc.) — NOT your work. Do not stage that collateral; tell subagents to commit only their files and not run repo-wide format-writes. (`docs/specs/2026-06-26-decryption-*` files may show as prettier-touched in the working tree — harmless, leave them.)
- **~34 pre-existing local worker-suite failures** (bundle, conversions, a migration-0016 backtick mismatch) exist independent of this work — **CI is authoritative.** Don't chase them. Verify only the decryption-specific suites (listed in §2).
- **Container images build/deploy via Cloudflare Workers Builds, NOT local docker** (operations.md §11–12). The only sanctioned local docker is the checked-in acceptance script run by the pre-push hook when `containers/<x>/**` changed + docker present. Don't run ad-hoc `docker build`/`run`.
- **No-secret-leak invariant (security keystone):** the password and decrypted plaintext must NEVER appear in any response (except the intended `decryptedBase64`/recovered-password-to-authorized-requester), audit record, problem detail, or log. `fileSha256` in audits is of the ENCRYPTED input. Audits use `refuseUnredactedMetadata`.
- **No panic on untrusted input:** routes/handlers ingest attacker-influenced bytes/hashes — malformed → 400, never 500/panic.
- **Versions:** `decryption-core` reuses `lopdf 0.41` (workspace-promoted), `zip 2` (default-features=false, aes-crypto+deflate only — no C), `cfb 0.10`, `office-crypto 0.2`, RustCrypto **0.10/0.4 generation** (NOT 0.11/0.5), `thiserror 2`. rayon is `cfg(not(wasm32))`. Pure-Rust only (golden rule 14).

---

## 5. Owner preferences & owed items

- **Build complete scope, don't piecemeal; reserve check-ins for real/irreversible forks** (see memory `build-complete-scope-not-piecemeal`). Don't re-confirm settled scope.
- **UI widget deferred to post-0.7** — Slice 2 is backend-only (no Svelte widget).
- **Owner-owed activation:** connect a `magna-carta-recovery` Worker to Workers Builds (dashboard: build root `apps/recovery-worker`, Build Watch Paths), like scan. The recovery container is inert until then.
- **Owner separately decided** to RENAME the tool "File Unlock & Password Recovery" and retrofit it onto the engine-host harness (memory `engine-host-and-file-repair-program` SP3) — NOT applied on this branch; coordinate before/at merge.
- **`packages/pdf` has the same latent `WebAssembly` typecheck gap** that was fixed for `packages/decryption` (added `WebWorker` to tsconfig lib) — pre-existing on main, out of scope here, worth flagging.

## 6. Deferred minors (sweep opportunistically / at merge)

decryption-core: tier unknown-format-string→Pdf fallback (documented); a few crypto coverage gaps (R2/R4-AESV2/R5 fixtures, $pkzip2$ not cross-validated vs a 17200 vector, base64 leniency). Slice-1 backend: DRY the duplicated decode/cap/attestation/audit across `inspect`/`unlock`; native OOXML strip to drop `office-crypto` (it does no password verification + panics on tiny inputs — guarded); `upload-not-allowed` 400-vs-422; `ensureReady` memoizes a rejected promise. Slice-2: drop `ca-certificates` from `containers/recovery/Dockerfile` (no egress); delete unused `apps/recovery-worker/worker-env.d.ts` pool decl; add a zip-mode `recoveryTier` wrapper test; cache the noop `RuleSet` in the container.

## 7. Pending at merge (golden rule 5)

ADR fragments AAAA–EEEE (raise at the shipping slice), `STATUS.md` row, `ROADMAP.md`, `changelog.d/`, user docs. Sync `main` first (branch is ~49 commits off an old `main`; main has moved a lot — engine-host, file-type-verifier, support-access, etc. merged). The worktree-lifecycle cleanup (remove worktree + branch + this active-work note) happens after merge.
