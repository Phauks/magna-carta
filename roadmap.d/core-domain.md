# Core Domain — Directory, Matters & Locations

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Clients, matters and offices -->

- id: directory
  name: Directory
  scope: Single source of truth for every person and organization, modeled as a graph of entities and typed edges.
  status: partial
  slices: 1-3-directory
  adrs: ADR-0006, ADR-0085
  spec: docs/specs/2026-06-12-slice-1-3-directory-design.md
  evidence: packages/directory on main; the Directory list at apps/web/src/routes/(app)/directory and the entity window every record opens in at apps/web/src/lib/directory/entity-window.svelte; the linking family at packages/design-system/src/lib/components/{entity-identity,entity-picker,record-parties}
  audience: public
  public-name: One record for every person and organization
  public-summary: Clients, opposing parties, courts, experts and vendors in one place, with the relationships between them held as facts rather than notes.
  notes: Backend complete; the list, the entity window and its panes are built and owner-reviewed; edge creation, category management and the deeper edge catalog remain (docs/specs/2026-09-02-directory-linking-design.md).

- id: directory.entities
  name: Person and Organization entities
  scope: Distinct Person and Organization types with equal data depth; full contact core (typed emails/phones/addresses, notes) on every entity regardless of role.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/person.ts, organization.ts, entity-kind.ts, person-record.ts (a whole person in one batch); apps/web/src/lib/directory/new-person-dialog.svelte (every section reachable at creation, on the side rail) and apps/web/src/lib/directory/entity-window.svelte, the one window a record opens in from the directory, a matter or a conflicts hit, with the Names, Contact, Address, Pronouns, Dates, Identifiers, Duplicates, Relationships, Matters and (organizations only) Categories panes on the same rail; a recorded email, number or address is corrected in place through the same entry row it was entered in (apps/web/src/lib/directory/sections/contact-section.svelte and address-section.svelte over updateDirectoryContactPoint)
  notes: Backend shipped; the record opens in one window wherever it is reached (owner ruling, 2026-09-05). The organization stays thin by the owner's ruling. Postal addresses have their own section over the country-shaped AddressFields component, and both panels hold one height whichever rail section is chosen (owner ruling, 2026-09-08).

- id: directory.entities.categories
  name: Entity categories
  scope: Per-firm classification labels (attorney, judge, court, expert, vendor, client) that are not schema variants.
  status: partial
  surface: screen
  slices: 1-3-directory
  evidence: packages/directory/src/categories.ts; apps/web/src/lib/directory/categories-pane.svelte, on organizations only, assigns and creates a category the firm has not named yet through the add row; category repointing handled in merge.ts
  notes: Backend shipped; assignment and creation are on the record's window. Archiving a category has no route yet.

- id: directory.entities.category-fields
  name: Category-specific custom fields
  scope: Category-specific data (bar number, jurisdiction, specialty/rate) defined through the shared custom-fields engine; add-only, equal depth preserved.
  status: partial
  surface: awaiting-screen
  slices: 1-3-directory, 1-4-custom-fields-engine
  adrs: ADR-0087
  evidence: packages/custom-fields consumed for directory entities per ADR-0087
  notes: Engine shipped (see custom-fields.\*); field-definition and entry UI not built.

- id: directory.names
  name: Structured names and name history
  scope: Structured person names (prefix/first/middle/last/suffix), aliases/AKAs, maiden and former names, preferred/display name; org legal name, DBAs/trade names, former names; retained name-change history.
  status: partial
  surface: screen
  slices: 1-3-directory
  evidence: packages/directory/src/name-history.ts (current-to-former flip, alias/aka/maiden/dba roles), normalize-name.ts; apps/web/src/lib/directory/names-pane.svelte and sections/names-section.svelte, over the shared honorific field at apps/web/src/lib/names/honorific-field.svelte
  notes: Backend shipped including phonetic codes on every name row; the Names pane adds and changes names. A person is recorded with a first name and no more required — a mononym is indexed from the given name — and carries as many suffixes as they hold, comma-separated in the one column (owner ruling, 2026-09-08). display_text and the legal/preferred roles remain.

- id: directory.pronouns
  name: Pronouns on a person
  scope: Optional, owner-entered pronouns on a Directory person — the whole declension plus verb agreement — feeding the document-assembly pronoun helpers; never inferred from a name, a title, or a gender attribute.
  status: partial
  surface: screen
  slices: 1-3-directory, 2-6-document-automation
  evidence: apps/web/src/lib/directory/pronouns-pane.svelte; six columns on directory_person with an all-or-nothing table CHECK, packages/directory/src/pronouns.ts, PUT /api/v1/directory/persons/{id}/pronouns, and the pronoun()/pronounVerb() helpers in packages/document-assembly/src/expression
  awaiting-owner: Whether a separate gender field is ever added to a Directory person. It is deliberately not built; pronouns are owner-entered and never inferred.
  notes: Backend shipped and the Pronouns pane on the record screen enters them. A separate gender field is deliberately not built and is flagged for the owner.

- id: directory.edges
  name: Typed edges
  scope: First-class typed, dated edges between entities (affiliations, relationships, representation, role assignments) with valid-from/valid-to.
  status: partial
  slices: 1-3-directory
  evidence: packages/directory/src/edges.ts; EDGE_TYPES catalog in types.ts with the membership family; apps/web/src/lib/directory/edges-pane.svelte records an edge from either record through EntityPicker, the direction decided by the type (edge-draft.ts)
  notes: Backend and the record screen shipped. The tighter constituent class for the conflicts traversal waits for the conflicts pass; every constituent type is classed control meanwhile.

- id: directory.edges.affiliations
  name: Affiliations (person-org)
  scope: Typed, dated person-to-organization links (officer, employee, partner, member, registered agent, attorney-at-firm) with per-contact flags (primary, billing, do-not-contact).
  status: partial
  surface: awaiting-screen
  slices: 1-3-directory
  evidence: EDGE_TYPES officer_of, director_of, partner_of, trustee_of, personal_representative_of, agent_of, employment, member_of, shareholder_of, point_of_contact_for beside the legacy affiliation; an organization's People pane and a person's Organizations pane in apps/web/src/lib/directory/edges-pane.svelte
  notes: The membership family is built and offered; affiliation stays for the rows already recorded. The promised per-contact flags (primary/billing/do-not-contact) are not built; contact permission and preference live on the contact points instead, and do-not-contact is a per-matter derivation by the entity-model design.

- id: directory.edges.relationships
  name: Relationships (person-person, org-org)
  scope: Typed relationship edges — spouse/family, guardian/ward, trustee, beneficiary, business partner; corporate parent/subsidiary/successor/affiliate — feeding conflicts, estate planning, corporate work.
  status: partial
  surface: awaiting-screen
  slices: 1-3-directory
  evidence: EDGE_TYPES includes relationship, guardian_of, beneficiary_of, corporate_parent, corporate_subsidiary, corporate_successor; conflict-oriented read-all-current query in edges.ts; recorded from the Relationships pane
  notes: Backend and the record screen shipped; the conflicts engine consumes these — expandGraph in packages/conflicts/src/expansion.ts walks them and costs the corporate types nothing.

- id: directory.edges.representation
  name: Representation edges
  scope: Counsel-represents-party edges scoped within a matter.
  status: partial
  surface: awaiting-screen
  slices: 1-3-directory
  evidence: EDGE_TYPES includes "representation" in packages/directory/src/types.ts
  notes: Backend edge type shipped; no UI.

- id: directory.edges.role-assignments
  name: Matter role assignments
  scope: Entity-to-matter role links with the role on the link, not the entity; one entity can hold multiple roles in one matter.
  status: partial
  surface: screen
  slices: 1-3-directory, 1-1-matters-locations-file-manager
  evidence: packages/directory/src/party.ts (matter_party rows, one per role, no uniqueness on (matter, entity)); apps/web/src/routes/(app)/matters/[id]/parties/+page.svelte on the RecordParties tab
  notes: Backend shipped; the matter's Parties page adds a party from the Directory picker with a role and a capacity, and removes one. The matter's client is a party row from the moment the matter exists, written by the intake's create.

- id: directory.identifiers
  name: Typed identifiers
  scope: Typed identifier list (bar number, EIN/Tax ID, SSN, DOB, driver's license) used for conflicts, billing, and document generation.
  status: shipped
  slices: 1-3-directory
  evidence: packages/directory/src/identifiers.ts and identifier-shape.ts (the type decides the fields and checks the shape; the label column names what a sealed value is of); apps/web/src/lib/directory/sections/identifiers-section.svelte on the record's Identifiers pane and the New Person screen
  notes: Typed shapes with format checks on both sides; accounts sealed with their username and secret; the dob kind removed (dates live on the person).

- id: directory.identifiers.protected-fields
  name: Field-level encryption and access control
  scope: Sensitive fields (SSN, EIN, DOB, financial) structurally encrypted via the data-access protected() field type with HMAC blind index so conflicts can match without decrypting; access logged.
  status: shipped
  surface: internal
  slices: 1-2-protected-crypto-module, 1-3-directory
  adrs: ADR-0084
  spec: docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md
  evidence: identifiers.ts imports blindIndexValue/composeProtectedWrite/readProtected from @magna-carta/data-access/protected-fields; status.d/1-2 on main

- id: directory.addresses
  name: Postal addresses
  scope: Structured postal addresses on every directory entity, held as the international field set so a country's own shape is a presentation of the stored columns rather than a schema of its own.
  status: shipped
  slices: 1-3-directory
  evidence: directory_address in packages/database/src/per-firm-schema.ts carries recipient, organization, two address lines, dependent locality, locality, administrative area, postal code, sorting code and country, plus the four verification columns and a duplicate-detection normalized_key; written through packages/directory/src/statements.ts and entered on the record's Address pane (apps/web/src/lib/directory/sections/address-section.svelte).
  notes: The field set is the international one rather than a state and a five-digit code, which is what lets a provider's structured result land later with no migration.

- id: directory.addresses.constraints
  name: Postal-code and administrative-area constraints
  scope: What a well-formed postal code looks like in a country and which administrative areas it publishes, so an address form can say a code reads wrong and can offer a state.
  status: shipped
  surface: screen
  evidence: packages/address-formats — a corpus of 252 countries checked in at docs/research/address-formats/corpus.json, projected by scripts/build-data.mts into two generated modules (182 postal-code formats, 62 administrative-area lists, 1,619 areas) with a --check drift guard; validatePostalCode anchors and case-folds the published pattern, administrativeAreasFor offers the list. Reaches AddressFields as optional props, wired on the Directory record's Address pane and the office record window.
  notes: A warning and never a gate — a malformed code renders as the field's hint, so the box is never marked invalid and nothing can refuse a commit. "No published format" is a distinct answer from "wrong", and an administrative-area list is a suggestion the field still takes free text past.

- id: directory.addresses.lookup
  name: Address autocomplete
  scope: Offering real addresses as a person types one, and turning a chosen offer into the parts a record stores.
  status: partial
  surface: internal
  evidence: packages/address-lookup holds the port and the deferred implementation — AddressLookupPort with suggest/resolve, typed outcomes that never throw, and deferredAddressLookupPort() answering engine-not-implemented to everything, the same wired-but-dormant shape resolveSearchIndexPort takes. No engine.
  notes: Partial because the seam exists and the engine does not. Two candidate engines, and the owner's 2026-09-20 ruling that an address may leave the tenancy means they now compete on cost rather than on confidentiality: a self-hosted index over the open address corpora reusing crates/search-core and the R2 range-reader containers/search already runs (no per-lookup fee, but an index build and a refresh cadence), or a hosted provider (no build, a per-lookup rate). AddressLookupPort is indifferent to which wins. no-coverage is a first-class outcome because the open corpora cover countries very unevenly.

- id: directory.duplicates
  name: Duplicate detection
  scope: Fuzzy name + identifier matching on entry and import surfacing possible-duplicate candidates.
  status: shipped
  surface: awaiting-screen
  slices: 1-3-directory
  adrs: ADR-0086
  evidence: findDuplicateCandidates export (phonetic-block, trigram, blind-index equality) in packages/directory/src/search.ts, phonetics.ts
  notes: Candidate engine shipped; the entry-time gate runs beside the New Person and New Organization entry (apps/web/src/lib/directory/duplicate-gate.svelte), permanently in view as the name is typed.

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
  surface: internal
  slices: 1-3-directory
  evidence: deleted_at soft-delete columns throughout directory statements; merged subordinate archived with status merged_into

- id: directory.temporal-audit
  name: Temporal history and audit
  scope: Key fields (names, addresses, affiliations, roles) time-bounded (valid-from/valid-to) to answer "what was true then"; every change audited (who/what/when).
  status: shipped
  surface: internal
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
  evidence: packages/matters + apps/api-worker/src/http/routes/matters/matters.ts on main; the intake at apps/web/src/lib/matters/new-matter-dialog.svelte chooses the client from the directory (EntityPicker) and the create writes the client party in the same batch
  audience: public
  public-summary: Open a matter, set who is involved and how it is numbered, and keep everything about it in the one place for the life of the file.
  awaiting-owner: The platform carries no note, comment or timeline entity on any record, and one design now asks whether to build one. Is the note primitive built at all, and as a platform slice belonging to every matter and every Directory entity rather than to whichever subsystem needs it first? If no, intake's prospect timeline stays derived-only and cannot hold "she is thinking about it", the matter detail keeps promising a Notes section it will not have, tasks land on an activity stream nobody owns, and every subsystem that needs somewhere to write a sentence grows its own note column. If yes, it comes before tasks and before intake. Notes and activity design flag W1, raised by the client intake design as J6.
  notes: Backend shipped, and the matter host has landed since this said otherwise — thirteen section routes under the matter, a matter header and a section nav, an overview reading the real record, and a Files section running the whole document loop against the file API through the same-origin seam in apps/web/src/lib/documents/. The matters LIST is still the honest empty state rather than a list; of the thirteen sections, seven render a SectionStub and six read the firm's own record (Overview, Files, Time, Costs, Parties, Calendar). The file-surface-web stream named here is abandoned and superseded; what carried its reasoning forward has landed.

- id: matters.parties
  name: Matter parties
  scope: Parties attached via Directory role-links; multiple roles per entity on one matter.
  status: partial
  surface: screen
  slices: 1-1-matters-locations-file-manager, 1-3-directory
  evidence: packages/directory/src/party.ts (link, read with the entity name and capacity resolved, sever) over three routes in apps/api-worker/src/http/routes/directory/directory.ts; the matter Parties section at apps/web/src/routes/(app)/matters/[id]/parties/+page.svelte on the RecordParties tab links, reads and severs; the client's own party row is written by packages/matters createMatter in the same batch as the matter (clientPartyStatements).
  notes: The read and the sever were both missing until the section was built - a link could be written through the API and never read back, and nothing anywhere set matter_party.deleted_at although five readers filtered on it. Adding a party is live on the design-system picker; the client is chosen from the directory at intake and is required for an open matter and a consultation alike, because a consultation's conflict check needs a person.

- id: matters.numbering
  name: Configurable matter numbering
  scope: Firm-configurable numbering scheme engine (ordered segment template, counters) drawing the number at open, the settings editor that writes it, and a number set by hand.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0079
  evidence: packages/sequence-numbering/src/ (purposes, segments, render, scheme-service, scheme-draw) with matters' own tables in packages/matters/src/numbering/ + routes/firm/numbering.ts; the editor in apps/web/src/lib/matters/numbering-scheme-editor.svelte under Settings · Numbering, with the model in numbering-scheme.ts; Set Number on the status window over the renumber route
  notes: Backend and the settings editor shipped (2026-09-06). One editor per purpose, the parts named for the reader, scoping drawn as "restarts the count", starters for the common shapes, and the preview rendered by the server's own renderer against a sample matter. A matter's number is set by hand from its status window, only where the matter has been active; the renumber service refuses the unnumbered rungs. The engine moved out of matters into the platform-wide numbering register on 2026-09-18 (matters.numbering.register).

- id: matters.numbering.register
  name: One numbering register for every sequence
  scope: Every number the firm issues on one register in @magna-carta/sequence-numbering (purpose, when drawn, parts, what decides the counter scope, default); all eight sequences drawn through the shared planner from firm-written schemes; the numbering listing route; Settings · Numbering as one fold per sequence.
  status: shipped
  surface: screen
  slices: 1-1-matters-locations-file-manager
  evidence: packages/sequence-numbering/src/purposes.ts + scheme-draw.ts; packages/conflicts/src/check-numbering.ts and the draw in check-run.ts; packages/custodian/src/packet-service.ts; the draws in packages/billing/src/finalize.ts, packages/timekeeping/src/entry-numbering.ts and packages/communications/src/communication-service.ts; GET /api/v1/numbering-schemes in apps/api-worker/src/http/routes/firm/numbering.ts; apps/web/src/routes/(app)/settings/numbering/+page.svelte; the per-firm migrations 20260918T195508_conflicts-check-numbering-scheme and 20261002T192145_communication-number-scope-parts
  notes: Shipped 2026-09-18; the last three fixed runs became schemes on 2026-09-20. Conflicts checks default to CC2026-00001 restarting each year (a four-digit firm-wide run was the wrong default for the busiest sequence); custody keeps CUS-00001 as its default. Invoice, time-entry and call numbers are schemes like the rest, each defaulting to byte-for-byte what it rendered before — which needed the month, day and matter-number parts plus scopeSource (template-derived scope versus a key the domain passes) and scopeDistinguishedBy on the register. A new sequence is a row here and a draw site; nothing about its shape goes in the owning package.

- id: matters.numbering.location-segment
  name: Location segment in numbering
  scope: Optional location segment/prefix in the numbering scheme.
  status: shipped
  surface: screen
  slices: 1-1-matters-locations-file-manager
  evidence: location_code segment kind in packages/sequence-numbering/src/segments.ts

- id: matters.types
  name: Flexible matter types
  scope: Matter types carrying type-specific fields for mixed practices, via the shared custom-fields engine.
  status: partial
  slices: 1-1-matters-locations-file-manager, 1-4-custom-fields-engine
  adrs: ADR-0087
  evidence: packages/matters/src/matter-type-service.ts + routes/firm/matter-types.ts; custom-fields engine on main
  notes: Backend shipped; practice-area templates explicitly deferred (status.d/1-4: "before first client"); UI not built.

- id: matters.types.templates-workflows
  name: Per-type templates and workflows
  scope: Matter types carrying document templates and workflows.
  status: not-started
  evidence: Document automation is built through slice 2-6-5 (status.d/2-6-document-automation.md reports built done), so the templates half now has an engine to hang on — what is missing is any link from a matter TYPE to a template, and there is still no workflow engine of any kind in the tree.
  notes: The document-automation dependency is met; the matter-type binding and the workflow engine are not.

- id: matters.home-location
  name: Optional home Location
  scope: A matter optionally assigned to a firm office, which supplies its number prefix, letterhead/remit-to on generated documents and bills, and per-location reporting; firm default otherwise.
  status: partial
  surface: awaiting-screen
  slices: 1-1-matters-locations-file-manager
  evidence: matter-location reference + location_code numbering segment on main
  notes: Link and number-prefix shipped; letterhead/remit-to on documents and bills awaits billing and document automation; per-location reporting awaits the reports slice.

- id: matters.lifecycle
  name: Matter lifecycle
  scope: Intake, Consultation, Open, Hold and Closed statuses; Open draws the matter number; Hold pauses an open matter or a consultation for a recorded reason and keeps whichever number it wears, releasing to where the hold found it; a consultation closes as declined without drawing a matter number; Closed is archived-but-additive with reopen support.
  status: shipped
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0079, ADR-0080
  evidence: packages/matters/src/matter-service.ts (intake/consultation/open/hold/closed transitions — graduateMatter draws the consultation number behind the intake procedure's gate; holdMatter and releaseMatter carry the reason and draw nothing — reopen restoring the prior rung, the hold included, frozen numbers), reached from the matter masthead's status seal in apps/web/src/lib/matters/matter-status-dialog.svelte over the graduate/open/hold/release/close/reopen routes.
  notes: The UI has landed. Pressing the status seal opens a short status window - the status, how the matter is engaged (the signed agreement on file and the fee arrangement it rests on, with Amend beside it and the history folded away; moved here from the Fees screen by the owner's ruling of 2026-09-03), what closing requires with each requirement already answered, what becomes of the paper file, and the one step the status allows. The answers are the program's: GET /api/v1/matters/{id}/close-readiness runs the registered rules read-only when the window opens, so a requirement arrives met or unmet rather than as a box to tick, and a press whose refusal is already known is disabled rather than offered. The steps a status allows and never a status picker - the contract takes no status on any lifecycle operation; an active matter offers the close and the pause (Put On Hold asks for its reason in place), a held one its release and the close (owner ruling, 2026-09-06), and a consultation offers open, hold and close-as-declined (owner ruling, 2026-09-11). The seal itself is now a dropdown of those steps — never a status picker — with the status window as its last item, opened at the step when a step needs its reason or its requirements shown. The Consultations folder view and the stale-consultation bulk close are their own nodes and are still UI debt.

- id: matters.lifecycle.consultations
  name: Consultations
  scope: Lightweight matters kept out of the main list, carrying a tentative number from their own firm-settable sequence, surfaced in a per-attorney Consultations virtual view; parties feed conflicts permanently; conflicts run at intake.
  status: partial
  surface: awaiting-screen
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0080
  evidence: the consultation status drawing matter.consultation_number from the consultation-purpose scheme in matter-service.ts (at graduation from intake, or at creation when recorded outright) (numbering/consultation-scheme.ts holds the built-in default); consultation queries with staleness in queries.ts
  awaiting-owner: May a fee agreement be recorded against an intake or a consultation, before the firm has agreed to act? The billing engine would accept one today — nothing in the arrangement model asks whether the matter is numbered. The question is whether a firm should be able to agree a fee on a file it has not taken, which is a professional-conduct call rather than an engineering one. Client intake design flag J7.
  notes: Backend shipped, consultation numbering included — a consultation draws a tentative number from its own sequence, when an intake graduates or when a consultation is recorded outright, kept separate from the matter run so a consultation that is never taken consumes no matter number, and kept on the row after opening. Consultations folder view is UI (not built). The conflicts engine is shipped and its matter.created trigger already records a preliminary check, but the pre-engagement screen the scope promises has no intake flow to fire it from — see conflicts.triggers.

- id: matters.lifecycle.close-preconditions
  name: Close-precondition hook
  scope: Named close-precondition registry run at close; any failure blocks the close; empty until the Financial Core registers "all bills paid, no remaining balance".
  status: shipped
  surface: internal
  slices: 1-1-matters-locations-file-manager
  evidence: packages/matters/src/close-preconditions.ts holds the registry and CLOSE_PRECONDITIONS is empty there by design — the matter shell runs what it is handed and imports no subsystem. The rules are registered in apps/api-worker/src/http/routes/matters/matters.ts, where the subsystems meet.
  notes: The hook is also readable without acting on it - GET /api/v1/matters/{id}/close-readiness runs the same rules and reports what stands in the way, so the status window states a verdict rather than making somebody press a button to discover it; the close still re-asserts every rule inside its own batch, which is what makes a probe safe to offer. Two rules are registered and both are about somebody else's money — a client trust ledger still holding funds, and a conceded client credit. There is deliberately NO rule on an unpaid bill: an uncollectable receivable is an ordinary business outcome whose lawful exit is a write-off. Custody is registered separately as an ADVISORY rather than a rule, because a firm holds a client's will for decades after the last matter closed and a block would only teach people to unlink packets before closing.

- id: matters.lifecycle.stale-consultations
  name: Stale-consultation policy and bulk close
  scope: Per-firm age policy flags stale consultations for bulk close; closed consultations retained forever as conflict history.
  status: partial
  surface: awaiting-screen
  slices: 1-1-matters-locations-file-manager
  evidence: staleAgeDays setting in packages/matters/src/settings.ts; isStale flag in queries.ts
  notes: Flagging backend shipped; the bulk-close affordance is UI and no bulk-close operation was found.

- id: matters.physical-file
  name: Physical file register and retention
  scope: The firm's OWN paper file for a matter - what holds it, where that is kept, and the date the file may be destroyed under a firm retention policy. Distinct from Custodian, which holds client property left with the firm to guard.
  status: not-started
  evidence: Nothing in the tree models it. Custodian is client property (packages/custodian), the close stamps closed_at as the instant retention would run from (packages/matters/src/matter-service.ts), and no retention policy or destruction date exists anywhere to run from it - the custody register is explicit that it runs no timer at all and destroys an original only on a written basis by two people.
  notes: NEEDS ITS OWN DESIGN WORK, and the owner has said so: what holds a file is not one shape. A box at a remote store, a drawer in a cabinet, a safe, a shelf, a crate - the medium is a firm's own choice and a model that hardcodes any one of them is wrong for most firms, so the container is a record carrying its own kind rather than a field spelling "box". A container is a record in its own right for a second reason too: one holds the folders of several matters, so a matter points at it. Surfaced rather than hidden meanwhile - the matter status window gives it a panel of its own, marked Soon, naming what it waits on, because a window that answers "where is the file" while silently omitting the question is worse than one that says it cannot answer yet. It sits beside the status rather than under the close because the file is a standing fact: a folder sits where it sits whatever the matter's status is, and the panel says so. A destruction date is jurisdictional, so the policy is a firm setting rather than a number this platform picks.

- id: matters.file-manager
  name: File Manager
  scope: Navigation over the matter's versioned R2 files — folders, document types, drag/drop.
  status: partial
  slices: 1-1-matters-locations-file-manager
  spec: docs/specs/2026-07-09-matter-file-manager-design.md
  evidence: packages/file-manager; routes folders.ts, files.ts, document-types.ts; and the Files section of the matter host, which runs the whole loop — list, create, open, save the next version, read the version history — through the same-origin seam in apps/web/src/lib/documents/.
  notes: The Files UI has landed since this said it was queued. What it does not yet offer is folder navigation, document-type assignment or drag-and-drop, which is the rest of this node's scope; the backend for all three is built.

- id: matters.file-manager.content-hash
  name: Content hash on every stored object
  scope: SHA-256 computed at write time for fixity, delta verification, duplicate detection, upload short-circuit, scan-verdict caching, and no-op version skip.
  status: shipped
  surface: internal
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
  evidence: apps/api-worker/src/downloads/bundle-coordinator.ts + routes/files/downloads.ts; status.d/2-1 built
  notes: Client-portal reuse awaits the portal (not built).

- id: matters.file-manager.bulk-download.async-jobs
  name: Async bulk-download jobs
  scope: Seam switching very large bundles to an async job producing an R2 artifact behind a signed URL.
  status: shipped
  surface: awaiting-screen
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: apps/bundle-worker + routes/files/bundle-status.ts; docs/specs/2026-06-17-slice-2-1-plan-3-async-bulk-download-implementation-plan.md
  notes: White paper scoped v1 to live-stream only; the async path was built anyway per the 2-1 plan.

- id: matters.file-manager.upload
  name: Direct-to-R2 inbound upload
  scope: Worker mints presigned URLs and records metadata; presigned PUT for small files, resumable S3 multipart above a threshold; per-firm max-size/content-type policy enforced at presign and re-verified at the quarantine gate.
  status: shipped
  surface: screen
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0081
  spec: docs/specs/2026-06-16-slice-2-1-inbound-upload-untrusted-pipeline-design.md
  evidence: routes/files/uploads.ts; status.d/2-1 built, deployed scan pipeline
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
  surface: internal
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: packages/file-type verifier; pdf-decompression-guard specs built; per-firm scan policy landed (status.d/2-1)

- id: matters.file-manager.untrusted-pipeline.quarantine
  name: Quarantine-on-arrival
  scope: Bytes land not visible/servable/indexed until cleared; async scan via R2 event, Queue, scanner; verdict stored as file metadata; quarantine, never auto-delete.
  status: shipped
  surface: internal
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: ingest consumer + quarantine status gate per the 2-1 design; status.d/2-1 built

- id: matters.file-manager.untrusted-pipeline.scan-engine
  name: Malware scan engine port
  scope: Scanning as a swappable port with one or more engines behind it; no privileged bytes leave firm-controlled infrastructure.
  status: partial
  surface: internal
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
  surface: internal
  slices: 2-3-inline-preview-safe-delivery-sandbox
  adrs: ADR-0115
  spec: docs/specs/2026-06-19-slice-2-3-inline-preview-safe-delivery-design.md
  evidence: status.d/2-3 built+tested (cookieless subresource delivery under first-party HMAC token)
  notes: Player/preview UI queued behind the app shell.

- id: matters.file-manager.untrusted-pipeline.rescan
  name: Continuous re-scan
  scope: Re-scan sweep on signature updates via cron fan-out; audit every verdict; alert staff on hits.
  status: partial
  surface: internal
  evidence: access-triggered rescan built — rescanCommittedVersion in apps/api-worker/src/background/files/ingest-consumer.ts over the scan port (docs/specs/2026-06-22-access-triggered-rescan-design.md and its implementation plan)
  notes: Access-triggered rescan exists. The signature-update cron sweep does not: apps/api-worker/src/background/scheduled.ts runs the conflicts periodic rescan and no file one, so a signature update reaches a stored version only when somebody next opens it.

- id: matters.search
  name: Consolidated matter search
  scope: One search over everything on a matter, opening scoped to the section the reader is standing on and never widening past the matter.
  status: partial
  spec: docs/specs/2026-08-31-matter-consolidated-search-design.md
  audience: public
  public-name: Search a matter
  public-summary: Search everything on a matter from one box — notes, files, parties and what the firm holds in custody — starting with the screen you are already on.
  awaiting-owner: Four standing recommendations the build proceeded under, each reversible and none of them reaching the registry or the route — M3 whether a hit may show a snippet within a matter, M5 the new search:matter permission and its broad seeding, M6 that "include deleted" stays per source rather than one global toggle, M7 that a source withheld for want of a permission says so rather than reading as empty. M1, M2 and M4 are settled.
  notes: PARTIAL because eight of the fourteen sections answer; the other six decline in the scope dropdown with the line saying what each waits on. The read layer is a registry of declared sources on the federated-timeline pattern, so a fifteenth searchable section is one source module rather than a change to the route, the control or the results page.

- id: matters.search.sources
  name: Declared search sources
  scope: One source module per searchable section — its bounded statements, its projection, the read permission that gates it, and whether it declares a non-privileged snippet.
  status: partial
  surface: screen
  spec: docs/specs/2026-08-31-matter-consolidated-search-design.md
  evidence: packages/matter-search/src/sources/all.ts registers eight sources (files, time, costs, billing, parties, calendar, notes, custody) behind the shared builder in build.ts; test/source-fitness.test.ts asserts the matter binding, the visibility predicate, the LIMIT, the LIKE escape and the review-table refusal over the SQL each one builds
  notes: PARTIAL because six sections still decline; apps/web/src/lib/matters/sections.ts records each one's reason and pnpm run lint:matter-search-coverage refuses a section that answers neither way. Fees is blocked on the fee work-in-progress store existing at all — nothing on the wire carries the record. The matter-asset register has a query but no screen to land a hit on, so it is deliberately unregistered until the register gets one. Review-set sources are structurally refused: a review set is its own corpus.

- id: matters.search.file-contents
  name: File contents in a matter search
  scope: The Files source's second half — querying the keyword index over the matter corpus and fusing it with the file-name match.
  status: designed
  spec: docs/specs/2026-08-31-matter-consolidated-search-design.md
  notes: The engine, write pipeline and compaction are built; SearchIndexPort answers engine-not-implemented until the search Container is deployed in the order docs/deploy-queue.md names.

- id: locations
  name: Locations (offices)
  scope: First-class per-firm entity for physical offices; a dimension within the firm tenancy boundary, referenced by matters, trust accounts, Custodian roots, users, and generated documents.
  status: partial
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0031
  spec: docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md
  evidence: packages/locations + routes/matters/locations.ts on main; status.d/1-1 built done, ui todo
  audience: public
  public-name: More than one office
  public-summary: Run several offices, with staff, matters and letterhead attached to the right one and nothing hidden from the rest of the firm.
  notes: Backend shipped; administration UI not built.

- id: locations.fields
  name: Location fields
  scope: Name/label, active/closed status, physical addresses + contact info, jurisdiction, letterhead and branding assets (logo, address block, footer, remit-to), optional matter-number prefix/segment.
  status: partial
  surface: awaiting-screen
  slices: 1-1-matters-locations-file-manager
  evidence: location-service.ts carries jurisdiction, remitTo, one physical + one mailing address, status
  notes: Core fields shipped; branding assets (logo, address block, footer) beyond remit-to were not found — they land with document automation consumers.

- id: locations.staff-assignment
  name: Staff assignment
  scope: Users belong to one or more locations with exactly one designated primary.
  status: shipped
  surface: awaiting-screen
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
  surface: awaiting-screen
  slices: 1-1-matters-locations-file-manager
  evidence: matter home-location reference + location_code numbering segment on main

- id: locations.usage.trust-accounts
  name: Location on trust accounts
  scope: Each trust account associated with a Location; jurisdiction trust-rule profile binds per account.
  status: partial
  surface: awaiting-screen
  slices: 3-2-trust-accounting-jurisdiction-compliance
  spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
  evidence: the trust_account row carries location_id and the jurisdiction derived from that office, written by openTrustAccount in packages/trust/src/account-tree.ts, and packages/trust/src/movements.ts refuses every movement on an account whose office recorded no jurisdiction
  notes: The per-account binding ships; the rule profile it binds to is not yet resolved anywhere - packages/trust/src/jurisdiction.ts still refuses every requirement until a reviewed corpus is bound.

- id: locations.usage.custodian
  name: Location as Custodian root
  scope: Physical-location hierarchy rooted at a Location (Location, safe, box, position).
  status: shipped
  surface: awaiting-screen
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Shipped with custody, after this node was last written — packages/custodian/src/location-service.ts holds the recursive container tree over the custody_location table, and a root optionally binds a firm Location while an offsite or bank root binds none, so a vault never becomes an office row. The Locations side of that binding is what this node covers and it is in place; see custodian.location-hierarchy for the tree itself.

- id: locations.usage.documents-billing
  name: Location identity on generated output
  scope: Location fields feed the data dictionary so generated documents and invoices carry correct office identity.
  status: partial
  surface: awaiting-screen
  evidence: Partial because the documents half is built and the invoice half is half-built. Document automation resolves location.\* keys from the MATTER'S home location through one batched read, including the letterhead logo as a real OOXML picture (document-automation.location-identity). The invoice carries letterhead_address_block, letterhead_footer and remit_to, snapshotted at finalize rather than read live — but nothing derives them from the matter's home Location, so the caller supplies them and they default to null (financial.billing.location-letterhead).
  notes: What remains unbuilt on this node is the office-settings interface a firm would set those fields through. The office time zone has landed on both sides since — location.time_zone is an IANA zone validated on write by packages/locations/src/location-service.ts, and timeZoneForLocation is the one place it enters the platform, falling back to the normalized zone only for an office recorded before the column existed.

- id: locations.access-model
  name: Location as filter, not gate
  scope: Location is a view/reporting filter; data stays firm-wide open by default; hard per-location separation is a reserved seam.
  status: shipped
  surface: internal
  adrs: ADR-0068
  evidence: ADR-0068 access-control model; no location gating in the access-control registry

- id: locations.soft-delete
  name: Location soft-delete
  scope: A Location referenced by a matter, trust account, or custody record is closed/archived, never hard-deleted.
  status: shipped
  surface: internal
  slices: 1-1-matters-locations-file-manager
  evidence: closeLocation + active/closed status in location-service.ts; no hard-delete path

- id: custom-fields
  name: Custom-fields engine
  scope: Shared typed custom-fields engine serving matter types, Directory categories, and matter-asset classes.
  status: partial
  slices: 1-4-custom-fields-engine
  adrs: ADR-0087, ADR-0107, ADR-0108
  spec: docs/specs/2026-06-18-slice-1-4-custom-fields-design.md
  evidence: packages/custom-fields (typed-EAV, migration 0013); status.d/1-4 built done, ui todo, tested todo
  audience: public
  public-name: Fields you define yourself
  public-summary: Add your own fields to clients, matters and assets, and use them in searches, reports and generated documents.
  notes: Backend shipped; definition/entry UI deferred until the app shell.

- id: custom-fields.typed
  name: Typed fields and values
  scope: Typed field definitions with value coercion, picklist options, and limits.
  status: shipped
  surface: awaiting-screen
  slices: 1-4-custom-fields-engine
  evidence: types.ts, coercion.ts, picklist-option-service.ts, limits.ts in packages/custom-fields/src

- id: custom-fields.stable-identity
  name: Stable field identity
  scope: Renaming a field never breaks stored data or templates.
  status: shipped
  surface: internal
  slices: 1-4-custom-fields-engine
  evidence: identity-keyed typed-EAV model in custom-field-service.ts; rename is metadata-only

- id: custom-fields.convert
  name: Non-destructive retype
  scope: Retyping is a guided, reversible convert.
  status: shipped
  surface: awaiting-screen
  slices: 1-4-custom-fields-engine
  evidence: packages/custom-fields/src/convert.ts
  notes: The guided UX is UI and not built; the reversible conversion machinery is.

- id: custom-fields.retire
  name: Archive and gated purge
  scope: Retiring a field archives it without losing history; purge is gated.
  status: shipped
  surface: awaiting-screen
  slices: 1-4-custom-fields-engine
  evidence: packages/custom-fields/src/purge.ts; archive/gated-purge noted in status.d/1-4

- id: custom-fields.temporal-audit
  name: Temporal history and audit
  scope: Value history retained over time; changes audited.
  status: shipped
  surface: internal
  slices: 1-4-custom-fields-engine
  evidence: temporal history in status.d/1-4; packages/custom-fields/src/audit.ts

- id: custom-fields.consumers
  name: Searchable, reportable, automation-usable
  scope: Custom fields usable in search, reporting, and document automation.
  status: partial
  surface: awaiting-screen
  slices: 1-4-custom-fields-engine
  evidence: typed reads in packages/custom-fields/src/reads.ts; the document-automation consumer is packages/document-assembly/src/custom-field-bindings.ts, deriving one dictionary entry per active matter-axis field at read time.
  notes: Document automation consumes matter-axis fields as `custom.<handle>` merge keys; the reporting consumer does not exist. A field on the entity or matter-asset axis is deliberately not a merge key — a `custom.<handle>` is a scalar and an assembly has only the matter's row to resolve one against.

- id: matter-assets
  name: Matter asset register
  scope: Per-matter register of what a client or an estate owns — the asset row, a closed platform class with a per-firm type catalog under it, structured attributes per class, dated valuations, interests, encumbrances, documents, and the estate schedule.
  status: partial
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: packages/matter-assets + twenty routes in apps/api-worker/src/http/routes/matters/matter-assets.ts, over fifteen per-firm tables. Backend only.
  audience: public
  public-name: Asset registers
  public-summary: Track the property, accounts and possessions a matter deals with — what each is worth, what is owed against it, and who holds an interest.
  notes: All ten classes, encumbrances and equity, the grouped schedule, the custody link, the merge subjects, and the firm's own fields on an asset are built. Still open — a supplied schedule template (blocked on where platform-authored template content lives at all), the load-profile asset corpus, carry-forward from a prior matter, the integration adapters, and portal visibility. No user interface.

- id: matter-assets.register
  name: The asset row and the class spine
  scope: An asset rooted NOT NULL to one matter, a closed ten-value platform class, a per-firm type catalog under that class, a frozen class, an asserted estate treatment and disposition, and soft delete.
  status: partial
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset / matter_asset_type in packages/database/src/per-firm-schema.ts; packages/matter-assets/src/{asset,asset-type}-service.ts and src/classes.ts.
  notes: All ten classes are available to the write path. Two fields make a row (class and description) — the deliberate inversion of Custodian's mandatory owner link.

- id: matter-assets.attributes
  name: Per-class structured attributes
  scope: One one-to-one attribute table per class that has structure, with indexes on the identifiers people search by; no table for a class that has none.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: eight one-to-one attribute tables in packages/database/src/per-firm-schema.ts, with searchable indexes on parcel_number, vehicle_identification_number, plate_number and serial_number; packages/matter-assets/src/asset-service.ts drives them from one table of builders.
  notes: personalProperty and other carry no table by design. A public-record identifier is a plaintext searchable column; matter_asset_digital_asset has no column a credential could ride on, and the write path refuses one by name.

- id: matter-assets.valuations
  name: Append-only valuation history and the as-of read
  scope: Dated valuations on a closed basis vocabulary, corrected by compensating rows, with the as-of resolution that returns amount, date, and basis together — and no current-value column anywhere.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset_valuation with BEFORE UPDATE / BEFORE DELETE / replace-guard triggers in packages/database/drizzle/per-firm/20260908T000000_baseline.sql; packages/matter-assets/src/{valuation-service,as-of}.ts.
  notes: A date before an asset's first valuation resolves to nothing rather than to the earliest figure; no route edits or deletes a recorded value.

- id: matter-assets.interests
  name: Interests held by directory entities
  scope: Who holds a stake, under a firm-configurable label, as a rational share, temporally end-dated rather than deleted.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset_interest + packages/matter-assets/src/interest-service.ts; the label catalog reuses the custody ownership-role setting shape.
  notes: Optional by design — an estate where everything is the decedent's records none. Nothing derives estate treatment from an interest label or the reverse.

- id: matter-assets.documents
  name: Document links over ordinary matter files
  scope: Many-to-many links from an asset to already-ingested matter files, with no upload path of its own.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset_document + packages/matter-assets/src/document-link-service.ts; bytes ride the File Manager's presigned-upload and quarantine chokepoint only.
  notes: Deliberately not unique on file_id, diverging from custody_scan — one brokerage statement lists four accounts.

- id: matter-assets.identifiers
  name: Protected identifiers and the credential refusal
  scope: Full account, policy, certificate, and tax numbers sealed with only the last four characters readable; public-record identifiers left plaintext and searchable; credentials refused outright.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset_identifier.value_ciphertext in packages/database/src/protected-columns.ts; packages/matter-assets/src/identifier-service.ts reads only through the data-access protected chokepoint.
  notes: One audited read path, a named refusal rather than a blank without the decrypt permission, and no merge facet for a protected value.

- id: matter-assets.encumbrances
  name: Encumbrances and net equity
  scope: Mortgages, liens, and security interests with their own dated balances, and equity computed per currency as of a date.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset_encumbrance + packages/matter-assets/src/{encumbrance-service,equity}.ts; a balance is a matter_asset_valuation row naming the encumbrance, resolved by the same as-of shape.
  notes: Equity is computed and never stored, and withheld rather than approximated — an unrecorded balance or a mixed-currency pair makes it unavailable with a named reason, and negative equity is reported as negative. Releasing writes a date; nothing disappears.

- id: matter-assets.schedule
  name: The estate schedule
  scope: Grouped by class as of a date, with value, basis, actual as-of date, unreleased encumbrances, equity, per-class subtotals per currency, and a stated unvalued count.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: packages/matter-assets/src/schedule.ts behind GET /api/v1/matters/{matterId}/asset-schedule — five batched reads for a whole matter, never one per asset.
  notes: Not a court form and not a stored document — a read. The as-of date is required with no default, `undetermined` is its own group, the unvalued count is stated rather than hidden, and a group's equity subtotal is withheld when one balance in it is unstated.

- id: matter-assets.class-handling-notice
  name: Class handling notices
  scope: A standing, non-jurisdictional sentence on a class whose type carries known legal handling, rendered and acted on by nothing.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: the firearm note in packages/matter-assets/src/classes.ts, guarded by a test asserting it names no jurisdiction, cites no statute, and carries no numeral.
  notes: The register records what is held and encodes no transfer law; a verified jurisdiction catalog is a separate build behind primary-source research.

- id: matter-assets.custody-link
  name: The custody item link
  scope: One nullable column joining a scheduled asset to the custody item that physically holds it, with neither side copying the other's facts.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: matter_asset.custody_item_id set and cleared through the patch route; packages/matter-assets/src/custody-link-statements.ts composes location, status and hold state by reading Custodian, and test/custody-link.test.ts scans the source in both directions.
  notes: No unique index — the same held object can be scheduled in two matters. custody_item.declared_value_amount_minor and a valuation answer different questions; nothing syncs them, and the package names no custody declared-value column at all.

- id: matter-assets.merge-fields
  name: Asset subjects in the merge catalogue
  scope: Collection-only merge subjects per class plus an aggregate, filled by one new assembly source, with value and its date declared together and no protected value as a facet.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: the assetClass subject kind and eleven subjects in packages/document-assembly/src/catalog/subjects.ts, filled by the one `asset` source in src/resolve.ts; packages/document-assembly/test/asset-subjects.test.ts holds the collection-only rule and test/resolve-batching.test.ts the one-read budget.
  notes: No assetClass subject declares a scalar — an estate with two houses would make every scalar an absence naming the count. `value` and `valueAsOf` are declared and set together; accountSuffix is the facet and the full number has no key. A firm's own field on an asset is deliberately NOT a merge field — packages/document-assembly/src/custom-field-statements.ts scopes the catalogue to target = 'matter', held by test/custom-field-catalog-scope.test.ts over the whole target vocabulary.

- id: matter-assets.custom-fields
  name: The firm's own fields on an asset
  scope: custom_field.target widened to matterAsset, scoped per class through the engine's existing attachment_id column, with the asset detail returning each scoped field and this asset's value for it.
  status: shipped
  surface: awaiting-screen
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: CUSTOM_FIELD_TARGETS in packages/custom-fields/src/types.ts drives the drizzle column, the define-field request schema, and readCustomFieldValuesForScope in src/reads.ts; the asset detail composes it in apps/api-worker/src/http/routes/matters/matter-assets.ts; packages/custom-fields/test/{schema-name-sync,matter-asset-target}.test.ts and the asset-field block in apps/api-worker/test/matter-assets-routes.test.ts.
  notes: No migration — custom_field.target is a bare text NOT NULL with no CHECK and drizzle's enum emits no SQL, so check-snapshots reports the per-firm head already current; the readers carry the whole of the safety and the vocabulary has one home. The Custodian custodyPacket widening is decoupled rather than coordinated, because with no migration there is nothing to share.

- id: matter-assets.schedule-template
  name: A supplied asset-schedule template
  scope: A starter template assembling the estate schedule from the asset subjects with a repeating block, supplied by the platform rather than authored by each firm.
  status: planned
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  evidence: no code, and no mechanism to hold it — nothing on main distributes a platform-authored template. No template package, no committed word-processing template outside a conversion test fixture, no document_template seed in either migration lineage, no template role, no adopt route, and no provenance column on document_template. What a template would bind to is shipped under matter-assets.merge-fields, so a firm-authored upload works today; only the supplying of one is missing.
  awaiting-owner: Two questions. Whether shipped starter content rides the court-form adoption path designed in docs/specs/2026-08-14-nevada-court-form-library-design.md once its N1-N5 flags clear, or wants a distribution path that does not wait on them — an asset schedule is not a court form and carries none of that design's copyright or attorney-review weight. And what an estate asset schedule should actually say: heading, grouping, columns, whether unvalued assets are listed or counted, and what the document calls itself. Every firm provisioned after it ships inherits the answer, and neither the design nor ADR-0255's A-flags specify any of it.
  notes: The exhibits slice's separator-page and list starter templates wait on the same mechanism answer.

- id: matter-assets.carry-forward
  name: Carry-forward from a prior matter
  scope: Copying selected assets into another matter as new rows with recorded provenance, never a shared row.
  status: planned
  slices: 4-3-matter-assets
  spec: docs/specs/2026-08-05-matter-assets-design.md
  notes: Valuations do not copy by default — a value asserted in one matter as of one date is not an assertion in another.
