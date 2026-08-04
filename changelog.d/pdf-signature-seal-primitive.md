---
category: Added
---

**PDF signing gains its structural foundation — the PAdES seal primitive.** The pure-Rust PDF
engine can now prepare a document for signing without disturbing a byte of it: `prepare_signature`
appends a PAdES signature dictionary, an AcroForm, and an invisible signature widget as a true
incremental update, so the original file survives verbatim as the literal prefix of the output —
the property every signature depends on and that the additive Bates/searchable writers (which
re-serialize) deliberately do not provide. It writes an exact `/ByteRange` covering the whole file
except the reserved `/Contents`, exposes the bytes a signer must digest (`signed_bytes`), and splices
a caller-supplied detached CMS into the reservation (`embed_signature`) without moving a signed byte —
so embedding the signature can never invalidate the digest it signs. Multiple signatures chain, each
preserving the prior signed revision. The cryptography stays the caller's, host-side, by design: no
private key enters the engine. Classic and cross-reference-stream base documents are both handled (the
update always appends a classic table chained via `/Prev`). This is the engine half of first-party
e-signature; the CMS builder, platform certificate, and the ESIGN/UETA product layer follow.
