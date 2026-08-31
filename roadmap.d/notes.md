# Matter Notes and Activity

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Matter notes -->

- id: notes
  name: Matter notes and activity
  scope: The note primitive — a dated, attributed record on a matter, corrected by appended revision and withdrawn rather than deleted — and its entry on the federated activity read.
  status: partial
  slices: 4-4-matter-notes
  spec: docs/specs/2026-08-15-notes-and-activity-design.md
  audience: public
  public-name: Matter notes
  public-summary: Write down what happened on a case, correct it without losing what it said before, and withdraw anything that should never have been written.

- id: notes.matter-note
  name: The matter note
  scope: An identity row carrying the matter, the original author, the created instant and the state, with the body held as revisions beside it.
  status: shipped
  slices: 4-4-matter-notes
  evidence: packages/notes (note-service.ts, note-statements.ts), matter_note + matter_note_revision in packages/database/src/per-firm-schema.ts, apps/api-worker/src/routes/notes.ts, the matter's Notes section in apps/web
  audience: public
  public-summary: A note on a matter, dated and attributed the moment it is written.

- id: notes.matter-note.revisions
  name: Correction by appended revision
  scope: An edit appends a revision and moves the head; every prior body is retained with its own author and instant, and is readable from the note's own history.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  evidence: reviseMatterNote in packages/notes/src/note-service.ts; the readable chain in the Notes section's History control
  audience: public
  public-summary: Correcting a note keeps what it said before, so the earlier version is never lost.

- id: notes.matter-note.append-only-enforcement
  name: Append-only revisions, enforced by the database
  scope: Three RAISE(ABORT) triggers refuse UPDATE, DELETE and INSERT OR REPLACE on the revision table; none guards the note head, whose state must move for withdrawal.
  status: shipped
  slices: 4-4-matter-notes
  surface: internal
  evidence: packages/database/drizzle/per-firm/20260831T000000_matter-notes.sql; packages/notes/test/append-only.test.ts issues each refused statement by hand
  notes: Honouring a court-ordered destruction is therefore a reviewed migration rather than a query, which was the accepted cost.

- id: notes.matter-note.retraction
  name: Withdrawal
  scope: A state with its own actor, instant and required reason. The body stops rendering everywhere and the note leaves the federated read; the row and every revision remain.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  evidence: retractMatterNote in packages/notes/src/note-service.ts; the read nulls a retracted body in HEAD_REVISION_JOIN rather than trusting the caller
  audience: public
  public-summary: Withdraw a note that should never have been written: the text stops being shown everywhere, and the record that it existed stays.

- id: notes.matter-note.no-delete
  name: No delete path
  scope: No route, no capability, and no statement in the package deletes a note. The one case where bytes must genuinely leave routes through the erasure residue report and a person.
  status: shipped
  slices: 4-4-matter-notes
  surface: internal
  evidence: matter_note_revision.body registered report-manual, and both author columns pseudonymize-keep, in packages/data-access/src/pii-registry.ts

- id: notes.activity
  name: The note on the matter's activity history
  scope: One declared source on the calendar's federated read — keyed matterNote, matter-anchored, declaring no label — reading the note table in place.
  status: shipped
  slices: 4-4-matter-notes
  evidence: matterNoteSource in packages/calendar/src/sources/all.ts; packages/notes/test/timeline-source.test.ts proves one entry per note, the created instant as sort key, and exclusion once withdrawn
  notes: No second activity stream was built; a note joins the register that already exists, which is why nothing projects or backfills.

- id: notes.activity.no-label
  name: No privileged text on the federated read
  scope: The source projects NULL AS label, so an entry says a note was written, on this matter, then, by them, and never a word of it.
  status: shipped
  slices: 4-4-matter-notes
  surface: internal
  evidence: declaresLabel false in packages/calendar/src/sources/all.ts, asserted for every source by packages/calendar/test/source-fitness.test.ts

- id: notes.confidentiality.no-merge-field
  name: No merge field reaches a note
  scope: A source scan and a catalogue scan refuse any merge-field entry, subject or batched read that resolves to a note table.
  status: shipped
  slices: 4-4-matter-notes
  surface: internal
  evidence: packages/document-assembly/test/no-note-merge-field.test.ts
  notes: The PDF metadata scrub is structurally blind to this route, because merge-filled text is page content rather than a document-level surface.

- id: notes.confidentiality.outside-discovery
  name: Notes stay outside discovery collection
  scope: review_document.source_kind keeps its three values; producing a note means exporting it as a document into the matter's file record and collecting that.
  status: shipped
  slices: 4-4-matter-notes
  surface: internal
  evidence: review_document.source_kind keeps its three-value CHECK constraint in packages/database/src/per-firm-schema.ts, which is what makes a note structurally uncollectable
  notes: Owner decision, notes design flag W5. Widening that enum is the change that must not be made quietly.

- id: notes.search
  name: Finding a note again
  scope: Search within one matter, matched against the notes' current text only; a corrected note stops being findable by the words taken out of it.
  status: partial
  slices: 4-4-matter-notes
  evidence: searchConditionFor in packages/notes/src/note-statements.ts, and the query control on the matter's Notes section
  audience: public
  public-summary: Search a matter's notes for what they say now.
  notes: PARTIAL because it is within one matter. Firm-wide note search is unbuilt and needs an index decision — see notes.search.firm-wide.

- id: notes.search.firm-wide
  name: Firm-wide note search
  scope: Searching every matter's notes from one place, under the same visibility predicate the timeline composes, with no snippet.
  status: designed
  spec: docs/specs/2026-08-15-notes-and-activity-design.md
  awaiting-owner: Neither existing index can take notes as it stands, and which one grows to fit is an owner call. The natural-language feed reserves work-product as a class its writer must never produce, and a note is exactly that; the keyword index takes a file or a review document fed from R2 objects, and a note is a database row. The third option is a note-only index. The snippet question is already answered (no snippet, notes design flag W6).

- id: notes.entity-note
  name: Notes on a Directory entity
  scope: The same primitive keyed to a Directory entity, read on the entity's own surface.
  status: designed
  spec: docs/specs/2026-08-15-notes-and-activity-design.md
  notes: Deferred deliberately (notes design flag W2). Joining the federated read needs a THIRD visibilityAnchor with its own predicate — an entity note can carry matter-derived confidentiality on a firm-wide record — and registering one as firm-anchored would be a silent loosening of the package's one reviewed exemption.

- id: notes.document-note
  name: Notes on a document
  scope: An annotation on a document rather than on a matter.
  status: not-started
  notes: Deliberately not designed. A different product with a different privilege story, plausibly a PDF annotation rather than a row.

- id: notes.client-visible-comment
  name: Client-visible comments
  scope: A threaded comment a client can read through the portal — a separate entity from an internal note, with no path by which one becomes the other.
  status: not-started
  notes: Belongs to the portal's own slice. The shape was decided ahead of it so the portal inherits a decision: two entities, no visibility flag, and no promotion path. See portal.capabilities.comment.
