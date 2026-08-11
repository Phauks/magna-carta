---
branch: claude/calendar-slice-2-design
worktree: .claude/worktrees/calendar-slice-2-design
area: Calendar slice 2 — design only (firm events, resource and room availability, event links, honest continuance)
status: review
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream executing the owner's 2026-08-07 docket overrides on calendar flags L1 and L4:
firm events (meetings and firm-wide entries with no matter), rooms and resources with an
availability model and a warn-and-allow double-booking posture, typed event links, and continuance
as a chain-linked new setting that never rewrites the vacated one. One spec (design + implementation
plan in the same document), one decision fragment, one changelog fragment. **No product code in this
stream.**

**Overlap to watch.** The build slices this design plans will touch `packages/calendar/` (the source
registry gains a `visibilityAnchor` field and a `firmEvent` source; `notifications.ts` gains four
emission points), the per-firm schema (five new tables plus a nullable `matter_event.status_reason`
column, all additive), and `apps/worker/src/routes/calendar.ts`. Nothing here writes any of them —
this stream is docs-only. The notifications delivery build (its design plans outbox topics on the
calendar's existing write paths) is a merge-order seam for build slice 2·1, noted in the plan.
