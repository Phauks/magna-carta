---
worktree: .claude/worktrees/pdf-form-templates
area: Fillable-PDF form templates — the template kind, the AcroForm manifest, confirmed binding, and filling on the assembly path
status: building
touches: packages/document-assembly, packages/database, packages/pdf, packages/fixtures/src/load-profile, crates/pdf-core, apps/worker/src/routes/templates.ts, apps/worker/src/routes/assemblies.ts, apps/worker/src/assemblies, apps/worker/src/per-firm-migrations.ts, docs/user/document-automation.md, status.d/2-6-document-automation.md, roadmap.d/document-automation.md, changelog.d/, docs/decisions/pending/
---

Adds a second template kind to document automation: a firm-supplied fillable PDF registers as a
`pdfForm` template, its AcroForm field set becomes a manifest in the shape a Word manifest has, each
field binds to a merge key only through a human-confirmed entry in the firm's existing field-mapping
library, and the assembly job fills the form through the PDF engine instead of the OOXML assembler.

Adds a per-firm migration (`kind` on `document_template_version`), so it touches the journal, the
worker's hand-registered migration map, and the `meta/` snapshot. It also adds one additive field
(`required`) to `crates/pdf-core`'s `FormField` and its WASM binding, which the manifest records.

Whether a filled form files flattened or interactive is an owner decision that is deliberately NOT
made here: the fill seam takes an explicit typed `FormFillFinish` parameter defaulting to
`interactive`. Nothing else in the tree should grow a second answer to that question.

Not in scope: the signing surface (slice 2·5), and any curated jurisdiction court-form library.
