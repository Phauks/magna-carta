# The report screen — design

**Date:** 2026-09-07
**Status:** Design, built in the same stream (slice 3·6's first interface). The owner asked for the
main report-generation screen "up and running", built as ports and seams so it grows as the
program does.
**White paper:** _Reports_. **Builds on:**
[`2026-08-13-financial-reporting-design.md`](2026-08-13-financial-reporting-design.md) (the
projection layer, the temporal contract, the four families, the nine owner questions) and
[`2026-08-31-tabular-export-rendering-design.md`](2026-08-31-tabular-export-rendering-design.md)
(the export seam). **Decision:**
[`a-report-is-declared-once-and-the-screen-renders-from-it`](../decisions/0445-a-report-is-declared-once-and-the-screen-renders-from-it.md).
**Scope:** the `/reports` destination and everything a person does on it — pick a report, set its
period, its knowledge instant and its subject, read the result, export it. **Excludes:** the
report families' backends (sub-slices 3·6·2 to 3·6·4), scheduling and the filed artifact
(3·6·5), and the trust ledger's own account wiring, which the listing added here unblocks but
which belongs to the money-sections stream.

---

## 1. What the screen is

A firm's reports are a small, growing library, and every report in it is the same kind of thing: a
question asked over a period, answered from records that already exist, read on screen and taken
away as a file. The surface is therefore **two screens over one registry**:

- **The catalogue, `/reports`.** Every report the platform declares, grouped by family, each with
  the question it answers. A report whose backend is built opens; one whose backend is not renders
  visible, disabled, marked Soon, with what it waits on. The catalogue is honest about the
  library's shape before the library is full.
- **The run screen, `/reports/<report>`.** The report's own controls at the reading edge, its
  answer beneath them, and the export menu over that answer. The period, the knowledge instant
  and the subject ride the address, so a report somebody ran is a link somebody else can open.

There is no third screen per report. That is the whole design: one report is one registry entry
plus one presenter, and the screens render from it.

## 2. The registry — where a report is declared

`apps/web/src/lib/reports/report-registry.ts` holds every report as data, on the pattern of the
sidebar's destinations registry. A declaration carries:

| Field        | What it decides                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | The route segment, `/reports/<id>`, and the key a test names it by                                                                          |
| `family`     | Which heading it sits under: trust compliance, financial, productivity, operational                                                         |
| `name`       | The screen's title, taken from here and nowhere else                                                                                        |
| `answers`    | One line, the question the report answers, on the catalogue row                                                                             |
| `permission` | The `reports:*` key the server enforces; the run screen refuses with that key named when the session lacks it                               |
| `temporal`   | `bitemporal` draws the knowledge-instant control; `live-only` does not, because a read that cannot honor an instant must not be offered one |
| `scope`      | Which controls the run screen draws: the period on every report, a trust account where the report is about one                              |
| `stage`      | `soon` renders disabled in the catalogue with `waitsOn`; any other stage opens                                                              |
| `read`       | The port that fetches: `(fetch, scope) → ApiOutcome<payload>`                                                                               |
| `present`    | The port that arranges: `(payload) → ReportPresentation`                                                                                    |

A `soon` declaration has no ports, by type: a report that cannot be read cannot be presented, and
the union makes the combination unrepresentable rather than remembered.

## 3. The presentation — what a report looks like on screen and in a file

A `ReportPresentation` is a title, a stamp, the completeness declaration, and titled **sections of
headers and rows**, with a per-section note where a section has to say something about itself ("No
reconciliation was closed in this period"). That shape is the tabular export document's shape on
purpose: the run screen draws each section as a `DataTable`, and the export menu renders the same
sections through `$lib/export`, so a file cannot disagree with the screen.

Two rules follow, and a test holds each:

- **The presenter computes nothing.** Opening balances, closing balances, running balances, the
  difference between an attestation and the live proof: all arrive in the payload from
  `@magna-carta/reporting`, where the agreement tests prove them. A presenter formats money, dates
  and instants and arranges rows. The trust-compliance presenter's test asserts every journal entry
  and every ledger entry in a fixture pack reaches a row, and that the closing figures printed are
  the payload's own.
- **The stamp is the response's own sentence.** The reproducibility statement the reporting package
  writes is printed as the report's stamp, on screen and in the file, in its words. The screen adds
  a live/reproducible reading beside the controls and says nothing the response did not.

## 4. The run screen's controls — one period, one instant, one subject

- **The period** is a named span or a custom range, on the Time screen's pattern: this month, last
  month, this quarter, last quarter, this year, last year, and a date range that applies as it is
  picked. The arithmetic lives in `report-scope.ts` with the label and the span computed together,
  so a preset can never read "Last quarter" over the wrong ninety days.
- **The knowledge instant** is offered only on a bitemporal report. Its default is **live**
  ("everything known now"), which the stamp says out loud. A person who wants the reproducible
  form picks a date, and the instant is the end of that day in the zone of the office that holds
  the account (section 7, Q2), named beside the control. The instant is deliberately a date rather
  than a date-time: the question a person is asking is "as things stood on the first of August",
  and a time picker would invite a precision the answer does not need and the wire format would
  then have to explain.
- **The subject** is the trust account, picked from `GET /api/v1/trust/accounts`, which this stream
  adds. Closed accounts are listed beside open ones, because a compliance report is most often asked
  about a period after the account closed.
- **The pack's two options** (zero-balance ledgers, authorizers) are the firm's report policy
  (section 7, Q3) and are not on the screen.

The read fires when the scope is complete and valid. There is no Run button: the reporting reads
are bounded and measured (a twelve-month pack assembles in about a tenth of a second), every
control's change is a new question, and a button between the question and the answer is a control
that makes the reader confirm what they already chose.

## 5. The state set

The result region is furniture. It renders at rest with a fixture of the report's own sections, so
the answer fills a shape the reader already has. A read in flight is the loading region over that
fixture; a refusal settles to the failure notice with Retry and the Error ID; a refused permission
names the key; a scope that is not yet complete says which control is empty, beside that control,
and reads nothing. A period the account has nothing in produces the report with empty sections and
the stamp, which is a true answer rather than an empty state.

## 6. What is deliberately not on the screen

- **Production and scheduling.** The filed artifact and the schedule are the delivery sub-slice's,
  and both need machinery this repository cannot run yet. The run screen's action row has room for
  them and does not draw a disabled control for either: a Soon control earns its place when the
  design of the thing behind it is settled, and the production record's shape is still open on the
  owner's Q6 and Q7.
- **Any figure the screen would compute.** Section 3.
- **A per-report page.** Section 1.

## 7. Decided by the owner (2026-09-07)

The three questions the first build flagged were put to the owner with a recommendation each, and
the owner took all three. Each is built in the same stream.

- **Q1 — Who may list trust accounts: `trust:read`, stated on the screen.** The account picker
  reads `GET /api/v1/trust/accounts` on `trust:read`. A member granted only
  `reports:trustCompliance` sees the refusal in the one sentence the product uses for a refused
  control, naming the key, so the reader has the words to take to an administrator. A firm that
  grants the report key to a bookkeeper grants `trust:read` beside it, which is the direct grant
  the reporting design already describes. A second listing on the report key was rejected as a
  second answer to which accounts the firm holds.
- **Q2 — The knowledge instant is the end of the chosen day in the holding office's zone.** The
  office already records an IANA zone (`location.time_zone`), the trust-account listing carries it
  resolved beside each account, and the screen ends the chosen day in that zone
  (`knowledgeInstantForDate`), so two members asking for the same day get the same instant and a
  Nevada firm's "31 July" ends at midnight in Nevada. An office recorded before the column existed
  resolves to UTC on the server, in the one place the platform resolves a zone. Changing the
  account keeps the chosen day and moves the instant. No time picker: the precision invites a
  question the document cannot answer well, and the provenance section prints the full instant.
- **Q3 — What the pack lists is the firm's policy, under Settings › Practice › Reports.** Whether
  ledgers at zero all period appear and whether authorizers are named are firm settings
  (`reports.trustCompliance.zeroBalanceLedgers`, `reports.trustCompliance.authorizers`), read and
  written through `GET`/`PATCH /api/v1/firm/reports/policy` on `firm:manageReportPolicy` (Owner
  and Admin by seed), audited on write. The pack route applies the policy when a request leaves an
  option unstated, the screen states neither, and the provenance section records what was used.
  The key is in the `firm:` namespace on purpose: no `reports:` key may gate a write, so a report
  can never adjust the books it reports on. The controls came off the run screen.

## 8. Test plan

- **Registry fitness** (`report-registry.test.ts`): every id is a route segment; every permission
  is a `reports:` key; every `soon` report names what it waits on; every other report has both
  ports; the families cover the four the design named.
- **Scope arithmetic** (`report-scope.test.ts`): the named spans against a fixed date, including
  the year boundary on last quarter and last month; the knowledge-instant date maps to the end of
  that day; the address round-trips.
- **The presenter** (`trust-compliance-presenter.test.ts`): over a fixture pack, every entry
  reaches a row, the printed closing figures are the payload's, the stamp is the response's
  sentence, and the presentation renders through the export document's renderers.
- **The listing route** (`reports-routes.test.ts`, `account-tree.test.ts`): the page shape, the
  keyset, the refusal at the chokepoint.
