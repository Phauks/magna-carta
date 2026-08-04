---
slice: 2·6 — Document automation
group: phase-2
order: 6
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: in-progress by="Opus 4.8"
ui: todo
load-profile: todo
tested: in-progress by="Opus 4.8"
branch: claude/automation-consent-refinements
active-work: docs/active-work/claude/automation-consent-refinements.md
next: Slice 2·6·2 — conditional and repeating blocks, the Directory/custom-field/letterhead-logo dictionary sources, and protected-value binding. Then a location time-zone column behind timeZoneForLocation.
link-spec: docs/specs/2026-08-04-document-automation-design.md
link-plan: docs/specs/2026-08-04-document-automation-implementation-plan.md
adrs: ADR-0210, ADR-0211, ADR-0217
blocked-by:
---

Build slice 2·6·1 shipped: the walking slice, template registration through to a filed document.
`@magna-carta/document-assembly` is a pure package over `fflate` + `fast-xml-parser` (the
`@magna-carta/metadata` substrate) holding the guarded OOXML reader/writer, the macro stripper and its
independent re-verification gate, the normalization pass, the declarative merge-field dictionary and
its formatters, the batched resolution pipeline, and the substitution engine. Four per-firm tables
(`document_template`, immutable `document_template_version`, `document_template_field_mapping`,
`document_assembly`), nine catalogue routes plus submit/poll, a `DocumentAssemblyJob` Durable Object
over a dedicated queue, and the assembled document filed through `initiateUpload` /
`completeUploadSession` — the one ingest chokepoint, no bypass. Owner decisions taken: `{{key}}` is
the single stored placeholder form, and the merge is in-house rather than an adopted library.

Both registration transforms of the firm's own document are **opt-in and always reported**, revised
on 2026-08-04 evening. Converting Word merge fields runs only on request, and a template registered
without it keeps them — each recorded on the field manifest with the part it sits in and the frozen
cached text it will print, reported again by every assembly in the response and on the provenance row,
and landing the assembly on `succeeded_with_absences`, so a blank that does not look like a blank
meets the same absence model an ordinary missing value does. Removing macros likewise runs only on
request; a macro-bearing upload without the opt-in is refused with both remedies named, never stored
carrying live macros and never stripped silently. The per-firm **field-mapping library** behind
`MergeFieldNameResolver` is built: confirmed Word-name-to-key mappings written when a conversion
confirms them, read once per registration, listed and deletable under `templates:manage`.

Remaining for the subsystem: conditionals and repeats (2·6·2), PDF output and the signature hand-off
(2·6·3), authoring surfaces (2·6·4), the interface seams, and the load-profile volume profile.
