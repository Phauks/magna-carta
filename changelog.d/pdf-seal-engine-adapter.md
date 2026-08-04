---
category: Added
---

**The PAdES seal is wired end to end: the WASM engine drives the real seal.** `@magna-carta/pdf` now
exposes the seal primitive at its edge — `prepareSignature`, `embedSignature`, and `createSealEngine`,
which packages them (with a pure `signedBytes` slice) as the `SealEngine` that `@magna-carta/signing`'s
`sealDocument` orchestrates. So a real PDF flows prepare (WASM, prefix-preserving incremental update) →
sign the byte range host-side (WebCrypto/pkijs) → embed the CMS (WASM), and the sealed document
verifies. An end-to-end test proves it on a real document: the seal verifies, the sealed PDF still
parses through the render engine (hayro), and a tampered range fails. The cryptography stays host-side;
no key enters the engine. Remaining before a firm can rely on it: ESS signing-certificate-v2,
platform-certificate provisioning, and independent-validator (pyHanko/DSS) conformance.
