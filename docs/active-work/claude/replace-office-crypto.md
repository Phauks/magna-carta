---
branch: claude/replace-office-crypto
worktree: .claude/worktrees/agent-ae99d5fdbc696f1d4
area: Replace the office-crypto dependency with an in-house MS-OFFCRYPTO package decryption loop in decryption-core
status: review
touches: crates/decryption-core, crates/Cargo.lock, containers/recovery/Cargo.lock, osv-scanner.toml, changelog.d/, docs/decisions/pending/
---

Implements the MS-OFFCRYPTO package decryption loop (agile 4096-byte segments plus the ECMA-376
standard AES-ECB scheme) inside `crates/decryption-core/src/ooxml.rs` and drops `office-crypto`
entirely, which takes `quick-xml` out of every lockfile and retires `RUSTSEC-2026-0194` and
`RUSTSEC-2026-0195` from `osv-scanner.toml`. No dependency is added.

Nothing outside `crates/decryption-core` changes in source terms: the crate's public API and the
WASM export surface are identical, so `packages/decryption`, `apps/worker`, and
`containers/recovery` are only rebuilt, not edited. The two touched lockfiles are regenerated, not
hand-edited. `osv-scanner.toml` is the one shared file this stream edits — a concurrent stream
adding an accepted advisory should expect to merge against the removal of the two quick-xml entries.
