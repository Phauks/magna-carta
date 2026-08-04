---
number: 210
slug: document-automation-assembly-engine
status: Accepted
date: 2026-08-04
area: Document Automation
summary: "The document-automation merge is built in-house as a pure TypeScript package, `@magna-carta/document-assembly`, over fflate and fast-xml-parser — the substrate the OOXML metadata inspector and scrubber already use — running in a Worker queue consumer behind a `DocumentAssemblyPort.assemble(templateBytes, mergeContext)` seam, so the substitution layer is replaceable without touching the dictionary, the resolution pipeline, the job model, or the filing path. Rust compiled to WebAssembly is rejected for this slice but not designed out (no candidate crate carries templating semantics, and the workload is not CPU-bound); adopting docxtemplater's MIT core is the real alternative and is declined — a second zip stack beside fflate, image and HTML insertion behind paid modules, and expressions evaluated from template content — while remaining the documented, scoped fallback behind the same port; driving the consented LibreOffice container's mail merge is rejected outright as the only memory-unsafe route and the only one that would push privileged merge values through the one C++ dependency for no fidelity gain, so LibreOffice keeps DOCX-to-PDF and nothing else."
---

**The document-automation merge engine is built in-house in TypeScript and runs in a Worker; docxtemplater's core is the recorded scoped fallback, and the consented LibreOffice container never sees a merge value.**

## Context

Slice 2·6 assembles `.docx` documents from firm-authored templates and matter data. The merge step
manipulates an Open Packaging Conventions package: unzip, rewrite `word/document.xml` and the
header/footer/footnote/endnote parts, re-zip. Four routes were available, and — unusually — golden
rule 14 does not force the answer, because every candidate except one is already memory-safe.

## Decision

Build the merge in-house as a pure TypeScript package, `@magna-carta/document-assembly`, over
`fflate` and `fast-xml-parser` — the same substrate `@magna-carta/metadata`'s OOXML inspector and
scrubber already use — running in a Worker queue consumer. The consented LibreOffice container keeps
exactly the job the conversion design gave it, DOCX to PDF, and never sees a merge value.

The engine sits behind `DocumentAssemblyPort.assemble(templateBytes, mergeContext) → bytes`, so the
substitution layer is replaceable without touching the dictionary, the resolution pipeline, the job
model, or the filing path.

**Owner decision, 2026-08-04.** The recommendation is accepted as written. The in-house TypeScript
merge is the decision; docxtemplater's open-source core stays a scoped fallback behind the same port
rather than a second engine anyone builds now.

## Considered options

**Rust compiled to WebAssembly — rejected for this slice, not designed out.** `docx-rs`,
`docx-rust`, and `rdocx` are read/write libraries with no templating semantics; `docxide-template`
does placeholder substitution but not conditionals or repeats. Adopting one buys a document model
and leaves the templating to us, in a second language, across a WebAssembly boundary, for a workload
that is not CPU-bound. Revisit if assembly ever has to run identically on the Tauri client.

**Adopting docxtemplater's open-source core — the real alternative, declined.** MIT, actively
maintained, one dependency (`@xmldom/xmldom`), and its core covers substitution, loops including
table-row loops, and conditional sections with run-splitting solved. Declined on four grounds: its
zip layer expects a JSZip-shaped object, so we would carry a second zip stack beside `fflate` with a
second set of decompression-bomb guards; image and HTML insertion sit behind paid modules, and image
insertion is exactly what the letterhead logo needs in the next slice; its richer expressions are
evaluated from template content, which contradicts the deliberately non-executable expression
language this subsystem wants; and it solves the smaller half of the problem — the dictionary,
batched resolution, storage-encoding-aware formatting, absence policy, protected-field gate, and
provenance record are ours either way. It remains the documented, scoped fallback behind the same
port.

**Driving the consented LibreOffice container's mail merge — rejected.** The only memory-unsafe
option and the only one requiring a container round-trip per document. It would push privileged merge
values — party names, addresses, settlement amounts, decrypted identifiers — through the one C++
dependency consented on the explicit basis that it is reached only for format fidelity unavailable
elsewhere. There is no fidelity argument for the merge: input and output are both `.docx`.

## Consequences

**Positive.** No new runtime, no container hop, and no new dependency class in the merge path. The
expensive half of the OOXML problem — finding a placeholder Word split across five runs — is paid
once per template version at registration rather than on every assembly, which makes the per-assembly
path a deterministic substitution and makes assembly output reproducible for a given template version
and merge context. The expression language is non-executable by construction, so the
template-evaluates-code vulnerability class cannot exist here.

**Negative.** We own run splitting, conditional-block removal, repeat expansion, and list/numbering
continuity that the declined library would have supplied. Block removal that strands numbering or
banded-table formatting is the most likely source of a subtly-wrong document, and there is no general
oracle for it.

**Risk.** If the fidelity bar proves more expensive than budgeted, the fallback is adopting
docxtemplater's core behind the existing port — a scoped substitution, not a redesign.

## Related

The pure-Rust PDF engine, in-house conversion, and in-house e-signature decisions establish the same
own-the-bytes posture; the metadata inspector and scrubber and `crates/recovery-core`'s Open
Packaging Conventions module are the in-tree evidence that in-house OOXML manipulation is viable.
