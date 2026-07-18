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

The pure-Rust PDF **engine** substrate is built (see _PDF render engine_, cross-cutting). E-signature core now underway (Opus 4.8): the PAdES **seal primitive** landed in `pdf-core` (prefix-preserving incremental update + exact `/ByteRange` + reserved `/Contents` + CMS splice), the **CMS backend** is settled and proven on workerd (pkijs/WebCrypto, key host-side), and `@magna-carta/signing` holds the CMS builder + `SealEngine` port + `sealDocument` + ESIGN/UETA model. Remaining: the real `@magna-carta/pdf` WASM adapter, ESS signing-cert-v2, platform-cert provisioning, timestamp/LTV levels, independent-validator (pyHanko/DSS) conformance, and the consumer/UI surfaces.
