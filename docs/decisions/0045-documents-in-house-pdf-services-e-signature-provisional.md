---
number: 45
slug: documents-in-house-pdf-services-e-signature-provisional
status: Proposed
date:
area: Documents
---

**In-house PDF services + e-signature (provisional).** A unified **PDF service** (fill/draw/stamp/merge/split/rotate/flatten/secure/redact/Bates/seal-sign), **client-side by default** (privileged bytes never leave the device; the server touches a PDF only for the platform seal, no-client automated generation, server-only engines like DOCX↔PDF, and web batch/ingest). Composed from permissively-licensed engines — **@cantoo/pdf-lib, PDFium, qpdf, @signpdf** — behind a registry, _not_ a bundle. **In-house e-signature** built on it: the **ESIGN/UETA** electronic-signature model (intent / consent / association / attribution — **not** per-signer PKI), a **PAdES platform seal** + server-observed **audit trail** + **Certificate of Completion**, attribution as a configurable spectrum (client-portal signers strongest); a **port seam** is kept for the PKI/notarial long tail. E-signature is now a **Documents** capability — the _Payments_ section points here, resolving the earlier overlap. Rejected as primary: **Stirling-PDF** (redundant JVM runtime), **Documenso/DocuSeal** (AGPLv3 + stateful, break the Workers/D1/R2 isolation model). **Deferred:** true content-level redaction (AGPL engines — carried to Phase-4 discovery). **Status Proposed** — the area is explicitly a first design pass; every library license/maintenance, the Worker-signing constraint, the ESIGN/UETA specifics, the Certificate-of-Completion scheme, and all cross-references **must be independently verified before build**. Extends ADR-0011 (PDF form-filling) and reuses the ADR-0030 engine-composition approach.
