---
slice: 0·6 — Telemetry baseline + platform closeout
group: phase-0
order: 7
research: n/a
spec: done
plan: done
built: done by="Opus 4.8" gap
ui: in-progress by="Opus 5"
load-profile: n/a
tested: in-progress by="Opus 5"
branch: claude/unified-error-screen-8pam6s
active-work:
next: screenshot capture on a report, and the diagnostics-level setting UI
link-spec: docs/specs/2026-08-31-unified-error-surface-design.md
link-plan:
adrs:
blocked-by:
---

`@magna-carta/telemetry`, incident table + `POST /v1/incidents`, Email Service adapter. Closes Phase 0's backend. The client half of the standard now exists too: one problem model over the whole app, the `failure-state`/`failure-band`/`failure-details` family in the design system, the client crash boundary, the breadcrumb ring, and a Report a Problem that files rather than producing text to paste. Screenshot capture and the diagnostics-level setting are what remain.
