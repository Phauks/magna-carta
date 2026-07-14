# Calendar and Rules-Based Docketing

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: calendar
  name: Calendar and docketing
  scope: Calendar surface for matters, deadlines, and appointments; two-way external sync; rules-based court-deadline computation.
  status: not-started
  adrs: ADR-0018
  evidence: No calendar code, schema, or spec; matter detail skeleton reserves a Calendar section naming docketing deadlines (apps/web/src/lib/matters/sections.ts).

- id: calendar.surface
  name: Calendar surface
  scope: Calendar of matters, deadlines, and appointments.
  status: not-started
  evidence: Placeholder section in the matter detail skeleton only; no events model or UI.

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
