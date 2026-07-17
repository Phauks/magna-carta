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
branch: status-page-history
active-work:
next: Merge the public page + history branches, then run the deploy-activation checklist (status.magnacarta.esq)
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/status` + `apps/status-worker` (isolated, `STATUS_KV`-only) + the new `platform_operator` principal; extends ADR-0048. The public page is server-rendered zero-JS HTML from the live snapshot, with same-origin assets (Atkinson + hashed stylesheet), light/dark, text ladder, and a subscribe-panel front door. `status-page-history` adds the 90-day per-component uptime record (a third cron-owned `status:history` key, sample-counted) and makes an upstream provider's trouble an advisory rather than our verdict.
