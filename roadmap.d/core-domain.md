# Core Domain — Directory, Matters & Locations

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: directory
  name: Directory
  scope: Single source of truth for every person and organization, modeled as a graph of entities and typed edges.
  status: partial
  slices: 1-3-directory
  adrs: ADR-0006, ADR-0085
  spec: docs/specs/2026-06-12-slice-1-3-directory-design.md
  evidence: packages/directory on main; status.d/1-3-directory.md built+tested done, ui todo
  notes: Backend complete on main; UI deferred until the design-system app shell lands.

- id: directory.entities
  name: Person and Organization entities
  scope: Distinct Person and Organization types with equal data depth; full contact core (typed emails/phones/addresses, notes) on every entity regardless of role.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/person.ts, organization.ts, entity-kind.ts
  notes: Backend shipped; no entity UI yet (ui todo in status.d/1-3-directory.md).

- id: directory.entities.categories
  name: Entity categories
  scope: Per-firm classification labels (attorney, judge, court, expert, vendor, client) that are not schema variants.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/categories.ts; category repointing handled in merge.ts
  notes: Backend shipped; category management UI not built.

- id: directory.entities.category-fields
  name: Category-specific custom fields
  scope: Category-specific data (bar number, jurisdiction, specialty/rate) defined through the shared custom-fields engine; add-only, equal depth preserved.
  status: partial
  slices: 1-3-directory, 1-4-custom-fields-engine
  adrs: ADR-0087
  evidence: packages/custom-fields consumed for directory entities per ADR-0087
  notes: Engine shipped (see custom-fields.*); field-definition and entry UI not built.

- id: directory.names
  name: Structured names and name history
  scope: Structured person names (prefix/first/middle/last/suffix), aliases/AKAs, maiden and former names, preferred/display name; org legal name, DBAs/trade names, former names; retained name-change history.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/name-history.ts (current-to-former flip, alias/aka/maiden/dba roles), normalize-name.ts
  notes: Backend shipped including phonetic codes on every name row; UI not built.

- id: directory.edges
  name: Typed edges
  scope: First-class typed, dated edges between entities (affiliations, relationships, representation, role assignments) with valid-from/valid-to.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/edges.ts; EDGE_TYPES catalog in types.ts
  notes: Backend shipped; edge management UI not built.

- id: directory.edges.affiliations
  name: Affiliations (person-org)
  scope: Typed, dated person-to-organization links (officer, employee, partner, member, registered agent, attorney-at-firm) with per-contact flags (primary, billing, do-not-contact).
  status: partial
  slices: 1-3-directory
  evidence: edge_type "affiliation" with role qualifier + valid_from/valid_to in edges.ts
  notes: Typed/dated edges shipped; the promised contact flags (primary/billing/do-not-contact) were not found in the schema or package.

- id: directory.edges.relationships
  name: Relationships (person-person, org-org)
  scope: Typed relationship edges — spouse/family, guardian/ward, trustee, beneficiary, business partner; corporate parent/subsidiary/successor/affiliate — feeding conflicts, estate planning, corporate work.
  status: partial
  slices: 1-3-directory
  evidence: EDGE_TYPES includes relationship, corporate_parent, corporate_subsidiary, corporate_successor; conflict-oriented read-all-current query in edges.ts
  notes: Backend shipped; conflicts engine that consumes these is not built (slice-4-1-conflicts branch has no work yet).

- id: directory.edges.representation
  name: Representation edges
  scope: Counsel-represents-party edges scoped within a matter.
  status: partial
  slices: 1-3-directory
  evidence: EDGE_TYPES includes "representation" in packages/directory/src/types.ts
  notes: Backend edge type shipped; no UI.

- id: directory.edges.role-assignments
  name: Matter role assignments
  scope: Entity-to-matter role links with the role on the link, not the entity; one entity can hold multiple roles in one matter.
  status: partial
  slices: 1-3-directory, 1-1-matters-locations-file-manager
  evidence: packages/directory/src/party.ts (matter_party rows, one per role, no uniqueness on (matter, entity))
  notes: Backend shipped; party management UI not built.

- id: directory.identifiers
  name: Typed identifiers
  scope: Typed identifier list (bar number, EIN/Tax ID, SSN, DOB, driver's license) used for conflicts, billing, and document generation.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/identifiers.ts; IDENTIFIER_TYPES catalog in types.ts
  notes: Backend shipped; UI not built.

- id: directory.identifiers.protected-fields
  name: Field-level encryption and access control
  scope: Sensitive fields (SSN, EIN, DOB, financial) structurally encrypted via the data-access protected() field type with HMAC blind index so conflicts can match without decrypting; access logged.
  status: shipped
  slices: 1-2-protected-crypto-module, 1-3-directory
  adrs: ADR-0084
  spec: docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md
  evidence: identifiers.ts imports blindIndexValue/composeProtectedWrite/readProtected from @magna-carta/data-access/protected-fields; status.d/1-2 on main

- id: directory.duplicates
  name: Duplicate detection
  scope: Fuzzy name + identifier matching on entry and import surfacing possible-duplicate candidates.
  status: partial
  slices: 1-3-directory
  adrs: ADR-0086
  evidence: findDuplicateCandidates export (phonetic-block, trigram, blind-index equality) in packages/directory/src/search.ts, phonetics.ts
  notes: Candidate engine shipped; entry-time "possible duplicate?" prompt is UI, not built.

- id: directory.merge
  name: Non-destructive merge
  scope: Merge folds a duplicate into a master, repoints every reference, archives (never deletes) the subordinate, and records survivorship plus the exact repoint list in an append-only entity_merge event.
  status: partial
  slices: 1-3-directory
  adrs: ADR-0086
  evidence: packages/directory/src/merge.ts (repoint with collision absorption, prior-value recording)
  notes: Backend shipped; merge tooling UI not built.

- id: directory.merge.unmerge
  name: Guarded unmerge
  scope: Reversal of a recent, still-clean merge; locked once post-merge activity accrues.
  status: deferred
  adrs: ADR-0086
  evidence: ADR-0086 defers the guarded automated unmerge to the LEAP slice; merge.ts records prior values so nothing is irrecoverable
  notes: Deferral-with-seam, not a retrofit; no unmerge export exists in packages/directory.

- id: directory.archival
  name: Soft-delete and archival
  scope: Entities referenced by a matter or the conflicts log are archived, never hard-deleted.
  status: shipped
  slices: 1-3-directory
  evidence: deleted_at soft-delete columns throughout directory statements; merged subordinate archived with status merged_into

- id: directory.temporal-audit
  name: Temporal history and audit
  scope: Key fields (names, addresses, affiliations, roles) time-bounded (valid-from/valid-to) to answer "what was true then"; every change audited (who/what/when).
  status: shipped
  slices: 1-3-directory
  evidence: valid_from/valid_to on directory_edge; name-history current/former flips; packages/directory/src/audit.ts

- id: directory.legacy-id
  name: Legacy source-system ID
  scope: A legacy source-system identifier on every entity for LEAP migration traceability.
  status: not-started
  adrs: ADR-0021
  evidence: no legacy/source-system column found in packages/directory or the per-firm schema
  notes: LEAP migration itself is deferred (ADR-0021); this lands with that slice.

- id: matters
  name: Matters
  scope: Matter as the top-level access unit and cost center, opened directly with the client as a Directory link.
  status: partial
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0007
  spec: docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md
  evidence: packages/matters + apps/worker/src/routes/matters.ts on main; status.d/1-1 built done, ui todo
  notes: Backend shipped; matter UI in flight (matter-detail skeleton design, file-surface-web stream) but not landed as a usable surface.

- id: matters.parties
  name: Matter parties
  scope: Parties attached via Directory role-links; multiple roles per entity on one matter.
  status: partial
  slices: 1-1-matters-locations-file-manager, 1-3-directory
  evidence: packages/directory/src/party.ts wired to matters
  notes: Backend shipped; UI not built.

- id: matters.numbering
  name: Configurable matter numbering
  scope: Firm-configurable numbering scheme engine (ordered segment template, counters) drawing the number at open.
  status: partial
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0079
  evidence: packages/matters/src/numbering/ (scheme-service, segments, counters, render) + routes/numbering.ts
  notes: Backend shipped; scheme configuration UI not built.

- id: matters.numbering.location-segment
  name: Location segment in numbering
  scope: Optional location segment/prefix in the numbering scheme.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  evidence: location_code segment kind in packages/matters/src/numbering/segments.ts

- id: matters.types
  name: Flexible matter types
  scope: Matter types carrying type-specific fields for mixed practices, via the shared custom-fields engine.
  status: partial
  slices: 1-1-matters-locations-file-manager, 1-4-custom-fields-engine
  adrs: ADR-0087
  evidence: packages/matters/src/matter-type-service.ts + routes/matter-types.ts; custom-fields engine on main
  notes: Backend shipped; practice-area templates explicitly deferred (status.d/1-4: "before first client"); UI not built.

- id: matters.types.templates-workflows
  name: Per-type templates and workflows
  scope: Matter types carrying document templates and workflows.
  status: not-started
  evidence: document automation (status.d/2-6) is "Not started"; no workflow engine in tree
  notes: Depends on document automation.

- id: matters.home-location
  name: Optional home Location
  scope: A matter optionally assigned to a firm office, which supplies its number prefix, letterhead/remit-to on generated documents and bills, and per-location reporting; firm default otherwise.
  status: partial
  slices: 1-1-matters-locations-file-manager
  evidence: matter-location reference + location_code numbering segment on main
  notes: Link and number-prefix shipped; letterhead/remit-to on documents and bills awaits billing and document automation; per-location reporting awaits the reports slice.

- id: matters.lifecycle
  name: Matter lifecycle
  scope: Prospective, Open, Closed statuses; Open draws the matter number; Closed is archived-but-additive with reopen support.
  status: partial
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0079, ADR-0080
  evidence: packages/matters/src/matter-service.ts (prospective/open/closed transitions, reopen restoring prior state, frozen numbers)
  notes: Backend shipped; lifecycle UI not built.

- id: matters.lifecycle.consultations
  name: Consultations (prospective matters)
  scope: Unnumbered lightweight matters kept out of the main list, surfaced in a per-attorney Consultations virtual view; parties feed conflicts permanently; conflicts run at intake.
  status: partial
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0080
  evidence: prospective status with no number/counter in matter-service.ts; consultation queries with staleness in queries.ts
  notes: Backend shipped; Consultations folder view is UI (not built); the conflicts engine that runs at intake is not built (slice-4-1-conflicts branch empty).

- id: matters.lifecycle.close-preconditions
  name: Close-precondition hook
  scope: Named close-precondition registry run at close; any failure blocks the close; empty until the Financial Core registers "all bills paid, no remaining balance".
  status: shipped
  slices: 1-1-matters-locations-file-manager
  evidence: packages/matters/src/close-preconditions.ts (registry empty by design at this layer)
  notes: The zero-balance rule registration belongs to the trust slice and is not yet registered.

- id: matters.lifecycle.stale-consultations
  name: Stale-consultation policy and bulk close
  scope: Per-firm age policy flags stale consultations for bulk close; closed prospectives retained forever as conflict history.
  status: partial
  slices: 1-1-matters-locations-file-manager
  evidence: staleAgeDays setting in packages/matters/src/settings.ts; isStale flag in queries.ts
  notes: Flagging backend shipped; the bulk-close affordance is UI and no bulk-close operation was found.

- id: matters.file-manager
  name: File Manager
  scope: Navigation over the matter's versioned R2 files — folders, document types, drag/drop.
  status: partial
  slices: 1-1-matters-locations-file-manager
  spec: docs/specs/2026-07-09-matter-file-manager-design.md
  evidence: packages/file-manager; routes folders.ts, files.ts, document-types.ts; file-surface-web merge landed primitives + contract
  notes: Backend and file-manager primitives on main; the Files UI is queued behind the app shell (status.d/1-1 next).

- id: matters.file-manager.content-hash
  name: Content hash on every stored object
  scope: SHA-256 computed at write time for fixity, delta verification, duplicate detection, upload short-circuit, scan-verdict caching, and no-op version skip.
  status: shipped
  slices: file-hash-integrity, 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0078
  spec: docs/specs/2026-06-23-file-hash-integrity-design.md
  evidence: packages/file-integrity (streaming multi-algorithm hash + ingest-baseline compare); status.d/file-hash-integrity built+tested
  notes: Cross-matter blob dedup deliberately undecided per the white paper.

- id: matters.file-manager.bulk-download
  name: Bulk download (zip)
  scope: Streaming, store-mode, ZIP64 archives of selected files/folders or a whole matter, versions pinned at request time, access-checked and audit-logged; single-file selections download directly.
  status: shipped
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0082
  evidence: apps/worker/src/downloads/bundle-coordinator.ts + routes/downloads.ts; status.d/2-1 built
  notes: Client-portal reuse awaits the portal (not built).

- id: matters.file-manager.bulk-download.async-jobs
  name: Async bulk-download jobs
  scope: Seam switching very large bundles to an async job producing an R2 artifact behind a signed URL.
  status: shipped
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: apps/bundle-worker + routes/bundle-status.ts; docs/specs/2026-06-17-slice-2-1-plan-3-async-bulk-download-implementation-plan.md
  notes: White paper scoped v1 to live-stream only; the async path was built anyway per the 2-1 plan.

- id: matters.file-manager.upload
  name: Direct-to-R2 inbound upload
  scope: Worker mints presigned URLs and records metadata; presigned PUT for small files, resumable S3 multipart above a threshold; per-firm max-size/content-type policy enforced at presign and re-verified at the quarantine gate.
  status: shipped
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0081
  spec: docs/specs/2026-06-16-slice-2-1-inbound-upload-untrusted-pipeline-design.md
  evidence: routes/uploads.ts; status.d/2-1 built, deployed scan pipeline
  notes: Client portal and Discovery reuse await those subsystems.

- id: matters.file-manager.untrusted-pipeline
  name: Untrusted-file pipeline
  scope: Every uploaded byte treated as untrusted — gates, quarantine, scanning, safe delivery, continuous re-scan.
  status: partial
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download, 2-3-inline-preview-safe-delivery-sandbox
  evidence: apps/scan-worker deployed (magna-carta-scan, SCAN_SERVICE per status.d/2-1); routes scan-policy.ts, scan-matter.ts, scan-diagnose.ts
  notes: Children mix shipped and deferred; EICAR live check deferred (no prod users).

- id: matters.file-manager.untrusted-pipeline.pre-acceptance
  name: Pre-acceptance gates
  scope: Authenticated upload, per-firm size and content-type allow-list, magic-byte validation, decompression-bomb and nested-archive guards, filename sanitization.
  status: shipped
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: packages/file-type verifier; pdf-decompression-guard specs built; per-firm scan policy landed (status.d/2-1)

- id: matters.file-manager.untrusted-pipeline.quarantine
  name: Quarantine-on-arrival
  scope: Bytes land not visible/servable/indexed until cleared; async scan via R2 event, Queue, scanner; verdict stored as file metadata; quarantine, never auto-delete.
  status: shipped
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: ingest consumer + quarantine status gate per the 2-1 design; status.d/2-1 built

- id: matters.file-manager.untrusted-pipeline.scan-engine
  name: Malware scan engine port
  scope: Scanning as a swappable port with one or more engines behind it; no privileged bytes leave firm-controlled infrastructure.
  status: partial
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: YARA Forge rules + raw-facts engine + score-histogram seam landed (status.d/2-1); apps/scan-worker
  notes: Baseline engines shipped; the concrete commercial engine choice is explicitly deferred behind the port (its own future ADR).

- id: matters.file-manager.untrusted-pipeline.cdr
  name: CDR disarmed renditions
  scope: Optional disarmed copy of document types while the original is preserved byte-for-byte for evidence.
  status: not-started
  evidence: no CDR engine or rendition path in tree
  notes: Named optional in the pipeline design; engine choice deferred.

- id: matters.file-manager.untrusted-pipeline.safe-delivery
  name: Safe delivery (structural)
  scope: Separate cookieless sandbox origin, CSP, iframe sandbox, safe-rendition preview defeating stored-XSS uploads.
  status: shipped
  slices: 2-3-inline-preview-safe-delivery-sandbox
  adrs: ADR-0115
  spec: docs/specs/2026-06-19-slice-2-3-inline-preview-safe-delivery-design.md
  evidence: status.d/2-3 built+tested (cookieless subresource delivery under first-party HMAC token)
  notes: Player/preview UI queued behind the app shell.

- id: matters.file-manager.untrusted-pipeline.rescan
  name: Continuous re-scan
  scope: Re-scan sweep on signature updates via cron fan-out; audit every verdict; alert staff on hits.
  status: partial
  evidence: access-triggered rescan built (rescan handling in apps/scan-worker; docs/specs/2026-06-22-access-triggered-rescan-design.md + implementation plan)
  notes: Access-triggered rescan exists; the signature-update cron sweep was not verified in tree.

- id: locations
  name: Locations (offices)
  scope: First-class per-firm entity for physical offices; a dimension within the firm tenancy boundary, referenced by matters, trust accounts, Custodian roots, users, and generated documents.
  status: partial
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0031
  spec: docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md
  evidence: packages/locations + routes/locations.ts on main; status.d/1-1 built done, ui todo
  notes: Backend shipped; administration UI not built.

- id: locations.fields
  name: Location fields
  scope: Name/label, active/closed status, physical addresses + contact info, jurisdiction, letterhead and branding assets (logo, address block, footer, remit-to), optional matter-number prefix/segment.
  status: partial
  slices: 1-1-matters-locations-file-manager
  evidence: location-service.ts carries jurisdiction, remitTo, one physical + one mailing address, status
  notes: Core fields shipped; branding assets (logo, address block, footer) beyond remit-to were not found — they land with document automation consumers.

- id: locations.staff-assignment
  name: Staff assignment
  scope: Users belong to one or more locations with exactly one designated primary.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  evidence: member-location assignments with exactly-one-primary validation in packages/locations/src/location-service.ts

- id: locations.usage
  name: Location consumers
  scope: The surfaces a Location feeds — matters, trust accounts, Custodian roots, generated output
  status: partial

- id: locations.usage.matters
  name: Location on matters
  scope: Optional home-Location reference supplying number prefix and firm-default fallback.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  evidence: matter home-location reference + location_code numbering segment on main

- id: locations.usage.trust-accounts
  name: Location on trust accounts
  scope: Each trust account associated with a Location; jurisdiction trust-rule profile binds per account.
  status: designed
  slices: 3-2-trust-accounting-jurisdiction-compliance
  spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
  evidence: trust_account-to-location binding specified in the approved trust jurisdiction-schema design; location.jurisdiction column already on main as the seam
  notes: No trust-account code in tree yet.

- id: locations.usage.custodian
  name: Location as Custodian root
  scope: Physical-location hierarchy rooted at a Location (Location, safe, box, position).
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: safe-custody design salvaged to main; safe-custody-design branch exists; no custody code in tree

- id: locations.usage.documents-billing
  name: Location identity on generated output
  scope: Location fields feed the data dictionary so generated documents and invoices carry correct office identity.
  status: not-started
  evidence: document automation (status.d/2-6) not started; billing/invoicing slice not started
  notes: The source data (remit-to, addresses) is shipped; no consumer exists.

- id: locations.access-model
  name: Location as filter, not gate
  scope: Location is a view/reporting filter; data stays firm-wide open by default; hard per-location separation is a reserved seam.
  status: shipped
  adrs: ADR-0068
  evidence: ADR-0068 access-control model; no location gating in the access-control registry

- id: locations.soft-delete
  name: Location soft-delete
  scope: A Location referenced by a matter, trust account, or custody record is closed/archived, never hard-deleted.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  evidence: closeLocation + active/closed status in location-service.ts; no hard-delete path

- id: custom-fields
  name: Custom-fields engine
  scope: Shared typed custom-fields engine serving Directory categories and matter types.
  status: partial
  slices: 1-4-custom-fields-engine
  adrs: ADR-0087, ADR-0107, ADR-0108
  spec: docs/specs/2026-06-18-slice-1-4-custom-fields-design.md
  evidence: packages/custom-fields (typed-EAV, migration 0013); status.d/1-4 built done, ui todo, tested todo
  notes: Backend shipped; definition/entry UI deferred until the app shell.

- id: custom-fields.typed
  name: Typed fields and values
  scope: Typed field definitions with value coercion, picklist options, and limits.
  status: shipped
  slices: 1-4-custom-fields-engine
  evidence: types.ts, coercion.ts, picklist-option-service.ts, limits.ts in packages/custom-fields/src

- id: custom-fields.stable-identity
  name: Stable field identity
  scope: Renaming a field never breaks stored data or templates.
  status: shipped
  slices: 1-4-custom-fields-engine
  evidence: identity-keyed typed-EAV model in custom-field-service.ts; rename is metadata-only

- id: custom-fields.convert
  name: Non-destructive retype
  scope: Retyping is a guided, reversible convert.
  status: shipped
  slices: 1-4-custom-fields-engine
  evidence: packages/custom-fields/src/convert.ts
  notes: The guided UX is UI and not built; the reversible conversion machinery is.

- id: custom-fields.retire
  name: Archive and gated purge
  scope: Retiring a field archives it without losing history; purge is gated.
  status: shipped
  slices: 1-4-custom-fields-engine
  evidence: packages/custom-fields/src/purge.ts; archive/gated-purge noted in status.d/1-4

- id: custom-fields.temporal-audit
  name: Temporal history and audit
  scope: Value history retained over time; changes audited.
  status: shipped
  slices: 1-4-custom-fields-engine
  evidence: temporal history in status.d/1-4; packages/custom-fields/src/audit.ts

- id: custom-fields.consumers
  name: Searchable, reportable, automation-usable
  scope: Custom fields usable in search, reporting, and document automation.
  status: partial
  slices: 1-4-custom-fields-engine
  evidence: typed reads in packages/custom-fields/src/reads.ts
  notes: Read primitives exist; reporting (reports slice) and document automation (status.d/2-6 not started) consumers do not.
