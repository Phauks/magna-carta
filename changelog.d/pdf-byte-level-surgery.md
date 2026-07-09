---
category: Added
---

Text-preserving redaction now handles pages whose content stream cannot be
faithfully re-encoded (inline images and other constructs the PDF library
cannot round-trip). Instead of flattening the whole page to a raster, the engine
copies the original stream bytes verbatim and re-encodes only the operators it
edits, so unrepresentable content passes through byte-identical while the marked
text is removed. The existing redaction path is unchanged for pages it already
handled; the new path is reached only where the page would otherwise have been
flattened, and every result still passes the outcome gate.
