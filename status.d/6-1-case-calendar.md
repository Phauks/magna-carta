---
slice: 6·1 — Case calendar and matter timeline
group: phase-6
order: 1
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: done by="Opus 5"
ui: in-progress
load-profile: done by="Opus 5"
tested: done by="Opus 5"
next: The two index follow-ups the load profile names (the custodyDueBack predicate, the member filter's participant lookup); the matter timeline as a fourth view over the federated matter read; notification wiring subscribes to the declared emission points
branch: claude/calendar-ui-plan-eu523y
active-work:
link-spec: docs/specs/2026-08-05-case-calendar-design.md
link-plan: docs/specs/2026-08-05-case-calendar-implementation-plan.md
adrs:
blocked-by:
---

Built: the recorded model, the source registry, and the reads over both. **Four per-firm tables** — a litigation event, its platform-seeded-and-firm-extensible type catalog, its participants, and a first-class deadline — plus `location.time_zone`, two composite indexes on shipped tables (`audit_log(subject_id, created_at, id)` and `conflicts_check(subject_matter_id, created_at, id)`), two permissions, and **seventeen routes**. Dates are civil dates and times are separate and optional, with a **required IANA zone on the row**: a hearing's zone is the court's, and no property of the firm, the matter, or the office says which that is. A continued hearing is an **edit to the one row** with the move on the audit trail, not a second hearing somebody has to hide. `location.time_zone` makes `timeZoneForLocation` in document assembly return an office's real zone instead of `"UTC"` for the first time, with an office that carries none rendering byte-identically to before. **The timeline is FEDERATED and nothing is projected, copied, or backfilled:** thirteen declared sources read their subsystems' rows in place — matter events and deadlines, filed mail, assemblies, matter documents, time, costs, conflicts checks, the matter's own lifecycle, three custody sources, and trust movements — merged under one comparable ISO-8601 sort key and the platform's existing cursor. A custody movement back-dated to Friday and typed on Monday sorts on **Friday**, the assertion the whole design rests on. **Every source's statement builder takes the visible-matter predicate as a REQUIRED argument and composes it into SQL before the `LIMIT`**, proven for every registered source by one table-driven fitness pass, so post-filtering (which under-fills a page and turns the page size into an existence oracle) is structurally impossible. The **canonical-instant obligation** is a fitness function with a failure message that states the consequence, because a variant precision reorders the timeline silently. The **audit log is a source only over a frozen four-key lifecycle allowlist** — a settings change on the same subject never reaches a case history. **Nothing computes a deadline date**, held by a source scan as well as by review; **nothing writes "missed"** — overdue is derived at read time in the deadline's own zone, across daylight-saving boundaries in both directions, and no column exists that could disagree. The firm-calendar window and the deadline horizon are capped at 366 days as **refusals rather than silent clamps**. The six notification emission points are declared and wired to nothing.

Deliberately not built and named as seams: the calendar user interface, court e-filing and docket adapters, rule-based deadline computation (a position, not a deferral), notification scheduling and delivery, recurring events, external calendar synchronization, matterless personal appointments, e-signature seals as a source (no per-firm signing record exists to federate), and the custodian's statutory deposit obligation as a source. The load-profile litigation corpus and the four measurements — including the firm-wide-window read that would be the only trigger for building the rebuildable read model — are the next thing after the interface.

**Interface, in build** (`docs/specs/2026-09-02-calendar-interface-design.md`): one `CalendarView` component over the design system's `CalendarGrid`, the firm calendar at `/calendar`, the matter section's Month and Agenda views, the entry window and the record forms.
