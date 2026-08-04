---
category: Added
---

**The platform seal has a home: the dedicated `sign-worker`.** A new internal Worker
(`magna-carta-sign`) applies the PAdES seal — the pure-Rust PDF engine (prepare/embed) and the pkijs
CMS run in-process, and it holds the platform signing key (`PLATFORM_SEAL_KEY` / `PLATFORM_SEAL_CERT`
Worker secrets) so the key lives in exactly one minimal-surface worker. Its only surface is
`POST /seal`, reached over a service binding, returning the `SealPort` wire shape (sealed PDF +
document hash + Certificate of Completion). Activation is deferred: the worker deploys without the
secrets and returns `503 seal-not-configured` until an operator sets them, then seals — no redeploy.
Proven in the real Worker runtime: pool-workers (workerd) tests seal a real PDF and verify the embedded
CMS end to end (the first WASM-only dedicated worker here), and the worker bundles to ~2.6 MB gzip,
well under the Workers limit.
