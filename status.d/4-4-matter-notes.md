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
next: entity notes and their visibility anchor; firm-wide note search needs an index decision
link-spec: docs/specs/2026-08-15-notes-and-activity-design.md
link-plan: docs/specs/2026-08-15-notes-and-tasks-implementation-plan.md
adrs:
blocked-by:
---

`@magna-carta/notes` on the house pattern: `matter_note` (identity, original author, created instant, head ordinal, state) and `matter_note_revision` (one body, its own author, its own instant, its ordinal), the revision table append-only by three `RAISE(ABORT)` triggers. Three write paths and no fourth — create, revise, retract — with no delete route, capability or statement anywhere. `notes:read` / `notes:write` / `notes:retract` seeded to the seats that work matters. A `matterNote` timeline source joins the calendar's federated read declaring no label. The matter's Notes section is real: composer, correction with a readable version history, the withdrawal tombstone, the former-member attribution signal, and within-matter search over current text only. A merge-field fitness function refuses any catalog entry that reaches a note table.

Two things stage 1 did not close. Entity notes wait on a third `visibilityAnchor` with its own predicate, which is the substance of that stage rather than a copy of this one. Firm-wide note search is not built: the natural-language feed reserves `work-product` as a class its writer must never produce and a note is exactly that, while the keyword index takes a file or a review document fed from R2 objects — so the search that shipped is within one matter and needs no index.
