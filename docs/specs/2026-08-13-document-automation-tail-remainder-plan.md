# Document automation — the 2·6·3 remainder (implementation plan)

**Date:** 2026-08-13
**Status:** Plan. Not built.
**Parent:** [`2026-08-04-document-automation-design.md`](2026-08-04-document-automation-design.md) and
[`2026-08-04-document-automation-implementation-plan.md`](2026-08-04-document-automation-implementation-plan.md)
(slice 2·6·3, Tasks 17 to 19).
**Shipped ahead of this plan:** Task 17 (PDF output) and the backend half of Task 18 (the assembly
result states what it produced, so an assembled PDF is in the shape the platform seal accepts).

This plan carries the two pieces of the tail that were **not** built, with the reasoning for why each
was left rather than half-done. Both are additive to what shipped; neither is blocked by it.

---

## What shipped, in one paragraph, so this plan starts from the truth

`POST /api/v1/matters/{matterId}/assemblies` takes an optional `outputFormat` of `docx` or `pdf`. The
`pdf` arm calls `runConversion("docx", "pdf", mergedBytes, resolveEnginePort(env))` inside the same
job — the registry's own edge, the same per-engine-id resolver the file-converter tool executes with —
and files what comes back through the same `initiateUpload` / `completeUploadSession` chokepoint every
other byte uses. A conversion that cannot be done fails the assembly rather than filing the
word-processing package. The requested format is `document_assembly.output_format` and is answered by
the poll from the moment of submit, which is what lets a caller decide whether the produced document
can be handed to `POST /api/v1/documents/seal`.

---

## Part A — the signing surface (the rest of Task 18)

### Why it is not "the last mile of an assembly"

The plan's Task 18 reads "the assembly result carries the produced file and version handles in the
shape the sealing route already accepts, so 'assemble then send for signature' is a link rather than a
new path", and the design's fourth interface seam says the post-assembly hand-off is "a link, not a
build". Both are accurate about the **contract** and both are written as if the surface on the other
end of the link exists. It does not, and the gap is not document automation's.

What exists is the **platform seal**: a stateless `POST /api/v1/documents/seal` that takes PDF bytes
plus a list of already-completed signer records and returns sealed bytes, the sealed-range digest, and
a Certificate of Completion. It stores nothing. What does not exist anywhere on `main` is the model
that produces those signer records — the envelope, the field placement, the signer invitation, the
consent disclosure and its version, and the attribution ceremony. The slice 2·5 analysis puts all of
that in its sub-slice 3 and the 2·5 status fragment lists "the consumer/UI surfaces" as remaining.

So "send it out for signature" is a **2·5 product surface with a 2·6 entry point**, not a 2·6 feature.
Building a button here would have meant inventing a consent-disclosure version and an attribution
level on the firm's behalf — a legal artifact, guessed at, recorded in an audit row that is meant to be
the evidence if a signature is ever challenged. Not offering the button is the better failure.

### What this part is, when it is built

Sequenced against 2·5, not against 2·6. Two shapes are available and the choice belongs to that area:

**A1 — seal in place, no envelope.** The narrow one: a member with `esign:seal` applies the platform
seal to a filed PDF and the sealed bytes land as a **new version of the same document**, through the
ingest chokepoint. No invitation, no external signer, no waiting. This is a genuine capability (it
makes a completed record tamper-evident and produces the certificate) and it is small, but it needs
one thing settled first: `esign:*` binds `resource: "firm"` in the conformance suite's
`RESOURCE_BY_PERMISSION_NAMESPACE`, and a route addressed by a matter-rooted file handle wants
`resource: "matter"` on the `files:*` precedent. Either the namespace's binding widens to both, or the
capability is a `documents:*` key instead. That is a capability-subsystem decision, not a routing
detail, and it is the first thing to answer.

**A2 — the envelope.** The full 2·5 sub-slice 3: envelope and signing-session state, field placement,
signer invitation and adoption, the attribution spectrum bound to the client portal's per-share
assurance, the audit trail, and the Certificate of Completion stored as a versioned sibling of the
signed document. An assembled PDF is one input to it among several, and document automation's only
contribution is the entry point that already exists.

### What document automation owes either shape

Nothing further. The assembly result already carries the file handle, the version handle, and the
format. If A2 lands with a "start an envelope from this document" route, the assemble dialog gains a
link to it and that is the whole of the change here.

---

## Part B — fillable-PDF form templates (Task 19)

### The shape

A firm supplies a fillable PDF — its own intake form, a court form it already has — and registers it
as a template of a `pdfForm` kind. The field manifest comes from the AcroForm field set
`crates/pdf-core`'s forms engine already reads, each field bound to the same merge-field dictionary a
Word template binds, and filling goes through that same engine. Court-form **curation** is out of
scope pending owner decision F2 in the design; this is firm-supplied forms only.

### Why it was not built alongside the PDF arm

It looks adjacent and is not. The PDF arm is one call on an existing edge inside an existing job. A
form template changes the shape of a template:

- **The catalogue grows a kind.** `document_template_version` today assumes a normalized OOXML package
  and stores a normalizer version; a PDF form has no normalization pass, no run splitting, no blocks,
  and no expression sites. Every read that assumes "a template version is a `.docx`" —
  `prepareTemplateVersion`, the field-list surface, the assembly path — has to learn a discriminator.
- **The manifest is discovered, not authored.** A Word template's keys are typed by a person and the
  binding is the key. An AcroForm field carries the **form's own** field name, which is the firm's
  text and cannot be trusted to lex as a merge key — exactly the problem the Word `MERGEFIELD`
  conversion already faced, and it was answered with a per-firm confirmed-mapping library
  (`document_template_field_mapping`) rather than by guessing. A form template needs the same
  discipline: a proposed mapping per AcroForm field, confirmed by a human, stored per firm, never
  inferred from resemblance.
- **The engine is a different one.** Filling runs in `crates/pdf-core`, which is WASM in
  `@magna-carta/pdf`, not in the pure-TypeScript assembler. That is a second execution surface inside
  the assembly job and it needs its own caps and its own failure vocabulary.
- **Flatten-or-not is a product decision.** A filled form left interactive can be edited by whoever
  receives it; flattened, it cannot, but nor can it be corrected. Both are defensible and the choice
  interacts with signing.

### Tasks

- [ ] **B1 — the template kind.** A `kind` discriminator on `document_template_version`
      (`wordProcessing` | `pdfForm`), defaulting to the existing value, and the registration pipeline
      branching on it before normalization. Every consumer of a template version reads the kind rather
      than assuming.
- [ ] **B2 — the manifest from the AcroForm field set.** Registration reads the field set through the
      existing forms engine, records name, type, page, and whether the field is required, and produces
      a manifest in the same shape a Word manifest has — so the field-binding index, the custom-field
      hard-delete guard, and the field-list surface all keep working unchanged.
- [ ] **B3 — binding, through the existing mapping library.** One proposed merge key per AcroForm
      field, confirmed by a human, written to `document_template_field_mapping`. **No name guessing**,
      on the same reasoning the Word conversion refuses it: a `ClientName` that becomes
      `client.displayName` because it looked close is a silent binding decision on privileged content.
- [ ] **B4 — filling, on the assembly path.** The job branches on the kind: resolve the same merge
      context through the same batched reads, then fill through the forms engine instead of the OOXML
      assembler. The absence model is unchanged — a field the matter cannot supply is reported and
      shows a marker, and a `fail` entry fails the assembly.
- [ ] **B5 — flatten policy.** Owner decision: does a filled form file flattened, interactive, or is
      it a per-template setting? A flattened form is what a signature wants; an interactive one is
      what a firm wants when a recipient still has to complete it.
- [ ] **B6 — load profile and tests.** The `documentAutomation` volume gains form templates; the
      package suite gains fill correctness against committed non-privileged fixture forms, and the
      worker suite gains the end-to-end path.

### Owner decisions this part needs

| Flag   | Decision                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B5** | Flatten a filled form, leave it interactive, or make it a per-template setting?                                                                                               |
| **F2** | (from the parent design, still open) Does the platform ever ship and maintain a curated library of jurisdiction court forms, or only fill forms a firm supplies?              |

---

## Sequencing

Part B depends on nothing that shipped here and can start whenever the PDF engine's forms surface is
wanted; B1 gates B2, which gates B3 and B4. Part A is sequenced against slice 2·5 and its first
question — the `esign:*` resource binding — is answerable today and worth answering before either
shape is designed.
