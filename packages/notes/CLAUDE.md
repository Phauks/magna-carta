# @magna-carta/notes — CLAUDE.md

**Purpose.** The matter note: what a firm wrote down about a case that no other record holds. A note
is an IDENTITY that persists and a BODY that gets corrected, held as two tables, with three write
paths (create, revise, retract) and no fourth. Validates in memory and composes statements into
`@magna-carta/data-access`'s `composeEffectBatch`; holds no binding, reads no clock, and never calls
an external service.

**White paper:** _Tasks and workflows / matter plans_, with _Client portal_, _Discovery_,
_Observability and diagnostics_ and _Tenancy and data isolation_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-15-notes-and-activity-design.md`](../../docs/specs/2026-08-15-notes-and-activity-design.md).

## Key files / entry points

- `src/types.ts` — the two states, the body and reason ceilings, the page caps
- `src/validation.ts` — every refusal as a code the route maps to a problem type, and the body
  normalization (trimmed at the edges, never in the middle)
- `src/note-statements.ts` — the SQL: the head-revision join, the guarded head move, the guarded
  retraction, the matter's list, the revision chain, and the within-matter search condition
- `src/note-service.ts` — create, revise, retract, each one batch with its audit row

## Invariants that apply here

- **A note is corrected by revision and retracted, never deleted.** An edit APPENDS a revision and
  moves the note's head ordinal; every prior body is retained and readable. Retraction is a state
  with its own actor, instant and required reason: the body stops rendering everywhere and the note
  drops out of the federated timeline, while the row and its revisions remain. There is no delete
  path — no route, no capability, no statement in this package — and the one case where bytes must
  genuinely leave routes through the PII registry's `report-manual` action and a person.
- **The revision table is append-only by DATABASE TRIGGER, not by this package's good behaviour.**
  Three `RAISE(ABORT)` triggers refuse `UPDATE`, `DELETE` and `INSERT OR REPLACE` on
  `matter_note_revision`. Application code that appends and never rewrites is true until a repair
  script or a well-meant autosave feature reaches the table directly, at which point a
  contemporaneous record quietly becomes something else with no trace.
  `test/append-only.test.ts` issues each refused statement by hand.
- **No trigger guards `matter_note`.** Its head ordinal moves on every revision and its state must
  move for retraction, which is the mechanism by which a note that should never have been written
  stops rendering. Withdrawal is a state, not a rewrite.
- **The head is an ORDINAL on the identity row, not a flag on each revision.** A flag would have to
  be turned off on the old head, which is an `UPDATE` the triggers refuse. The unique index on
  `(note_id, ordinal)` is what makes "exactly one head" a schema fact — and what makes two members
  revising at once resolve cleanly: both compute the same next ordinal, the second insert collides,
  and that batch aborts whole rather than overwriting anybody's words.
- **A retracted note's body is nulled BY THE READ.** `HEAD_REVISION_JOIN` projects
  `CASE WHEN state = 'retracted' THEN NULL`, so a caller that forgets to check the state gets
  nothing to display rather than something it should not have. The revision-chain read refuses a
  retracted note outright: a history that still served every superseded body would be a way around
  the tombstone rather than an exception to it.
- **`author_user_id` never nulls, never repoints, and is not anonymized when a member leaves.** An
  unattributed contemporaneous record is worth a fraction of an attributed one. That a member has
  left is a JOIN on `member.status` at read time, never a column here — a fact that is a join cannot
  drift from the row it joins.
- **Every read composes the visible-matter predicate, as a REQUIRED argument.** A note is the most
  privileged free-text record this platform holds, and an id-addressed read that skipped the
  predicate is the read an information-barrier overlay would later be built past.
- **Search matches the CURRENT text only.** A note corrected to take out the wrong client's name
  must stop being findable by that name, otherwise the correction fixed what the note says and not
  what it discloses. Superseded bodies stay readable from the note's own history, where somebody has
  already chosen to look at that note.
- **The audit row carries identifiers and never words.** Not the body, not its first sentence, not
  its length, and not the retraction reason — the log is a compliance record with its own retention
  and its own readers, and the note is screened from some of them.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, and
  `@magna-carta/calendar` — the last for the visible-matter predicate ALONE, which is where that seam
  lives (`packages/notifications` depends on it for the same reason and nothing else).
- The route layer (`apps/api-worker/src/routes/notes.ts`) hands the service the firm-scoped database,
  the real clock, a crypto random source, and the authenticated actor — none of which is client input.
- **The timeline source is not here.** A note joins the federated read as one declared entry in
  `packages/calendar/src/sources/all.ts`, keyed `matterNote`, which reads `matter_note` by table name.
  That is a read-side declaration and never a write-side obligation, so nothing in this package knows
  the timeline exists.

## Gotchas

- **The timeline source reads `matter_note`, never `matter_note_revision`.** A source over the
  revision table would put a fresh entry on the timeline every time somebody fixed a typo, each
  claiming to be a thing that happened.
- **The source declares no label** (`declaresLabel: false`, `NULL AS label`). A note body's first
  eight words are frequently the whole disclosure, and the federated read spans every matter. The
  entry says a note was written, on this matter, then, by them.
- **No merge field may resolve to a note table**, on any record — not the body, not the latest
  revision, not a count. A merge-filled note would go out under the firm's letterhead as PAGE
  content, which the PDF metadata scrub in `crates/pdf-core/src/scrub.rs` is structurally blind to.
  Held by `packages/document-assembly/test/no-note-merge-field.test.ts`.
- **Notes stay outside the discovery collection vocabulary.** `review_document.source_kind` keeps its
  three values; producing a note means exporting it as a document into the matter's file record and
  collecting that, which gives it a version, a hash and a custodian of record.
- **Firm-wide note search is not built, and neither existing index can take it as it stands.** The
  natural-language feed reserves `work-product` as a class its writer must never produce, and a note
  is exactly that; the keyword index's `IndexedDocumentId` is a file or a review document, fed from
  R2 objects, and a note is a database row. The search here is within one matter and needs no index.
