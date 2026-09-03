# Calendar and Rules-Based Docketing

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Calendar and deadlines -->

- id: calendar
  name: Calendar and docketing
  scope: Calendar surface for matters, deadlines, and appointments; two-way external sync; rules-based court-deadline computation.
  status: partial
  adrs: ADR-0018, ADR-0055
  evidence: The event and deadline model, firm events with an audience switch, resources and bookings with derived liveness, typed event links with chain-held continuance, the federated timeline (fourteen sources in TIMELINE_SOURCES), the firm's week-start setting, and thirty-five routes are built (packages/calendar, apps/api-worker/src/routes/calendar.ts registers thirty-five handlers); the firm calendar, the matter's Calendar section and the calendar settings page are the interface, and there is no docketing computation (which is a deliberate position, not a gap).
  audience: public
  public-name: Calendar and deadlines
  public-summary: Hearings, deadlines, firm events and room bookings in one calendar, with every date on a matter visible as that matter's own timeline.

- id: calendar.events
  name: Litigation events and deadlines
  scope: Member-entered hearings, filings, service, orders, depositions and the like, plus first-class deadlines with a stated authority, satisfaction, and a vacate/supersede trail.
  status: shipped
  surface: screen
  adrs: ADR-0055
  notes: Read on the matter's Calendar section and on the firm calendar; recorded, edited, cancelled, continued, satisfied, vacated and superseded from those screens through the record forms and the entry window.
  evidence: Four per-firm tables (matter_event, matter_event_type, matter_event_participant, matter_deadline) with civil dates, an explicit IANA zone per row, and the platform event-type catalog seeded by 20260806T000000_case-calendar; write paths in packages/calendar; read at apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte and apps/web/src/routes/(app)/calendar/+page.svelte; written from apps/web/src/lib/calendar/record-event-dialog.svelte, record-deadline-dialog.svelte and entry-window.svelte.

- id: calendar.timeline
  name: Matter timeline (federated)
  scope: One ordered history per matter across every subsystem that already records what the firm did, read in place through a source registry under one cursor and one visibility contract.
  status: shipped
  surface: awaiting-screen
  adrs: ADR-0051, ADR-0068
  notes: Backend only — the calendar screens are their own slice.
  evidence: Fourteen declared sources in packages/calendar/src/sources/all.ts; nothing projected, copied, or backfilled; every source declares its visibility anchor — matter anchors compose the required predicate, firm anchors sit on a reviewed allowlist — proven by a table-driven fitness test.

- id: calendar.firm-events
  name: Firm events
  scope: Events that belong to the firm rather than to a case — meetings, closures, training, holidays, reservations — with an all-members/participants audience and the same civil-date/zone model as case events.
  status: shipped
  surface: screen
  adrs: ADR-0055, ADR-0068
  notes: On the firm calendar at /calendar beside the matters' settings, recorded from its Record menu, opened and edited in the entry window; /calendar/firm-events is the deep link the federated read emits.
  evidence: firm_event and firm_event_participant in 20260807T070000_calendar-firm-events-resources-links; write paths in packages/calendar/src/firm-event-service.ts; the firmEvent federated source with visibilityAnchor 'firm'; scope and widened member filters on GET /api/v1/calendar/events.

- id: calendar.resources
  name: Rooms and resources
  scope: Bookable firm resources (rooms, vehicles, equipment) with availability as a read, bookings attached to exactly one event, liveness derived from event status, and double-booking as a warn-and-allow visible fact.
  status: shipped
  surface: screen
  notes: The catalog is kept under Settings › Practice › Rooms and Resources; a room is booked from an event's window (its Rooms tab) and read on the room grid at /calendar/rooms. A per-firm hard-refuse booking policy, approval workflows, and room-panel sync are named seams.
  evidence: firm_resource and firm_resource_booking tables; packages/calendar/src/resource-service.ts and booking-service.ts (two-stage overlap check, zone frozen from the resource's office); availability, booking and the two per-event bookings routes in apps/api-worker/src/routes/calendar.ts; apps/web/src/routes/(app)/settings/resources/+page.svelte, the Rooms tab in apps/web/src/lib/calendar/entry-window.svelte, and apps/web/src/routes/(app)/calendar/rooms/+page.svelte.

- id: calendar.links-continuance
  name: Event links and continuance
  scope: Typed relations between events, and continuance as a new setting pointing at the vacated one — old row byte-untouched, chain held by partial unique indexes, no deadline ever moved.
  status: shipped
  surface: screen
  notes: Continue Setting is a verb on a scheduled matter event in the entry window, which lists the trigger-linked open deadlines the operation reports and states that none moved; the Links tab shows continued-from and continued-to. Related links are recorded through the API only until the links surface lands.
  evidence: calendar_event_link with two hand-written partial uniques; packages/calendar/src/continuance-service.ts (one-batch operation, depth-capped chain read, trigger-linked deadline lookup as pure SELECT); continue and continuance-chain routes.

- id: calendar.surface
  name: Calendar surface
  scope: Calendar of matters, deadlines, and appointments.
  status: partial
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: One reusable calendar component (CalendarView over the design system's CalendarGrid) embedded with a scope: the firm screen, the matter section, and later the dashboard, an entity and a room.
  evidence: apps/web/src/lib/calendar/calendar-view.svelte and packages/design-system/src/lib/components/calendar-grid; both registered in tooling/lint-one-ui/registry.json so a second calendar rendering fails the gate.

- id: calendar.surface.firm-calendar
  name: Firm calendar screen
  scope: The firm-wide calendar at /calendar: month, week and agenda views over the federated read, the deadlines read and the firm-events read, with a Mine / Everyone scope and a Record menu.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar, 6-2-calendar-firm-events-resources
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: Paints kinds and matter numbers, never titles, on the firm-wide grid; the title is fetched for the one entry opened. The week is seven civil-day columns rather than a time axis (owner flag C3).
  evidence: apps/web/src/routes/(app)/calendar/+page.svelte over apps/web/src/lib/calendar/calendar-reads.ts; the window arithmetic and the projection are asserted in apps/web/test/calendar-window.test.ts, calendar-entries.test.ts and calendar-reads.test.ts.

- id: calendar.surface.matter-section
  name: Matter calendar section
  scope: The matter's Calendar section: the deadlines and events tables as the List view, plus Month and Agenda views over the same component with the matter scope, and live record controls.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  evidence: apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte embedding apps/web/src/lib/calendar/calendar-view.svelte with a matter scope.

- id: calendar.surface.entry-window
  name: Entry window
  scope: The one window an event, a firm event or a deadline opens in: the record, its participants and links, in-place editing, and the verbs (cancel, continue, satisfy, vacate, supersede).
  status: shipped
  surface: screen
  slices: 6-1-case-calendar, 6-2-calendar-firm-events-resources
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: The History tab is a marked Soon seam until a per-record audit read exists; a deadline reached by deep link outside the window on screen says so rather than reading one by id, because no single-deadline route exists.
  evidence: apps/web/src/lib/calendar/entry-window.svelte, a RecordWindow.

- id: calendar.surface.record-forms
  name: Record forms
  scope: Recording an event on a matter, a deadline on a matter (including superseding one), and a firm event from a screen, with a participant picker over the roster, the directory and external names.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar, 6-2-calendar-firm-events-resources
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  evidence: apps/web/src/lib/calendar/record-event-dialog.svelte, record-deadline-dialog.svelte, record-firm-event-dialog.svelte and participant-picker.svelte over the pure draft models asserted in apps/web/test/calendar-drafts.test.ts.

- id: calendar.surface.firm-settings
  name: Firm calendar settings
  scope: What the firm decides once about how it reads its calendar, held in the per-firm setting table and edited under Settings › Practice › Calendar; today the day the week begins on.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: A firm setting, never a personal preference (owner ruling 2026-09-02); Sunday by default. Read by every member who can read the calendar, moved only under calendar:manage, audited, idempotent. The page is the first settings page with a server behind it and shows no per-browser history.
  evidence: packages/calendar/src/settings.ts over the setting table; GET/PATCH /api/v1/calendar/settings in apps/api-worker/src/routes/calendar.ts, asserted over Miniflare in apps/api-worker/test/calendar-settings-routes.test.ts; apps/web/src/routes/(app)/settings/calendar/+page.svelte over apps/web/src/lib/calendar/calendar-settings-draft.svelte.ts (apps/web/test/calendar-settings-draft.test.ts); CalendarView reads it once in apps/web/src/lib/calendar/calendar-context.svelte.ts and hands it to every grid.

- id: calendar.surface.kind-narrowing
  name: Layers, the colleague picker and the settled filter
  scope: Turning the timeline's date-bearing sources (custody due-backs and review dates) on over the firm calendar as a layer, reading one colleague's calendar beside Mine and Everyone, and narrowing the agenda to what is still coming.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: Only date-bearing sources are offered as layers; the timeline's history sources (time, costs, mail, documents, trust) stay in the matter timeline rather than flooding a month. Every refinement is mirrored into the address.
  evidence: CALENDAR_LAYERS and firmCalendarKinds in apps/web/src/lib/calendar/calendar-vocabulary.ts, read through calendar-reads.ts; the controls in calendar-toolbar.svelte over calendar-controller.svelte.ts (layers, memberChoice, hideSettled); asserted in apps/web/test/calendar-reads.test.ts and calendar-entries.test.ts.

- id: calendar.surface.embedded
  name: Calendar embedded on other surfaces
  scope: The Today card on Home, the matter overview's agenda, and a directory entity's appearances, each the one component with a narrower scope.
  status: partial
  surface: screen
  slices: 6-1-case-calendar
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: Home's Today card (today and tomorrow, the reader's own scope, six rows) and the matter overview's Coming up card (the next thirty days, six rows) are built; a directory entity's appearances wait on a participant read filterable by entity.
  evidence: apps/web/src/routes/(app)/home/+page.svelte and apps/web/src/routes/(app)/matters/[id]/overview/+page.svelte embed apps/web/src/lib/calendar/calendar-view.svelte with agendaDays and limit; nothing on a directory entity page reads the calendar.

- id: calendar.surface.room-grid
  name: Room grid and bookings
  scope: A resource's schedule over the availability read with conflicts painted, bookings on an event's window, and the resource catalog under Settings.
  status: shipped
  surface: screen
  slices: 6-2-calendar-firm-events-resources
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: The room grid is the one calendar component with the resource scope; a booking paints as its event, danger with a Double-booked line where the read pre-paired it, and opens the event's window. Booking takes the event's own window; changing a booking's span is recorded through the API until a reason to surface it appears.
  evidence: apps/web/src/routes/(app)/calendar/rooms/+page.svelte over the resource scope in apps/web/src/lib/calendar/calendar-reads.ts (asserted in apps/web/test/calendar-reads.test.ts); the Rooms tab and Book a Room verb in apps/web/src/lib/calendar/entry-window.svelte over GET /api/v1/events/{eventId}/bookings (apps/api-worker/test/calendar-routes.test.ts); the catalog at apps/web/src/routes/(app)/settings/resources/+page.svelte.

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
