---
category: Security
---

**The `office-crypto` dependency is gone; `decryption-core` decrypts Office documents itself.**
`crates/decryption-core` already owned the ECMA-376 agile verifier, the iterative password hash,
block-key derivation, its own descriptor parser, and the compound-file validation. The only thing
`office-crypto` still did was the package decryption loop, which is now implemented in-house:
MS-OFFCRYPTO agile encryption's 4096-byte segments, each an independent AES-CBC chain under an
initialization vector derived from the `keyData` salt and the segment index, plus the session-key
unwrap that precedes them. ECMA-376 **standard** encryption (Office 2007 — AES-ECB under a
SHA-1-derived key) is ported alongside it, so no document that opened before stops opening; its
legacy RC4 CryptoAPI variant is refused by name, exactly as it was before.

**This removes both quick-xml advisories from the tree rather than accepting them for another
review cycle.** `office-crypto` was quick-xml's only consumer in every audited lockfile, and no
`office-crypto` release resolves the fixed quick-xml 0.41, so replacing it was the only remediation
that existed — the exit the accepted-advisory entries themselves named. `RUSTSEC-2026-0194` and
`RUSTSEC-2026-0195` leave `osv-scanner.toml`, which now holds no accepted Rust advisory at all.
Sixteen crates leave the dependency graph (`office-crypto`, `quick-xml`, `base64`, `bytemuck`,
`derivative`, `ecb`, `packed_struct` and its codegen, `bitvec` and friends, `serde`, `syn` 1.x);
none are added — the in-house loop is built on the RustCrypto primitives already in the workspace.

**Three panic paths on untrusted input close with it.** `office-crypto` computed
`total_size - 4096` as unsigned arithmetic with no bounds check, unwrapped its XML reader outright
on a malformed descriptor, and read `spinCount` from an uploaded document with no cap — so a
crafted file could crash the process or pin a core for hours. The in-house path is checked
throughout: the size prefix is read as the 64-bit quantity it is and converted rather than cast (a
32-bit concern on the wasm32 target), a prefix promising more plaintext than there is ciphertext is
refused before a segment is decrypted, and the spin-count cap that guarded hash extraction now
guards decryption too. Every guard that already existed is kept.

**A wrong password is now refused by the ECMA-376 verifier rather than inferred.** Both schemes
carry a password verifier and both are checked before any package byte is decrypted, so a wrong
password costs one key derivation instead of a full decryption, and a genuinely corrupt document is
reported as malformed rather than as a bad password.
