---
slice: Service status
group: cross-cutting
order: 20
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: done by="Fable 5"
load-profile: n/a
tested: done by="Fable 5"
branch: service-status-ui
active-work: docs/active-work/service-status-ui.md
next: Merge the public page branch, then run the deploy-activation checklist (status.magnacarta.esq)
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/status` + `apps/status-worker` (isolated, `STATUS_KV`-only) + the new `platform_operator` principal; extends ADR-0048. The public page is built on `service-status-ui`: server-rendered zero-JS HTML from the live snapshot, same-origin assets (Atkinson + hashed stylesheet), light/dark, text ladder, subscribe-panel front door.
