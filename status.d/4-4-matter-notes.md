---
slice: 4·4 — Matter notes (the note primitive)
group: phase-4
order: 4
research: n/a
spec: done
plan: done
built: done
ui: done
load-profile: n/a
tested: done
branch: claude/matters-notes-section-m9na1w
active-work: docs/active-work/claude/matters-notes-section-m9na1w.md
next: entity notes and their visibility anchor; firm-wide note search needs an index decision; the Activity section wants the sections it links into to honour the entry they are handed
link-spec: docs/specs/2026-08-15-notes-and-activity-design.md
link-plan: docs/specs/2026-08-15-notes-and-tasks-implementation-plan.md
adrs:
blocked-by:
---

`@magna-carta/notes`: one `matter_note` row per note, edited in place and deleted outright, carrying the words, who wrote them, when they were written, optionally when the thing they describe happened, and the matter's files they point at. `matter_note_document` links those files many-to-many on the `matter_asset_document` model, linking a handle rather than moving bytes. `notes:read` and `notes:write` seeded to the seats that work matters. A `matterNote` timeline source joins the calendar's federated read declaring no label and sorting by the occurrence with the written day as fallback. The Notes section is a list plus the shared record window: the list carries within-matter search over current text, the former-member attribution signal and one row per note, and the window carries every field a note will hold before anything is typed, the Date and its Time on one line, edit, delete, print, and the attachments tab over the matter's own files — which takes its choices while the note is still a draft and writes them after the note itself.

The first cut of this slice shipped the opposite model — an identity row plus a revision chain, three `RAISE(ABORT)` triggers, and withdrawal as a state — and the owner replaced it hours later: replacing a note with another note every time somebody fixes a word accumulates without end. The reversal is a reviewed rebuild that carries every standing note across with its current text, and it costs what it costs: nothing records what a note said before an edit, and a deletion leaves only an audit row naming no content. The superseded ADR fragment is marked rather than deleted.

The owner's first review round on the screen replaced the inline composer with the record window, on the ruling that starting a record is a modal act; the corrections are in `docs/conventions/design-corrections.md`. The reported symptom that opened that round — a section that never stopped loading — did not reproduce: `apps/web/e2e/matter-notes.spec.ts` drives the whole surface against a real Worker and the list settles every time, and `apps/api-worker/test/notes-routes.test.ts` pins the empty-page envelope the settling depends on. What the rebuild changed is the shape rather than a found defect: the notes read is an effect of its own, so nothing else the screen wants can abort it before the read is asked for, and a failed read settles with a stated reason and a Retry.

The owner then took the screen question further: the note is a small primitive, and the reason the
Notes section read thin is that it showed one of the fourteen sources the platform already records.
So the matter gained an **Activity** section over the federated timeline that had been built, tested
and served since the calendar slice with no web caller at all. The screen names no source: a
presentation registry pairs one entry to each declared source, and a test scanning the calendar
package's own declarations fails until a new source has one. The Notes section stays as it is, on the
owner's direction.

Two things stage 1 still does not close. Entity notes wait on a third `visibilityAnchor` with its own predicate, which is the substance of that stage rather than a copy of this one. Firm-wide note search is not built: the natural-language feed reserves `work-product` as a class its writer must never produce and a note is exactly that, while the keyword index takes a file or a review document fed from R2 objects — so the search that shipped is within one matter and needs no index.
