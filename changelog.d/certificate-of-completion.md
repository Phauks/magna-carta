---
category: Added
---

**The Certificate of Completion is assembled and rendered.** `@magna-carta/signing` gains the ESIGN/UETA
defensibility artifact that travels with a sealed document: `assembleCertificateOfCompletion` builds it
from the sealed document's SHA-256, the seal time, and the server-observed signer records — refusing to
emit an incomplete record (no signers, a non-SHA-256 hash, or a missing seal time) — and
`renderCertificateOfCompletion` produces a stable, deterministic plain-text record naming each signer's
attribution, adopted signature, affirmed intent, and consent to transact electronically. Pure and
reproducible; the signing workflow that captures the acts feeds it, the way the seal engine feeds
`sealDocument`.
