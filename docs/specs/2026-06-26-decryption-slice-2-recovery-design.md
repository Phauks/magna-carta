# File Decryption & Recovery — Slice 2 (Rung 1 recovery + format router) design

**Status:** Accepted (design) · **Date:** 2026-06-26 · **Owner:** Trevor Goldsmith
**Builds on:** the Slice 1 core + backend (`crates/decryption-core`, `@magna-carta/decryption`, the `decryption.inspect`/`unlock` routes) — `docs/specs/2026-06-26-decryption-tool-design.md` (parent), `…-decryption-core-slice-1-implementation-plan.md`, `…-decryption-slice-1-plan-2-worker-implementation-plan.md`. Mirrors the conversion service's job model (`ConversionJob` DO) and the Container workers (`apps/scan-worker`, `apps/convert-worker`).
**ADRs (new, to record):**

- **ADR-DDDD** — Recovery tier router: classify each `RecoveryJob` by KDF hardness into a CF-capable band (run on Rung 1) vs a GPU-required band (handed to the GPU rung), and run a button-initiated, coverage-bounded dictionary pass on the CF band.
- **ADR-EEEE** — Sharded fan-out coordinator: the `RecoveryBackend` port + `RecoveryJob` DO are a backend-agnostic keyspace-split + first-hit-cancel coordinator (CF adapter now, GPU adapter next). The platform-generic cross-domain fan-out primitive is deferred; **the next non-recovery domain that needs container fan-out must consolidate by extracting it from this coordinator, not roll its own.**

Slice 1 made a locked file's recovery hash extractable and let you decrypt with a known password. This slice adds **Rung 1 — actually recovering an unknown password** on Cloudflare's own compute: a button-initiated dictionary attack over the bundled common-password wordlist, routed by format hardness, coordinated by a backend-agnostic job so the later GPU rungs plug in without rework.

The honest frame (from the dependency research): Cloudflare Containers are CPU-only and weak — modern KDFs are weeks of brute-force there. So Rung 1 is **not** a real cracker; it is the always-available **common-password** tier. It clears forgotten *weak* passwords cheaply, and routes everything harder to the GPU rungs (next slices).

---

## 1. Button-initiated, never automatic

Recovery costs CF compute, so it only ever runs on an explicit user action — the `POST /api/v1/decryption/recover` route (a "Recover password" button later). Nothing cracks on upload or on `inspect` (inspect only extracts the hash — no compute spent). There is **no background/automatic pass** anywhere.

## 2. The format router (KDF-hardness → tier)

On a recover request, the Worker runs the Slice-1 `extract_hash` (wasm) to produce the `RecoveryJob` (hash string + format + params + hashcat mode), then classifies it:

- **CF-capable band** — fast + medium KDFs: legacy PDF (RC4 R2–R4), ZipCrypto, old Office (RC4), and WinZip-AES (PBKDF2-HMAC-SHA1 ×1000). These finish a meaningful pass on CF in seconds-to-minutes for cents. → run on Rung 1.
- **GPU-required band** — slow KDFs: PDF R6 (AES-256 hardened), OOXML agile (SHA-512 ×100k), 7-Zip (SHA-256 ×2¹⁹). A meaningful CF pass is hours-to-weeks. → the job is created in a terminal **`needs_gpu`** state with a clear status ("not in the common-password set reachable on this tier — deeper recovery requires the GPU rung"), the seam Rung 2/3 fill later.

Classification derives from `RecoveryJob` (format + revision/mode), no new probing. This *is* the format separation — the band decides how deep CF goes and where the GPU handoff sits.

## 3. The CF recovery pass — coverage-bounded depth

The CF pass is bounded by **coverage**, not a magic candidate count: it always runs the full bundled **NCSC Top-100k** wordlist on every CF-capable job; it adds **best64** rule-amplification only when the format is fast enough to finish the amplified keyspace within a bounded sharded wall-clock cap.

- **Fast band** → full `NCSC-100k × best64` (≈6.4M) — seconds, ~$0.001.
- **Medium band** (WinZip-AES) → full `NCSC-100k × best64` — minutes single / seconds sharded, ~$0.01.
- **(CF-capable, if ever a slower-but-still-CF KDF)** → full `NCSC-100k` straight (~$0.03), rules deferred to GPU.

NCSC-100k alone recovers the large majority of weak human-chosen passwords; rules-amplification (the 60–80% band) is the GPU rung's job. The keyspace is finite, so a pass always terminates (no infinite run); a **max-shard / max-shard-wall-clock** cap is the safety bound. Wordlist policy (parent design §8): the bundled set is clean-license (NCSC-100k under OGL v3.0 with NOTICES attribution, `10k-most-common` MIT, `best64` MIT); big breach lists are *not* bundled (Rung 1 doesn't need them).

## 4. Backend-agnostic coordinator — `RecoveryBackend` port + `RecoveryJob` DO

The job is a **keyspace-split + first-hit-cancel** coordinator, built backend-agnostic now because Rung 3 (cloud GPU) is the imminent, identically-shaped second consumer (same split + cancel; only the backend differs).

- **`RecoveryJob` Durable Object** = state machine (`queued → running → found | exhausted | needs_gpu | cancelled`) + progress (candidates tried / total). It splits the keyspace into shards, dispatches each to the chosen `RecoveryBackend` via a **recovery Queue**, aggregates progress, and on the first hit **best-effort-cancels** the remaining shards.
- **`RecoveryBackend` port** = the adapter seam. Slice 2 ships **one adapter: the Cloudflare-CPU backend** (`apps/recovery-worker` Containers running the pure-Rust verify loop). Rung 3's rented-GPU adapter (next slice) plugs into the same coordinator with no rework; Rung 2's desktop adapter follows in the Tauri phase.
- **CF v1 uses the coordinator with modest real sharding** (a few containers) — same total cost as one box, faster wall-clock, and it proves the split/cancel machinery end-to-end so the GPU adapter inherits tested coordination.

**Deferred + mandated (ADR-EEEE):** the platform-generic cross-domain fan-out primitive (`@magna-carta/fan-out-jobs`, also for OCR-at-ingest-scale, Bates/redaction burn-in, batch conversion) is *not* built here — those carry a different termination rule (all-complete vs first-hit), so the generic shape only emerges with a second non-recovery consumer. The standing rule (recorded in `docs/conventions/`): the next non-recovery domain needing container fan-out **extracts the shared primitive from this coordinator**, rather than re-implementing.

## 5. `apps/recovery-worker` Container

Mirrors `apps/scan-worker`/`apps/convert-worker`: a native Rust binary depending on `decryption-core`, with the wordlists + rules (**NCSC-100k, 10k-common, best64**) baked into the image. It receives a `RecoveryJob` (the **hash string + params**, never the file) + a shard spec via the Queue, reconstructs `verify_guess` from the hash (`parse_hash`), runs `run_dictionary` (rayon) over its shard, and reports progress + any hit back to the DO. The document never reaches the container — only the extracted hash does (the confidentiality keystone).

## 6. Routes (permission `tools:decryption`, per-job attestation, audited)

- **`POST /api/v1/decryption/recover`** — body `{ fileBase64, attestation:{authorized:true} }`. Runs `extract_hash` (wasm), classifies the tier, creates the `RecoveryJob`, dispatches to the CF backend (CF-capable) or sets `needs_gpu`, returns `{ jobId, tier, status }`. Audit `decryption.recovery_started` (actor, fileSha256 of input, format, tier — never the file/password).
- **`GET /api/v1/decryption/recover/{jobId}`** — returns `{ status, progress, tier, result? }`. On `found`, `result.password` is surfaced to the authorized requester (their file, they attested).
- **`DELETE /api/v1/decryption/recover/{jobId}`** — cancel a running job (bounded control over spend).

Malformed base64 / extract failures → 400 (no content echo), mirroring the Slice-1 routes. New operations added to OpenAPI + api-client + conformance.

## 7. Data model & confidentiality

- **No file persistence.** `extract_hash` runs in the Worker; only the resulting **hash string** enters the job/Queue/Container. The uploaded bytes are discarded after extraction — the file never lands in R2 or reaches a Container. (Simpler and more confidential than the parent design's ephemeral-R2 sketch, which is unnecessary once extraction is at the edge.)
- **Per-firm D1** `RecoveryJob` rows (new migration): id, file content hash, format, tier, status, progress, attestation, started/finished, outcome. No file bytes, no hash-secret beyond what recovery needs, **never the recovered password**.
- **Recovered password** surfaced once via the status GET to the authorized requester; **not persisted** in v1 (envelope-encrypted opt-in storage is a seam); never in audit/logs (audit records `found`/`exhausted`/`needs_gpu` + counts only).

## 8. Audit & authorization

Every recovery passes the Slice-1 boundary: `tools:decryption` permission, per-job ownership attestation (recorded with the job), and redacted audit through the standard pipeline (`decryption.recovery_started` / `…_finished` with outcome/format/tier/candidatesTried — never the password, file bytes, or hash-secret).

## 9. Testing

- `decryption-core`: `run_dictionary` already tested; add a keyspace-shard-range helper + its test (a shard covers a wordlist range; the union of shards = the full keyspace; first-hit found in any shard).
- The DO coordinator: split → dispatch (mock backend) → aggregate → **first-hit-cancel** (a hit in shard k cancels the rest), and `needs_gpu` routing for slow-band jobs — exercised with N>1 shards (proving the coordinator the GPU rung will reuse).
- `apps/recovery-worker`: a shard run over the PDF/ZIP fixtures (known password in-list → found; absent → exhausted), reconstructing `verify_guess` from the hash.
- Routes (Miniflare): recover (CF-capable → job runs → found via status; slow-band → `needs_gpu`), permission 403, attestation 400, cancel, and audit redaction (no password/file in the audit rows).

## 10. Slices / non-goals

In scope: the router, the coverage-bounded CF pass, the backend-agnostic `RecoveryJob` DO + `RecoveryBackend` port (CF adapter, modestly sharded), `apps/recovery-worker`, the recover/status/cancel routes, the per-firm migration, OpenAPI/client/conformance.

Out of scope (later slices / deferred): the **GPU rungs** (Rung 3 cloud — next slice; Rung 2 desktop — Tauri phase), the **platform-generic fan-out primitive** (extract on the next non-recovery consumer), user-supplied wordlists, mask/brute-force, big-list runtime fetch, persisted (encrypted) recovered passwords, and the Tools-area **UI widget** (post-0.7).
