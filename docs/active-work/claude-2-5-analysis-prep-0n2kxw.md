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

5. The seal is wired **end to end**: `pdf-core` `wasm.rs` exposes `prepareSignature`/`signedBytesForSeal`/
   `embedSignature`; `@magna-carta/pdf` wraps them + `createSealEngine` (the real `SealEngine`); an
   e2e test (`packages/pdf/test/seal-e2e.test.ts`, node + real WASM) runs prepare→sign(pkijs)→embed and
   verifies the sealed PDF, which also re-parses through hayro; tamper fails. Dev image: `wasm-pack`
   installed + `vp run bootstrap` builds the git-ignored WASM (a durable SessionStart hook follows).

6. The seal has a **home**: the dedicated **`sign-worker`** (`apps/sign-worker`, `magna-carta-sign`) runs
   the engine (WASM) + CMS (pkijs) in-process and holds the platform signing key
   (`PLATFORM_SEAL_KEY`/`PLATFORM_SEAL_CERT` Worker secrets), exposing only `POST /seal` over the shared
   `SealPort` wire codec (`packages/signing/src/port.ts`). Proven on workerd (pool-workers): seals a real
   PDF and verifies the embedded CMS; deploys without the secrets and `503`s until set. Decision in
   `docs/decisions/pending/esign-platform-seal-service.md`.

7. The seal has a **door**: **`POST /api/v1/documents/seal`** in the app worker
   (`apps/worker/src/routes/document-seal.ts`) — chokepoint + new `esign:seal` permission (seeded to
   Owner/Admin + Attorney), forwarding to the sign worker via `resolveSealPort` over `SIGN_SERVICE`
   (`apps/worker/src/documents/seal-port-binding.ts`, an injectable port). Server-set signing-time +
   observed-IP; redacted `esign.sealed` audit; `503` deferred activation. Route test covers the sealed
   shape (injected fake port), 401/403, and the not-configured `503`; conformance + byte-exact OpenAPI
   snapshot + regenerated client all green.

Touches `crates/pdf-core/src/{sign.rs,lib.rs,wasm.rs}`, `packages/signing/**`, `packages/pdf/src/index.ts`
+ `packages/pdf/test/seal-e2e.test.ts` + `packages/pdf/package.json`, `apps/sign-worker/**`,
`apps/worker/src/{app.ts,routes/document-seal.ts,documents/seal-port-binding.ts,per-firm-migrations.ts}`
+ `apps/worker/{wrangler.jsonc,vitest.config.ts,test/conformance.test.ts,test/document-seal-route.test.ts,openapi/openapi.json}`
+ `apps/worker/package.json`, `packages/access-control/src/registry.ts`, the new per-firm seed migration
+ journal, `packages/api-client/**` (regenerated), the pnpm catalog + lockfile, generated
`tsconfig.build.json` refs, my `status.d/2-5-*.md` fragment, and doc fragments. **Next:** platform-cert
provisioning, then independent-validator (pyHanko/DSS) conformance and the timestamp/LTV levels.
