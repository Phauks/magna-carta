---
category: Added
---

**The platform seal gets a typed service contract (`SealPort`).** `@magna-carta/signing` gains the
`SealPort` interface and its shared wire codec — the reuse seam for the dedicated sealing service: a
request (document + seal metadata + signer records + signing time) in, a response (sealed PDF +
document hash + Certificate of Completion + rendered text) out, with `encode`/`decode` helpers so both
sides of the service binding serialize identically and never drift. Binary fields cross base64-encoded
in a JSON envelope (chunked base64 helpers added to the bytes util). `@magna-carta/pdf` now also exports
its compiled WASM as a subpath so a Worker can import it as a `WebAssembly.Module` (the established
email/decryption route mechanic). This is the contract the sign-worker implements and the app worker
forwards to.
