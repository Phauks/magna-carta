---
slug: file-repair-single-container-lane
status: Accepted
area: Tools
date: 2026-07-03
summary: Run file repair on the native Container lane only — drop the WASM lane the engine-host seam offers by default — because users tolerate an upload-and-wait and a second runtime is pure cost; and rename the `documents` tool subject group to `files` (it was already the file-utilities bucket) rather than split it.
---

**File Repair runs on a single Container lane; the `documents` tool group is renamed to `files`.**

**Context:** the `engine-host` seam (`docs/conventions/engine-host-seam.md`) offers
every pure-Rust engine two compile targets from one crate — a WASM lane that runs
in the Worker isolate (the default, for small inputs) and a native Container lane
(the heavy lane). `recovery-core` compiled cleanly to both. But repair is not a
latency-sensitive inline operation the way rendering a page thumbnail is: a user
uploads a damaged file and waits a few seconds for a reconstruction. Supporting
the WASM lane would mean a `crate-type=cdylib` build, a `wasm.rs` marshalling
layer, a `getrandom/wasm_js` pin, a wrapper package, and a wrangler wasm module
rule in the app worker — a second runtime to build, test, and keep at parity —
to save an upload the user already accepts.

Separately, the tool catalog grouped the file utilities (Converter, Metadata,
Hash & Integrity, File Type Verifier, AI-Text Detection) under a subject group
literally named `documents`, which read as "documents the matter owns" rather
than "utilities that operate on a file's bytes." File Repair belongs in that same
bucket, so the group needed either a rename or a split.

**Decision:** (1) **Drop the WASM lane for repair entirely** — not defer it.
Repairs run only on the native Container (`containers/recovery`), reached from the
app worker through the `magna-carta-recovery` service binding. There is no lane
selector and no runtime-placement decision at the route; the only sizing control
is an input-size cap that rejects oversized uploads before dispatch. The
now-vestigial `wasm32` support is removed from `recovery-core` (the
`getrandom/wasm_js` pin and the wasm build gate step). This is scoped to
`recovery-core` only — `engine-host`'s `wasm_edge` toolkit and `pdf-core`'s
`wasm.rs` stay, because `pdf-core` genuinely runs as WASM in the SPA and the seam
still offers both lanes to engines that want them. (2) **Rename the `documents`
subject group to `files`** rather than split it — a compile-time, UI-only
grouping constant (`SUBJECT_GROUP_ORDER`), never stored in the database and never
an authorization input, so the rename is a source change with no migration. All
five existing file tools stay grouped; File Repair joins them.

**Considered and rejected:** keeping the WASM lane as a fast path for small files
(rejected — the parity/maintenance cost of a second runtime is not repaid by
saving an upload users already tolerate; a single lane is one course of action to
reason about, test, and secure). Splitting `documents` into two groups (rejected —
the group was already the file-utilities bucket; a split would fragment a
coherent set and force a heavier catalog change than a rename).

**Consequences:** `recovery-core` is native-only and simpler (no dual-target
constraint on new dependencies for this engine). The container is the sole trust
boundary for untrusted repair input, with no internet egress. `recovery` is the
first engine built to be hosted in a Container on the `engine-host` harness
(`engine_host::host`), establishing the reference container-on-harness pattern —
a thin `containers/<engine>` host, a repo-root `image_build_context` Dockerfile
that copies the shared `crates/*` path-dependencies, and a dedicated
`apps/<engine>-worker` reached by a service binding — captured in the engine-host
seam convention so later engines copy it instead of re-deriving it. The `files`
group name now reads honestly in the tool catalog.
