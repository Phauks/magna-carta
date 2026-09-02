# Calendar and Rules-Based Docketing

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Calendar and deadlines -->

- id: calendar
  name: Calendar and docketing
  scope: Calendar surface for matters, deadlines, and appointments; two-way external sync; rules-based court-deadline computation.
  status: partial
  adrs: ADR-0018, ADR-0055
  evidence: The event and deadline model, firm events with an audience switch, resources and bookings with derived liveness, typed event links with chain-held continuance, the federated timeline (fourteen sources in TIMELINE_SOURCES), and thirty-three routes are built (packages/calendar, apps/api-worker/src/routes/calendar.ts registers thirty-three handlers); the only interface is the matter's own Calendar section, and there is no docketing computation (which is a deliberate position, not a gap).
  audience: public
  public-name: Calendar and deadlines
  public-summary: Hearings, deadlines, firm events and room bookings in one calendar, with every date on a matter visible as that matter's own timeline.

- id: calendar.events
  name: Litigation events and deadlines
  scope: Member-entered hearings, filings, service, orders, depositions and the like, plus first-class deadlines with a stated authority, satisfaction, and a vacate/supersede trail.
  status: shipped
  surface: screen
  adrs: ADR-0055
  notes: The matter's Calendar section reads both records; recording from the screen still waits on the participant picker, so those actions render disabled. The firm-wide calendar screens remain their own slice.
  evidence: Four per-firm tables (matter_event, matter_event_type, matter_event_participant, matter_deadline) with civil dates, an explicit IANA zone per row, and the platform event-type catalog seeded by 20260806T000000_case-calendar; write paths in packages/calendar; read at apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte over the two listings.

- id: calendar.timeline
  name: Matter timeline (federated)
  scope: One ordered history per matter across every subsystem that already records what the firm did, read in place through a source registry under one cursor and one visibility contract.
  status: shipped
  adrs: ADR-0051, ADR-0068
  evidence: Fourteen declared sources in packages/calendar/src/sources/all.ts; nothing projected, copied, or backfilled; every source declares its visibility anchor — matter anchors compose the required predicate, firm anchors sit on a reviewed allowlist — proven by a table-driven fitness test. Read by the matter's Activity section since 2026-09-02.

- id: calendar.timeline.activity-section
  name: The matter's Activity section
  scope: The federated timeline as a screen — one chronology per matter, cut into days, narrowed by bands of sources, each entry following into the subsystem that owns it.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  audience: public
  public-summary: See everything that has happened on a case, in order, in one place.
  evidence: apps/web/src/routes/(app)/matters/[id]/activity/+page.svelte over GET /api/v1/matters/{matterId}/timeline; apps/web/src/lib/matters/activity-presentation.ts pairs one entry to each declared source, asserted against the calendar package's own declarations by apps/web/test/activity-presentation.test.ts; the two-subsystem walk in apps/web/e2e/matter-activity.spec.ts.
  notes: The screen names no source and switches on none — adding a subsystem to the platform's timeline is one entry in the presentation registry, and the test fails until it exists. Most sources declare no label, so a row states what happened, when and by whom, and the words stay behind the link under the owning subsystem's own access gate.

- id: calendar.firm-events
  name: Firm events
  scope: Events that belong to the firm rather than to a case — meetings, closures, training, holidays, reservations — with an all-members/participants audience and the same civil-date/zone model as case events.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0055, ADR-0068
  notes: Backend only — the calendar screens are their own slice.
  evidence: firm_event and firm_event_participant in 20260807T070000_calendar-firm-events-resources-links; write paths in packages/calendar/src/firm-event-service.ts; the firmEvent federated source with visibilityAnchor 'firm'; scope and widened member filters on GET /api/v1/calendar/events.

- id: calendar.resources
  name: Rooms and resources
  scope: Bookable firm resources (rooms, vehicles, equipment) with availability as a read, bookings attached to exactly one event, liveness derived from event status, and double-booking as a warn-and-allow visible fact.
  status: shipped
  surface: awaiting-screen
  notes: Backend only. A per-firm hard-refuse booking policy, approval workflows, and room-panel sync are named seams.
  evidence: firm_resource and firm_resource_booking tables; packages/calendar/src/resource-service.ts and booking-service.ts (two-stage overlap check, zone frozen from the resource's office); availability and booking routes in apps/api-worker/src/routes/calendar.ts.

- id: calendar.links-continuance
  name: Event links and continuance
  scope: Typed relations between events, and continuance as a new setting pointing at the vacated one — old row byte-untouched, chain held by partial unique indexes, no deadline ever moved.
  status: shipped
  surface: awaiting-screen
  notes: Backend only. Continuance binds matter events; a moved staff meeting stays an edit.
  evidence: calendar_event_link with two hand-written partial uniques; packages/calendar/src/continuance-service.ts (one-batch operation, depth-capped chain read, trigger-linked deadline lookup as pure SELECT); continue and continuance-chain routes.

- id: calendar.surface
  name: Calendar surface
  scope: Calendar of matters, deadlines, and appointments.
  status: partial
  surface: screen
  notes: One screen of several. A month grid, a week view, an agenda list, and the firm-wide calendar are all still unbuilt, as is any way to record a date from a screen.
  evidence: The matter's Calendar section at apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte reads the matter's events and its deadlines, in every state, and reports which deadlines are past due. There is still no firm calendar route, and the reads a month grid and a week view consume are built and contract-emitted with nothing consuming them.

- id: calendar.sync
  name: Two-way Google/Outlook sync
  scope: Two-way calendar synchronization via the email/calendar plugin.
  status: not-started
  slices: integration-port-system
  adrs: ADR-0091
  evidence: No calendar adapter; the integration port system it will plug into is shipped.
  audience: public
  public-name: Two-way calendar sync
  public-summary: Keep the firm's calendar and your Google or Outlook calendar in step, in both directions.

- id: calendar.docketing
  name: Rules-based docketing
  scope: Compute court dates and deadlines from jurisdiction/court rule sets, defaulting from the matter's jurisdiction or home Location.
  status: researching
  adrs: ADR-0018
  evidence: White paper flags it needs-development and expects its own subsystem spec; none exists. Court-rule sets are jurisdiction-keyed reference data on the trust-rules-catalog pattern.
  audience: public
  public-name: Deadlines calculated from court rules
  public-summary: Enter the trigger date and have the deadlines that follow from it calculated under the rules of the court you are in.

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
  audience: public
  public-summary: Be reminded of a deadline before it arrives, on the notice you choose.
