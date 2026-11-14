---
slice: 2·7 — Exhibits and exhibit lists
group: phase-2
order: 7
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Claude"
ui: todo
load-profile: todo
tested: todo
next: Screens (where a member starts building exhibits is with the owner), then the exhibit list document, in-text references and the stamped package.
active-work:
link-spec: docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md
link-plan: docs/specs/2026-08-11-exhibits-and-exhibit-lists-implementation-plan.md
adrs: ADR-0273, ADR-0274
blocked-by:
---

Designed 2026-08-11. An exhibit is identity, position, and label — three separately-changing facts —
with the label a pure function of position and the set's scheme, computed while a set is a draft and
materialized and trigger-frozen at issue. In-text references are a fourth placeholder form
(`{{@referenceName}}`) citing identity rather than label, deliberately outside both the merge-field
dictionary and the expression language; a multi-exhibit citation enumerates its members so the
renderer computes the phrasing and an insertion cannot silently widen a span. Issuing is a recorded
human assertion (the platform has no e-filing integration), it is irreversible, and an amended filing
is a superseding set on the calendar's continuance idiom. Four per-firm tables, a new pure
`@magna-carta/exhibits` package, an `exhibits` collection-only dictionary source that closes the
expression language's first open question, and package pagination through the shipped Bates engine.
Eight owner flags open.
