# File Repair & Salvage — design (SP2)

**Status:** Accepted (design) · **Date:** 2026-06-28 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ ("pure utilities are libraries"); _Performance & concurrency model_ (sandbox-hardened Container processing)
**ADRs:** **new ADR (pending fragment `file-repair-salvage` — a file-corruption recovery tool: diagnose broadly, repair narrowly; stateless with an opt-in matter-attach; on the engine-host harness)** · builds on the engine-host harness (`docs/specs/2026-06-28-engine-host-framework-design.md`), ADR-0101 (Tools layer), ADR-0143 (File Hash & Integrity — the `file` tag + receipt/audit precedent), the metadata tool (stateless tool precedent), ADR-0039 (heavy work in Containers/Queues/DO).
**Research:** `docs/research/file-corruption-recovery.md`.

A new Tools-area utility that recovers content from **structurally corrupted, truncated, or damaged files** —
broken archives, malformed PDFs, truncated images, mangled email attachments. The existing file-tool family
can _diagnose_ that a file is wrong (Type Verifier, Hash, Scan) but none can _rescue_ it. This tool closes
that gap, and is the **first real consumer of the engine-host harness** (SP1).

It is built **comprehensively** — diagnose broadly, repair across the realistic high-value format set in one
cohesive tool, not a thin first slice. The format pillars below sequence the _implementation_; the
_deliverable_ is the whole tool.

---

## 1. The tool & information architecture

A new catalog entry, one user flow: **diagnose → (offer) repair → receipt**.

- **Subject group: a new `files` group.** Recovery acts on _any_ file, not just documents. The current
  `documents` group is, by its own code comment, "file utilities" — so this design **renames that role to
  `files`** in `@magna-carta/tools` (`SUBJECT_GROUP_ORDER`) and migrates the file-operation tools
  (`metadata-scrubber`, `file-hash-integrity`, `file-type-verifier`, `file-converter`) into it, adding
  `file-repair`. The `documents` group key is retired (it had no document-specific members).
- **Manifest:** `{ id: "file-repair", name: "File Repair & Salvage", icon: "life-buoy" (Lucide —
  provisional; the icon is finalized when the UI lands), subjectGroup: "files", permission: tools:fileRepair,
  contextTags: ["file", "none"], backing: { kind: "library" }, matterContext: "optional" }`. **No UI is
  built in SP2** — the entry widget lands with the 0·7a design-system shell, like the rest of the file-tool
  family (§7).
- **Permission `tools:fileRepair`**, seeded to the default roles (per-firm seed migration), mirroring the
  other file-tools.
- **`matterContext: "optional"`** — the tool runs standalone (the Tools "ethereal principle"), and a matter
  can be attached (§5).

## 2. Architecture — one engine, two server lanes (on the harness)

A new pure-Rust crate **`crates/recovery-core`**, the engine-host harness's first real consumer. It compiles
to **two targets from one source**, both server-side (privacy is not the driver — files already live in R2):

- **WASM inside a Worker — the default lane.** The file is already in R2; the Worker (via the harness
  `wasm_edge` toolkit) runs the engine and returns the result. No cold start, no container bill. Most files
  fit. Synchronous.
- **Native inside a Container (`containers/recovery`) — the heavy lane.** Identical crate compiled native,
  served with the harness `host` toolkit (`ready_app`/`serve`/`with_panic_net`/`r2_client`). Entered only
  when the file exceeds the Worker memory/CPU budget (large files, deep carving over a big blob, large-PDF
  reconstruction), via a Queue + a per-job Durable Object (the async-bulk-download pattern). Most repairs
  never touch it.

Routing is a cheap pre-check (R2 object size + detected format + diagnosis complexity). `recovery-core` is
**I/O-free** (bytes in, result out) per the harness convention, so lane placement is a routing decision, not
a rewrite. Pure-Rust features only (no C dep on the WASM path).

The engine reuses the harness `format::detect` for the cheap first identification and composes the salvage
pillars (§4) on top.

## 3. The flow & data model

**Diagnose (read-only, broad).** Given bytes, produce a `DiagnosisReport`:
`{ detectedFormat, corruption: CorruptionKind[], recoverability: "intact" | "repairable" | "partial" |
"unrecoverable", repairSupported: boolean, detail }`. Diagnosis covers **any detected format** — it will
honestly report "truncated PDF — repair not yet supported" for formats whose _repair_ pillar is out of this
tool's scope, so the tool is useful immediately and never overclaims. `recoverability` is the gate the UI
uses to decide whether to offer repair.

**Repair (mutating, narrow).** Given bytes (+ options), produce a `RepairResult`:
`{ salvaged: bytes, lossManifest: LossManifest, receipt }`. The **`LossManifest`** is the evidentiary core:
exactly what was recovered (entries / parts / pages / objects) and what was lost or could not be verified —
**never overclaim**. A critical precedent from the research: `lopdf` silently drops unparseable objects, so
the PDF pillar must enumerate dropped objects, never emit a silently-"clean" file.

**Receipt.** A human-readable + structured artifact (mirroring the Hash tool's receipt builder): the input
identity (name, size, hashes), the diagnosis, the repair actions taken, and the loss manifest — the
defensible record of a derived artifact.

All three are pure functions of the input bytes in `recovery-core`; persistence/attach is the worker's
concern (§5).

## 4. Format coverage — the four pillars (and build order)

One engine; the pillars are composed. Build order sequences the work from highest-value/tractable to
hardest:

1. **Compression-stream salvage** (foundation, used by the others). `zune-inflate` partial decode — recover
   the decoded prefix up to the corruption point; underpins ZIP/PDF/PNG/OOXML. Companions
   `ruzstd`/`lzma-rs`/`bzip2` (pure-Rust) as needed.
2. **ZIP archetype family.** Signature-scan re-index: find `PK\x03\x04` local headers with `rc-zip` (reads
   damaged input ignoring the central directory), re-derive entries, re-emit a fresh central directory +
   EOCD with `zip` (lean `deflate-flate2` features). One engine covers **OOXML (docx/xlsx/pptx), ODF, EPUB,
   JAR, APK, XPS, KMZ**. **OOXML-specific OPC reconstruction**: rebuild `[Content_Types].xml`, repair the
   `_rels` graph, well-form the primary part XML so Office reopens the package (partial recovery is useful —
   salvage body text even if media is lost). EPUB/ODF `mimetype`-first-and-STORED handled in the re-emit.
3. **CFB / OLE2 family.** Reconstruct a damaged FAT / directory on top of the `cfb` crate's primitives;
   salvage streams by re-linking sector chains. Covers **legacy .doc/.xls/.ppt, Outlook .msg, MSI**.
4. **PDF xref rebuild** (the largest custom piece). Scan for `N M obj`, reconstruct the xref + trailer, walk
   the page tree, drop/replace dangling refs with null — building on `lopdf`'s object parser while bypassing
   its xref loader, with the dropped-object enumeration the loss manifest requires.
5. **Carving — the universal fallback.** Extract embedded known-type files from any blob via a header/footer
   signature table + a streaming scan (`aho-corasick`), validating candidates with `infer`/`file-format`
   signatures. **Magika-based ML validation is container-only** (Magika is ort/ONNX C++, a consented
   golden-rule-14 exception sealed in the scan container), so the Worker lane validates carved candidates by
   signature only; the container lane may additionally use Magika. No GPL code ships (PhotoRec/Scalpel are
   study-only; signatures are facts).

Image partial-decode (`zune-jpeg`/`zune-png` best-effort) rides in as a carving/validation helper. The hard
boundary (stated in the research): mid-stream bit-rot is unrecoverable without pre-existing redundancy — see
§7 (PAR2 deferred).

## 5. Output & evidentiary model

- **Stateless by default.** `diagnose` and `repair` write nothing (no D1, no R2) — like the Metadata
  scrubber. The repair response streams back `{ salvaged file, receipt }` for download. The original is never
  touched.
- **Opt-in attach to matter.** An explicit "Attach to matter" action commits the salvaged file into the
  firm's file system as a **new derived file version** (via `@magna-carta/file-manager`) plus a
  **`file.repaired` audit row** carrying the loss manifest and the receipt reference. This mirrors the Hash
  tool's verify-audit + receipt. **Never overwrites** the original or any prior version — the salvaged file
  is a clearly-marked derived artifact (chain of custody intact).
- **Never overclaim.** The receipt and the attach audit always carry the loss manifest; a partial recovery
  is labeled partial.

## 6. API & worker

Through the slice 0·5 route chokepoint, gated by `tools:fileRepair`:

- `POST /api/v1/file-repair/diagnose` — streamed body → `DiagnosisReport`.
- `POST /api/v1/file-repair/repair` — streamed body (+ options) → `{ salvaged file, receipt, lossManifest }`
  (Worker-WASM lane synchronous; large files routed to the container heavy lane → returns a job handle the
  per-job Durable Object resolves, like async bulk download).
- `POST /api/v1/file-repair/attach` — commits a previously-produced salvaged artifact to a matter (derived
  version + `file.repaired` audit). Requires a matter; idempotent on a client-generated key.

The container (`containers/recovery`) exposes the harness `/ready` + a `/repair` route returning raw facts;
the worker composes the user-facing verdict (raw-facts-in-container → verdict-in-app).

## 7. Seams left open

- **PAR2 "protect-ahead"** — laying down Reed-Solomon parity at ingest so future mid-stream damage is
  repairable (`rust-par2` verifies/repairs; creation we'd build). A genuinely separate capability
  (prevention, not recovery) — its own future slice, not here.
- **Deeper image recovery** (JPEG restart-marker resync, PNG IDAT/CRC chunk salvage) beyond best-effort
  decode — measured-trigger follow-on.
- **Text/XML/JSON repair** (`chardetng`/`encoding_rs`/`jsonrepair`) — a cheap follow-on pillar, not in the
  core build.
- **Tool entry UI** — the `id → component` map + the styled surface land with the 0·7a design-system shell,
  like the rest of the file-tool family.

## 8. Security & safety

Untrusted, possibly-malicious input. The harness provides the net: bounded body size (`MAX_BODY_BYTES`),
the panic net (`with_panic_net`) so a crafted file cannot crash the container, and the wasm-edge
content-safety rule (stable `&'static str` error codes, never file content in errors or logs — golden rule
4). Bounded memory on the recursion/scan paths (account real materialized bytes, not declared sizes — the
decompression-bomb discipline the scan engine already uses). Repaired output is a derived artifact, never an
execution.

## 9. Testing & fitness

- **`recovery-core` unit tests** per pillar over crafted-corruption fixtures (truncated zip, broken central
  directory, missing EOCD, OOXML with a stripped `[Content_Types].xml`, damaged CFB FAT, broken-xref PDF,
  carve-from-blob) — assert both the diagnosis and the loss manifest (recovered vs lost), not just "it
  produced bytes."
- **Round-trip / honesty tests:** a repaired OOXML reopens (validates the OPC skeleton); a partial recovery
  reports the loss; a genuinely-unrecoverable input is labeled `unrecoverable`, never silently "repaired."
- **Worker/route tests** (Miniflare) for the three routes + the attach audit row.
- **Fitness:** `recovery-core` depends on `engine-host` (the harness) and pure-Rust crates only — no C
  feature on the WASM path; the carving Magika path is container-only.

## 10. Decisions recorded & docs to update

New ADR (`docs/decisions/pending/file-repair-salvage.md`, numbered on assembly): the file-corruption
recovery tool — diagnose broadly, repair narrowly; one `recovery-core` engine on the engine-host harness,
Worker-WASM default + Container-native heavy lane; stateless with an opt-in matter-attach; the four-pillar
coverage with build order; PAR2 protect-ahead deferred. Plus the `documents → files` subject-group rename as
a recorded IA decision.

On build (golden rule 5, same commit): `ROADMAP.md` + `STATUS.md` rows; `changelog.d/` fragment; the ADR
fragment; user docs (`docs/user/`) when the UI surface ships (the file-tool-family precedent). The
load-profile accretion rule does not bind the stateless paths; the attach path adds one derived version +
one audit row per attach (no per-firm volume surface beyond existing file storage).
