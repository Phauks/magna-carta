# Document Automation

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: document-automation
  name: Document Automation
  scope: Conditional assembly of .docx templates from matter data, with a data dictionary and dedicated PDF form filling.
  status: partial
  slices: 2-6-document-automation
  adrs: ADR-0011, ADR-0210, ADR-0211, ADR-0218
  evidence: Build slices 2-6-1 and 2-6-2 shipped — packages/document-assembly, three per-firm tables, the templates/assemblies routes, the DocumentAssemblyJob queue consumer, and the template expression language behind conditionals, repeats, and computed fields. The widened dictionary sources, PDF output, and the authoring surfaces are unbuilt.
  notes: A firm can register a .docx template and assemble it onto a matter today; the output is filed through the existing ingest chokepoint.

- id: document-automation.conditional-assembly
  name: Conditional document assembly
  scope: Merge fields plus conditional clauses/sections driven by matter data.
  status: built
  slices: 2-6-document-automation
  adrs: ADR-0011, ADR-0218
  evidence: Substitution, {{#if}}/{{#unless}} conditional blocks, {{#each}} repeats, and {{= }} computed fields are built and tested over a closed expression language (packages/document-assembly/src/expression/, src/blocks.ts) checked at registration with a character offset. Removal and repetition operate on whole paragraphs and whole table rows, so list numbering and table banding survive. An unresolved condition fails the assembly naming the field; an unresolved calculation renders a visible placeholder.
  notes: Aggregates over a repeat collection are built — sum, minimum, and maximum over a literal field path of a list-valued key, bounded exactly as a repeat is. An aggregate over an empty collection is an absence rather than a zero.

- id: document-automation.docx-templates
  name: DOCX template authoring
  scope: Templates authored as .docx for formatting control, bound to the data dictionary.
  status: partial
  adrs: ADR-0211
  evidence: document_template plus an immutable document_template_version, a registration pipeline that strips macros, normalizes run-split placeholders, scrubs, and re-verifies, and the seven catalogue routes. Authoring in the browser is slice 2-6-4; content controls are a named seam.
  notes: Word MERGEFIELD conversion is detected always and applied only on explicit opt-in.

- id: document-automation.data-dictionary
  name: Data dictionary
  scope: Directory/Matter/Location/custom/financial fields exposed as a merge-field dictionary.
  status: partial
  evidence: A declarative dictionary over matter, client party, location, firm, and system sources with per-type formatters and a declared absence behaviour per entry (packages/document-assembly/src/dictionary.ts), exposed at GET /api/v1/merge-fields. matter.parties is the first list-valued source, read once for the whole collection. Directory role links, custom-field handles, and protected values are the remaining widening.

- id: document-automation.location-identity
  name: Location-resolved office identity
  scope: Office name, address, letterhead, remit-to, and jurisdiction resolve from the matter's home Location so generated documents carry the correct office identity.
  status: partial
  evidence: location.\* keys resolve from THE MATTER'S home location, not the acting member's, through one batched read. The letterhead logo asset is slice 2-6-2; document dates still render in a platform-normalized zone because Locations carries no time-zone column yet (timeZoneForLocation is the single seam for it).

- id: document-automation.generation-engine
  name: Generation engine
  scope: In-house TypeScript OOXML merge in a Worker queue consumer; heavy DOCX-to-PDF via the office engine in a Container.
  status: partial
  adrs: ADR-0210
  evidence: The merge engine is built as a pure package over fflate + fast-xml-parser and runs in the document-assembly queue consumer behind a DocumentAssemblyJob Durable Object; assembly output is filed through initiateUpload/completeUploadSession. The DOCX-to-PDF arm waits on the LibreOffice engine (see documents.conversion.office).

- id: document-automation.pdf-form-filling
  name: Dedicated PDF form filling
  scope: Court/government fillable PDFs filled via the PDF engine.
  status: partial
  adrs: ADR-0152
  evidence: AcroForm fill engine shipped in crates/pdf-core/src/forms.rs; no automation-facing surface, template binding, or UI exists.
  notes: Binding firm-supplied fillable PDFs to the same data dictionary is slice 2-6-3.

- id: document-automation.field-mapping-library
  name: Per-firm merge-field mapping library
  scope: A firm-scoped store of confirmed Word-field-name to merge-field-key mappings, so a second template import reuses what the first established.
  status: not-started
  evidence: The seam exists (MergeFieldNameResolver in packages/document-assembly/src/normalize.ts, the identity mapping today) and the registration response already reports which detected names map to no merge field; no store is built.

- id: document-automation.filing-grade-generation
  name: Filing-grade generation
  scope: Court documents generated from vetted templates (optionally tweaked in Collabora) rather than co-edited from scratch.
  status: partial
  evidence: An assembled document lands as an ordinary matter file, so it is already previewable, editable in Collabora, convertible, and available to the e-signature seal. What is missing is the pleading-grade template content itself (conditionals, party schedules) and the authoring surfaces.
