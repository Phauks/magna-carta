# Calendar and Rules-Based Docketing

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: calendar
  name: Calendar and docketing
  scope: Calendar surface for matters, deadlines, and appointments; two-way external sync; rules-based court-deadline computation.
  status: partial
  adrs: ADR-0018, ADR-0055
  evidence: The event and deadline model, the federated matter timeline, and seventeen routes are built (packages/calendar, apps/worker/src/routes/calendar.ts); no user interface yet and no docketing computation (which is a deliberate position, not a gap).
  notes: Calendar slice 2 (firm events, rooms/resources with bookings, event links, continuance) is designed (docs/specs/2026-08-07-calendar-slice-2-firm-events-and-resources.md), not yet built.

- id: calendar.events
  name: Litigation events and deadlines
  scope: Member-entered hearings, filings, service, orders, depositions and the like, plus first-class deadlines with a stated authority, satisfaction, and a vacate/supersede trail.
  status: shipped
  adrs: ADR-0055
  notes: Backend only — the calendar screens are their own slice.
  evidence: Four per-firm tables (matter_event, matter_event_type, matter_event_participant, matter_deadline) with civil dates, an explicit IANA zone per row, and the platform event-type catalog seeded by 20260806T000000_case-calendar; write paths in packages/calendar.

- id: calendar.timeline
  name: Matter timeline (federated)
  scope: One ordered history per matter across every subsystem that already records what the firm did, read in place through a source registry under one cursor and one visibility predicate.
  status: shipped
  adrs: ADR-0051, ADR-0068
  notes: Backend only — the calendar screens are their own slice.
  evidence: Thirteen declared sources in packages/calendar/src/sources/all.ts; nothing projected, copied, or backfilled; the visible-matter predicate is a required argument of every statement builder and is proven by a table-driven fitness test.

- id: calendar.surface
  name: Calendar surface
  scope: Calendar of matters, deadlines, and appointments.
  status: not-started
  evidence: The two reads a month grid, a week view, an agenda list, and a matter timeline all consume are built and contract-emitted; no Svelte surface exists yet.

- id: calendar.sync
  name: Two-way Google/Outlook sync
  scope: Two-way calendar synchronization via the email/calendar plugin.
  status: not-started
  slices: integration-port-system
  adrs: ADR-0091
  evidence: No calendar adapter; the integration port system it will plug into is shipped.

- id: calendar.docketing
  name: Rules-based docketing
  scope: Compute court dates and deadlines from jurisdiction/court rule sets, defaulting from the matter's jurisdiction or home Location.
  status: researching
  adrs: ADR-0018
  evidence: White paper flags it needs-development and expects its own subsystem spec; none exists. Court-rule sets are jurisdiction-keyed reference data on the trust-rules-catalog pattern.

- id: calendar.docketing.rule-sets
  name: Court rule sets
  scope: Sourcing, encoding, and maintaining per-jurisdiction/court rule sets.
  status: researching
  evidence: Named open question in the white paper; the analogous trust-rules catalog (docs/research/trust-rules/) proves the reference-data pattern.

- id: calendar.docketing.computation
  name: Deadline computation
  scope: Trigger-to-deadline model — court holidays, service-method offsets, chained deadlines, recalculation when a trigger moves.
  status: not-started
  evidence: No computation model specified or built.

- id: calendar.docketing.review
  name: Reviewer confirmation
  scope: Human confirmation step before computed dates take effect.
  status: not-started
  evidence: Unspecified beyond the white paper's to-specify list.

- id: calendar.reminders
  name: Deadline reminders
  scope: Computed dates and appointments feed reminders through the Communications layer.
  status: not-started
  adrs: ADR-0059
  evidence: Notifications subsystem decided (ADR-0059) as the seam; no calendar reminders exist.
