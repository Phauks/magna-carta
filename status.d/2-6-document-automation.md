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
branch: claude/document-automation-slice-1
active-work: docs/active-work/claude/document-automation-slice-1.md
next: Slice 2·6·2 — conditional and repeating blocks, the Directory/custom-field/letterhead-logo dictionary sources, and protected-value binding. Then the per-firm merge-field mapping library behind the MergeFieldNameResolver seam, and a location time-zone column behind timeZoneForLocation.
link-spec: docs/specs/2026-08-04-document-automation-design.md
link-plan: docs/specs/2026-08-04-document-automation-implementation-plan.md
adrs: ADR-0210, ADR-0211
blocked-by:
---

Build slice 2·6·1 shipped: the walking slice, template registration through to a filed document.
`@magna-carta/document-assembly` is a pure package over `fflate` + `fast-xml-parser` (the
`@magna-carta/metadata` substrate) holding the guarded OOXML reader/writer, the macro stripper and its
independent re-verification gate, the normalization pass, the declarative merge-field dictionary and
its formatters, the batched resolution pipeline, and the substitution engine. Three per-firm tables
(`document_template`, immutable `document_template_version`, `document_assembly`), seven catalogue
routes plus submit/poll, a `DocumentAssemblyJob` Durable Object over a dedicated queue, and the
assembled document filed through `initiateUpload` / `completeUploadSession` — the one ingest
chokepoint, no bypass. Owner decisions taken: `{{key}}` is the single stored placeholder form; the
merge is in-house rather than an adopted library; macro-bearing templates are accepted, stripped, and
re-verified rather than refused; and **converting Word merge fields is opt-in** — detection always
runs and is reported, the rewrite happens only when the caller asks, and a template using them is
refused with the list until the choice is made. Remaining for the subsystem: conditionals and repeats
(2·6·2), PDF output and the signature hand-off (2·6·3), authoring surfaces (2·6·4), the interface
seams, and the load-profile volume profile.
