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
  notes: The matter's Calendar section reads both records; recording from the screen waits on the event and deadline forms, so those actions render disabled; the participant picker it once named exists (EntityPicker) and is consumed when the forms are built. The firm-wide calendar screens remain their own slice.
  evidence: Four per-firm tables (matter_event, matter_event_type, matter_event_participant, matter_deadline) with civil dates, an explicit IANA zone per row, and the platform event-type catalog seeded by 20260806T000000_case-calendar; write paths in packages/calendar; read at apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte over the two listings.

- id: calendar.timeline
  name: Matter timeline (federated)
  scope: One ordered history per matter across every subsystem that already records what the firm did, read in place through a source registry under one cursor and one visibility contract.
  status: shipped
  adrs: ADR-0051, ADR-0068
  evidence: Fourteen declared sources in packages/calendar/src/sources/all.ts; nothing projected, copied, or backfilled; every source declares its visibility anchor — matter anchors compose the required predicate, firm anchors sit on a reviewed allowlist — proven by a table-driven fitness test. Read by the matter's Activity section since 2026-09-02.

- id: calendar.timeline.activity-section
  name: The matter's Activity section
  scope: The federated timeline as a screen — one chronology per matter on the product's shared table, sorted and filtered by its own columns, each row named by the subsystem that owns it through that subsystem's own describe statement and contribution, opening into its section, and the first record (a note) written from it.
  status: shipped
  slices: 4-4-matter-notes
  surface: screen
  audience: public
  public-name: Matter activity
  public-summary: See everything that has happened on a case, in order, in one place — and write a note from there.
  evidence: apps/web/src/lib/activity/activity-register.svelte over GET /api/v1/matters/{matterId}/timeline, mounted in full by apps/web/src/routes/(app)/matters/[id]/activity/+page.svelte and with a row budget as the Overview's Recent activity, rendered as a DataTable.Grid (apps/web/src/lib/activity/activity-columns.ts); the contract in apps/web/src/lib/activity/contribution.ts and the registry in apps/web/src/lib/activity/contributions.ts, one contribution per source beside its subsystem's code; the server's describe on seven sources (the file manager's history events among them, as the fileHistory source) in packages/calendar/src/sources/all.ts, run after the merge by packages/calendar/src/timeline.ts and pinned by packages/calendar/test/describe.test.ts; the registry pairing asserted by apps/web/test/activity-contributions.test.ts and section ownership by tooling/lint-matter-timeline-coverage/index.mjs; the two-subsystem walk, the head-menu walk, the file-identity walk and the write-a-note walk in apps/web/e2e/matter-activity.spec.ts.
  notes: The screen names no source and switches on none. A subsystem joins the chronology with a `permission` and a `describe` on its timeline source and an ActivityContribution beside its own web code; the test fails until both exist, and the coverage lint fails until a section owns the source or declares it ownerless. The description is server-side, one statement per source present on the page, gated per source by the member's capabilities: a member without notes:read sees that a note was written and not what it said. The firm-wide read is never described. A file's Type is what the file manager identifies it as (its document type, else the identification's own label), never a name suffix; Section and Type are two columns with two filters. Opening a row follows the timeline's deep link into the owning section; sections honouring `?entry=` is the next step.

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
