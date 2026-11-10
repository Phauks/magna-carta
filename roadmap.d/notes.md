# Matter Notes and Activity

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Matter notes -->

- id: notes
  name: Matter notes and activity
  scope: The note primitive — a dated, attributed record on a matter, edited in place and deleted outright, opened in the shared record window — and its entry on the federated activity read.
  status: partial
  slices: 4-4-matter-notes
  spec: docs/specs/2026-08-15-notes-and-activity-design.md
  audience: public
  public-name: Matter notes
  public-summary: Write down what happened on a case, when it happened, and which of the matter's documents it concerns.

- id: notes.matter-note
  name: The matter note
  scope: One row carrying the matter, the author, the words, the instant it was written, and optionally when the thing it describes happened.
  status: shipped
  slices: 4-4-matter-notes
  evidence: packages/notes (note-service.ts, note-statements.ts), matter_note in packages/database/src/per-firm-schema.ts, apps/api-worker/src/http/routes/notes-and-tasks/notes.ts, the matter's Notes section and note-record-window.svelte in apps/web
  audience: public
  public-summary: A note on a matter, dated and attributed the moment it is written.

- id: notes.matter-note.edit-and-delete
  name: Edit and delete
  scope: An edit replaces a note's text and records who changed it; a delete removes the row and its words, leaving an audit entry that names no content.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  evidence: editMatterNote and deleteMatterNote in packages/notes/src/note-service.ts, over the reviewed rebuild in packages/database/drizzle/per-firm/20260908T000000_baseline.sql
  audience: public
  public-summary: Edit a note to change what it says, or delete one outright.
  notes: Replaced correction-by-revision and withdrawal on the owner's direction, 2026-09-01. Nothing records what a note said before an edit, and a deletion leaves only an audit row naming no content; the superseded reasoning is kept in docs/decisions/pending/ rather than deleted.

- id: notes.matter-note.append-only-enforcement
  name: Append-only revisions, enforced by the database
  scope: Three RAISE(ABORT) triggers that refused UPDATE, DELETE and INSERT OR REPLACE on the revision table.
  status: cut
  slices: 4-4-matter-notes
  evidence: dropped by packages/database/drizzle/per-firm/20260908T000000_baseline.sql
  notes: CUT on the owner's direction, 2026-09-01, hours after it shipped. A note is edited in place and deleted outright, so there is no append-only body left to guard.

- id: notes.matter-note.record-window
  name: The note's record window
  scope: A note is written, read, changed and deleted in the shared two-pane record window, with its attachments as the right-hand tab and a printable sheet.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  evidence: apps/web/src/lib/matters/note-record-window.svelte over @magna-carta/design-system/record-window; apps/web/src/lib/matters/note-print-sheet.ts; the end-to-end walk in apps/web/e2e/matter-notes.spec.ts
  audience: public
  public-summary: Open a note in the same window every other record opens in.
  notes: Replaced the inline composer on the owner's direction, 2026-09-01. The window states every generated field before anything is typed, and the Date and its Time sit on one line.

- id: notes.matter-note.occurrence
  name: When the thing happened
  scope: A civil date, an optional wall-clock time and its zone, recording when what the note describes took place, separately from when the note was typed.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  evidence: the occurred_on/occurred_at_time/time_zone columns and their coherence CHECK in packages/database/src/per-firm-schema.ts; normalizeOccurrence in packages/notes/src/validation.ts
  audience: public
  public-summary: Say when a call or meeting actually happened, not just when you wrote it down.
  notes: Nothing infers one — no default to today, no invented midnight, no assumed zone. Every read orders by it, falling back to the day the note was written.

- id: notes.matter-note.documents
  name: Documents on a note
  scope: A note points at the matter's own files, many-to-many, linking a handle rather than moving bytes.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  evidence: matter_note_document in packages/database/src/per-firm-schema.ts on the matter_asset_document model; attachFileToMatterNote and detachFileFromMatterNote in packages/notes/src/note-service.ts
  audience: public
  public-summary: Attach the letter a note discusses, without moving it out of the matter's files.
  notes: Upload stays the File Manager's chokepoint, so an attached document keeps its versions, holds and discovery reachability. Deleting a note detaches its documents and deletes none of them. The window takes the choices while the note is still a draft and writes them after the note itself, so attaching never means saving and reopening; where one of them does not land, the list names which rather than reporting a failure to save.
  awaiting-owner: A note cannot upload a NEW document, only point at one the matter already holds. Whether the note window should also file a document into the matter — which means the presigned upload, the quarantine chokepoint and a scan wait inside a note — is an owner call, not a gap to close quietly.

- id: notes.activity
  name: The note on the matter's activity history
  scope: One declared source on the calendar's federated read — keyed matterNote, matter-anchored, declaring no label — reading the note table in place.
  status: shipped
  slices: 4-4-matter-notes
  evidence: matterNoteSource in packages/calendar/src/sources/all.ts; packages/notes/test/timeline-source.test.ts proves one entry per note, the occurrence as sort key with the written day as fallback, and the entry leaving when the note is deleted
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
  scope: Searching every matter's notes from one place, under the same visibility predicate the timeline composes.
  status: shipped
  surface: screen
  spec: docs/specs/2026-08-15-notes-and-activity-design.md
  evidence: The notes source's acrossMatters declaration in packages/matter-search/src/sources/all.ts, read by GET /api/v1/search (apps/api-worker/src/http/routes/matters/search-across-matters.ts) behind notes:read and the visible-matter predicate, and shown as the Notes place on apps/web/src/routes/(app)/search/+page.svelte; held by packages/matter-search/test/across-matters.test.ts and apps/api-worker/test/search-across-matters-routes.test.ts
  notes: Built as one place of the search across matters (search.across-matters), which is where its limits are recorded. The index decision is the owner's approval of 2026-11-10 (docs/specs/2026-11-10-indexing-and-discovery-design.md): notes are a source of the firm's record index, built as search.record-index. A result shows a line of the note. The notes design held that a firm-wide result should carry none and put the question to the owner as flag W6; the proposal approved on 2026-11-10 drew the excerpt and its build order says "snippets shown", so that is what was built, and the excerpt is returned only behind notes:read for a matter the reader may see.

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
