---
slice: 6·2 — Calendar: firm events, resources, links & continuance
group: phase-6
order: 2
research: n/a
spec: done
plan: done
built: done
ui: in-progress
load-profile: done
tested: done
next: The room grid and the bookings surface over the availability read, the resource catalog under Settings, and the related-links surface; notification wiring subscribes to the ten declared emission points; a per-firm hard-refuse booking policy, approval workflows, and room-panel sync are named seams awaiting an owner ask
branch: claude/calendar-ui-plan-eu523y
active-work:
link-spec: docs/specs/2026-08-07-calendar-slice-2-firm-events-and-resources.md
link-plan: docs/specs/2026-08-07-calendar-slice-2-firm-events-and-resources.md
adrs: ADR-0261
blocked-by:
---

Built: the owner's two overrides executed through every layer, backend only. **Firm events** in
their own `firm_event` table (never a nullable matter — the shipped NOT NULL cannot drop without a
forbidden rebuild), sharing the civil-date/time/zone shapes and the three-shape participant model,
reusing the shared type catalog, with `audience = all_members | participants` so a firm holiday is
on everyone's calendar without a list that decays. The federated read gains the declared
**`visibilityAnchor`** contract field: matter anchors compose the required predicate
(fitness-enforced), firm anchors are a reviewed allowlist (today exactly `firmEvent`) — never a
silent exemption; the registry is fourteen sources and the firm calendar gains `scope` and the
widened member filter (participant OR all-members), composed in SQL. **Resources and bookings**:
`firm_resource` (closed kind enum, soft-deactivate) and `firm_resource_booking` attached to exactly
one event, window defaulted-then-editable, zone frozen from the resource's office; **liveness is
derived from event status** — no released flag, cancelling or continuing an event frees its rooms
with no second write, asserted byte-for-byte. **Double-booking is warn-and-allow** with the
conflict on the write response, on the grid (pre-paired), and on the booking; the overlap check is
one coarse civil-date statement widened a day each side plus precise per-row-zone instant
intersection, proven across a DST boundary and across zones. **Continuance** dissolves the
edit-or-new-row dichotomy: a correction stays an edit; a continuance mints a new setting, marks the
old `cancelled` with the additive `status_reason`, historical columns byte-untouched, and one
`continuance_of` link chain-held by two partial unique indexes the schema enforces under races. The
one-batch operation reports trigger-linked open deadlines (pure lookup — the no-arithmetic scan
stays green) and derivation-released bookings; the chain read is depth-capped at 100 and its cost
does not scale with the firm's event count. Four notification points declared, wired to nothing.
The five load-profile bounds asserted over the section-9 corpus. Owner flags R1/R2/R3 built as
confirmed recommendations.

**Interface, in build** (`docs/specs/2026-09-02-calendar-interface-design.md`): firm events on the firm calendar and its Record menu, opened and edited in the entry window; continuance as a verb in that window. The room grid, bookings and the resource catalog are the plan's slice 3.
