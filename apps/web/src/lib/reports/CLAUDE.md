# Reports (web) — CLAUDE.md

**Purpose.** The report surface: the registry every report is declared in, the scope a report is
asked over, the presentation a report renders as, and the presenters that turn a reporting payload
into one. The screens under `apps/web/src/routes/(app)/reports/` render from here and decide
nothing a report could decide for itself.

**White paper:** _Reports_. **Spec:**
[`docs/specs/2026-09-07-report-screen-design.md`](../../../../../docs/specs/2026-09-07-report-screen-design.md),
over [`docs/specs/2026-08-13-financial-reporting-design.md`](../../../../../docs/specs/2026-08-13-financial-reporting-design.md).

## Key files / entry points

- `report-catalogue.ts` — the registry projected into the shared catalogue vocabulary
  ([`$lib/catalogue`](../catalogue/CLAUDE.md)), which the `/reports` landing index renders through
  AND the reports layout's navigation column reads (`routes/(app)/reports/+layout.svelte`, on the
  design system's `NavigationLayout`, drawing `$lib/catalogue/catalogue-navigation.svelte`). One
  projection feeds both sides of the two-sided screen; adding a report never touches either.
- `report-registry.ts` — every report as data: family, name, the question it answers, its
  `reports:*` permission, its temporal contract, its scope controls, and (for a built report) the
  read and the presenter paired under one payload type by `built()`. A `soon` report has no ports.
- `report-scope.ts` — the period presets, the knowledge-instant day in a zone, the address round-trip.
- `report-policy-draft.svelte.ts` — the firm's report policy as the settings page's draft.
- `report-presentation.ts` — the shape a report renders as, and its mapping onto the export document.
- `reports-api.ts` — the wire shapes and the reads (the pack, the trust-account roster).
- `trust-compliance-presenter.ts` — the pack's presenter; `trust-compliance-fixture.ts` its sample.
- `report-reads.ts` — the financial, productivity and operational wire shapes and reads.
- `financial-presenters.ts`, `activity-presenters.ts` — their presenters; `report-samples.ts` their
  samples; `report-cells.ts` how they print money (through `@magna-carta/money`), hours and counts.
- `report-summary.svelte` — the row of totals; `report-section-table.svelte` one section (a plain
  table with its ruled total, or `report-section-grid.svelte` on `DataTable.Grid` when sortable),
  and the cards it becomes under the medium breakpoint.

## Local conventions

- **Adding a report is one registry entry plus a presenter.** Never a route of its own. The run
  screen draws the controls the declaration names and nothing else, and the catalogue — the landing
  index and the navigation column alike — picks the report up from the registry with no edit of
  its own.
- **The run screen renders in the content column of a two-sided screen and keeps
  `back="reports"` on its header.** The column beside it is a finding aid, not the way back;
  `pnpm run lint:back-navigation` reads the header.
- **A presenter computes nothing.** Every figure printed is the payload's; a presenter formats
  and arranges. Its test asserts the printed figures are the payload's and that every entry reaches
  a row. A presenter that sums a column has become a second answer to a ledger question.
- **The stamp is the response's own sentence.** Print `reproducibilityStatement` as served; do not
  paraphrase it on screen or in a file.
- **Live-only reports do not accept a knowledge instant.** `temporal: "live-only"` hides the
  control; do not read `knownAsOf` in such a report's reader.
- **Sample words only in a fixture.** The fixture pack uses the design system's sample people and
  matters; never a firm's own figures.
- **Totals first, then tables (the owner's pick B, 2026-11-13).** A presentation with a `summary`
  opens with its tiles and states its stamp as one line; a by-office section carries the payload's
  total as `totalRow`; a by-client section is `sortable` with each client's matters in
  `rowDetails`. The grid's own totals row is never switched on for a report: it adds the column up,
  and a report's totals are the payload's.
- **The office is a filter, never a gate.** `scope.office` rides the address as `office`; null is the
  whole firm, which every member who may run the report may run.

## Dependencies & contracts

- Reads through `$lib/api/request.ts`; the shapes mirror `apps/api-worker/openapi/openapi.json`
  (`reports.trustCompliancePack`, `trust.listTrustAccounts`).
- Exports through `$lib/export` (the presentation IS the export document's shape).
- Period arithmetic is the time sheet's (`$lib/time/time-sheet-scope.ts`) — one span vocabulary.

## Gotchas

- **The account picker rides `trust:read`**, not the report key, by the owner's ruling. A member
  holding only `reports:trustCompliance` sees the refusal sentence naming the key. Do not gate the
  listing on a report key to work around it.
- **The knowledge instant is the end of the chosen day in the holding office's zone**
  (`knowledgeInstantForDate(day, zone)`, the zone from the trust listing). Changing the account
  keeps the day and moves the instant (`knowledgeInstantMovedToZone`). Never `T23:59:59.999Z`
  literally.
- **What the pack lists is the firm's policy, not a control.** The run screen states no option;
  the server defaults from `firm:manageReportPolicy`'s settings and the provenance records it.
  `report-policy-draft.svelte.ts` is the settings page's model.
