# Document Automation

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Document automation -->

- id: document-automation
  name: Document Automation
  scope: Conditional assembly of .docx templates from matter data, with a data dictionary and dedicated PDF form filling.
  status: partial
  slices: 2-6-document-automation
  adrs: ADR-0011, ADR-0210, ADR-0211, ADR-0218
  evidence: Build slices 2-6-1, 2-6-2, 2-6-5 and the first half of 2-6-3 shipped — packages/document-assembly, five per-firm tables (document_template, document_template_version, document_template_field_binding, document_template_field_mapping, document_assembly), the templates/assemblies routes, the DocumentAssemblyJob queue consumer, the template expression language behind conditionals, repeats and computed fields, the generated merge-field catalogue and its contract, and the PDF output arm. The template library at /documents is the first of the 2-6-4 surfaces; the field inspector, browser authoring and the signing ceremony remain unbuilt.
  audience: public
  public-name: Documents built from your templates
  public-summary: Build a document from your own template and the matter's data, including the clauses that only apply in some cases.
  notes: The template library is a screen (see document-automation.template-library), so a firm registers a template and adds it to matters from the browser; the output is filed through the existing ingest chokepoint. A second browser surface predates it and no node claims it — a field-input scaffold under the app's forms section, over apps/web/src/lib/document-assembly/ and the design system's merge-field picker, chip and review list. Its interaction shape is real; its data is not, since every template, field and proposal comes from an in-repo fixture catalog through a mock provider, and choosing Assemble reports the collected values rather than starting a job.

- id: document-automation.conditional-assembly
  name: Conditional document assembly
  scope: Merge fields plus conditional clauses/sections driven by matter data.
  status: shipped
  surface: awaiting-screen
  slices: 2-6-document-automation
  adrs: ADR-0011, ADR-0218
  evidence: Substitution, {{#if}}/{{#unless}} conditional blocks, {{#each}} repeats, and {{= }} computed fields are built and tested over a closed expression language (packages/document-assembly/src/expression/, src/blocks.ts) checked at registration with a character offset. Removal and repetition operate on whole paragraphs and whole table rows, so list numbering and table banding survive. An unresolved condition fails the assembly naming the field; an unresolved calculation renders a visible placeholder.
  notes: Aggregates over a repeat collection are built — sum, minimum, and maximum over a literal field path of a list-valued key, bounded exactly as a repeat is. An aggregate over an empty collection is an absence rather than a zero.

- id: document-automation.docx-templates
  name: DOCX template authoring
  scope: Templates authored as .docx for formatting control, bound to the data dictionary.
  status: partial
  surface: screen
  adrs: ADR-0211
  evidence: document_template plus an immutable document_template_version, a registration pipeline that strips macros, normalizes run-split placeholders, scrubs, and re-verifies, and the nine catalogue routes in apps/api-worker/src/routes/templates.ts (upload, register, add a version, list, field list, archive, the merge-field dictionary, and the mapping library's list and delete) beside the two assembly routes. Authoring in the browser is slice 2-6-4; BINDING a content control is still a named seam, though an unfilled one is now detected and reported.
  notes: Registration, versions aside, is a screen — the New Template panel on /documents presigns, uploads and registers a .docx or a fillable PDF and renders the report as findings; adding a version and authoring in the browser are still API-only. Word MERGEFIELD conversion is detected always and applied only on explicit opt-in. The two constructs nothing binds — legacy Word form fields, and content controls showing a placeholder or bound to the template's own data — are reported on their own manifest lists at registration, in the field list, on a refusal, and by every assembly, which lands on succeeded_with_absences.

- id: document-automation.template-library
  name: Template library
  scope: The Documents destination — the firm's template catalogue on the one table, registering a template from the browser, adding one template to several matters at once, and archiving.
  status: partial
  surface: screen
  slices: 2-6-document-automation
  evidence: apps/web/src/routes/(app)/documents over apps/web/src/lib/templates/ (template-columns.ts, register-template.ts, add-to-matters.ts and the register, New Template and Add to Matters surfaces), through the generated client; the documents destination flipped to shipped at alpha in apps/web/src/lib/navigation/destinations.ts.
  audience: public
  public-name: The firm's template library
  public-summary: Every template the firm has registered in one place, with a way to register another and to add one to several matters in one go.
  notes: Standing is derived from the listing's status and current-version handle rather than served. What is partial is the rest of the authoring seam — the field inspector over a version's manifest, adding a version to an existing template, and the mapping library's screen — which stay API-only.

- id: document-automation.data-dictionary
  name: Data dictionary
  scope: Directory/Matter/Location/custom/financial fields exposed as a merge-field dictionary.
  status: partial
  surface: awaiting-screen
  evidence: The dictionary is generated from a subject catalogue rather than hand-listed — packages/document-assembly/src/catalog/subjects.ts declares 29 subjects across eleven sources (matter, party, location, firm, customField, protectedIdentifier, system, asset, staffing, court, estate), crossed with the per-kind facets in catalog/facets.ts by catalog/generate.ts, with per-type formatters and an availability and absence note derived per entry rather than declared 300 times (catalog/entry.ts); exposed at GET /api/v1/merge-fields. The widenings this node once listed as remaining are built: Directory role links resolve through directory-role-bindings.ts (opposing party, opposing counsel, guardian, witness, keyed by the punctuation-stripped role token), and sealed identifiers through protected-bindings.ts, which holds the keys and routes every read through the protected-field chokepoint's permission gate and decrypt-audit row rather than opening a second door to it. matter.parties is the first list-valued source, read once for the whole collection. A firm's own fields enter per firm at read time as custom.\<customField\_ handle\> entries — bound by handle and never by name, archived means absent and reported, values read at the scale the field declared through the custom-fields engine's own effectiveNumberScale, one statement covering every handle.

- id: document-automation.location-identity
  name: Location-resolved office identity
  scope: Office name, address, letterhead, remit-to, and jurisdiction resolve from the matter's home Location so generated documents carry the correct office identity.
  status: partial
  surface: awaiting-screen
  evidence: location.\* keys resolve from THE MATTER'S home location, not the acting member's, through one batched read. The letterhead logo asset is built — the office holds the mark (PNG or JPEG, decided by magic bytes) plus the width it prints at, and location.letterheadLogo is emitted as a real OOXML picture with its part, content type, relationship, and drawing; the height follows from the image's own proportions so nothing can print a stretched mark. The office time zone has landed since this said Locations carried no column for it: location.time_zone holds an IANA zone validated on write by packages/locations/src/location-service.ts, and timeZoneForLocation in packages/document-assembly/src/resolve.ts is the one place it enters the platform — an office recorded before the column existed still falls back to the platform-normalized zone, so a document that rendered correctly before renders identically now. The office-settings interface for the logo and the zone is still a named seam.

- id: document-automation.generation-engine
  name: Generation engine
  scope: In-house TypeScript OOXML merge in a Worker queue consumer; heavy DOCX-to-PDF via the office engine in a Container.
  status: partial
  surface: internal
  adrs: ADR-0210
  evidence: The merge engine is built as a pure package over fflate + fast-xml-parser and runs in the document-assembly queue consumer behind a DocumentAssemblyJob Durable Object; assembly output is filed through initiateUpload/completeUploadSession. The DOCX-to-PDF arm is built rather than waiting: an assembly takes an outputFormat, document_assembly.output_format records it, and apps/api-worker/src/assemblies/assembly-consumer.ts hands the merged package to the conversion registry's own docx-to-pdf edge through the same runConversion the file-converter tool uses, contributing no engine of its own. A conversion that cannot be done fails the assembly with conversion-failed and files nothing. What the arm depends on is the LibreOffice engine being deployed (see documents.conversion.office), which is why the Documents surface records it as deployed-only.

- id: document-automation.pdf-form-filling
  name: Dedicated PDF form filling
  scope: Court/government fillable PDFs filled via the PDF engine.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0152
  evidence: A firm-supplied fillable PDF registers as a template of kind pdfForm — document_template_version.kind is wordProcessing | pdfForm, and the two kinds share the catalogue, the immutable version ladder, the ingest gate, the field-manifest shape, the binding index, the dictionary, the formatters, the absence model, and the provenance row while sharing no engine. prepareFormTemplateVersion (packages/document-assembly/src/pdf-form.ts) reads the AcroForm field set through an injected reader over crates/pdf-core, scrubs the upload, and builds the manifest from the stored bytes; fillFormTemplate (src/fill-form.ts) plans the fill and the assembly job branches on the kind in exactly one place. A box binds ONLY through a mapping a human confirmed, stored in the firm's existing document_template_field_mapping library — an exact name match is offered as a proposal and never applied. Every field the form declares is either bound or on manifest.unboundFormFields with its reason (no-confirmed-mapping, not-fillable, unclassified); an unclassifiable field is never filled as text, and a form that binds nothing warns that every document from it is the blank form.
  notes: Whether a filled form files flattened or interactive is an open owner decision, held as a required typed FormFillFinish parameter at the fill seam and answered today by one constant set to interactive, because flattening is irreversible. The registration and field-list surfaces are backend only; the browser screens are slice 2-6-4.
  awaiting-owner: Does a filled form file flattened, interactive, or is it a per-template setting? A flattened form is what a signature wants and cannot be corrected; an interactive one is what a firm wants when the recipient still has to complete a box. Today it is interactive, which is the non-destructive answer to sit behind the question — changing it is one constant, or one column read. Document automation tail remainder plan, flag B5.

- id: document-automation.field-mapping-library
  name: Per-firm merge-field mapping library
  scope: A firm-scoped store of confirmed Word-field-name to merge-field-key mappings, so a second template import reuses what the first established.
  status: shipped
  surface: awaiting-screen
  evidence: The store is packages/document-assembly/src/field-mapping-statements.ts over the per-firm document_template_field_mapping table (one merge key per field name by unique index) — read whole into a resolver once per registration, written back in the same batch as the registration whose conversion confirmed each mapping, and exposed at GET /api/v1/merge-field-mappings and DELETE /api/v1/merge-field-mappings/{mappingId}. A detection reports mappedFromLibrary so a firm's own confirmed answer is never blended with a name that happened to match a dictionary key.
  notes: Backend only — no browser surface lists or withdraws a mapping yet; the authoring surfaces are slice 2-6-4. A mapping is only ever confirmed by converting a template, never typed in.

- id: document-automation.filing-grade-generation
  name: Filing-grade generation
  scope: Court documents generated from vetted templates (optionally tweaked in Collabora) rather than co-edited from scratch.
  status: partial
  surface: awaiting-screen
  evidence: An assembled document lands as an ordinary matter file, so it is already previewable, editable in Collabora, convertible, and available to the e-signature seal. What is missing is the pleading-grade template content itself (conditionals, party schedules) and the authoring surfaces.
  awaiting-owner: The curated Nevada starter library is designed and its plan does not start until five calls land. Whether the platform authors its own templates from the text a statute prescribes, or redistributes the courts' published documents — authoring narrows the copyright question to prescribed text and produces templates the engine can actually render, redistribution takes on somebody else's asserted rights in every file. What the starter set contains, which is the deliverable rather than a detail. Whether one named Nevada attorney's review is enough, or each firm must acknowledge an entry before first use. Whether fillable-PDF templates get built at all, without which no family-law form — the forms most Nevada firms actually file — can ever be in the library. And whether to write to the Supreme Court of Nevada and the Legal Aid Center of Southern Nevada asking permission, since both assert copyright expressly and until a written permission exists no court-published form is shippable. Nevada court form library design, flags N1 through N5.

- id: document-automation.template-storage-reclamation
  name: Template storage reclamation
  scope: Reclaiming the R2 objects a refused template registration leaves behind, which no version row names.
  status: partial
  surface: internal
  evidence: Registration writes its object before its rows on purpose — a committed row pointing at bytes that were never written fails on a filing deadline, where a written object with no row is only wasted storage — and a refused attempt therefore strands a full copy under templates/ that nothing named. apps/api-worker/src/assemblies/template-orphan-sweep.ts runs on the daily storage cron and MEASURES that leak: every candidate is decided by the rules a collector would arm (not staged, named by no version row anywhere in the fleet, unnamed for longer than a 24-hour grace period), counted on storage.template_orphan.found, and left in place. The fleet retention read is a paged keyset walk, and a read that fails disarms the whole pass rather than narrowing the set.
  notes: Deletion is deliberately not armed — see the owner question. The other half of the prefix, abandoned staged uploads, is an R2 lifecycle rule in docs/deploy-queue.md rather than code.
  awaiting-owner: Should the sweep be armed to delete, and at the cost of what change? Deleting the complement of the live set is only as safe as that set is complete, and completeness is currently unverifiable: a template key carries no firm segment and every firm resolves to the same bound bucket, so the retention set has to be the whole fleet's — and a per-firm database addressed under a name it does not answer to does not throw, it self-migrates and returns zero rows, which reads identically to a firm that holds no templates. The residency seam makes that reachable rather than theoretical. Arming it safely wants each object stamped with the firm that wrote it, so an orphan is decided against one firm's rows and the fleet-wide union disappears along with its blast radius — a schema and write-path change, not a line to flip.
