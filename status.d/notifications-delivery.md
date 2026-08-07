---
slice: Notifications — delivery
group: cross-cutting
order: 35
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: todo
load-profile: todo
tested: todo
branch: claude/notifications-delivery-1
active-work: docs/active-work/claude/notifications-delivery-1.md
next: Slice 2 — the comparison-driven sweep (calendar horizon/due/overdue and the one custody collection point), the three calendar write-path topics, the email-filing topic, and the job-coordinator completion rows; then preferences and the firm policy floor (slice 3), then the email digest (slice 4)
link-spec: docs/specs/2026-08-06-notifications-delivery-design.md
link-plan: docs/specs/2026-08-06-notifications-delivery-implementation-plan.md
adrs: notifications-delivery-half, notifications-retention-and-swept-unread
blocked-by:
---

Slice 1 built: five per-firm tables, the type registry with its validated fact grammar, a second non-exclusive translator pass on the shipped per-firm queue (no producing package changed — thirty-one topics already commit transactionally), the member-scoped read API behind `notifications:read`, the firm-ceiling email detail level, and the firm-configurable retention window with its nightly sweep and its swept-unread tally.
