---
branch: claude/advisory-resolution
worktree: C:/dev/magna-carta-worktrees/claude-advisory-resolution
area: Resolve the three advisory ignores that lapse 2026-10-14, before the security gate fails on them
status: review
touches: osv-scanner.toml, pnpm-workspace.yaml, pnpm-lock.yaml, crates/decryption-core/src/ooxml.rs, crates/pdf-core/src/, crates/Cargo.toml, crates/Cargo.lock, containers/*/Cargo.lock, docs/conventions/operations.md, changelog.d/
---

Clears the accepted-advisory debt whose `ignoreUntil` lapses on 2026-10-14, by the best mechanism
available for each rather than by moving the date and saying nothing.

`GHSA-w5hq-g745-h8pq` (uuid) is **fixed**: a `pnpm-workspace.yaml` override forces uuid 11.1.1 onto
`postman-collection`, the only carrier, and the entry is deleted from `osv-scanner.toml`. 11.1.1 is the
ceiling — uuid 12+ is ESM-only and `postman-collection` requires the CommonJS entry point.

`RUSTSEC-2026-0194` and `RUSTSEC-2026-0195` (quick-xml) are **extended to 2027-02-14 with written
justification**, because no reachable fix exists: `office-crypto` 0.3, its newest release, still
requires `quick-xml ^0.38`, and a `[patch.crates-io]` entry cannot satisfy that requirement with 0.41
without vendoring a version-falsified fork of the parser. `-0195` is not reachable here at all
(`NsReader` only; `office-crypto` builds a plain `Reader`). `-0194` is reachable, so
`crates/decryption-core` now caps the `EncryptionInfo` descriptor at 64 KiB before `office-crypto`
parses it, bounding the quadratic scan. Replacing `office-crypto` outright is the real exit and is
named in the file as the next review's target — `decryption-core` already owns the agile verifier and
its own descriptor parser, so the remaining gap is the package decryption loop.

`GHSA-gv7w-rqvm-qjhr` needed no pruning: it had already left `osv-scanner.toml`, and a full
osv-scanner run over all nine lockfiles confirms it is not among the unused ignores. The stale copy of
it in the operations runbook is removed, and that section now points at `osv-scanner.toml` as the
single home instead of restating entries.

Rides along with lopdf 0.42 → 0.44 across all six Cargo lockfiles, taken for its bounded stream
decompression and `LoadOptions.max_decompressed_size` guards. The only breaking change touching this
codebase is `Document::get_page_content` becoming infallible (five call sites in `crates/pdf-core`).

Adopting lopdf's `get_page_content_with_limit` / `extract_text_with_limit` on the untrusted-PDF paths
is deliberately **not** in this stream — it needs a chosen limit and error handling per call site, and
belongs in its own slice. The defaults are unchanged (`max_decompressed_size` defaults to no limit), so
nothing regressed by leaving it.
