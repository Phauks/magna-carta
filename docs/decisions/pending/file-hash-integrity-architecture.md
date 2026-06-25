---
slug: file-hash-integrity-architecture
status: Accepted
area: Tools / File Manager
date: 2026-06-25
summary: The File Hash & Integrity tool is built as a pure streaming multi-digest core (one read → five digests) with server-side computation on every surface, verification against the ingest SHA-256 baseline recorded to audit_log, and a new "file" context tag — with async large-file verify, client-side standalone hashing, and signed/PDF receipts deferred as measured-trigger seams.
---

**File Hash & Integrity tool architecture.** The tool computes cryptographic digests and verifies file integrity. The key architectural choices:

**(1) Pure streaming multi-digest core — one read, five digests.** The `hashAll` function in `@magna-carta/file-integrity` fans every chunk from one `ReadableStream<Uint8Array>` into one `DigestSink` per algorithm simultaneously. A single pass over the bytes produces MD5, SHA-1, SHA-256, SHA-384, and SHA-512 together. Buffering nothing beyond the current chunk means memory cost is O(chunk) not O(file). The digest backend is injected (`CreateDigestSink`) so the package is pure and node-testable; the Worker backs it with `crypto.DigestStream` and the tests back it with `node:crypto`.

**(2) Server-side compute on every surface.** Hashing runs in the Cloudflare Worker on every call — for the `hash` route over the streamed request body, and for the `verify` route over the bytes read from R2. Server-side computation is necessary for forensic attestability: the server observes the bytes and signs the result with a chain-of-custody audit row, so the digest is not merely what the client claims. MD5 and SHA-1 are retained for eDiscovery and legacy interoperability (load files and opposing-party tooling still specify them) and are explicitly labelled legacy-interop, not security-grade, in the metadata and receipt.

**(3) Verification against the ingest baseline, recorded to audit_log.** The `verify` route reads the file's current clean version from D1 via `readCurrentVersionForIntegrityBaseline` in `@magna-carta/file-manager`, re-fetches the bytes from R2, computes all five digests, and compares the computed SHA-256 against the `content_sha256` stored at ingest. The outcome (`match` / `mismatch` / `no-baseline`) is written as a `file.integrityVerified` audit row and returned with the full digest set and a downloadable hash receipt. This makes every verification a permanent chain-of-custody record — the same model used throughout the audit subsystem.

**(4) New "file" context tag.** The `file` context tag is added to `@magna-carta/tools`, making the File Hash & Integrity tool the first per-file contextual action — a tool surface that appears in the context of a specific file, not just in the Tools sidebar. This establishes the pattern for future per-file tools.

**Deferred seams (measured-trigger, not built).**

- **Async large-file verify via Container.** The verify route streams bytes through the Worker for files under the Worker's request-body size cap. For files above that cap, a Container-backed async verify path is the named seam — built when large-file verification is measured to be needed.
- **Client-side standalone hashing.** A client-side WASM or WebCrypto path for hashing a local file before upload — a pure UX improvement that does not replace server-side attestation. Deferred until the UI shell (slice 0·7a) provides the surface to build on.
- **Signed/PDF receipts.** The receipt is currently a plain-text attestation block. A cryptographically signed receipt (using the slice 1·2 signing seam) or a PDF receipt (using the PDF engine) are named future evolutions, deferred to when downstream consumers (Discovery production, e-signature) make them necessary.

**Considered and rejected.** Client-only hashing without server attestation — rejected because it cannot produce a chain-of-custody record (the server cannot attest to bytes it did not observe). Storing each digest in D1 as a permanent record — rejected because the ingest-baseline SHA-256 already exists on `file_version.content_sha256`; duplicating it into a separate integrity table adds a sync surface with no benefit. Per-algorithm parallelism — rejected in favour of the fan-into-one-read pattern; the chunk fan-out achieves all five digests in one I/O pass, which is the bottleneck.

**Consequences.** Every file integrity verification is a permanent audit-log entry — the system knows who verified what, when, and what the outcome was, without storing the file's content or name in the log. The pure `@magna-carta/file-integrity` package is independently testable in the node pool and re-usable by any future consumer (Discovery production Bates-and-hash, the file export pipeline). The `file` context tag establishes a new class of contextual Tools actions that surface alongside a specific file in the UI.
