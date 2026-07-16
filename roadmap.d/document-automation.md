# Document Automation

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: document-automation
  name: Document Automation
  scope: Conditional assembly of .docx templates from matter data, with a data dictionary and dedicated PDF form filling.
  status: partial
  slices: 2-6-document-automation
  adrs: ADR-0011
  evidence: Slice 2-6 fragment is all-todo ("Not started"); only the underlying PDF forms engine exists (crates/pdf-core/src/forms.rs).
  notes: Substrate pieces (custom fields, Locations letterhead fields, PDF forms engine) shipped in other areas; no automation code exists.

- id: document-automation.conditional-assembly
  name: Conditional document assembly
  scope: Merge fields plus conditional clauses/sections driven by matter data.
  status: not-started
  slices: 2-6-document-automation
  adrs: ADR-0011
  evidence: No assembly engine, template model, or schema anywhere in packages/ or crates/.

- id: document-automation.docx-templates
  name: DOCX template authoring
  scope: Templates authored as .docx for formatting control, bound to the data dictionary.
  status: not-started
  evidence: No template storage or binding code in the tree.

- id: document-automation.data-dictionary
  name: Data dictionary
  scope: Directory/Matter/Location/custom/financial fields exposed as a merge-field dictionary.
  status: not-started
  evidence: No dictionary artifact; the custom-fields engine (packages/custom-fields, slice 1-4) and Directory/Locations models exist as feeder substrate only.

- id: document-automation.location-identity
  name: Location-resolved office identity
  scope: Office name, address, letterhead, remit-to, and jurisdiction resolve from the matter's home Location so generated documents carry the correct office identity.
  status: not-started
  evidence: packages/locations carries letterhead/remit-to fields, but nothing consumes them for generation.

- id: document-automation.generation-engine
  name: Generation engine
  scope: Light templating in a Worker (Rust/WASM docx); heavy DOCX-to-PDF via the office engine in a Container.
  status: not-started
  evidence: No docx templating crate or package; the heavy DOCX-to-PDF office engine is itself only planned (see documents.conversion.office).

- id: document-automation.pdf-form-filling
  name: Dedicated PDF form filling
  scope: Court/government fillable PDFs filled via the PDF engine.
  status: partial
  adrs: ADR-0152
  evidence: AcroForm fill engine shipped in crates/pdf-core/src/forms.rs; no automation-facing surface, template binding, or UI exists.
  notes: Backend engine only — the promised user-facing capability is unbuilt.

- id: document-automation.filing-grade-generation
  name: Filing-grade generation
  scope: Court documents generated from vetted templates (optionally tweaked in Collabora) rather than co-edited from scratch.
  status: not-started
  evidence: Depends on assembly + templates + generation engine, none of which exist; Collabora editing substrate is built (see documents.editing).
