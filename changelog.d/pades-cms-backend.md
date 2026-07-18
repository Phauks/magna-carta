---
category: Added
---

**The PAdES seal's signing backend is settled and proven: pkijs over WebCrypto, in the Worker.** The
detached CMS/PKCS#7 that fills the seal primitive's reserved `/Contents` is built in TypeScript with
pkijs, running on the Cloudflare Workers WebCrypto runtime, with the firm's signing key held as a
non-extractable `CryptoKey` — the key does only a raw signature over the CMS digest and never leaves the
host or becomes extractable. The pure-Rust `pdf-core` engine keeps owning the PDF structure and takes
the CMS as an opaque blob, so no cryptography enters the engine. A workerd test proves the path end to
end: a detached CMS with signed attributes (contentType, messageDigest, signingTime) over an external
byte range verifies, and a tampered range is rejected. Chosen over a Rust CMS crate in the engine (no
first-class host-side-key signer) and over `@signpdf` (basic level, no native long-term-validation path);
pkijs also carries the timestamp/revocation primitives the later PAdES levels need. Independent-validator
(pyHanko/DSS) conformance and the `@magna-carta/signing` product layer follow.
