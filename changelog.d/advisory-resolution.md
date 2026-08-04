---
category: Security
---

**The uuid advisory is fixed rather than accepted.** `GHSA-w5hq-g745-h8pq` (missing buffer bounds
checks in uuid's `v3`/`v5`/`v6` when the caller supplies an output buffer) reached the tree only
through the API-contract tooling — `@stoplight/prism-cli` and `@stoplight/spectral-cli` pull
`postman-collection`, which hard-pins uuid 8.3.2 through its newest release, so no carrier bump
cleared it. A `pnpm-workspace.yaml` override now forces uuid 11.1.1, the newest release that still
ships a CommonJS entry point (uuid 12+ is ESM-only, and `postman-collection` does
`require('uuid').v4()`). Its accepted-advisory entry is gone from `osv-scanner.toml` rather than
carried to a later date.

**Password-protected Office uploads no longer scale an attacker's cost.** `office-crypto` parses the
agile `EncryptionInfo` descriptor with quick-xml, and every quick-xml before 0.41 scans a start tag's
attributes for duplicate names in quadratic time (`RUSTSEC-2026-0194`) — so a crafted upload with one
enormous start tag could pin a CPU core for minutes. `office-crypto` 0.3, its newest release, still
requires `quick-xml ^0.38`, so the fixed parser cannot be resolved. `crates/decryption-core` now caps
the descriptor at 64 KiB before `office-crypto` sees the bytes, which bounds the scan to well under a
second and stops the cost scaling with the uploaded file — the same defensive-perimeter pattern as the
existing `EncryptedPackage` size-prefix guard.

**The remaining quick-xml acceptances say what was checked.** Both quick-xml entries in
`osv-scanner.toml` were re-checked before their 2026-10-14 lapse and extended to 2027-02-14 with the
reachability analysis written into the file: `RUSTSEC-2026-0194` is reachable but now bounded, and
`RUSTSEC-2026-0195` is not reachable at all — it affects only quick-xml's `NsReader`, and
`office-crypto` builds a plain `Reader` that never resolves namespaces.

**The operations runbook stopped duplicating the advisory list.** Its dependency-audit section still
described the retired `pnpm audit` gate and restated two accepted advisories, one of which GitHub had
withdrawn. It now points at `osv-scanner.toml` as the single home and records the working rules for
adding, extending, and pruning entries.

**PDF handling picks up upstream decompression-bomb guards.** lopdf moved 0.42 to 0.44 across all six
lockfiles, adding bounded stream decompression, a `LoadOptions.max_decompressed_size` limit for
load-time object and cross-reference streams, and a fix that rejects incremental saves of encrypted
documents. `Document::get_page_content` is infallible in 0.44, so its five call sites in
`crates/pdf-core` dropped their `Result` handling.
