---
slice: 2·5 — PDF services + e-signature core
group: phase-2
order: 5
research: in-progress
spec: in-progress
plan: in-progress
built: in-progress
ui: todo
load-profile: n/a
tested: todo
branch: main
active-work:
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

The pure-Rust PDF **engine** substrate is built (see _PDF render engine_, cross-cutting). E-signature core substantially built (Opus 4.8), end to end and proven: the PAdES **seal primitive** in `pdf-core` (prefix-preserving incremental update + exact `/ByteRange` + reserved `/Contents` + CMS splice) with **WASM bindings** and the real `@magna-carta/pdf` `createSealEngine` adapter; the **CMS backend** (`@magna-carta/signing`, pkijs/WebCrypto, key host-side) now at **PAdES-B-B baseline** with ESS **signing-certificate-v2**; the `SealEngine` port + `sealDocument` orchestrator; the ESIGN/UETA model + **Certificate of Completion** (assemble + render). The seal now has a **home and a door**: the dedicated **`sign-worker`** (`magna-carta-sign`) runs the engine + CMS in-process and holds the platform signing key (proven on workerd — it seals a real PDF and verifies the embedded CMS), and the app worker exposes **`POST /api/v1/documents/seal`** (permission `esign:seal`, chokepoint, redacted `esign.sealed` audit) forwarding to it over a `SIGN_SERVICE` binding through a reusable `SealPort` adapter, with deferred-activation `503` until the signing identity is set. An **e2e test** drives a real PDF prepare→sign→embed and verifies the seal (node + workerd); the route is covered end to end (chokepoint, sealed shape, server-set signing-time/observed-IP, not-configured `503`). Remaining: platform-cert provisioning, timestamp/LTV levels (B-T/B-LT/B-LTA), independent-validator (pyHanko/DSS) conformance, and the consumer/UI surfaces.
