# Calendar and Rules-Based Docketing

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Calendar and deadlines -->

- id: calendar
  name: Calendar and docketing
  scope: Calendar surface for matters, deadlines, and appointments; two-way external sync; rules-based court-deadline computation.
  status: partial
  adrs: ADR-0018, ADR-0055
  evidence: The event and deadline model, firm events with an audience switch, resources and bookings with derived liveness, typed event links with chain-held continuance, the federated timeline (fourteen sources in TIMELINE_SOURCES), the firm's week-start setting, and thirty-five routes are built (packages/calendar, apps/api-worker/src/http/routes/calendar/calendar.ts registers thirty-five handlers); the firm calendar, the matter's Calendar section and the calendar settings page are the interface, and there is no docketing computation (which is a deliberate position, not a gap).
  audience: public
  public-name: Calendar and deadlines
  public-summary: Hearings, deadlines, firm events and room bookings in one calendar, with every date on a matter visible as that matter's own timeline.

- id: calendar.events
  name: Litigation events and deadlines
  scope: Member-entered hearings, filings, service, orders, depositions and the like, plus first-class deadlines with a stated authority, satisfaction, and a vacate/supersede trail.
  status: shipped
  adrs: ADR-0055
  notes: Read on the matter's Calendar section and on the firm calendar; recorded, edited, cancelled, continued, satisfied, vacated and superseded from those screens through the record forms and the entry window.
  evidence: Four per-firm tables (matter_event, matter_event_type, matter_event_participant, matter_deadline) with civil dates, an explicit IANA zone per row, and the platform event-type catalog seeded by 20260806T000000_case-calendar; write paths in packages/calendar; read at apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte and apps/web/src/routes/(app)/calendar/+page.svelte; written from apps/web/src/lib/calendar/record-event-dialog.svelte, record-deadline-dialog.svelte and entry-window.svelte.

- id: calendar.events.recurrence
  name: Repeating settings
  scope: A calendar setting that happens more than once, held as one row carrying an RFC 5545 rule and expanded at read time, on both the matter and the firm scope.
  status: partial
  surface: screen
  spec: docs/specs/2026-09-15-calendar-places-people-and-recurrence-design.md
  notes: Partial because the rule is stored, returned, shown and edited but the occurrences are not painted on the grid yet; the read-time expansion and the this-occurrence-or-series question an edit has to ask are the next slice. Nothing here computes a deadline — a recurring event is not a docketing rule.
  evidence: recurrence_rule on matter_event and firm_event (20260916T000000_event-recurrence), threaded through packages/calendar's statement modules, services and event-shape asserts and refused at the write as calendar-invalid-recurrence; the grammar in packages/civil-time/src/recurrence.ts, which the record form and the calendar service both depend on so one reading of a valid rule serves both; edited in apps/web/src/lib/calendar/recurrence-field.svelte and read out in recurrence-sentence.ts.
  audience: public
  public-name: Repeating events
  public-summary: Record a hearing or a firm meeting once and have it repeat — weekly, every second Tuesday, the third Tuesday of the month — with the rule read back to you in words before you save it.

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
  evidence: firm_resource and firm_resource_booking tables; packages/calendar/src/resource-service.ts and booking-service.ts (two-stage overlap check, zone frozen from the resource's office); availability, booking and the two per-event bookings routes in apps/api-worker/src/http/routes/calendar/calendar.ts; apps/web/src/routes/(app)/settings/resources/+page.svelte, the Rooms tab in apps/web/src/lib/calendar/entry-window.svelte, and apps/web/src/routes/(app)/calendar/rooms/+page.svelte.

- id: calendar.links-continuance
  name: Event links and continuance
  scope: Typed relations between events, and continuance as a new setting pointing at the vacated one — old row byte-untouched, chain held by partial unique indexes, no deadline ever moved.
  status: shipped
  surface: screen
  notes: Continue Setting is a verb on a scheduled matter event in the entry window, which lists the trigger-linked open deadlines the operation reports and states that none moved; the Links tab shows continued-from and continued-to, and the settings related by hand with their titles, Relate (a setting on the same matter, or a firm event within six months) and Remove.
  evidence: calendar_event_link with two hand-written partial uniques; packages/calendar/src/continuance-service.ts (one-batch operation, depth-capped chain read, trigger-linked deadline lookup as pure SELECT); continue, continuance-chain and the two per-event links routes (GET /api/v1/events/{eventId}/links, /firm-events/{firmEventId}/links, asserted in apps/api-worker/test/calendar-routes.test.ts); the Links tab in apps/web/src/lib/calendar/entry-window.svelte.

- id: calendar.surface
  name: Calendar surface
  scope: Calendar of matters, deadlines, and appointments.
  status: partial
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: One reusable calendar component (CalendarView over the design system's CalendarGrid) embedded with a scope: the firm screen, the matter section, a record form's context pane, and later the dashboard, an entity and a room. Four presentations — month, week, day, agenda — of which only the day has a time axis.
  evidence: apps/web/src/lib/calendar/calendar-view.svelte and packages/design-system/src/lib/components/calendar-grid; both registered in tooling/lint-one-ui/registry.json so a second calendar rendering fails the gate.

- id: calendar.surface.calendars-rail
  name: Individual calendars, in folders
  scope: Every calendar the firm has as its own row — the firm's records, its own events, a member per role the firm handed out, a room, a date calendar — kept in folders, turned on one at a time or a folder at a time, each wearing a colour the member chose.
  status: shipped
  surface: screen
  audience: public
  public-name: Your calendars
  public-summary: Turn each colleague's, each room's and each kind of date's calendar on or off, and give any of them a colour.
  notes: The folders are the FIRM'S vocabulary — a folder is a role it handed out — so nothing in the product decides who counts as support staff; a member holding two roles is filed under the first. What is on and what colour it wears is personal and per browser, unlike the week start, which is the firm's and lives on the server. File-destruction dates are a served date calendar, reading the date each matter's paper file may be destroyed after as the firm recorded it.
  evidence: The catalog in apps/web/src/lib/calendar/calendar-sources.ts and the preference in calendar-preferences.svelte.ts, rendered by calendar-rail.svelte; the read plan per calendar in calendar-reads.ts (readOneCalendar, one arm per CalendarSourceKind), with every entry tagged and mergeByRecord unioning a record that arrives from two; asserted in apps/web/test/calendar-sources.test.ts and calendar-entries.test.ts.

- id: calendar.surface.day-view
  name: The day, as a column per calendar
  scope: One day drawn as an hour axis crossed with a column per calendar turned on, with an all-day band above the hours, for a day a firm spends in several places at once.
  status: shipped
  surface: screen
  audience: public
  public-name: Day view
  public-summary: See one day with a column for each calendar, so parallel scheduling reads at a glance.
  notes: A record on two calendars is drawn in both their columns deliberately. The hours are the working day, widened by anything outside it and never narrowed. It is fed by the hour the federated read now carries.
  evidence: packages/design-system/src/lib/components/calendar-grid/calendar-grid-day.svelte over day-axis.ts, asserted in packages/design-system/test/day-axis.test.ts and three catalog stories; the lane expansion in apps/web/src/lib/calendar/calendar-entries.ts (perLane, recordKeyOf); the hour declared per source in packages/calendar/src/sources/all.ts (timeOfDayExpression) and carried on TimelineEntry.

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
  scope: Recording an event on a matter or on nobody's, a deadline on a matter (including superseding one), and a firm event from a screen, with a participant picker over the roster, the directory and external names; a Location offered from the firm's own offices and rooms, a conference link for a setting held on a call, times as time fields with the zone beside them as a shortcode, and the day being booked in the panel's context pane.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar, 6-2-calendar-firm-events-resources
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: The matter is not required — no matter is a choice whose row says what it writes, and the form records a firm event instead, which is the table an event belonging to no case already had. Double-clicking an empty day or hour opens the event form on it, as an accelerator beside the create control every screen carries.
  evidence: apps/web/src/lib/calendar/record-event-dialog.svelte, record-deadline-dialog.svelte, record-firm-event-dialog.svelte, location-picker.svelte, day-schedule.svelte, record-timing-fields.svelte and participant-picker.svelte over the pure draft models asserted in apps/web/test/calendar-drafts.test.ts; conference_url on matter_event and firm_event (20260914T120001_event-conference-link).

- id: calendar.surface.firm-settings
  name: Firm calendar settings
  scope: What the firm decides once about how it reads its calendar, held in the per-firm setting table and edited under Settings › Practice › Calendar; today the day the week begins on.
  status: shipped
  surface: screen
  slices: 6-1-case-calendar
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: A firm setting, never a personal preference (owner ruling 2026-09-02); Sunday by default. Read by every member who can read the calendar, moved only under calendar:manage, audited, idempotent. The page is the first settings page with a server behind it and shows no per-browser history.
  evidence: packages/calendar/src/settings.ts over the setting table; GET/PATCH /api/v1/calendar/settings in apps/api-worker/src/http/routes/calendar/calendar.ts, asserted over Miniflare in apps/api-worker/test/calendar-settings-routes.test.ts; apps/web/src/routes/(app)/settings/calendar/+page.svelte over apps/web/src/lib/calendar/calendar-settings-draft.svelte.ts (apps/web/test/calendar-settings-draft.test.ts); CalendarView reads it once in apps/web/src/lib/calendar/calendar-context.svelte.ts and hands it to every grid.

- id: calendar.surface.event-types
  name: Event-type catalog
  scope: The vocabulary a setting is classified under, kept under Settings › Practice › Event Types: the platform's shipped types (recategorized or retired, never renamed) and the firm's own (added, renamed, retired).
  status: shipped
  surface: screen
  slices: 6-1-case-calendar
  spec: docs/specs/2026-09-02-calendar-interface-design.md
  notes: Retiring is one way, as the contract is; a word wanted back is added again as the firm's own. Gated on the session's calendar:manage.
  evidence: apps/web/src/routes/(app)/settings/event-types/+page.svelte over the event-type routes in apps/api-worker/src/http/routes/calendar/calendar.ts.

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
  status: in-build
  surface: screen
  slices: integration-port-system
  adrs: ADR-0091
  spec: docs/specs/2026-11-10-calendar-sync-design.md
  evidence: Design accepted 2026-11-10 (per-member, rule-driven, off by default, Outlook first). Built so far is connecting a member's own Outlook account with calendar access only (apps/api-worker/src/http/routes/calendar/connected-accounts.ts, asserted in apps/api-worker/test/connected-accounts-routes.test.ts; packages/microsoft-graph; apps/web/src/routes/(app)/settings/connected-accounts/+page.svelte), dormant until a Microsoft application is registered. No event syncs in either direction yet.
  notes: In flight on docs/active-work/claude/project-thread-pbtqhp.md.
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
