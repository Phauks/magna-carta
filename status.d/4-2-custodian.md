---
slice: 4·2 — Custodian (safe-custody register)
group: phase-4
order: 2
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: in-progress by="Opus 4.8"
ui: todo
load-profile: todo
tested: todo
branch: claude/custodian-build-slice-2
active-work: docs/active-work/claude/custodian-build-slice-2.md
next: Load-profile volume profile + the six measured operations; then the destruction workflow (owner-gated) and 4·2·3 (gated release, receipts, portal visibility)
link-spec: docs/specs/2026-08-04-custodian-design.md
link-plan: docs/specs/2026-08-04-custodian-implementation-plan.md
adrs:
blocked-by:
---

Slice 4·2·1 (the register) built: eleven per-firm tables, trigger-enforced append-only movement ledger, mandatory Directory ownership, allocation-ledger custody numbers, holds, and scan binding via a system holding matter. Slice 4·2·2 built the review-and-reporting half: review dates with an anniversary-anchored roll forward and a `reviewed` ledger entry, one query-shaped reminder emission point covering both reviews and overdue check-outs, three register reports (holdings per owner, occupancy per location, holds in force), and printable Code 128 label sheets — twenty-five routes in total. The destruction workflow and any retention policy remain deliberately unbuilt and owner-gated; `custody_destruction_request` is still a table with no service and no route.
