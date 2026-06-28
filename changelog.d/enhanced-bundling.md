---
category: Added
---

**Matter bulk downloads can now be packaged with a chosen format, compression, encryption, and
multi-volume splitting** (ADR `enhanced-bundling-formats-encryption-split`). When downloading a set of
matter files as a bundle, you can now choose the archive **format** (ZIP or 7z), a **compression** level
(store / normal / maximum), optional **AES-256 encryption** with your own password, and — for 7z —
**multi-volume splitting** into fixed-size parts. Quality-of-life options round it out: name the output,
wrap everything in a folder, flatten the folder tree, and include a CONTENTS manifest (each file's path,
size, and SHA-256). Plain ZIP downloads keep their existing fast path; the heavier formats, compression,
encryption, and splitting are produced by a dedicated archive-builder service. **Encryption passwords are
never stored** — an encrypted bundle is built and streamed to you in one pass, with the password held only
for that request, so re-downloading an encrypted bundle rebuilds it on demand.
