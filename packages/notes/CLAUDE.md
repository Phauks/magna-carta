# @magna-carta/notes — CLAUDE.md

**Purpose.** The matter note: what a firm wrote down about a case that no other record holds. One row
per note, edited in place and deleted outright, carrying the words, who wrote them, when they were
written, optionally when the thing they describe happened, and the matter's files they point at.
Validates in memory and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`;
holds no binding, reads no clock, and never calls an external service.

**White paper:** _Tasks and workflows / matter plans_, with _Client portal_, _Discovery_,
_Observability and diagnostics_ and _Tenancy and data isolation_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-15-notes-and-activity-design.md`](../../docs/specs/2026-08-15-notes-and-activity-design.md),
whose correction/retraction half was superseded on 2026-09-01 — see below.

## Key files / entry points

- `src/types.ts` — the ceilings, the page caps, the occurrence shape
- `src/validation.ts` — every refusal as a code the route maps to a problem type, the body
  normalization, and the three-way occurrence coherence check
- `src/note-statements.ts` — the SQL: the ordering expression, the search condition, and the file
  links with their join to the matter's own file record
- `src/note-service.ts` — create, edit, delete, attach, detach, each one batch with its audit row

## The model, and what it replaced

A note is ONE ROW. An edit overwrites the words; a delete removes the row.

The first cut of this package was the opposite: an identity row plus a chain of revisions, three
`RAISE(ABORT)` triggers making a stored body unrewritable, and withdrawal as a state rather than a
delete. It shipped, and the owner replaced it hours later. Their reason: replacing a note with another
note every time somebody fixes a word accumulates without end, and the chain was never what a firm
asked for.

**What that costs, stated once so nobody rediscovers it as a defect.** There is no record of what a
note said before it was edited, and nothing is left behind when one is deleted beyond an audit row
carrying identifiers. A note is therefore weaker evidence of what the firm knew and when than the
first model made it. That trade was put to the owner with the scenarios spelled out and reaffirmed;
the superseded reasoning is kept in
`docs/decisions/0342-a-note-is-corrected-by-revision-and-retracted-never-deleted.md` rather than
deleted, because the position was really taken.

## Invariants that apply here

- **Two times, and they are different questions.** `created_at` is when somebody typed the note.
  `occurred_on` / `occurred_at_time` are when the thing it describes happened. A note written on
  Thursday about a call on Tuesday carries both, and every read orders by the second falling back to
  the first — a note about Tuesday's call belongs beside Tuesday's hearing.
- **Nothing infers an occurrence.** No path defaults it to today, invents a midnight, or fills a zone
  the caller did not give. A note that records no single moment is the ordinary case, not a gap.
- **A time needs a date and a wall clock needs a zone**, both directions, held by the schema and by
  `normalizeOccurrence`. An hour with no day is not a moment anybody can place; "3pm" read in another
  state is not a time; a zone on a note naming no time says nothing.
- **`author_user_id` never nulls, never repoints, and is not anonymized when a member leaves.** That
  they have left is a JOIN on `member.status` at read time, never a column here. `last_edited_by` is
  separate and null until somebody edits: "nobody has touched this" and "the author edited their own
  note" are different facts.
- **Every read composes the visible-matter predicate, as a REQUIRED argument.** A note is the most
  privileged free-text record this platform holds, and an id-addressed read that skipped the predicate
  is the read an information-barrier overlay would later be built past.
- **A note points only at documents on its own matter**, checked in SQL at the write. A link across
  matters would be a disclosure wearing an association.
- **Deleting a note deletes no document.** The links go first and the files are untouched — they stay
  in the matter's file record with their versions, holds and discovery reachability intact.
- **Bytes never reach a note route.** Upload is the File Manager's presigned-upload and quarantine
  chokepoint; this package links the resulting handle and nothing more.
- **Search matches the current text only**, which is what the text now is. A note edited to take out
  a name stops being findable by it.
- **The audit row carries identifiers and a date, never words.** Not the body, not its first sentence,
  not its length, in any of the five events. On delete that is the whole surviving record: afterwards
  the firm can see a note existed here and who removed it, and cannot see what it said.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, and
  `@magna-carta/calendar` — the last for the visible-matter predicate ALONE, which is where that seam
  lives (`packages/notifications` depends on it for the same reason and nothing else).
- The route layer (`apps/api-worker/src/http/routes/notes-and-tasks/notes.ts`) hands the service the firm-scoped database,
  the real clock, a crypto random source, and the authenticated actor — none of which is client input.
- **The timeline source is not here.** A note joins the federated read as one declared entry in
  `packages/calendar/src/sources/all.ts`, keyed `matterNote`, which reads `matter_note` by table name.
  That is a read-side declaration and never a write-side obligation, so nothing in this package knows
  the timeline exists.

## Gotchas

- **The ordering expression appears twice and must agree.** `COALESCE(occurred_on, substr(created_at,
  1, 10))` is both the list's `ORDER BY` and its keyset cursor, and it is the timeline source's sort
  column. If one moves and the others do not, the walk skips or repeats rows at a page boundary.
- **The fallback is a DATE cut from the instant, never the instant.** Mixing `2026-08-25` and
  `2026-08-25T09:00:00.000Z` in one sort column orders a note typed in the morning before a note that
  happened the same day, on nothing but the presence of a `T`.
- **The source declares no label** (`declaresLabel: false`, `NULL AS label`). A note body's first
  eight words are frequently the whole disclosure, and the federated read spans every matter.
- **No merge field may resolve to a note or to its file links**, on any record. A merge-filled note
  would go out under the firm's letterhead as PAGE content, which the PDF metadata scrub in
  `crates/pdf-core/src/scrub.rs` is structurally blind to. Held by
  `packages/document-assembly/test/no-note-merge-field.test.ts`.
- **Notes stay outside the discovery collection vocabulary.** `review_document.source_kind` keeps its
  three values; producing a note means exporting it as a document into the matter's file record.
- **Firm-wide note search is not built, and neither existing index can take it as it stands.** The
  natural-language feed reserves `work-product` as a class its writer must never produce, and a note
  is exactly that; the keyword index's `IndexedDocumentId` is a file or a review document fed from R2
  objects, and a note is a database row. The search here is within one matter and needs no index.
