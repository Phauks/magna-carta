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

The pure-Rust PDF **engine** substrate is built (see _PDF render engine_, cross-cutting). E-signature core substantially built (Opus 4.8), end to end and proven: the PAdES **seal primitive** in `pdf-core` (prefix-preserving incremental update + exact `/ByteRange` + reserved `/Contents` + CMS splice) with **WASM bindings** and the real `@magna-carta/pdf` `createSealEngine` adapter; the **CMS backend** (`@magna-carta/signing`, pkijs/WebCrypto, key host-side) now at **PAdES-B-B baseline** with ESS **signing-certificate-v2**; the `SealEngine` port + `sealDocument` orchestrator; the ESIGN/UETA model + **Certificate of Completion** (assemble + render). An **e2e test** drives a real PDF prepare→sign→embed and verifies the seal (node + workerd). Remaining: platform-cert provisioning + the worker seal route (engine-placement decision: in-process vs a dedicated sign-worker), timestamp/LTV levels (B-T/B-LT/B-LTA), independent-validator (pyHanko/DSS) conformance, and the consumer/UI surfaces.
