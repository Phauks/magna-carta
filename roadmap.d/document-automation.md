# Document Automation

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Document automation -->

- id: document-automation
  name: Document Automation
  scope: Conditional assembly of .docx templates from matter data, with a data dictionary and dedicated PDF form filling.
  status: partial
  slices: 2-6-document-automation
  adrs: ADR-0011, ADR-0210, ADR-0211, ADR-0218
  evidence: Build slices 2-6-1 and 2-6-2 shipped — packages/document-assembly, three per-firm tables, the templates/assemblies routes, the DocumentAssemblyJob queue consumer, and the template expression language behind conditionals, repeats, and computed fields. An outputFormat on the assembly request chains the existing docx-to-pdf conversion edge after the merge (#214) — no new engine, dormant until the LibreOffice engine is deployed (documents.conversion.office). The widened dictionary sources and the authoring surfaces are unbuilt.
  audience: public
  public-name: Documents built from your templates
  public-summary: Build a document from your own template and the matter's data, including the clauses that only apply in some cases.
  notes: A firm can register a .docx template and assemble it onto a matter today; the output is filed through the existing ingest chokepoint. PDF output is wired but inert until the office-conversion engine goes live.

- id: document-automation.conditional-assembly
  name: Conditional document assembly
  scope: Merge fields plus conditional clauses/sections driven by matter data.
  status: shipped
  slices: 2-6-document-automation
  adrs: ADR-0011, ADR-0218
  evidence: Substitution, {{#if}}/{{#unless}} conditional blocks, {{#each}} repeats, and {{= }} computed fields are built and tested over a closed expression language (packages/document-assembly/src/expression/, src/blocks.ts) checked at registration with a character offset. Removal and repetition operate on whole paragraphs and whole table rows, so list numbering and table banding survive. An unresolved condition fails the assembly naming the field; an unresolved calculation renders a visible placeholder.
  notes: Aggregates over a repeat collection are built — sum, minimum, and maximum over a literal field path of a list-valued key, bounded exactly as a repeat is. An aggregate over an empty collection is an absence rather than a zero.

- id: document-automation.docx-templates
  name: DOCX template authoring
  scope: Templates authored as .docx for formatting control, bound to the data dictionary.
  status: partial
  adrs: ADR-0211
  evidence: document_template plus an immutable document_template_version, a registration pipeline that strips macros, normalizes run-split placeholders, scrubs, and re-verifies, and the seven catalogue routes. Authoring in the browser is slice 2-6-4; BINDING a content control is still a named seam, though an unfilled one is now detected and reported.
  notes: Word MERGEFIELD conversion is detected always and applied only on explicit opt-in. The two constructs nothing binds — legacy Word form fields, and content controls showing a placeholder or bound to the template's own data — are reported on their own manifest lists at registration, in the field list, on a refusal, and by every assembly, which lands on succeeded_with_absences.

- id: document-automation.data-dictionary
  name: Data dictionary
  scope: Directory/Matter/Location/custom/financial fields exposed as a merge-field dictionary.
  status: partial
  evidence: A declarative dictionary over matter, client party, location, firm, system, and custom-field sources with per-type formatters and a declared absence behaviour per entry (packages/document-assembly/src/dictionary.ts), exposed at GET /api/v1/merge-fields. matter.parties is the first list-valued source, read once for the whole collection. A firm's own fields enter per firm at read time as custom.\<customField\_ handle\> entries — bound by handle and never by name, archived means absent and reported, values read at the scale the field declared through the custom-fields engine's own effectiveNumberScale, one statement covering every handle. Directory role links and protected values are the remaining widening.

- id: document-automation.location-identity
  name: Location-resolved office identity
  scope: Office name, address, letterhead, remit-to, and jurisdiction resolve from the matter's home Location so generated documents carry the correct office identity.
  status: partial
  evidence: location.\* keys resolve from THE MATTER'S home location, not the acting member's, through one batched read. The letterhead logo asset is built — the office holds the mark (PNG or JPEG, decided by magic bytes) plus the width it prints at, and location.letterheadLogo is emitted as a real OOXML picture with its part, content type, relationship, and drawing; the height follows from the image's own proportions so nothing can print a stretched mark. Document dates still render in a platform-normalized zone because Locations carries no time-zone column yet (timeZoneForLocation is the single seam for it), and the office-settings interface for the logo is a named seam.

- id: document-automation.generation-engine
  name: Generation engine
  scope: In-house TypeScript OOXML merge in a Worker queue consumer; heavy DOCX-to-PDF via the office engine in a Container.
  status: partial
  adrs: ADR-0210
  evidence: The merge engine is built as a pure package over fflate + fast-xml-parser and runs in the document-assembly queue consumer behind a DocumentAssemblyJob Durable Object; assembly output is filed through initiateUpload/completeUploadSession. An outputFormat: pdf arm now chains the merge into the existing docx-to-pdf registry edge in the same job (#214) — wired, but the DOCX-to-PDF hop itself still waits on the LibreOffice engine going live (see documents.conversion.office).

- id: document-automation.pdf-form-filling
  name: Dedicated PDF form filling
  scope: Court/government fillable PDFs filled via the PDF engine.
  status: shipped
  adrs: ADR-0152
  evidence: A firm-supplied fillable PDF registers as a template of kind pdfForm — document_template_version.kind is wordProcessing | pdfForm, and the two kinds share the catalogue, the immutable version ladder, the ingest gate, the field-manifest shape, the binding index, the dictionary, the formatters, the absence model, and the provenance row while sharing no engine. prepareFormTemplateVersion (packages/document-assembly/src/pdf-form.ts) reads the AcroForm field set through an injected reader over crates/pdf-core, scrubs the upload, and builds the manifest from the stored bytes; fillFormTemplate (src/fill-form.ts) plans the fill and the assembly job branches on the kind in exactly one place. A box binds ONLY through a mapping a human confirmed, stored in the firm's existing document_template_field_mapping library — an exact name match is offered as a proposal and never applied. Every field the form declares is either bound or on manifest.unboundFormFields with its reason (no-confirmed-mapping, not-fillable, unclassified); an unclassifiable field is never filled as text, and a form that binds nothing warns that every document from it is the blank form.
  notes: Whether a filled form files flattened or interactive is an open owner decision, held as a required typed FormFillFinish parameter at the fill seam and answered today by one constant set to interactive, because flattening is irreversible. The registration and field-list surfaces are backend only; the browser screens are slice 2-6-4.
  awaiting-owner: Does a filled form file flattened, interactive, or is it a per-template setting? A flattened form is what a signature wants and cannot be corrected; an interactive one is what a firm wants when the recipient still has to complete a box. Today it is interactive, which is the non-destructive answer to sit behind the question — changing it is one constant, or one column read. Document automation tail remainder plan, flag B5.

- id: document-automation.field-mapping-library
  name: Per-firm merge-field mapping library
  scope: A firm-scoped store of confirmed Word-field-name to merge-field-key mappings, so a second template import reuses what the first established.
  status: shipped
  evidence: The store is packages/document-assembly/src/field-mapping-statements.ts over the per-firm document_template_field_mapping table (one merge key per field name by unique index) — read whole into a resolver once per registration, written back in the same batch as the registration whose conversion confirmed each mapping, and exposed at GET /api/v1/merge-field-mappings and DELETE /api/v1/merge-field-mappings/{mappingId}. A detection reports mappedFromLibrary so a firm's own confirmed answer is never blended with a name that happened to match a dictionary key.
  notes: Backend only — no browser surface lists or withdraws a mapping yet; the authoring surfaces are slice 2-6-4. A mapping is only ever confirmed by converting a template, never typed in.

- id: document-automation.filing-grade-generation
  name: Filing-grade generation
  scope: Court documents generated from vetted templates (optionally tweaked in Collabora) rather than co-edited from scratch.
  status: partial
  evidence: An assembled document lands as an ordinary matter file, so it is already previewable, editable in Collabora, convertible, and available to the e-signature seal. What is missing is the pleading-grade template content itself (conditionals, party schedules) and the authoring surfaces.
  awaiting-owner: The curated Nevada starter library is designed and its plan does not start until five calls land. Whether the platform authors its own templates from the text a statute prescribes, or redistributes the courts' published documents — authoring narrows the copyright question to prescribed text and produces templates the engine can actually render, redistribution takes on somebody else's asserted rights in every file. What the starter set contains, which is the deliverable rather than a detail. Whether one named Nevada attorney's review is enough, or each firm must acknowledge an entry before first use. Whether fillable-PDF templates get built at all, without which no family-law form — the forms most Nevada firms actually file — can ever be in the library. And whether to write to the Supreme Court of Nevada and the Legal Aid Center of Southern Nevada asking permission, since both assert copyright expressly and until a written permission exists no court-published form is shippable. Nevada court form library design, flags N1 through N5.
