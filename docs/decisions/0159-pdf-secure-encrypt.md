---
number: 159
slug: pdf-secure-encrypt
status: Accepted
date: 2026-06-26
area: Documents
summary: Compose lopdf's Standard Security Handler for PDF unlock/protect; read every revision but write AES-256 only; treat permission bits as advisory.
---

The pure-Rust PDF engine gains password security — inspect, unlock, and protect — to
complete the forms/secure slice of the engine roadmap.

**Compose, don't build.** `lopdf` 0.41 already implements the full Standard Security
Handler bidirectionally — RC4 (R2/R3), AES-128 (V4/`AESV2`), and AES-256 (V5/R6/`AESV3`,
PDF 2.0). Verifying that up front (the published-crate-first rule) turned the roadmap's
assumed "build the missing modes" into an integration-and-policy slice. No cipher code is
hand-rolled; the crypto crates (`aes`, `cbc`, `sha2`, `md-5`) arrive transitively through
lopdf, and `getrandom` is added as a direct dependency to draw the AES-256 file key from
the OS RNG — all pure Rust, so no C dependency and no new licensing commitment.

**Read broadly, write strictly.** `decrypt` opens any of the three ciphers given a known
password. `secure` writes **AES-256 by default and never RC4**; an AES-128 path exists for
older readers but is opt-in and not surfaced in the product. This honors the firm's
AES-256 posture (ADR-0026 envelope key management) and the agility-first stance (ADR-0046).

**Decrypt is a byte-to-byte transform.** lopdf decrypts the object model; `hayro` renders
from its own parse. Rather than coordinate keys between the two parsers, `decrypt` produces
plaintext bytes that *any* downstream module (render, redact, scrub, detect, forms) reads
with no password — unblocking the whole engine on protected inputs.

**Permission bits are advisory, and we say so.** PDF permission flags are enforced only by
cooperating viewers and can be stripped by anything that opens the document; the only real
confidentiality control is the open password plus the cipher. The engine and (later) the UI
state this plainly — overselling permissions as protection would be a malpractice trap in a
legal product. We surface them because clients and courts ask for them, not because they
protect anything.

**Client-side by default.** The capability ships as WASM in `packages/pdf`, so the password
and document bytes never leave the caller's process. A wrong password is a distinct, typed
signal (so a UI can re-prompt) and a password never appears in any error or log.

**Scope.** Unlock works with a *known* password only — password recovery and cracking are a
separate tool's job. Public-key (certificate) handlers are detected and reported, not
implemented. Digital signatures (PAdES) are the next engine slice, for which decrypt is a
prerequisite (a signed input may be encrypted).

Supersedes the "encrypt/secure: build the missing modes" note in the engine-roadmap design.
The consumer surface (a "Unlock & Secure PDF" Tools tool) is deferred to the 0.7 UI cycle,
mirroring how the redaction, detector, Bates, and forms engine slices merged ahead of their
UIs.
