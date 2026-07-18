---
category: Added
---

**`@magna-carta/signing` — the e-signature product layer, first increment.** A new package that owns the
PAdES seal's CMS and the ESIGN/UETA model, sitting above the pure-Rust PDF engine (which owns the
signature structure). It ships: the detached CMS/PKCS#7 builder and verifier over WebCrypto
(`buildDetachedCms`/`verifyDetachedCms`) — the firm key stays a non-extractable `CryptoKey`, only ever
signing the CMS digest; the `SealEngine` port mirroring the engine's `prepare`/`signedBytes`/`embed`, so
the seal orchestration is testable without the WASM binding; `sealDocument`, which threads prepare →
sign-host-side → embed into one call and reports the document hash for the Certificate of Completion;
and the ESIGN/UETA model — the four elements (intent, consent, association, attribution), the attribution
assurance ladder (`attributionMeets`), and the Certificate-of-Completion shape. Verified in node and on
the Workers runtime (workerd). Deferred: the real `@magna-carta/pdf` WASM adapter for `SealEngine`, ESS
signing-certificate-v2, platform-certificate provisioning, RFC 3161 timestamping / long-term validation,
and independent-validator (pyHanko/DSS) conformance.
