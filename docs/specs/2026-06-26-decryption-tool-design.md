# File Decryption & Recovery — design

**Status:** Accepted (design) · **Date:** 2026-06-26 · **Owner:** Trevor Goldsmith
**White-paper home:** _PDF services_ ("secure (password/permissions)") for the lock side; this tool is the **unlock** counterpart, an ethereal Tools-area utility.
**Builds on:** the Tools area (`docs/specs/2026-06-16-tools-area-design.md`, ADR-0101) · the Metadata Inspector & Scrubber (`docs/specs/2026-06-22-metadata-tool-design.md`) as the precedent ethereal file tool · the PDF engine (`crates/pdf-core`, which already depends on `lopdf` + the RustCrypto primitives this core reuses) · the integrations ports-and-adapters shape.
**ADRs (new, to record):**

- **ADR-AAAA** — Decryption-tool architecture: the in-house `FormatAdapter` core (strip-with-key + extract-hash + verify-guess), the `RecoveryBackend` port with a four-rung escalation ladder, and the authorization + audit boundary.
- **ADR-BBBB** — Cracking-engine doctrine: hashcat (MIT) as the GPU engine via out-of-process subprocess; our own pure-Rust verify loop for the Cloudflare CPU rung; John the Ripper never linked (GPL).
- **ADR-CCCC** — Wordlist & rules policy: bundle only clean-license + defensible-provenance assets (NCSC 100k under OGL v3.0; hashcat `best64`); fetch breach-derived lists at runtime; never ship raw breach dumps.

A law firm routinely meets locked files it is **authorized** to open but cannot: a client archive whose
password was lost, an old protected `.docx`, a password-protected production received in discovery, an
encrypted ZIP whose key arrived separately and vanished. This design adds an ethereal Tools-area utility —
**File Decryption & Recovery** — that **unlocks a file when you have the password** and **recovers an unknown
password when you do not**, across the common encrypted-container formats. It is built core-first so the same
engine can later back a matter-action ("unlock this document in the matter", "decrypt on ingest"), per the
Tools-area principle: _do matter-grade work without committing it to a matter._

It is the **unlock** counterpart to the PDF engine's planned **lock** capability (_PDF services_, "secure
(password/permissions)"). The two are deliberately separate streams: locking is a single-format PDF write
operation; unlocking is a multi-format, compute-heavy recovery subsystem with its own authorization posture.

---

## 0. Two operations, one core

Every supported format reduces to the same two pure operations, and that is the whole reason this does not
fragment into N disconnected tools:

1. **Strip-with-key** — given the password, parse the format's encryption container and emit the decrypted
   file. The "I have the key, just unlock it" path. Instant.
2. **Extract + verify** — when the password is unknown: pull the format's key-derivation salt and verifier
   into a normalized **`RecoveryJob`** (a small hash string), and verify one candidate password against it.
   The document itself never leaves the core; only the extracted hash travels to a cracking backend.

No single library performs either operation across all formats — encryption containers are irreducibly
format-specific (PDF stores it in an `/Encrypt` dictionary, ZIP in per-entry crypto headers, OOXML inside an
OLE2/CFB compound file, 7-Zip in the archive stream header). The only "one tool for everything" options are
the ones the platform already rejects or defers: a heavyweight C/JVM bundle (the Stirling-PDF shape rejected
in _PDF services_) or a commercial forensic engine (Passware/Elcomsoft — captured here as the Rung 4 seam,
§3). What unifies the work instead is **one shared crypto-primitive suite** (RustCrypto: AES, SHA, PBKDF2,
RC4, MD5 — the same primitives derive keys and verify guesses for every format) behind **one adapter trait**.
The per-format code is only the thin "find and parse this container's encryption header" layer.

## 1. Module placement

Mirroring the `crates/pdf-core` + `packages/pdf` split and the existing tool packages:

- **`crates/decryption-core`** — new **pure Rust** crate (compiles to native and `wasm32`). No network, no
  platform bindings — fully unit-testable. Indicative layout:
  - `src/adapter.rs` — the `FormatAdapter` trait + `RecoveryJob` / `DecryptedFile` / error types (§2).
  - `src/detect.rs` — real-format detection (magic bytes, not extension) → adapter selection.
  - `src/pdf.rs` — PDF adapter (built on `lopdf`, already a workspace dependency).
  - `src/zip.rs` — ZIP adapter (ZipCrypto + WinZip-AES).
  - `src/ooxml.rs` — OOXML adapter (OLE2/CFB + MS-OFFCRYPTO agile/standard).
  - `src/sevenz.rs` — 7-Zip adapter (slice deferred; seam present).
  - `src/dictionary.rs` — the in-house CPU recovery loop (the Rung 1 engine): run `verify_guess` over a
    wordlist amplified by rules, parallelized with `rayon`.
  - `src/wasm.rs` — `wasm-bindgen` edge (strip-with-key + extract-hash for the client/light path).
- **`packages/decryption`** (`@magna-carta/decryption`) — WASM build + thin TypeScript wrapper, mirroring
  `packages/pdf`. What the Worker and (later) the Tools UI call.
- **`apps/recovery-worker`** — new Cloudflare **Container** running the Rung 1 dictionary engine at sustained
  CPU (slice 2), per the standing rule _"Container subsystems extract to dedicated workers."_ Mirrors
  `apps/scan-worker`.
- **`@magna-carta/tools`** — one new catalog row (§10); no logic.
- **`@magna-carta/access-control`** — one new `tools:decryption` permission.

## 2. The core API — `FormatAdapter`

One trait, implemented per format, behind format detection:

```
trait FormatAdapter {
    // ① "I have the key": decrypt and return the plaintext file.
    fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError>;

    // ② "I do not have the key": normalize the container's KDF salt + verifier into a crackable job.
    fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError>;

    // ② verify a single candidate against an extracted job (the in-house cracking primitive).
    fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool;
}
```

`RecoveryJob` carries the format, the cracker hash-string (e.g. `$pdf$…`, `$zip2$…`, `$office$…`, `$7z$…`),
the matching **hashcat mode number** (so a GPU rung can run it directly), and the parsed KDF parameters (so
the in-house `verify_guess` can run it without hashcat). `verify_guess` is the bridge: the Rung 1 CPU engine
**is** a loop over `verify_guess`, and the GPU rungs hand the same hash to hashcat.

**Formats — v1:** **PDF** (RC4 R2–R4, AES-128 R4, AES-256 R6), **ZIP** (legacy ZipCrypto + WinZip-AES-256),
**OOXML** (`.docx`/`.xlsx`/`.pptx` agile encryption; standard/legacy as it falls out cheaply). **7-Zip** is
the first follow-on slice; **legacy Office (.doc/.xls) and RAR** are deferred (hard container parsing → shell
out or the Rung 4 forensic seam). Detection is by magic bytes, with the OOXML adapter recognizing the OLE2
compound-file wrapper that distinguishes an _encrypted_ office file from a plain zip.

## 3. The escalation ladder — `RecoveryBackend` port

When the password is unknown, the `RecoveryJob` flows to a `RecoveryBackend`. The port has one shape; the
adapter (the "rung") is chosen by caller/policy and hardware availability. Every rung consumes the same job
and reports progress to the same job orchestrator (§4); adding a rung is one adapter, no core change.

| Rung                  | Where                                             | Engine                                                                                  | Role                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · Light**         | Cloudflare **Container** (`apps/recovery-worker`) | our pure-Rust `verify_guess` loop (`rayon` + SHA-NI), wordlist sharded over a **Queue** | Always available, web floor. Clears fast-format and weak/known-shape passwords. CPU-only (Cloudflare has no GPU for our code).                                                                                                               |
| **2 · Local**         | **Desktop** (Tauri sidecar)                       | bundled **hashcat** subprocess on the firm's own GPU                                    | Optional local acceleration, $0 marginal, strongest confidentiality (file + hash both stay on the device). Web falls back to Rung 1 (delivery-model parity). Lands with the Tauri phase.                                                     |
| **3 · Cloud**         | rented on-demand GPU (RunPod / Vast.ai)           | **hashcat**                                                                             | "Go hard" on a strong KDF. Send **only the extracted hash**, never the document. ~$0.30–0.70/hr, live in 1–5 min; an 8-hour job ≈ $3.                                                                                                        |
| **4 · Vendor (seam)** | external forensic engine (Passware / Elcomsoft)   | vendor SDK/API                                                                          | Coverage our engine cannot reach (full-volume encryption, device backups, exotic formats). Ingests the whole file → least private → deliberate last resort. **Zero-cost documented extension point; never built or bought by the platform.** |

**Why these tiers (evidence, summarized from the dependency research, 2026):** Cloudflare Containers cap at
4 vCPU and expose **no GPU** to our code (Workers AI runs only its model catalog), so a modern KDF (Office
2013+, 7-Zip, PDF R6 ≈ 10²–10³ guesses/s there) is a multi-week brute-force — Rung 1 is honestly only good
for fast formats and weak passwords, and its real strength is being the always-on floor. A single RTX-class
GPU does the same modern-KDF dictionary+rules run in ~13 hours (one desktop) or ~1.5–2 hours (a rented
8-GPU rig). **The confidentiality keystone:** because hashcat needs only the extracted hash, Rung 3 can rent
a stranger's GPU while the privileged document never leaves our perimeter.

**Forward-looking seam (not v1 scope):** Rung 3's machinery — provision an on-demand GPU, send a minimal
payload, orchestrate the long job, tear down — is the same pattern any future _arbitrary-GPU_ workload would
need (most notably a **self-hosted private LLM** if a firm's confidentiality posture ever forbids Cloudflare
Workers AI or an external inference API). The app's other GPU-amenable work (transcription, embeddings,
inference) rides Cloudflare's **managed** GPU and needs no rented box. Build the Rung 3 adapter behind a port
general enough to be that seam later, without over-building it now.

**GPU vendor selection (from the 2026 vendor assessment).** The two workloads have opposite trust profiles
and select different vendors:

- **Cracking tier (Rung 3, build now — only the extracted hash egresses).** Build the adapter against a port
  with two interchangeable backends: **Vast.ai** (primary — cheapest 4090s, mature CLI/REST/SDK, per-second
  billing, the de-facto hashcat platform) and **RunPod** (fallback — per-ms billing, automatic
  balance-based teardown, a first-party Secure Cloud tier). **Avoid** Modal (its cryptominer auto-detection
  will false-flag a GPU-saturating hashcat job), Fly.io (GPUs end-of-life mid-2026), and Salad
  (consumer-PC substrate) for cracking.
- **Confidential tier (the future private-LLM seam — privileged content on the GPU).** Lead candidate
  **Azure** (NCCads H100 v5 — confidential GPU on a true on-demand SKU, data encrypted in-use on the H100,
  HIPAA BAA, EU Data Boundary); runner-up GCP (confidential H100 still Preview on-demand); AWS has no GPU
  confidential-computing option today. **Never** run privileged inference on any marketplace tier (Vast,
  Salad, RunPod Community), on Modal (its BAA excludes user code/volumes/memory), or on Together.ai (its ToS
  bans transmitting sensitive personal data).
- **Cross-cutting:** no vendor's AUP affirmatively permits password recovery — the viable ones simply do not
  prohibit it, so secure written vendor sign-off and retain documented client authorization before running
  real hashes. Treat every SOC 2 / ISO / HIPAA claim as unverified until the report is reviewed under NDA at
  contract time.

## 4. Orchestration & job model

A recovery is a long-running job, so it uses the conversion/timekeeping precedent:

- **Durable Object per job** = the state machine + scheduler: `queued → running → (progress %) → found |
  exhausted | cancelled`. It holds job state in its SQLite, advances via alarms, and **dispatches** work — it
  never cracks (a Durable Object caps at 5 minutes CPU per invocation).
- **Queue** shards the wordlist keyspace across **`recovery-worker` Container** instances (Cloudflare's lever
  is horizontal fan-out, not a bigger box). Each shard runs the `verify_guess` loop and reports candidates
  tried + any hit back to the job.
- For the GPU rungs the job parses **hashcat's machine-readable `--status-json`** for progress and the potfile
  for the result.
- **Strip-with-key needs none of this** — it is an instant in-band call (WASM on the client, or a single
  Worker call), no job.

## 5. Data model & confidentiality

Per golden rule 3 (bulk content to R2, never D1):

- The uploaded locked file goes to **firm-scoped R2**, **ephemeral** — deleted on job completion plus a short
  retention window (long enough to produce the decrypted output, no longer).
- **Per-firm D1** carries the job rows (new per-firm migration): id, R2 reference + **file content hash**,
  detected format, status, rung, progress, the ownership-attestation record, and audit fields. No file bytes
  in D1.
- **Recovered-password handling.** On success the tool **produces the decrypted file** (to R2 / download) and
  **surfaces the password once**. It is **persisted only if the user opts in**, and then **envelope-encrypted**
  as a sensitive secret (the platform encryption model — _Encryption and key management_), never beside the
  job row in cleartext. Default: do not persist — just decrypt. **The password is never written to the audit
  log.**

## 6. Authorization & audit boundary

Every recovery job passes a single boundary (the firm's redact-by-default + role-gated posture, applied to a
sensitive capability):

- **Permission `tools:decryption`**, seeded to **Owner/Admin** by default, grantable to other roles via the
  standard direct-grant path.
- **Per-job ownership attestation** — the user affirms authority to access the file ("I am authorized to
  access this file"), recorded with the job. Cheap to capture, and exactly the defensible artifact a firm
  wants if "how did you open this file" is ever asked.
- **Redacted audit record** through the standard pipeline (golden rule 4): who · file content hash · format ·
  rung · outcome · attestation. **Never** the recovered password or file contents.

Strip-with-key passes the same boundary as recovery — possessing the password is not, by itself, proof of
authority to the firm's record.

## 7. Dependencies — verified pure-Rust stack

All chosen crates are **pure Rust, MIT/Apache, and build on `wasm32`** — satisfying golden rule 14 (no new C
dependency) and golden rule 1 (reuse: `lopdf` and the RustCrypto primitives are already pulled in by
`crates/pdf-core`). Versions verified 2026-06-26; confirm exact patch versions with `cargo add` before
pinning.

**Crypto primitives (RustCrypto):** `pbkdf2 · hmac · sha1 · sha2 · md-5 · aes · cbc · ctr · cfb-mode · rc4`
(`rc4` is legacy-decrypt-only). **Generation note:** RustCrypto shipped a new generation (`digest 0.11` /
`cipher 0.5`) in early 2026, but `zip` and `lopdf` still ride the prior generation (`digest 0.10` / `cipher
0.4`); we pin to the **0.10/0.4 generation** to keep a single trait stack and migrate when they do. Only the
AES core is formally audited (NCC Group, 2020); the mode/hash crates are not — acceptable for a
_decryption_ library (we are not protecting secrets with them), recorded as a known gap.

| Format                  | Strip-with-key                                                                | Extract-hash                                                                                                                                               | Crate(s) · license                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **PDF**                 | `lopdf` `EncryptionState::decode(password)` (R2–R6) — already a workspace dep | read the `/Encrypt` dict + trailer `/ID`; model on the `pdf2john` crate; R6 per ISO 32000-2 Algorithm 2.A/2.B (hardened SHA-256/384/512 loop)              | `lopdf` (MIT); `pdf` (pdf-rs) kept as a verification oracle                                          |
| **ZIP**                 | `zip` (decrypts ZipCrypto + WinZip-AES)                                       | crate does not expose the verifier → parse the ~12-byte crypto headers ourselves (ZipCrypto CRC byte; WinZip PBKDF2-HMAC-SHA1×1000 salt + 2-byte verifier) | `zip` 8.x (MIT)                                                                                      |
| **OOXML**               | `cfb` (OLE2 reader) + `office-crypto` (agile/standard/legacy-RC4)             | `office2john`-format extractor over `cfb` + RustCrypto (SHA-512 ×100k iterative hash, block-key derivation, AES-256-CBC verifier)                          | `cfb` (MIT), `office-crypto` (MIT) — adopt or fork; ~200–400 LOC to own if its SHA-1-agile gap bites |
| **7-Zip** _(follow-on)_ | `sevenz-rust2` (`aes256` feature)                                             | own header parser (StreamsInfo → 7zAES coder), model on `7z2hashcat` (public domain); SHA-256 ×2¹⁹ KDF                                                     | `sevenz-rust2` 0.20 (Apache-2.0)                                                                     |

**Cracking engine (GPU rungs):** **hashcat** (MIT) — confirmed best-in-class in 2026 with no challenger;
invoked as an out-of-process subprocess (bundleable on desktop, run on rented boxes for cloud). **John the
Ripper** stays out-of-process-only and is never linked (GPLv2). **Light rung (CPU):** an in-house Rust
`verify_guess` loop, with the two cheap wins that matter — **`rayon`** core-parallelism and **SHA-NI hardware
acceleration** (`sha2` asm feature) — optionally fed by **`cracken`** (MIT) as a candidate generator.
WebGPU/browser-GPU cracking was evaluated and rejected as not worthwhile.

## 8. Wordlists & rules policy

Recovery recipe = **wordlist × rules**. The policy ships only clean-license, defensible-provenance assets and
fetches the rest at runtime, because bundling a breach dump inside a legal-practice product is a reputational
liability even when the license permits it.

- **Bundle (shipped in the artifact):**
  - **NCSC Top 100,000 passwords** — the default wordlist. UK National Cyber Security Centre, published as
    security guidance, **Open Government Licence v3.0** (commercial reuse, attribution-only). 836 KB,
    high ROI. Add an attribution line to the NOTICES file.
  - **`10k-most-common`** (SecLists, MIT) — fast first-pass wordlist.
  - **`best64`** (hashcat, MIT) and **OneRuleToRuleThemStill** rules. (`best64` is cleanly MIT; the OneRule
    family is mixed-license — custom rules MIT, borrowed rules retain origin licenses → legal-review item,
    with "fetch at runtime instead of bundle" as the fallback if it does not clear.)
- **Fetch at runtime / firm-supplied (never shipped):** `xato-net-10-million-passwords-1000000` (and the
  full list) — MIT via SecLists, the higher-coverage workhorse; optional Weakpass tiers.
- **Never bundle:** rockyou (unlicensed leak, optics), `Pwdb_*` / `darkweb2017_*` (MIT-licensed but
  indefensible filenames/provenance), `probable-v2_*` (actually **CC-BY-SA-4.0** — copyleft, mislabeled
  under SecLists' blanket MIT).
- **Documented caveat:** even the cleanest effective list is statistically breach-derived; choosing a
  government-published, OGL-licensed list makes that fact defensible rather than damaging. Lists carry no
  usernames/emails — passwords only — and are used solely to recover data the user is authorized to access.

## 9. Security & threat model

- **Confidentiality keystone (restated):** strip-with-key and extract-hash run **client-side (WASM) or in our
  own perimeter**; only the extracted **hash** ever crosses to an external (rented) GPU, never the document.
  Rung 4 (vendor, ingests the whole file) is the sole exception and a deliberate, last-resort opt-in.
- **Abuse boundary:** this is a recovery tool for _authorized_ access, not a general attack service. The
  permission gate + per-job attestation + redacted audit are the controls; the tool operates only on
  user-supplied files, performs no network attack, and surfaces no third-party-system access.
- **No password egress to logs.** Recovered passwords are surfaced once, optionally stored envelope-encrypted,
  and excluded from all audit/telemetry by construction.
- **Ephemeral handling.** Uploaded files and extracted hashes are deleted after the job plus a short window.

## 10. Catalog row & permission

One new row in `packages/tools/src/catalog.ts`, subject group **`documents`** (alongside Metadata, File
Hash, File Converter — file analysis, not a separate security group):

```
{ id: "file-decryption", name: "File Decryption & Recovery", icon: "lock-open",
  subjectGroup: "documents", permission: assertPermission("tools:decryption"),
  contextTags: ["file"], backing: { kind: "library" }, matterContext: "none" }
```

`matterContext: "none"` now; the matter-action second consumer ("unlock this document in the matter",
"decrypt on ingest") is a designed-in seam, wired later. `tools:decryption` seeded to Owner/Admin via a
per-firm migration.

## 11. Slice plan

Each slice is a working vertical slice, perf-tested against the load-profile fixtures as built.

- **Slice 1 — core + strip-with-key + machinery.** `crates/decryption-core` with the `FormatAdapter` trait
  and PDF/ZIP/OOXML adapters; `strip_with_key` + `extract_hash` + `verify_guess`; `@magna-carta/decryption`
  WASM wrapper; `tools:decryption` permission + per-job attestation + audit; catalog row; `/api/v1/decryption/*`
  routes; per-firm migration. Ships **every "I have the password, unlock it" case** end-to-end, plus the
  extract/verify primitive — no cracking backend yet.
- **Slice 2 — Rung 1 (light recovery).** The Durable Object job, the Queue keyspace sharding, and the
  `apps/recovery-worker` Container running the `rayon` + SHA-NI dictionary engine with the bundled
  wordlists/rules. Cloudflare-native, no external dependency.
- **Slice 3 — Rung 3 (cloud GPU "go hard").** The `RecoveryBackend` cloud adapter: on-demand GPU
  provisioning, hash-only egress, hashcat invocation + status parsing, teardown, cost accounting.
- **Later slices:** Rung 2 (desktop hashcat sidecar, with the Tauri phase); the 7-Zip adapter; Rung 4 remains
  a documented zero-cost seam.

## 12. Deferred seams & non-goals

- **Lock/secure (PDF password & permissions)** — the _other_ side of the coin, owned by the PDF engine
  (_PDF services_, the `pdf-engine-forms` stream), not this tool.
- **7-Zip, legacy Office (.doc/.xls), RAR** — deferred adapters (7-Zip first; the OLE2/RAR pair are hard →
  shell out or Rung 4).
- **Rung 2 (desktop), Rung 4 (vendor)** — seams now, built/bought later (Rung 4 possibly never, by the firm).
- **The generalized GPU-burst port** (a future self-hosted private LLM reusing Rung 3's pattern) — noted as a
  forward-looking seam, not built here.
- **Matter-action consumer** ("unlock in the matter" / "decrypt on ingest") — designed-in seam, wired later.

## 13. ADRs to raise

ADR-AAAA (architecture), ADR-BBBB (cracking-engine doctrine), ADR-CCCC (wordlist & rules policy) — recorded
as fragments under `docs/decisions/pending/` in the build commits (golden rule 8 + the fragment convention).

## 14. Open questions / flags to resolve at build

- Confirm exact crate patch versions and the `office-crypto` / `cfb` SPDX strings with `cargo add` / a
  license scan before vendoring; decide adopt-vs-fork for `office-crypto` (SHA-1-agile coverage).
- Validate the reproduced PDF R6 Algorithm 2.B and the OOXML agile key-derivation against the specs with test
  vectors.
- Legal review: OGL v3.0 attribution wording in NOTICES; the OneRule mixed-license bundle decision (bundle vs
  fetch).
- Right-size `recovery-worker` Container instances and the Queue shard count against the load-profile harness.
- Cost-accounting + spend-cap design for Rung 3 (a rented-GPU job spends real money) — surface an estimate and
  a ceiling before "go hard" starts, and enforce it with **our own hard billing killswitch** (auto-tear-down
  the box), because provider budgets (GCP/Azure) are advisory, not hard caps.
