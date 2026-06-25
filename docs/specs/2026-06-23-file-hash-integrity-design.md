# File Hash & Integrity — design

**Status:** Accepted (design) · **Date:** 2026-06-23 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ ("pure utilities are libraries, not plugins").
**Builds on:** the Tools area (`docs/specs/2026-06-16-tools-area-design.md`, ADR-0101) · the ingest pipeline's streaming-digest pattern (`packages/file-manager/src/ingest-core.ts`, read-only precedent) · the per-firm `audit_log` table and its redaction-safe helper (`packages/data-access/src/audit-statements.ts`).
**ADRs (new, to record):**

- **ADR-CCCC** — File-hash-integrity architecture: a pure streaming multi-digest core (one read → five hashes), server-side compute on every surface (forensic attestability + MD5), integrity verification against the ingest baseline recorded to `audit_log`, the new `file` context tag, and the downloadable hash receipt.

A law firm routinely needs to **prove a file is exactly what it claims to be**: confirm a production matches the hash opposing counsel listed in a load file, hand a court an attestable digest, detect that bytes at rest have not been altered or corrupted since intake, or check a download against a published checksum. This design adds an ethereal Tools-area utility — **File Hash & Integrity** — that computes a file's cryptographic digests and verifies a stored file still matches the digest recorded when it was ingested. It is built core-first so the same engine can later back a matter-action ("verify this production in place", "attach an integrity receipt to the discovery record"), per the Tools-area principle: _do matter-grade work without committing it to a matter._

This tool is **all-TypeScript** and pure, with all I/O (R2 reads, clock, identifiers, audit writes) injected — the worker-consumed-library pattern of `whois` and `safe-browse`.

---

## 0. Why this belongs in Tools (and not an engine)

The Tools area is the home for **orphan, cross-cutting capabilities no domain or engine wholly owns.** Redaction, Bates numbering, OCR, and PDF page-ops are _PDF-engine_ work and belong there, not here. Hashing is different: it operates on _arbitrary bytes_, is owned by no subsystem, and is needed in three unrelated places (a standalone utility, a per-file action, a future production/discovery step). It passes the orphan test, so it is a tool.

It also deliberately **does not duplicate** the ingest hash. The pipeline already computes and stores a SHA-256 per version at intake (`fileVersion.content_sha256`). This tool _consumes_ that as the integrity **baseline** and adds what ingest does not: on-demand multi-algorithm digests, an explicit recompute-and-compare with a chain-of-custody record, and an attestable receipt. The ingest path is read-only precedent here — its `ingest-core.ts` is not modified.

## 1. Module placement

Mirroring the structure-vs-UI seam and the existing tool packages (`whois`, `safe-browse`, `conversion`):

- **`@magna-carta/file-integrity`** — new **pure** TypeScript package. No D1, no Hono, no `env`, no Svelte, no network — fully unit-testable. Files (indicative):
  - `src/algorithms.ts` — the supported-algorithm set and its labels/order.
  - `src/hash.ts` — `hashAll(stream, deps)`: fans one byte-stream into five `DigestStream`s concurrently (§2). Counts bytes in the same pass. Never buffers.
  - `src/compare.ts` — `compareToBaseline(computedSha256, baselineSha256) → "match" | "mismatch" | "no-baseline"`.
  - `src/receipt.ts` — `buildReceipt(...)`: assembles the structured receipt payload (§4) and its human-readable rendering.
  - `src/types.ts` — `HashResult`, `VerifyResult`, `ReceiptPayload`, and the injected `HashDeps` (the `DigestStream` accessor + clock).
- **`@magna-carta/tools`** — one new catalog row (§5); no logic. Adds the **`file`** context tag to the `ContextTag` union (§5) — the first per-file contextual action.
- **`@magna-carta/access-control`** — one new `tools:fileIntegrity` permission.
- **The Worker** — a new route module (§5) registered through the chokepoint, plus a migration seeding the permission to roles. The verify route injects R2, the per-firm database, and the `audit_log` helper into the pure core.
- **The shell (design-system / web app)** — the `id → Svelte entry component` map, the standalone widget, and the per-file right-click action; lands with the design-system Tools shell, as the other tools' widgets do. Until then the routes are exercised via the throwaway `/__dev/web-tools` demo page.

Direction: `tools` ← shell; `file-integrity` ← worker route ← shell. `file-integrity` depends only on leaf libraries.

## 2. Architecture — pure streaming multi-digest core

The core is a single streaming pass that produces every digest at once:

```
hashAll(stream, deps) → { md5, sha1, sha256, sha384, sha512, sizeBytes }
  one ReadableStream<Uint8Array>
    ├─ DigestStream("MD5")
    ├─ DigestStream("SHA-1")
    ├─ DigestStream("SHA-256")
    ├─ DigestStream("SHA-384")
    └─ DigestStream("SHA-512")          // + a byte counter, same pass
```

**One read, five hashes.** Workers' `crypto.DigestStream` supports `MD5`, `SHA-1`, `SHA-256`, `SHA-384`, and `SHA-512` (MD5 is a Cloudflare extension for legacy interop). The bytes are fanned to all five digesters in one pass, so the cost is **one read regardless of how many algorithms** — not one read per algorithm. The user asks for everything with a single "Generate all" action; there is no per-algorithm toggle to reason about and no incremental read cost.

The `DigestStream` constructor is reached through a precisely-typed accessor (the same workerd extension `ingest-core.ts` uses, reproduced here rather than imported — the ingest helper stays untouched). The accessor is injected via `HashDeps` so unit tests can exercise the fan-out logic in the Vitest worker pool with real bindings.

**Compute location — server-side on every surface (forensic-first).** A digest computed in the Worker, with a server UTC timestamp, is more attestable than one computed in the user's browser; it is the only way to include **MD5** (browsers' Web Crypto omits it); and it gives one consistent code path for the standalone tool, the per-file action, and the future matter-action. The standalone tool therefore streams the uploaded file body straight to the Worker → the five digesters → result, with **nothing persisted**. (Client-side SHA-family hashing with no upload — instant and private — is a nice later optimization behind the same UI; deferred, §8.)

**Large files.** Verification streams the whole object, so it inherits the isolate's wall-clock/CPU envelope. v1 verifies **inline up to a configured cap** (a firm setting, defaulting to the existing inspectable-size cap) and, above it, returns a clear "too large for inline verify" with a **deferred async-Queue-job seam** (the ingest/scan precedent: a queue consumer streams from R2 and records the result). Integrity verification is infrequent and most legal files are small, so inline is the right v1; the seam is named, not built.

## 3. Algorithms and the integrity baseline

**Algorithm set:** `MD5`, `SHA-1`, `SHA-256`, `SHA-384`, `SHA-512` — all five, always, in one pass. MD5 and SHA-1 are retained for eDiscovery/legacy interop (load files and opposing-party tooling still specify them) despite being cryptographically weak; the tool labels them as legacy-interop, not security-grade. SHA-256 is the primary/default-display digest and the one with a stored baseline.

**Baseline comparison.** Only SHA-256 has an ingest baseline (`fileVersion.content_sha256`). `compareToBaseline` returns:

- **`match`** — recomputed SHA-256 equals the stored baseline: the bytes at rest are unchanged since intake.
- **`mismatch`** — they differ: corruption or alteration since intake — surfaced prominently.
- **`no-baseline`** — the version has no recorded SHA-256 (e.g. an oversize/`unscanned` intake whose `content_sha256` is null): the tool reports the freshly computed digests and states plainly that no baseline exists to compare against. The other four algorithms have no baseline and are always reported as freshly computed values, never compared.

## 4. Behaviour & data model — three surfaces, one core

1. **Standalone tool.** Drop any file → "Generate all hashes" → the five digests + byte size. Optional: paste an **expected** hash → the core reports which algorithm (if any) it matches. Nothing is persisted; this is record-less, like the other pure tools.
2. **Per-file action (right-click).** The stored SHA-256 shows **instantly** from existing file metadata. One button — **"Generate all & verify"** — reads the object from R2 once, computes all five, compares SHA-256 to the baseline (§3), and **records a chain-of-custody event** (below). Returns the digests, the match result, and the receipt payload.
3. **Matter-action seam (deferred).** The same core backs a future "verify in place" during production/discovery, flipping this tool's `matterContext` from `none` to `optional`.

**Chain-of-custody record.** Every per-file verify writes one `audit_log` row via the existing redaction-safe helper (`insertAuditLogStatement` / the file-manager `fileAuditStatement` wrapper):

```
event: "file.integrity_verified"
actor_user_id: <verifying user>
subject_id: <fileId>
metadata: { versionId, baselineSha256, computed: { md5, sha1, sha256, sha384, sha512 },
            result: "match" | "mismatch" | "no-baseline", sizeBytes, verifiedAt }
```

Digests are not privileged content, so they pass the metadata-redaction guard cleanly. The row is the durable forensic trail; it commits in the same batch as the receipt-correlation id.

**Hash receipt (v1).** `buildReceipt` returns a structured `ReceiptPayload`; the API returns it as JSON and the UI offers a downloadable human-readable **`.txt`** plus the raw **`.json`**. Contents: tool name + version, firm, file identity (name, fileId/versionId for the per-file surface), byte size, server UTC timestamp, all five algorithm+digest pairs, and — for a verify — the baseline SHA-256, the match result, the matter (if any), the verifying user, and the correlating `audit_log` row id. The standalone receipt omits the baseline/matter/user fields (there is no in-system file). _Deferred (§8):_ cryptographically signed receipts and a PDF rendering (waits on the in-house PDF engine).

## 5. Worker surface

Through the chokepoint, registered with full `RouteMeta`:

- `POST /api/v1/file-integrity/hash` — accepts a streamed file body (optional `expected` digest), returns `{ algorithms, sizeBytes, computedAt, expectedMatch? }`. No persistence.
- `POST /api/v1/file-integrity/verify` — accepts `{ fileId, versionId? }`, resolves the R2 key (`loadVisibleFile` / `getCurrentCleanVersion`), streams `env.R2.get(r2Key)` once through `hashAll`, compares to the baseline, writes the `audit_log` row, and returns the digests + result + `ReceiptPayload`.

Both: permission `tools:fileIntegrity`, `resource: "firm"`. The verify route binds a matter only via the file's existing association (read-only); it never creates one.

New catalog row in `@magna-carta/tools`, and the new `file` context tag:

```
// ContextTag union gains "file":
type ContextTag = "address" | "person" | "company" | "matter" | "website" | "file" | "none";

id: "file-hash-integrity", name: "File Hash & Integrity", icon: "fingerprint" (Lucide),
subjectGroup: "documents", permission: tools:fileIntegrity, contextTags: ["file", "none"],
backing: { kind: "library" }, matterContext: "none"
```

`contextTags: ["file", "none"]` — `none` lists it in the general sidebar (standalone), `file` surfaces it as a per-file right-click action via `toolsFor("file")`. `matterContext: "none"` now; the seam to `optional` is the future matter-action consumer of the same core.

## 6. Security

- **SSRF / target safety** — N/A for the hash endpoint (it consumes only the request body) and bounded for verify (the R2 key is server-resolved from a firm-scoped `fileId`, never client-supplied; the firm-scoped data-access layer guarantees no cross-firm read).
- **Size cap** on the standalone body and on inline verify (§2), enforced before processing; oversize returns a clean refusal (and, for verify, the deferred async-job path).
- **Redaction by default** (golden rule 4): file contents are **never** logged or persisted; digests and byte sizes are non-privileged and may appear in the `audit_log` row and the receipt, but no file content or path does. Errors correlate by ID only.
- **No new persistence surface** beyond the existing `audit_log` row — the tool writes one append-only audit event and nothing else; the standalone surface writes nothing.

## 7. Testing

- **TS core:** golden vectors — known files → known `MD5`/`SHA-1`/`SHA-256`/`SHA-384`/`SHA-512` digests (including the empty-input and a multi-chunk streamed input) — asserting the single-pass fan-out matches each algorithm's reference value and the byte count is exact.
- **Baseline comparison:** `match` (recompute equals stored), `mismatch` (mutated bytes → differ), and `no-baseline` (null `content_sha256`) each produce the right `VerifyResult`.
- **Receipt:** `buildReceipt` produces stable, fully-populated structured + text output for both the standalone and verify shapes; the verify receipt carries the `audit_log` correlation id.
- **Worker routes:** Vitest worker pool (real bindings) for `hash` and `verify` happy paths + permission gating; the verify path asserts the `audit_log` row is written with the expected `event`/`metadata` and that a tampered R2 object yields `mismatch`.
- **Security:** oversize body/verify returns a clean refusal; metadata-redaction guard accepts the digest metadata and would reject any attempt to log file content.

## 8. Out of scope / future seams

- **Matter-action consumer** — "verify in place" / "attach an integrity receipt" during production/discovery, consuming the same core against R2 bytes (no re-upload); flips this tool's `matterContext` seam to `optional`.
- **Async large-file verify** — a Queue consumer (the ingest/scan precedent) that streams from R2 and records the result, for files over the inline cap. Built only when measurement shows the cap is too limiting.
- **Client-side standalone hashing** — Web Crypto in the browser for the SHA family (instant, no upload, private); MD5 would need a small JS/WASM implementation. A UI optimization behind the same widget, deferred until demand justifies it.
- **Signed receipts** — sign the `ReceiptPayload` with a server key so a third party can verify the receipt's authenticity later; adds key-management scope, deferred.
- **PDF receipt** — a printable/attestable PDF rendering of the receipt, deferred until the in-house PDF engine lands (the `.txt`/`.json` receipt serves until then).
- **Additional algorithms** — SHA-3 / BLAKE families are not exposed by `DigestStream` today; if real demand appears, they would require a WASM hasher behind the same `hashAll` seam.
