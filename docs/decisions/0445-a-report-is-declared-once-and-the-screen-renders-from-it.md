---
number: 445
slug: a-report-is-declared-once-and-the-screen-renders-from-it
status: Proposed
date: 2026-09-07
area: Reports
summary: "The report surface is two screens over one registry, not a screen per report. Every report the platform offers is declared once in apps/web/src/lib/reports/report-registry.ts — its family, its permission key, whether it takes a knowledge instant or is live-only, which scope controls it needs, the read that fetches it and the presenter that turns the payload into titled table sections — and the catalogue and the run screen render from that declaration. The presentation shape is the tabular export document's shape, so every report exports in every format the moment it is declared. A report whose backend is not built is still declared, at stage soon with what it waits on, and renders in the catalogue visible and disabled. Adding a report is one registry entry plus a presenter; a second screen per report is refused."
---

**A report is declared once, and the screens render from the declaration.**

**Context.** The reporting design settled four report families and the bar-audit pack shipped as a
backend with no screen. The first screen could have been a page for the pack. It would have been
the first of a dozen: aging, work in progress, realization, productivity and the operational
counts each want a period, most want a knowledge instant, every one wants export, and a page per
report is a dozen answers to "where do the period controls go" that drift apart one correction at
a time. The sidebar solved the same problem for destinations with a registry rendered by one
component; the tools area solved it with a catalog and a presentation layer. Reports takes the same
shape.

**Decision.**

- **One registry.** `report-registry.ts` holds every report as data: `id` (its route segment),
  `family`, `name`, one-line `answers`, the `reports:*` permission the server enforces, its
  `temporal` contract (`bitemporal` draws the knowledge-instant control; `live-only` does not,
  because a read that cannot honor an instant must not be offered one), the `scope` controls it
  takes (a trust account today; a period on every report), and its `stage`. A report at stage
  `soon` carries `waitsOn` and no ports; a report at any other stage carries a `read` port and a
  `present` port.
- **Two ports, and the presentation IS the export document.** `read` is `(fetch, scope) →
  ApiOutcome<payload>`; `present` is `(payload) → ReportPresentation`, a title, a stamp (the
  reproducibility statement the response already carries, in its own words), the completeness
  declaration, and titled sections of headers and rows. That shape maps one-to-one onto
  `$lib/export/tabular-export.ts`, so the export menu takes every report with no per-report export
  code, and a file can never disagree with the screen because both are the same presentation.
- **Two screens.** `/reports` lists the registry grouped by family; a `soon` row renders its name,
  what it answers and the Soon mark, disabled, with what it waits on. `/reports/<id>` draws the
  report's scope controls from its declaration at the reading edge, reads when the scope is
  complete and valid, and renders the presentation below in a loading region. The scope rides the
  address, so a report somebody ran is a link somebody else can open.
- **What the screen never does.** It never computes a figure. Totals, running balances and
  differences arrive in the payload from the reporting package, which is where the agreement
  tests live; a presenter formats and arranges, and a test proves it drops nothing and sums
  nothing.
- **The account picker rides a trust read.** `GET /api/v1/trust/accounts` (paged, `trust:read`)
  is the one listing of a firm's trust accounts, added here because the report needs it and the
  trust ledger has been waiting on it. Whether a member holding only `reports:trustCompliance`
  should be able to list accounts is flagged for the owner in the design rather than settled by
  gating the listing on a report key.

**Consequences.** The next report costs a presenter and a registry row. The families the design
named are on the catalogue today, honestly disabled, so the shape of the surface is reviewable
before their backends exist. Scheduling and production (the filed artifact) are seams the run
screen leaves room for in its action row and does not fake.
