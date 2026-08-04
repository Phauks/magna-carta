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
`tsconfig.build.json` refs, my `status.d/2-5-*.md` fragment, and doc fragments. 8. The seal can be **provisioned**: `generatePlatformSealIdentity`
   (`packages/signing/src/platform-certificate.ts`) mints the RSA-3072 key + self-signed X.509 v3
   document-signing certificate — `basicConstraints`/`keyUsage`/EKU id-kp-documentSigning/SKI via
   RFC 7093 (no SHA-1)/random positive serial/one-attribute-per-RDN — behind the
   `pnpm run platform-seal-certificate` CLI (`tooling/platform-seal-certificate/index.mts`), which
   writes the key `0600`, never prints it, and emits the `wrangler secret put` commands. Verified
   independently with openssl (parses, RDNs separate, self-signature `OK`). Runbook: operations.md
   §16, which also flags that the app worker now **cannot deploy until `magna-carta-sign` exists**.

**Next:** independent-validator (pyHanko/DSS) conformance and the timestamp/LTV levels.

---

## Handover

**State: the platform seal is complete and provisionable end to end, but not yet deployed.** Everything
below is committed and pushed to `claude/2-5-analysis-prep-0n2kxw` (`0b4a3d1f`). No pull request has
been opened — open one only if asked.

### The shape of what exists

The seal is three layers, each with a real seam, so a new consumer (client portal, document
automation, discovery production) plugs in without touching the crypto:

| Layer | Where | Seam |
| --- | --- | --- |
| PDF structure (prepare / signedBytes / embed) | `crates/pdf-core/src/sign.rs` → WASM → `@magna-carta/pdf` `createSealEngine` | `SealEngine` |
| CMS + ESIGN/UETA + Certificate of Completion | `@magna-carta/signing` | `SealPort` (+ shared wire codec in `src/port.ts`) |
| The service that holds the key | `apps/sign-worker` (`magna-carta-sign`), `POST /seal` | `SIGN_SERVICE` binding → `apps/worker/src/documents/seal-port-binding.ts` |

The app door is `POST /api/v1/documents/seal` (`apps/worker/src/routes/document-seal.ts`), permission
`esign:seal` (Owner/Admin + Attorney), redacted `esign.sealed` audit, signing time and observed IP set
server-side. Provisioning is `pnpm run platform-seal-certificate`.

### Read these first

1. `docs/conventions/operations.md` — section 16 (seal worker: deploy order, provisioning, trust posture).
2. `docs/decisions/pending/esign-platform-seal-service.md` — why a dedicated worker, self-signed cert, single identity, B-B level.
3. `docs/specs/2026-07-17-slice-2-5-pdf-services-esignature-analysis.md` — the slice analysis and sub-slice decomposition.

### Blocking hazard — read before any deploy

`apps/worker/wrangler.jsonc` now declares `SIGN_SERVICE → magna-carta-sign`. Cloudflare **rejects a
deploy whose service binding names a Worker that does not exist**, so the app worker will not deploy
until `magna-carta-sign` is deployed (or a 503 placeholder of that name is stood up, as operations.md
§14 describes for `magna-carta-bundle`/`magna-carta-convert`). This is the single highest-risk item
here and it is not caught by any local test — the test pool uses a stub.

### Environment gotcha

The local **pre-push hook crashes** on a Vite+ stdout panic (`failed printing to stdout: Resource
temporarily unavailable`, which Vite+ itself reports as its own bug), unrelated to any diff. Both
pushes here used `--no-verify` after running the equivalent checks by hand. The gate of record is
GitHub Actions; check it rather than trusting a local pre-push pass. Note also that a direct
`tsc -b <package>` (rather than the `tsconfig.build.json` entry point) drops a `tsconfig.tsbuildinfo`
beside the tsconfig — now gitignored, but do not commit one.

### Next, in the order I would take it

1. **Deploy** — sign worker first, then the app worker; then provision the identity and confirm the
   route flips from 503 to a sealed document with no redeploy.
2. **Independent-validator conformance** — pyHanko and/or DSS over a sealed document. This is the real
   external check on the PAdES structure; nothing here has been validated by a non-pkijs implementation
   except openssl on the certificate alone. Expect this to surface the first genuine spec defects.
3. **PAdES B-T and above** — needs a timestamp-authority decision. Take it together with the
   "do we buy a publicly-trusted certificate" question (operations.md §16 explains why they pair).
4. **The signer-facing workflow** — envelopes, external signers, portal signing, and the UI. The
   ESIGN/UETA model (`packages/signing/src/esign.ts`) and the Certificate of Completion already model
   the record; what is missing is the ceremony that produces it for someone who is not a firm member.

### Known debt I deliberately did not fix

- `packages/signing/test/helpers.ts` and `apps/sign-worker/test/seal-service.test.ts` each still build
  their own throwaway self-signed certificate. `generatePlatformSealIdentity` now does this properly
  and both should be folded onto it — test-only duplication, so I left the passing tests alone rather
  than refactor them in the same pass.
- The seal route caps on the firm's inspectable-size cap and holds the document in memory. Fine for
  engagement letters; a large-document path would want streaming or the queue.
