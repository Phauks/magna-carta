# File Decryption & Recovery — Slice 3 (Rung 3: cloud-GPU recovery via vast.ai) design

**Status:** design (brainstormed 2026-07-03) · **Owner:** Trevor Goldsmith

**Builds on:** the Rung-1 recovery slice — the backend-agnostic `RecoveryJobCoordinator` DO + `RecoveryBackend` port + tier router (`docs/specs/2026-06-26-decryption-slice-2-recovery-design.md`), the `decryption.recover*` routes, and `crates/decryption-core` (`extract_hash`, `recovery_tier`). This slice fills the `needsGpu` seam those left open.

## Decisions on the table (ADRs to record at build)

- **ADR-FFFF — Rung 3 is rented cloud GPU (vast.ai), hashcat as the engine.** The `gpuRequired` band runs a real GPU cracker on a rented marketplace instance. Engine is **hashcat** (industry standard; our hashes are already hashcat-mode) — a **golden-rule-14 C/C++ consent**, narrowed by the fact that hashcat runs **only on the rented instance from our image, never linked into our Cloudflare/Rust codebase** (weaker than the clamd exception, which runs in our own sandbox).
- **ADR-GGGG — Trust boundary on rented hardware.** Only the **bare extracted hash** (no file, no client/matter metadata) ever leaves for the rig; the recovered password returns over the same channel. A rented host sees a context-free hash and at most a context-free password (disconnected from any file, which never leaves) — a small, de-identified exposure, and recovery only succeeds on weak passwords anyway. Controls: activation disclosures (authority attested · no guarantee · rented GPU / no files sent), ephemeral instances, our image (no persistence / no phone-home), the vast.ai API key held **Worker-side only** (never on the rig), and the backend surfaces the exact payload sent ("show what's sent to the GPU"). No host-vetting bar or TEE required.
- **ADR-HHHH — Full Durable Object coordinator, not Workflows.** A `RecoveryGpuCoordinator` DO owns the rent → run → teardown lifecycle with an **alarm as the guaranteed-teardown backstop** (the hardened Rung-1 stuck-job pattern), holding live progress directly. Cloudflare Workflows' declarative saga rollback was evaluated and rejected **for this shape**: the compensation is a single resource (destroy one instance), so the DO+alarm already gives durable guaranteed teardown, and live-progress needs a stateful surface anyway — a Workflow would have added a second coordination primitive (Workflow + DO/KV) for one job. The Workflow surface is deferred to the firm-provisioning pilot (a genuine multi-resource saga). The `RecoveryBackend` port keeps a later migration cheap.
- **ADR-IIII — Tiered escalation within dual caps.** A job climbs a shallow→deep ladder (small clean wordlist × rules → larger public wordlist × rules → masks), stops on the first hit, and is bounded by **both** a `$` budget cap **and** a wall-clock cap (firm default + per-job override), whichever hits first. Rig selection adapts to the tier reached.

## 1. Why this slice exists

Rung 1 is the always-available common-password tier on Cloudflare CPU; anything with a slow KDF (PDF R6, OOXML agile SHA-512 ×100k, 7-Zip) is parked in a terminal `needsGpu` state. This slice makes `needsGpu` a real path: a rented GPU actually cracks the hash. The honest frame from the numbers below — a single mid-tier GPU clears our baseline dictionary+rules pass in **seconds to ~2 minutes even on the slowest band** — so Rung 3 is not about giant rigs; it is about turning weeks-of-CPU into minutes-of-GPU, and escalating *depth* (bigger wordlists, rules, masks) only as far as a cap allows.

### Grounding data (measured, not assumed)

Hashcat on a single **RTX 4090** (Chick3nman reference bench), against a ~7.7M-candidate baseline (NCSC-100k × best64):

| Mode | Format | Speed | Baseline pass |
| --- | --- | --- | --- |
| 9600 | Office 2013 (SHA-512 ×100k) | 68 kH/s | ~112 s |
| 10700 | PDF R6 | 427 kH/s | ~18 s |
| 11600 | 7-Zip (SHA-256 ×2¹⁹ + AES) | 2.7 MH/s | ~3 s |

Implications that drive the design: (a) for the baseline pass the **crack is trivial and vast.ai boot/image-pull (1–5 min) dominates** → shallow tiers optimize for *cheap + fast-boot + available*, not $/hash; (b) beefy/multi-GPU rigs only earn their cost at **depth** (e.g. rockyou ~14M × rules ≈ 1B candidates → ~4.5 h on one 4090 for Office, ~1 h on 4×) — the throughput-bound regime; (c) **VRAM barely matters** for dictionary+rules on iterated-SHA KDFs (small wordlist, compute-hard), the modest exception being 7-Zip's per-hash decrypt memory; (d) vast.ai's headline **`dlperf` is a deep-learning training score and does not predict hashcat** — offer selection must use concrete fields and measured throughput, not `dlperf`.

## 2. Architecture

Rung 3 is a new `RecoveryBackend` behind the unchanged coordinator port, realized as:

- **`RecoveryGpuCoordinator` (Durable Object)** — sibling to the Rung-1 `RecoveryJobCoordinator`, one instance per GPU job (keyed `firmId:jobId`). Owns the lifecycle state machine, the rented `instance_id`, the escalation tier pointer, accumulated spend, and live progress. Its **alarm** is the teardown backstop.
- **The vast.ai client (`@magna-carta/…` or worker module)** — a thin typed wrapper over vast.ai's REST API: `searchOffers(filter)`, `createInstance(offerId, image, params)`, `getInstance(id)`, `destroyInstance(id)`. Key held Worker-side only.
- **The GPU recovery container image** — our own image: hashcat + baked clean-license wordlists/rules + a small control server. Mirrors the Rung-1 `containers/recovery` contract: receive a tier job (hash, mode, wordlist/rule id, mask spec), run it, **stream progress**, POST the outcome. Ephemeral; no credentials on the rig beyond what a single tier needs.
- **Offer selection** — a pure function from (tier, profile table) → a vast.ai offer filter: pre-filter on `gpu_name`, `num_gpus`, `gpu_ram` (floor, mainly for 7-Zip), `inet_down` (boot latency), `dph_total`, `reliability`, `verified`/`datacenter`; rank by **measured** hashcat throughput ÷ $/hr from the rig profiles. Never `dlperf`.

### Lifecycle (in the DO)

`selectOffer` → `rent` (persist `instance_id` + teardown-deadline, set alarm) → `waitReady` (poll `getInstance`) → for each escalation tier while under caps: `dispatchTier` → collect outcome (found → stop; miss → next tier) → `teardown` (destroy, idempotent, clear alarm). Any stall/crash/cancel leaves the alarm armed; when it fires it force-destroys the tracked instance. Ordering hazard (rent succeeds, DO dies before persisting the id) is covered by **tagging every rented instance with the `jobId`** and a reconciliation sweep that destroys orphaned tagged instances, plus the **vast.ai hard max-runtime** as the ultimate billing backstop. Three independent teardown guarantees: active teardown, DO alarm, vast.ai max-runtime.

## 3. Tiered escalation + dual caps

The ladder (concrete tiers finalized from Stage-1 numbers):

1. **Shallow** — NCSC-100k × best64 (the Rung-1 set, now rules-amplified). Seconds–minutes; any cheap single GPU; provisioning-bound.
2. **Medium** — a larger *public/clean-license* wordlist (e.g. rockyou-class) × best64. Minutes–hour; single strong GPU.
3. **Deep** — the medium wordlist × a larger rule set, and/or a second wordlist. Hour+; throughput rig (multi-GPU earns cost here).
4. **Masks** (deepest, deferred within this slice's *build* but designed for) — targeted brute-force masks up to a length bound.

Escalation stops the instant a tier finds the password, or when **either** cap is hit. Caps: a `$` budget and a wall-clock bound, as a firm setting (`FirmSettingDefinition`, default e.g. `$5` / `2 h`) with an optional per-job override on the recover request. Spend is tracked as chosen-rig `$/hr` × elapsed and checked between tiers (and enforced by the time-cap alarm mid-tier). Depth reached is a function of cap × rig × mode — cheap for weak passwords, deep only when the cap allows.

## 4. Confidentiality & disclosure

The Rung-1 keystone holds and tightens: **only the bare hash egresses** — the backend constructs the vast.ai payload from the hash + mode + wordlist/rule id and nothing else, and a fitness/unit test asserts no file bytes, filename, firmId, matter reference, or client identifier can appear in any vast.ai-bound payload. The recovered password returns to the DO and is surfaced once to the initiating user (the Rung-1 `startedByUserId` binding + retention purge apply unchanged). The vast.ai API key is a Worker secret, never placed on the rig. The backend exposes `payloadPreview` (the exact bytes sent) for the "show what's sent to the GPU" surface. Activation copy (recorded, shown at use): the requester attests authority; success is not guaranteed; work runs on a rented GPU and no files are sent to it — only the extracted hash. Audit records tier/mode/outcome/spend/counts — never the password, hash-secret, or file.

## 5. Status, progress, cost

The status route (existing `GET /api/v1/decryption/recover/{jobId}`, extended shape) surfaces phase (`selecting`/`provisioning`/`running`/`found`/`exhausted`/`capped`/`cancelled`), current tier, accumulated spend, and — from the DO's live progress — hashcat telemetry (guesses/sec, % of keyspace, ETA, current tier). The instance streams telemetry to the DO (single source of truth; no separate KV/Workflow status to reconcile). Cost surfaced per job feeds a later cost-recovery/disbursements pass-through (a seam, not built here).

## 6. Staging — benchmark-first

- **Stage 1 (build first): the image + a benchmark harness.** Our hashcat container image, plus a path that runs our three modes (9600/10700/11600) on a rented rig and records throughput + `$/hr` → the **rig profiles** (a committed table of `gpu_name`/`num_gpus` → measured H/s per mode → $/hash and boot latency). This is where "identify what rigs to rent / create profiles" is answered empirically, before wiring the full flow. The vast.ai key is attached at this stage to run real rigs.
- **Stage 2: the wired rung.** The `RecoveryGpuCoordinator` DO + vast.ai client + offer selection + tiered escalation + dual caps, routed from the tier router's `gpuRequired` band through the `RecoveryBackend` port, with the recover/status routes extended. Profiles from Stage 1 parameterize offer selection.

## 7. Testing

- **Coordinator DO** — unit-tested with a fake vast.ai client (offers/rent/getInstance/destroy) + a fake instance: assert rent→dispatch→found→teardown; **teardown fires on injected failure/cancel via the alarm** (the money-safety invariant); orphan reconciliation destroys a tagged instance; cap enforcement stops escalation at the `$` and time bounds; the confidentiality invariant (only the hash in any vast.ai payload).
- **Offer selection** — pure-function tests over sample offer sets (picks by tier; never selects on `dlperf`; honors floors).
- **Container** — standalone against a known hashcat example hash per mode (found + not-found + malformed → no panic), and that it emits progress + never logs the password.
- **Routes** — Miniflare: recover routes a `gpuRequired` job to the GPU backend; status surfaces phase/tier/spend/progress; caps/cancel; audit redaction.

## 8. Scope

**In scope:** Stage 1 (image + benchmark harness + committed rig profiles) then Stage 2 (the `RecoveryGpuCoordinator` DO, vast.ai client, offer selection, tiered escalation shallow→deep, dual caps as a firm setting + per-job override, the GPU `RecoveryBackend` adapter wired through the tier router, extended recover/status routes, live progress in the DO, confidentiality invariant + activation disclosures, audit).

**Out of scope / deferred:** Rung 2 (desktop GPU — the Tauri phase); the masks tier's *implementation* (designed-for, built when the deep wordlist tiers are proven); breach-list content and its licensing (start with clean/public lists only); cost-recovery/disbursements pass-through of the rented spend (a named seam onto the existing disbursements system); the Tools-area UI incl. the "active display" of the live crack (post-0·7, a Fable matter — the backend exposes the telemetry it will animate); user-supplied wordlists.
