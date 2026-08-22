# Archive reader — entering a container from the File Manager, and extracting into a matter

**Status:** Proposed. **Nothing here is built, and this design does not start** — nine numbered owner flags (**AR1** through **AR9**) decide what it is. AR1 (the ceilings), AR2 (the inflate engine), AR3 (nested containers), AR4 (structure) and AR5 (encrypted entries) are load-bearing: each one changes code that is expensive to retrofit, and AR2 and AR5 are confidentiality postures the code has to be written against rather than adapted to.

**White paper:** _Matters and File Manager_. **Supersedes, in part:** **ADR-0027** (uploaded archives stored opaque, "no extraction code, hence no zip-bomb/password/nested-archive surface"). **Builds on:** ADR-0081 (the ingest chokepoint), ADR-0082 and ADR-0146 (the write direction), ADR-0167 (the extraction rubric, living form in [`../conventions/operations.md`](../conventions/operations.md) section 18), ADR-0003 (firm-scoped data access), ADR-0067 (the route chokepoint).

**Related code homes:** [`crates/discovery-core/src/archive.rs`](../../crates/discovery-core/src/archive.rs), [`apps/worker/src/discovery/archive-expansion.ts`](../../apps/worker/src/discovery/archive-expansion.ts), [`apps/worker/src/search/split-object-host.ts`](../../apps/worker/src/search/split-object-host.ts), [`packages/file-manager/src/ingest-core.ts`](../../packages/file-manager/src/ingest-core.ts), [`packages/file-manager/src/upload-policy.ts`](../../packages/file-manager/src/upload-policy.ts).

---

## 1. Verified current state — and the finding that does not hold

The brief for this design carried a prior finding: that the platform's zip machinery is **write-only**, `client-zip` streaming out through `zip-entries-from-r2.ts`, with no archive reader anywhere. **That finding is false at the platform level and true only of the File Manager.** It matters, because it is the difference between building a new capability and wiring an existing one to a new surface — and this is the second.

### 1.1 What actually reads archives today

Five readers, in three languages, all pure-Rust or pure-TypeScript, all already parsing hostile bytes in production code paths.

| Reader                                                                                                     | What it reads                                                                                             | Library                           | Verified how                                                                               |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| [`crates/discovery-core/src/archive.rs`](../../crates/discovery-core/src/archive.rs)                       | Full central-directory enumeration **and** guarded recursive expansion, under five named guards           | Rust `zip` 8.6 (`deflate-flate2`) | Read the file. 502 lines, `enumerate()` and `expand()`, with unit tests over hostile input |
| [`containers/scan/src/heuristics/mod.rs`](../../containers/scan/src/heuristics/mod.rs)                     | Central directory of every uploaded file (attempted unconditionally, not gated on offset-0 magic), nested | Rust `zip` 8.6                    | Read the file. Enforces depth, entry count, declared ratio and real materialized size      |
| [`crates/decryption-core/src/zip_adapter.rs`](../../crates/decryption-core/src/zip_adapter.rs)             | Central directory and local file header of an **encrypted** entry, to extract a recovery hash             | Rust `zip` 8.6                    | Read the file. Walks the directory for the first encrypted entry, then the local header    |
| [`packages/metadata/src/guards.ts`](../../packages/metadata/src/guards.ts)                                 | Whole-archive unzip with entry-count and inflated-size caps, plus an inflate-nothing `zipHasEntry` probe  | `fflate` 0.8.3                    | Read the file                                                                              |
| [`packages/document-assembly/src/ooxml/package.ts`](../../packages/document-assembly/src/ooxml/package.ts) | The one zip entry point in document assembly, over the same guards                                        | `fflate` 0.8.3                    | Read the file                                                                              |

`containers/file-repair` additionally repairs a damaged central directory, and `containers/bundle` and `containers/discovery` both **write** zips.

### 1.2 Discovery already unpacks containers, and it is the design this one inherits from

Yes — and not as a side effect. Discovery's container handling is a fully designed, shipped subsystem with its own doctrine, and this design is an extension of it rather than a new capability.

- The engine half is `crates/discovery-core/src/archive.rs`: `enumerate()` lists entries with nothing decompressed; `expand()` walks the container tree under **five guards checked before a decompressed byte is retained** — nesting depth, total expanded bytes, expansion ratio, entry count read from the central directory, and unconditional path-traversal rejection.
- The orchestration half is [`apps/worker/src/discovery/archive-expansion.ts`](../../apps/worker/src/discovery/archive-expansion.ts), which turns an expansion into a **container family**: the archive is the family head, each entry a `container-child` carrying its path inside, and **every entry re-enters the ordinary ingest gate** by exactly the path an email attachment takes — `initiateUpload` → `bucket.put` with the returned dimensions → `completeUploadSession` → the ingest event. Its own comment states the rule this design must not break: "There is no discovery bypass, and there is deliberately no second way to put bytes in a firm's bucket."
- The engine already exposes the read half on **two** runtimes. Native, over `POST /archive/enumerate` and `POST /archive/expand` on the `magna-carta-discovery` Worker's Container. And on the WebAssembly edge: `crates/discovery-core/src/wasm.rs` already exports `enumerateArchive` under `#[wasm_bindgen]`. It is not yet built into a WASM package — [`tooling/bootstrap/index.mjs`](../../tooling/bootstrap/index.mjs) builds `pdf-core`, `decryption-core` and `email-core` only — but the export exists and compiles.

So the correct framing for the owner: **the platform can already open a zip safely; the File Manager is the one place that deliberately cannot.** That deliberateness is ADR-0027, and this design is a request to narrow it.

### 1.3 What genuinely does not exist

Three things, and they are the actual build.

1. **A ranged central-directory read.** Every reader above takes the whole archive as a `&[u8]` or a `Uint8Array` — `ZipArchive::new(Cursor::new(bytes))`, `unzipSync(bytes)`. Nothing in the tree locates the end-of-central-directory record from a tail slice and reads the directory without the body. The one worked precedent for ranged R2 reads under a capability token, [`apps/worker/src/search/split-object-host.ts`](../../apps/worker/src/search/split-object-host.ts), is a byte-range pass-through for a caller that already knows the offsets; it is the right shape to copy and it does not itself parse anything.
2. **Any File Manager surface at all.** No route, no permission, no read model, no UI. `apps/worker/src/routes/files.ts` lists, gets, renames, moves, soft-deletes and downloads; nothing enters a file.
3. **A write path from a container back into a matter.** Discovery's writes land in a **review set** corpus, not in the matter's folder tree, and carry review-document rows rather than File Manager provenance.

### 1.4 Two pieces of drift found on the way

- `roadmap.d/documents.md`, node `documents.upload.archive-opacity`, carries `evidence: No server-side extraction code in the tree`. That has been untrue since discovery slice 5·1·3 landed `crates/discovery-core/src/archive.rs`. The node's _scope_ is still right for the File Manager; its evidence line is not. Correcting it belongs with whoever next touches the ledger, not with this branch.
- Three sets of archive limits exist and two of them agree by coincidence rather than by wiring. `fileManager.archiveCaps` is a **declared per-firm setting that nothing reads** — `grep` finds it defined in `packages/file-manager/src/upload-policy.ts` and referenced only by its own test. `containers/scan` hard-codes `ArchiveCaps::default()` with the identical numbers and is never handed the firm's. `crates/discovery-core` deliberately differs. Section 6 proposes that this design be the thing that wires the setting.

| Home                                                 | Depth | Entries | Total uncompressed | Ratio |
| ---------------------------------------------------- | ----- | ------- | ------------------ | ----- |
| `fileManager.archiveCaps` (per-firm setting, unread) | 16    | 10,000  | 4 GiB              | 100   |
| `containers/scan` `ArchiveCaps::default()`           | 16    | 10,000  | 4 GiB              | 100   |
| `crates/discovery-core` `Limits::default()`          | 3     | 100,000 | 8 GiB              | 200   |
| `packages/metadata` guards                           | n/a   | 2,048   | 32 MiB             | n/a   |

### 1.5 A vocabulary problem to settle before anything is named

**ADR-0146 rules that "archive" means retired or retention items in this product**, which is why the write direction is called _bundling_. A feature called "the archive reader" therefore collides with the product's own glossary on the day it ships. The platform already has a word for the thing: discovery calls it a **container** — `container family`, `container-child`, and the scan prefilter's `container families`. This design uses **container** for the object and **entering a container** for the act, and reserves "archive" for the format-level discussion where it is unavoidable. Confirming that is **AR9**.

---

## 2. The shape, in one paragraph

One engine core, extracted from where it already lives, gains a ranged directory reader and is compiled to two targets. **Browsing** is a synchronous read: three or four ranged R2 GETs against an immutable version, parsed in the app Worker, persisted once as an entry listing because the version can never change. **Extraction** is a job on the existing coordinator-plus-queue pattern: the member selects entries **by the server's own entry ids**, never by path, and each selected entry is fetched as a byte range, inflated under a mid-stream ceiling, and handed to `initiateUpload` — the same four-step ceremony discovery and email attachment capture already use. Nothing new writes to R2. Nothing skips the gate. No new deployable.

---

## 3. The engine

### 3.1 Extract `crates/archive-core` rather than grow a sixth reader

Golden rule 1 says reuse before building, and there is something to reuse: `crates/discovery-core/src/archive.rs` plus the archive fields of `limits.rs` are already the guarded reader this design needs, hardened against hostile input and tested against it.

They should not simply be _called from_ discovery-core, for two reasons.

- **Dependency weight.** `discovery-core` depends on `pdf-core`, `email-core`, `lopdf`, `cfb`, `quick-xml`, `encoding_rs`, `chardetng` and `unicode-normalization`. Compiling that closure to WebAssembly to read a central directory would put an OLE2 parser, a PDF object model and a charset detector into the app Worker's bundle for no reason, against a 10 MiB compressed script ceiling the Worker already shares with `decryption-core`.
- **Doctrine.** The module's own header states that expansion "exists only here" and is a discovery exception. Making it a platform capability without moving it leaves a comment that is false and a rule nobody can find.

**Proposal:** a new `crates/archive-core`, depending on `magna-carta-engine-host`, `zip` and `flate2` and nothing else. `discovery-core` depends on it and re-exports `enumerate`, `expand`, `ArchiveEntry`, `SkipReason` and friends, so the discovery lane changes by one `use` and no behaviour. Its native build goes into the discovery Container unchanged; its `wasm32` build becomes `packages/archive`, the fourth bootstrap target beside `packages/{pdf,decryption,email}`. This is the engine-host seam's own model: one I/O-free core, two compile targets, and placement as a routing decision ([`../conventions/engine-host-seam.md`](../conventions/engine-host-seam.md)).

### 3.2 The one new engine capability — a directory read from a tail slice

A zip is located from its end, not its start: the end-of-central-directory record sits within the last 22 bytes plus up to a 64 KiB comment, and in a Zip64 archive it points through a locator to a second record carrying 64-bit fields where the 32-bit ones hold `0xFFFFFFFF` sentinels ([PKWARE APPNOTE.TXT](https://pkware.cachefly.net/webdocs/APPNOTE/APPNOTE-6.3.9.TXT)). That is exactly what makes a container browsable without downloading it.

New in `archive-core`:

```
read_directory(tail: &[u8], object_size: u64) -> Result<Directory, ArchiveError>
```

taking the object's total size and its last `min(object_size, 65_557)` bytes, and returning either the parsed directory or — when the directory does not fit in that window — the exact byte range the caller must fetch next. The caller (the Worker) performs the R2 reads; the core performs no I/O, per the seam's dual-target purity rule.

Every record the parse produces carries what the attack table in section 6 needs: the verbatim path, the compression method, compressed and uncompressed sizes, the CRC-32, the general-purpose bit flag (bit 0 encryption, bit 11 UTF-8, bit 3 data-descriptor), the `version_made_by` host byte, the external file attributes, the local-header offset, and the resolved Zip64 values.

### 3.3 Memory safety — golden rule 14, named crate by named crate

| Component                                                               | Language              | Dependency tree                                                                               | How confirmed                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zip` 8.6, features `["deflate-flate2"]` only                           | Rust                  | → `flate2` 1.1.9 → `miniz_oxide` 0.8.9. No `zlib`, `zlib-ng`, `zstd`, `bzip2`, `lzma`, `ring` | Ran `cargo tree -p discovery-core -e normal` in this worktree and read the subtree. Also asserted in-repo: `manifest_declares_only_pure_rust_backends` in `crates/discovery-core/src/lib.rs` reads the crate's own manifest and fails on a C-backed feature name |
| `flate2` 1.1.9, `default-features = false, features = ["rust_backend"]` | Rust                  | `miniz_oxide` only                                                                            | Same `cargo tree` run; declared directly in the manifest precisely so feature unification elsewhere cannot pull a zlib backend                                                                                                                                   |
| `fflate` 0.8.3 (the TypeScript alternative)                             | TypeScript/JavaScript | Zero dependencies, zero optional dependencies, MIT                                            | Read `node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/package.json`; listed every file in the package — no `.node`, no `.wasm`, no `binding.gyp`                                                                                                             |

**No C or C++ dependency is proposed, and none is required.** The one C-adjacent question is AR2 below, and it is about a _platform primitive_ rather than a dependency: the Workers runtime's own `DecompressionStream`. It is surfaced as a flag rather than adopted, which is what golden rule 14 asks for.

### 3.4 AR2 in full — the inflate engine, and why it is a real fork

Two ways to turn a compressed span into bytes, and they trade the same thing in opposite directions.

**(a) `DecompressionStream("deflate-raw")`.** Cloudflare Workers implements the standard Compression Streams API with `deflate`, `deflate-raw` and `gzip`, with no compatibility flag ([Cloudflare Workers docs, JavaScript and web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)). An entry becomes `R2.get(key, {range}) → DecompressionStream → a counting TransformStream → R2.put`, memory-flat at any entry size: nothing is ever resident. That removes the per-entry ceiling entirely and makes a 2 GiB entry as cheap in memory as a 2 KiB one. The cost: workerd's implementation is zlib, which is C. It is not a dependency in our tree — it is the platform, in the same category as `crypto.subtle` — but golden rule 14 exists because memory-unsafe code parsing untrusted privileged bytes is a confidentiality risk _even inside a sandbox_, and an opposing party's zip is exactly that input. Nothing in this repository uses `DecompressionStream` today; `grep` across the tree returns nothing.

**(b) `miniz_oxide` in `archive-core`, compiled to WebAssembly.** Pure Rust, memory-safe, the same decoder the scan container and the discovery engine already run against hostile bytes, and the choice ADR-0167's fleet keeps making. The cost: it inflates into a buffer, so the entry must fit the isolate's 128 MiB budget. A per-entry ceiling of roughly 96 MiB of inflated output is realistic; entries above it are **recorded, not extracted**, on the discovery precedent of describing honestly rather than opening.

The recommendation is **(b)**, with **(a) named as the escalation** if measurement shows real firm containers routinely carry entries over the ceiling. The reasoning: the platform has consistently paid performance and format breadth for memory safety (the raster engine takes the `image` crate over libvips; the scan container's one C engine, clamd, is consented, network-isolated and documented), and an entry ceiling produces an honest, recorded refusal rather than a silent risk. But it is the owner's trade, because it is the one that decides whether a 4 GiB video inside a production zip can be extracted at all.

---

## 4. Half one — browsing

The half with no write path. It cannot corrupt a matter, cannot bypass the gate, and costs nothing but reads.

### 4.1 Contract

```
GET /api/v1/files/{fileId}/container/entries?versionId=&cursor=&limit=
```

Resolves the file's **current clean version** by default, or a pinned `versionId` that must itself be clean, through the existing `getCurrentCleanVersion` / `listCleanVersions` queries — so the quarantine status gate holds by construction rather than by a new check. Paginated on the shared cursor primitive.

Each entry:

```
{ entryId, path, name, compressedSize, declaredSize, compressionMethod,
  encrypted, isDirectory, entryKind, modifiedAt, readable, notReadableReason }
```

`entryId` is minted by the server and is the **only** handle extraction accepts. `path` is the archive's verbatim claim, kept for the record and never used to derive anything. `name` is the normalized last segment (section 6, row 8). `entryKind` is `file | directory | symlink | other`. `readable` is false with a named `notReadableReason` for an entry that will be refused — `pathTraversal`, `absolutePath`, `symlink`, `encrypted`, `entryOversize`, `nested` — so the member sees before extracting what will and will not come out, which is the whole difference between an honest listing and a shrug.

Alongside the page, a summary: entry count, total declared uncompressed bytes, the maximum single-entry declared size, whether any entry is encrypted, and whether the container is Zip64.

**Permission: `permission: null`, `resource: "matter"`** — the same as `files.get` and `files.download`. The decisive argument is that a member who can already download the whole container can list it on their own machine in one command; refusing server-side listing protects nothing and only makes the product worse. `resource: "matter"` is mandatory: file objects are matter-rooted and the conformance suite enforces it for every `files:*`-adjacent surface.

**Idempotency:** none (a read). **Rate limit:** `expensive` — it parses hostile bytes.

**The flagged-version gate binds.** A version whose `scanVerdict` is `flagged` is not browsable on the same terms it is not downloadable: the route reads `flaggedTreatment` at request time through `scan-policy-settings.ts` and answers `409 malware-flagged` (with `stepUpRequired` when the firm's `scan.step_up_reauth_on_flagged` is on) unless the firm's treatment allows access. Parsing the structure of a file the scanner flagged is the exact thing a policy of `block` means to prevent.

### 4.2 The reads, and why the listing is written down

1. `R2.head(key)` for the object size.
2. `R2.get(key, {range: {offset: size - min(size, 65_557), length: …}})` — the EOCD search window.
3. When the directory does not fall inside that window, one further ranged GET for `[centralDirectoryOffset, +centralDirectorySize)`, using the offsets the parse returned.
4. One more only when a Zip64 locator sends the parse to a record outside the window.

**Two to four Class B operations, independent of the container's size.** A 40 GiB container browses for the same three reads as a 40 KiB one.

The listing is then persisted once, in a per-firm `file_container_entry` table keyed by `file_version_id`, because **a committed version is immutable** — its bytes and metadata never change (the File Manager invariant), so its directory is a fact that can be computed once and never recomputed. Three things follow, and the third is a security property rather than an optimization:

- Repeated browsing, pagination and sorting cost zero R2 operations.
- Extraction reads its plan from D1 rather than re-parsing.
- **Extraction selects server-minted `entryId`s from a table the server wrote.** A client-supplied path never reaches the extraction planner, which removes an entire class of confused-deputy mistakes before it can be made.

The write is idempotent (a partial unique index on `(file_version_id, entry_index)`), so two concurrent first-browses converge.

### 4.3 Failure modes and status codes

| Situation                                                                                    | Response                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Listed successfully                                                                          | `200`                                                             |
| Unknown file, soft-deleted file, no clean version, wrong firm                                | `404 not-found` — one answer for all four, as `files.get` does    |
| The version is not a container (no EOCD anywhere in the tail)                                | `422 not-a-container`                                             |
| EOCD found but the directory is malformed, truncated, or its offsets fall outside the object | `422 container-unreadable`                                        |
| The directory's entry count exceeds the firm's `maxEntries`                                  | `422 container-guard-tripped`, with the cap in the problem detail |
| Central directory and local headers disagree (section 6, row 9)                              | `422 container-ambiguous`                                         |
| The version is `flagged` and the firm's treatment is `block`                                 | `409 malware-flagged`                                             |
| No session / lacks matter access / rate-limited                                              | `401` / `403` / `429`                                             |

Every refusal names a stable problem type; new entries go in `apps/worker/src/contracts/problem-types.ts`. No refusal quotes bytes from the container — golden rule 4, and an entry path inside an opposing party's production is free text somebody wrote.

---

## 5. Half two — extraction into a matter

The sharp half. One rule governs everything below it.

> **Every byte that leaves a container enters the matter through `initiateUpload`.** Scan, magic-byte sniff, content hash, object dimensions, storage metering and the audit trail are all consequences of that one call and the ingest consumer that follows it. There is no second way to put bytes in a firm's bucket, and this design does not add one. An extracted file that skipped the gate would be an unscanned document sitting in a matter looking exactly like a scanned one.

### 5.1 The write ceremony, unchanged from the two paths that already do it

Per entry, in this order, which is itself the correctness rule (`archive-expansion.ts` states why):

1. `initiateUpload(database, { matterId, name, declaredSize, declaredContentType: **null**, uploadedBy, mode: "put", uploadKind: "bulk" })`, then commit its effect batch. `declaredContentType` is deliberately null: the entry's name inside a container is the _other side's claim_ about what it is, and feeding that claim into the check meant to test it is how a gate stops being one.
2. `bucket.put(initiated.r2Key, body, { customMetadata: initiated.dimensions })` — the dimensions minted where the matter is known, passed through unchanged, never re-derived. The key is the server's opaque `bulk/{fileId}/{versionId}`, never anything the container said.
3. `completeUploadSession(...)`, batched with the provenance row below.
4. The ingest event, enqueued **last**, so a verdict can never arrive for a file the corpus has not heard of.

The ingest consumer then does what it does for every upload: one read, magic-byte sniff, streaming SHA-256, the scan port, `computeVerdict` against the firm's policy, and commit or quarantine. Metering rides the commit batch. **None of that is re-implemented here, and a plan that re-implements any of it is a defect in the plan.**

Two consequences worth stating plainly. An extracted entry that the firm's upload policy refuses — a blocked extension, an over-cap size, a disallowed sniffed type — is refused at the gate exactly as an upload would be, and the extraction records it as a skip rather than failing the job. And an extracted entry the scanner flags is quarantined, not filed: extraction can therefore complete "successfully" while producing quarantined content, which is correct and must be visible in the job's result.

### 5.2 Contract

```
POST   /api/v1/files/{fileId}/container/extractions      -> 202 { jobId }
GET    /api/v1/files/container/extractions/{jobId}       -> 200 job state
GET    /api/v1/files/container/extractions/{jobId}/events -> WebSocket
```

Request:

```
{ versionId, entryIds: string[] | "all", destinationFolderId, structure: "preserve" | "flatten" }
```

`entryIds` are the server's own ids from section 4.2. `"all"` means every entry the listing marked `readable`.

**Permission: `files:upload`** is the recommendation, on the grounds that extraction _is_ an upload of many files and the platform seats content-writing there. **AR6** asks whether it earns its own key instead: extraction turns one member action into potentially ten thousand files, a blast radius an ordinary upload does not have, and `notes:retract` is the standing precedent for splitting a key when one act inside a permission is materially different from the rest. `structure: "preserve"` creates folders, so a member without `files:organize` gets `flatten` or a `403`; the route carries one permission, so the second check is in the handler.

**Idempotency: required.** The job id is content-addressed from `(firmId, versionId, sorted entryIds, destinationFolderId, structure)`, on the `bundleManifestHash` pattern, so a duplicate submit joins the running job rather than extracting twice. **Rate limit:** `expensive`. **Audited:** one `audit_log` row at submit and one at completion.

### 5.3 The job — coordination stays in the app Worker

`ContainerExtractionJob`, a Durable Object keyed `firmId:jobId`, on the `BundleBuildCoordinator` and `ConversionJob` pattern, with a `container-extract` queue and one message per entry.

The Durable Object holds the only thing that cannot be per-entry: the **running budget**. A consumer reserves against it before inflating and reports the real produced size after writing, so the total-bytes and ratio guards remain true across parallel entries. That is firm-bearing coordination and stays app-side by the rubric's compute-vs-coordination seam; relocating it would buy no isolation and add a hop to every reservation.

Both budget checks exist, and neither is sufficient alone:

- **At plan time**, from the central directory's _declared_ sizes — the cheap check that refuses an obvious bomb before a single byte inflates.
- **At write time**, from the _real_ produced bytes, correcting for the shortfall where a header lied. `containers/scan/src/heuristics/mod.rs` already does exactly this correction and is the shape to copy.

Progress rides the existing hibernation-aware WebSocket contract in `apps/worker/src/progress/`, with polling as the unchanged fallback. Every state write ends in a `broadcast()`.

**When the running budget is breached mid-job, the job stops and what already landed stays.** Those entries went through the gate and are real, scanned, metered files; soft-deleting them would be a second, less careful write path over a member's matter. The job's terminal state names the breach and the entry it stopped at, and the member deletes what they do not want.

### 5.4 Provenance — the chain of custody this creates

Two new per-firm tables, because the File Manager has no provenance column today (`file_version` carries `checkoutId` for offline check-ins and nothing else).

- `file_container_extraction` — the job: source file and version, destination folder, structure, actor, submitted and completed instants, terminal state, counts, and the budget outcome.
- `file_container_extraction_entry` — one row per entry the job considered: the extraction, the `entryId`, the verbatim `source_path`, the resulting `file_id` and `file_version_id` (null when skipped), the outcome, and the named skip reason.

That is the record that answers, years later, where a document in a matter came from — the File Manager's equivalent of discovery's container family, and the reason the verbatim path is kept even though it is never acted on.

**The source container is never modified and never deleted.** It stays at its own key as the as-received copy, exactly as discovery keeps its evidence copy. Extraction therefore **doubles** the stored bytes for everything it extracts, which is metered and billed, and which a firm should be told before it clicks (section 8).

### 5.5 Failure modes and status codes

| Situation                                                                                                         | Response                                                        |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Accepted, or joined an identical running job                                                                      | `202 { jobId, status }`                                         |
| Idempotent replay of a completed job                                                                              | `200` with the stored response                                  |
| Unknown file/version/folder, or a destination folder in another matter                                            | `404`                                                           |
| An `entryId` this version's listing does not contain                                                              | `422 validation` — never a path lookup, never a guess           |
| Declared totals over the firm's cap at plan time                                                                  | `422 container-guard-tripped`                                   |
| Central directory and local headers disagree                                                                      | `422 container-ambiguous` — the whole job, not a per-entry skip |
| The source version is `flagged` and treatment is `block`                                                          | `409 malware-flagged`                                           |
| Member lacks the permission                                                                                       | `403`                                                           |
| Per-entry: traversal, absolute path, symlink, encrypted, oversize, nested, refused by upload policy, CRC mismatch | recorded as a skip with a named reason; the job continues       |
| Per-entry: the resulting version is quarantined by the scanner                                                    | the job completes; the result names it                          |
| Running budget breached mid-job                                                                                   | job terminal state `guard-tripped`; extracted entries stay      |

### 5.6 What must not happen, stated so a reviewer can check for it

- No `R2.put` outside the ceremony in 5.1. The existing `r2-object-dimension-scan.test.ts` fitness function already fails a write path that omits dimensions; it will catch a shortcut here.
- No entry path used to derive an R2 key, a folder path, or a file name beyond the normalized last segment.
- No `declaredContentType` taken from an entry name or from the container.
- No second scan port, no second verdict computation, no second metering path.
- No extraction of an entry the listing marked `readable: false`.
- No path, filename, or byte from a container in a log line, a problem detail, a counter dimension, or a URL.

---

## 6. The attack table

Every row: the bound, and the single place it is enforced. The reader treats the container as hostile throughout; nothing that comes out of it is trusted by anything downstream, which is why every entry still crosses the ingest gate.

| #   | Attack                                                                                                                                 | Bound                                                                                                                                                                                                                                                                                                | Enforced at                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Path traversal in entry names** (`../`, `..\`) — Zip Slip, CWE-22                                                                    | Unconditional refusal. No ceiling, no setting, no override                                                                                                                                                                                                                                           | `archive-core`'s `is_traversal_path`, at directory-parse time, before anything else about the entry is looked at. Re-checked at write time. **Structurally moot as well:** the R2 key is server-minted `bulk/{fileId}/{versionId}` and folder placement uses `folder-service` rows, so a traversal path has nothing to act on |
| 2   | **Absolute paths and drive letters** (`/etc/…`, `C:\…`, `\\host\share`)                                                                | Unconditional refusal                                                                                                                                                                                                                                                                                | Same predicate, same point — leading `/` or `\`, or a second byte of `:`                                                                                                                                                                                                                                                      |
| 3   | **Symlink and special entries** — CWE-59 link following                                                                                | Refused, never materialized. Any entry whose `version_made_by` host is Unix and whose external attributes carry `S_IFLNK`, or a device/fifo/socket mode                                                                                                                                              | Directory parse: `entryKind` is computed there and an entry that is not `file` or `directory` is `readable: false`. Object storage has no symlinks, so materializing one would file a path string as if it were a document — a lie in the corpus, refused for that reason as much as for the write                            |
| 4   | **Decompression bomb — ratio** — CWE-409                                                                                               | AR1. Recommended `maxExpansionRatio` 100, evaluated on running totals, not per entry                                                                                                                                                                                                                 | Twice. Declared sizes at plan time (refuses without inflating); real produced bytes reported to the Durable Object after each entry, correcting for a lying header by adding only the shortfall                                                                                                                               |
| 5   | **Decompression bomb — absolute size**                                                                                                 | AR1. Per-entry ceiling (see AR2) and a whole-job `maxUncompressedBytes`, recommended 4 GiB                                                                                                                                                                                                           | A counting `TransformStream` between inflate and R2 that aborts at ceiling-plus-one byte. **A declared length never sizes a buffer** — the discovery core's read-one-past-the-ceiling technique, which is how a ceiling is detected while holding only the ceiling                                                            |
| 6   | **Nested archives, and the zip quine**                                                                                                 | AR3. Recommended: **one level, never entered.** A nested container is extracted as a file and is not itself extracted                                                                                                                                                                                | The inflated head is checked with `engine_host::format::detect`; a `Zip` result marks the entry `nested` and files it without recursing. The nested container then re-enters ingest, where `containers/scan` applies its own depth and nesting heuristics to it                                                               |
| 7   | **Entry-count explosion**                                                                                                              | AR1. Recommended `maxEntries` 10,000, from the firm's `fileManager.archiveCaps`                                                                                                                                                                                                                      | Directory parse, from the EOCD's count field **and** cross-checked against the records actually parsed, before a byte inflates. A disagreement between the two is row 9                                                                                                                                                       |
| 8   | **Filename encoding tricks** — CP437 vs UTF-8, the 0x7075 extra field, NFD/NFC, homoglyphs, embedded control characters and separators | Verbatim path recorded; a **separate** normalized display name derived. Bit 11 selects UTF-8, the 0x7075 Unicode Path extra field overrides, otherwise CP437. NFC-normalized. Control characters and both separators stripped from the display name                                                  | Directory parse produces both. `path` never leaves the record; `name` is the only value that becomes a file name, and it is the last segment only. A name is never used for type detection — the gate sniffs the bytes                                                                                                        |
| 9   | **Central-directory / local-header disagreement** — parser confusion                                                                   | The central directory is the **only** enumeration source; a sequential local-header walk is never performed. At entry read time the local header's name, compression method, compressed size and CRC-32 must equal the directory record's. A mismatch refuses the **whole container**, not the entry | Entry read, before inflate. Refusing the whole container rather than the entry is deliberate and follows PyPI's posture: a container that presents two different answers to two readers is not one whose other entries can be trusted either                                                                                  |
| 10  | **CRC-32 mismatch after inflate**                                                                                                      | The entry is discarded and recorded; nothing is filed                                                                                                                                                                                                                                                | The counting stream computes CRC-32 as it passes bytes and compares before `completeUploadSession`. Cheap, and it is the format's own integrity claim                                                                                                                                                                         |
| 11  | **Overlapping, out-of-range or duplicated data spans**                                                                                 | Every entry's `[localHeaderOffset, +headerLen+compressedSize)` must fall inside the object; two entries may not claim overlapping spans                                                                                                                                                              | Directory parse, as a whole-directory validation pass. A violation is `container-unreadable`                                                                                                                                                                                                                                  |
| 12  | **Zip64 sentinel lies** (`0xFFFFFFFF` / `0xFFFF` with no Zip64 extra field, or one that does not resolve)                              | Refusal, never a silent fallback to the 32-bit value                                                                                                                                                                                                                                                 | Directory parse. A sentinel with no resolving extra field is `container-unreadable`                                                                                                                                                                                                                                           |
| 13  | **Prepended data / polyglot / self-extracting stub**                                                                                   | Permitted (it is a legitimate, extractable archive) but every directory offset is validated against the computed archive-start shift                                                                                                                                                                 | Directory parse. This is why `containers/scan` opens zips unconditionally rather than on offset-0 magic, and the same reasoning holds here                                                                                                                                                                                    |
| 14  | **Duplicate entry names**                                                                                                              | Both are extracted as distinct files; the destination-name collision is resolved the way a second upload of the same name is                                                                                                                                                                         | Extraction planner, from the entry ids — which is another reason the plan is built from server-minted ids rather than names                                                                                                                                                                                                   |
| 15  | **Encrypted entries**                                                                                                                  | AR5. Recommended: skipped and recorded, siblings still extract                                                                                                                                                                                                                                       | Directory parse reads general-purpose bit 0 via the raw accessor (the reason discovery and scan both use `by_index_raw`: `by_index` errors on an encrypted entry and would skip it before `.encrypted()` could flag it)                                                                                                       |

**Sources for the attack classes:** [Snyk, Zip Slip vulnerability](https://security.snyk.io/research/zip-slip-vulnerability) and [CodeQL, arbitrary file access during archive extraction](https://codeql.github.com/codeql-query-help/go/go-zipslip/) for rows 1 and 2; [CodeQL, arbitrary file write via archive symlinks](https://codeql.github.com/codeql-query-help/go/go-unsafe-unzip-symlink/) and CVE-2025-55188 (7-Zip symbolic link handling) for row 3; [CWE-409, improper handling of highly compressed data](https://turingsecure.com/vulnerability-database/CWE-409/) and [David Fifield, "A better zip bomb"](https://www.bamsoftware.com/hacks/zipbomb/) for rows 4 through 6; [PyPI, preventing ZIP parser confusion attacks](https://blog.pypi.org/posts/2025-08-07-wheel-archive-confusion-attacks/) and [Mozilla bug 1534483, ambiguous zip parsing hides add-on files from reviewers](https://bugzilla.mozilla.org/show_bug.cgi?id=1534483) for row 9; [PKWARE APPNOTE.TXT 6.3.9](https://pkware.cachefly.net/webdocs/APPNOTE/APPNOTE-6.3.9.TXT) for the format facts behind rows 8, 11, 12 and 13.

**The firm's caps are the firm's.** Rows 4, 5 and 7 read `fileManager.archiveCaps` — the per-firm setting that already exists and that nothing reads. Wiring it here is the right first consumer, and it makes the same numbers reachable for the scan container's hard-coded copy later. The discovery engine keeps its own `Limits`, deliberately: an opposing party's production is a different risk posture from a member's own zip, and collapsing the two would let a firm's convenience setting loosen a discovery guard.

---

## 7. Where it runs — the rubric applied

[`../conventions/operations.md`](../conventions/operations.md) section 18 governs this. A subsystem earns its own Worker when it scores high on ① through ④ **and** clears ⑤.

| Property                                | Verdict for the container reader                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **① Heavy native / Container runtime**  | **No.** Browsing parses a few hundred kilobytes from a tail slice. Extraction is a byte-range read piped through an inflate into R2 — the same I/O-bound profile ADR-0082 accepted for `client-zip` in the other direction, plus one inflate per byte. The rubric is explicit: "A WASM engine that fits the isolate's CPU and bundle budget is not a candidate — it stays in-process" |
| **② Independent deploy cadence**        | **Nothing.** No perishable data is baked, no signature set, no model. The reader redeploys when the app does                                                                                                                                                                                                                                                                          |
| **③ Distinct scaling profile**          | **Stated as contention, and the contention is already solved.** Extraction is bursty and touches CPU, but it runs on a queue consumer with its own concurrency — the mechanism the two ingest lanes already use to keep bulk work off the interactive path. It does not want its own `instance_type`                                                                                  |
| **④ Containment / blast radius**        | **Satisfied in place.** The bytes are untrusted; the parser is memory-safe; the isolate is the sandbox; the path holds no credential it can misuse and writes only through the ingest chokepoint. `packages/pdf` and `packages/decryption` already parse untrusted, privileged bytes in this exact isolate on this exact reasoning                                                    |
| **⑤ Stateless compute — the seam test** | **The compute clears it; the coordination does not cross.** Inflating one entry is stateless. The running budget, the job state and the provenance rows are firm state and stay app-side, which is what the rubric requires                                                                                                                                                           |

**Conclusion: it does not extract.** In-process WebAssembly in the app Worker, with the job coordination beside every other coordinator. Precedent for the placement: `packages/pdf` and `packages/decryption`, the latter of which already imports `decryption_core_bg.wasm` directly into a route handler and parses encrypted zips there.

Three notes on the boundaries of that answer.

- **The escalation exists and is not built.** The engine-host seam models Worker-versus-Container as a routing decision on one crate, and `magna-carta-discovery` already exposes `/archive/enumerate` and `/archive/expand` over a service binding. If measurement shows real containers routinely exceed the isolate, the heavy lane is a resolver change, not a rewrite. It is named as a seam here so nobody re-derives it.
- **Riding the discovery Worker was considered and rejected.** It would work today with no new code, but it fails ③ in the direction the rubric cares about: the discovery engine "saturates CPU for hours during a bulk load", and putting an interactive File Manager browse behind it makes a member's click wait on a production load. It also sends the whole container across a service binding as a request body, which is the shape the ranged read exists to avoid.
- **Riding `magna-carta-bundle` was considered and rejected.** It is the archive _builder_, and grouping is permitted when two engines "share one pipeline and one cadence" — but reading and writing are not one pipeline here: the writer streams selected R2 objects out, the reader takes ranged reads in and feeds ingest. The coupling would be the word "zip" and nothing else.
- **The bundle budget must be measured, not assumed.** A Worker is capped at 10 MiB compressed on the paid plan. `archive-core`'s WASM artifact is `zip` plus `miniz_oxide` and no more, which is why section 3.1 extracts it rather than compiling `discovery-core`; the first build measures it against the app Worker's current size, and a result that does not fit is what moves the inflate to the heavy lane.

---

## 8. Cost

**R2 operations.** Browsing is 2–4 Class B per version, once, then zero (the listing is persisted against an immutable version). At $0.36 per million Class B, browsing is free at any plausible volume. Extraction is, per entry, one Class B for the ranged read plus a Class A `put` — or a multipart create/parts/complete when the inflated length is unknown, which it is whenever a streaming inflate is used. A 10,000-entry container is on the order of 10,000 Class A operations, roughly $0.05 at $4.50 per million, plus parts.

**The real cost is not R2.** Each extracted entry is a queue message, a scan, a D1 effect batch and a metered object — identical to the member uploading those files by hand, which is the honest comparison, and it is the ingest pipeline's cost rather than this feature's.

**Storage doubles for what is extracted.** The source container is kept as the as-received copy and the extracted entries are new objects, both metered under the `files/` dimension. A firm extracting a 20 GB production pays for 40 GB. This must be visible in the confirmation the member sees, not discovered on an invoice.

**Memory.** Browsing holds the EOCD window plus the central directory — under about 1 MiB for a 10,000-entry container. Extraction is flat under AR2(a) and bounded by the per-entry ceiling under AR2(b).

**Latency.** Browsing is two to four R2 round trips: tens of milliseconds, and it is off the download path entirely. Extraction is a job; its latency is the queue's.

**New deployables: none.** No new Worker, no new Container, no new image build, no new Workers Builds project, no warm-poke cron, no new standing monthly line in [`../operating-costs.md`](../operating-costs.md).

---

## 9. Ordering — browse first

**Browse ships first, alone, and is useful alone.** Four reasons, in the order that matters.

1. **It has no write path.** It cannot bypass the gate, cannot put an unscanned byte in a matter, and cannot cost storage. Shipping the read half first means the risky half is the second thing built, on machinery the first half proved.
2. **It builds what extraction requires.** The ranged directory reader, `archive-core`, the WASM build, the `file_container_entry` table, the problem types, and the entry-id contract that makes extraction's plan un-forgeable are all browse's work. Extraction on top of it is a job, a consumer and two provenance tables.
3. **It answers AR1, AR3 and AR5 with evidence instead of guesses.** Once members can list containers, the platform learns how large real firm containers are, how deeply they nest, how often they are encrypted, and how many entries they carry — which is exactly what the ceilings should be set against. Freezing those numbers before that data exists is the retrofit this ordering avoids.
4. **It is a feature on its own.** "What is in this zip" without downloading it is worth shipping even if extraction never follows.

**Extraction second, behind a release-channel flag.** Add a `FLAG_CATALOG` entry with `defaultValue: false` and `stage: "alpha"`, so it lands alpha, then beta, then stable, and a firm that has not asked for it sees no change. The flag mechanism and its safe-default rule are in [`../../apps/worker/CLAUDE.md`](../../apps/worker/CLAUDE.md).

**What each unblocks.** Browse unblocks a preview surface for containers, the entry-level "download just this one file" a member will ask for the day after browse ships (a ranged read plus an inflate straight to the response — no matter write, no ingest, and therefore a much smaller decision than extraction), and a cheaper discovery load path that enumerates before it commits. Extraction unblocks intake of a client's own document dump, and it is the last piece that lets a firm handle a production entirely in-product rather than unzipping on a workstation and re-uploading — which is what ADR-0027 assumed would happen and is worth naming as the thing this replaces.

---

## 10. Owner flags

Numbered `AR`. Each changes what gets built.

**AR1 — the ceilings.** Recommended: adopt `fileManager.archiveCaps` as it already stands (entries 10,000, total uncompressed 4 GiB, ratio 100, depth 16) and make this feature its first reader, so the setting stops being decorative. The depth value is only meaningful if AR3 permits recursion; under the recommended AR3 it is unused. Two sub-questions the owner may want to split: whether the ratio of 100 is too tight for a production of pure text (discovery chose 200 for exactly that reason), and whether a firm may raise these at all or whether they are a platform floor.

**AR2 — the inflate engine, and it is a memory-safety trade.** (a) The Workers runtime's `DecompressionStream("deflate-raw")`: memory-flat at any entry size, no per-entry ceiling, but the runtime's implementation is zlib (C) — a platform primitive rather than a dependency in our tree, and surfaced here rather than adopted quietly because golden rule 14 exists for untrusted privileged bytes specifically. (b) Pure-Rust `miniz_oxide` in `archive-core` compiled to WebAssembly: memory-safe, the same decoder scan and discovery already run, but it buffers, so entries above roughly 96 MiB inflated are recorded rather than extracted. **Recommended: (b), with (a) named as the escalation.** This decides the code, not a configuration value.

**AR3 — are nested containers entered at all?** Recommended: **no.** A container inside a container is extracted as a file and never opened; it re-enters ingest where the scan container applies its own nesting heuristics, and the member can enter it deliberately as a second act. The alternative — one level of automatic recursion — buys convenience and costs the clean property that a member always knows what they asked for. Entering more than one level should not be on the table for a member-facing tool; discovery's three levels exist because a production genuinely arrives as a zip of per-custodian zips of per-mailbox zips, and that is discovery's problem.

**AR4 — preserve the container's folder structure, or flatten?** Recommended: **offer both, default `preserve`.** `preserve` creates real folder rows through `folder-service` (never filesystem paths) mirroring the container's directories under the destination folder; `flatten` puts every entry directly in the destination and resolves name collisions the way a second upload of the same name does. Preserve is the default because a production's directory structure is frequently meaningful — it is how the producing party organized it, and flattening discards evidence. The flag matters because `preserve` pulls `files:organize` into the permission question (AR6) and adds folder-creation to the job's failure surface.

**AR5 — an encrypted container: refuse, or prompt for a password?** Recommended for the first build: **skip encrypted entries, record them by name in the result, and extract their siblings** — the discovery rule, on the grounds that one locked file must not cost a firm the other nine thousand. Prompting is the richer answer and it reaches further than it looks. `crates/decryption-core/src/zip_adapter.rs` already unlocks encrypted zip entries, and `POST /api/v1/decryption/unlock` already accepts a member-typed password — **in-process, as WebAssembly, in the app Worker, so today no member-typed password crosses a service binding anywhere in the platform.** (Password _recovery_ deliberately crosses one, but the boundary is hash-only: ADR-0170 records that only the extracted hash, never the file and never the password, reaches `magna-carta-recovery`.) Extraction-with-password would keep that property only if the inflate stays in-process — which is AR2(b) — and would break it the moment the heavy lane is entered. It also needs a decision about the password's lifetime inside a _job_, where "in memory only, never in the durable queue, never in a log, never in the cache key" (the ADR-0146 rule for bundle encryption) is harder to hold than in a single request. **This is a genuine open question and it is not recorded anywhere today** — I looked; what is recorded is the hash-only boundary and the in-process unlock, and the conclusion that no member-typed password crosses a binding is a fact I verified from the code rather than a decision anybody wrote down. Answering AR5 as "prompt" means answering AR2 as (b) and writing that decision down.

**AR6 — does extraction ride `files:upload`, or earn its own permission key?** Recommended: `files:upload`, because extraction is an upload of many files and the platform seats content-writing there. Against: one member action can produce ten thousand files, which is a blast radius an ordinary upload does not have, and `notes:retract` is the precedent for splitting a key when one act inside a permission is materially different. A new key is cheap now and expensive later (it needs role seeding and a migration).

**AR7 — is browsing gated behind anything at all?** Recommended: no — the same open read as `files.get` and `files.download`, because a member who can download the container can list it locally anyway. Worth a moment's thought only because listing is the first File Manager read that parses the file's _contents_ rather than its metadata, and a firm that treats containers as sensitive by default may want it narrower.

**AR8 — is `docs/user/` in scope for the first slice?** Golden rule 5 says a feature is not done until its user documentation exists. Browse is a user-facing capability the day it ships, so the answer is presumably yes; naming it here keeps it from being discovered at the end.

**AR9 — the name.** ADR-0146 rules that "archive" means retired or retention items in this product. This design proposes **container** for the object and **entering a container** for the act, matching discovery's existing `container family` and `container-child` and the scan prefilter's `container families`. Confirm, or name it something else before any route path, permission key, table name or user-facing string is written — this is the cheapest flag on the list to answer now and the most tedious to answer later.

---

## 11. What this design deliberately does not do

- **It does not open non-zip containers.** No 7z, RAR, tar, gzip, bzip2 or xz. Each is a separate decoder over hostile bytes, most of the good ones are C, and `containers/scan` already records the same gap as a documented follow-up. A member's container that is not a zip gets `422 not-a-container`, which is honest.
- **It does not touch the write direction.** Bundling (ADR-0082, ADR-0146) is unchanged, and the `containers/bundle` encoder registry is not a place to add a decoder.
- **It does not change discovery.** The discovery lane keeps its own `Limits`, its own guards and its own container-family semantics. The only change there is a `use` statement pointing at the extracted crate.
- **It does not preview entry content.** Reading one entry's bytes out to the member without filing them is a smaller, later, obvious follow-up (section 9), and folding it in now would blur the line between the two halves this design is built around keeping apart.
- **It does not decide ADR-0027's fate.** ADR-0027 said archive contents were "deferred but not designed-out", and expected client- or desktop-side extraction followed by loose-file upload. This design proposes the server-side alternative, and if it is accepted, a new ADR supersedes ADR-0027's File Manager clause while leaving its bulk-download clause standing. That ADR is written when the flags are answered, not now — the fragment convention in [`../../changelog.d/README.md`](../../changelog.d/README.md) and `docs/decisions/pending/` is where it goes.

---

## 12. Test plan, in outline

- **Golden vectors, committed as constructed bytes and never as fixture files.** A hostile archive is not a thing to leave lying in the repository; `crates/discovery-core/src/test_support.rs` already builds its zip bombs and traversal archives in code, and this follows it.
- **One case per attack-table row**, asserting the named bound at the named enforcement point — including the two that are easy to write and easy to get wrong: a central-directory/local-header name disagreement refusing the whole container, and an entry whose declared size lies small while the real inflate runs long.
- **A fitness function** over the extraction package asserting that the only `R2.put` reachable from it is the one inside the ceremony in 5.1, on the pattern of the existing object-dimension scan.
- **Round-trip against the platform's own writer:** a bundle built by `client-zip` and by `containers/bundle` must enumerate and extract identically, which is the cheapest proof the reader is not accidentally specific to one encoder.
- **Load profile:** browse measured against a container at the entry-count cap; extraction measured against the same, on the load-profile harness rather than on guesses (golden rule 10).
