---
branch: claude/2-5-analysis-prep-0n2kxw
worktree: (web session)
area: Slice 2·5 (PDF services + e-signature core) — analysis + seal-primitive spike
status: building
touches: docs/specs/2026-07-17-slice-2-5-pdf-services-esignature-analysis.md, crates/pdf-core/src/sign.rs, crates/pdf-core/src/lib.rs
---

Slice 2·5's open half — the **e-signature core** (PAdES seal + ESIGN/UETA workflow + audit
trail + Certificate of Completion + verification). The PDF-services half is already built as the
cross-cutting `pdf-core` engine; the e-sign layer was unstarted.

Two things landed here:

1. `docs/specs/2026-07-17-slice-2-5-...-analysis.md` — the pre-design analysis (state, the
   EmbedPDF→pure-Rust supersession, the code-grounded gaps, sub-slice decomposition).
2. `crates/pdf-core/src/sign.rs` — **sub-slice 1, the seal primitive** (feasibility spike): a
   prefix-preserving PDF incremental-update writer that appends the PAdES signature dict +
   AcroForm + invisible widget, writes an exact `/ByteRange`, reserves a zero-filled
   `/Contents`, and splices a caller-supplied CMS in without disturbing a signed byte. Pure
   structure — **no crypto** (host-side, sub-slice 2). Classic xref only; xref-stream originals
   are refused (`SignError::XrefStream`), a documented follow-up.

3. The CMS/crypto backend for the seal is settled after a library survey: **pkijs over WebCrypto in
   the Worker** (key a non-extractable `CryptoKey`, host-side), with the Rust engine taking the CMS as
   an opaque blob. Proven end to end by a workerd test (`apps/worker/test/signing-cms-backend.test.ts`):
   detached CMS with signed attributes verifies and rejects a tampered range. Decision recorded in
   `docs/decisions/pending/pades-cms-backend-pkijs-webcrypto.md`.

4. `@magna-carta/signing` scaffolded (first increment): the detached CMS builder/verifier
   (`buildDetachedCms`/`verifyDetachedCms`, WebCrypto), the `SealEngine` port mirroring the Rust
   `prepare`/`signedBytes`/`embed`, the `sealDocument` orchestrator, and the ESIGN/UETA model
   (intent/consent/association/attribution + Certificate-of-Completion shape). Tested in node (7) and
   on workerd (1). The worker's CMS test now imports the package (single-sourced).

Touches `crates/pdf-core/src/{sign.rs,lib.rs}`, `packages/signing/**`, `apps/worker/test/signing-cms-backend.test.ts`
+ `apps/worker/package.json`, the pnpm catalog + lockfile (pkijs/asn1js), my `status.d/2-5-*.md`
fragment, and doc fragments — no other shared rendered-file edits. **Next:** the real
`@magna-carta/pdf` WASM adapter for `SealEngine` (needs the wasm bindings in `pdf-core` `wasm.rs`),
ESS signing-cert-v2 + platform-cert provisioning, then independent-validator (pyHanko/DSS) conformance.
