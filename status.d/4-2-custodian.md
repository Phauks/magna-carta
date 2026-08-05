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
branch: claude/custodian-build-slice-3
active-work: docs/active-work/claude/custodian-build-slice-3.md
next: Load-profile volume profile + the six measured operations; then receipts (blocked on a matter-routed assembly path), portal visibility (blocked on the portal grant model), stocktake, and the destruction workflow (owner-gated)
link-spec: docs/specs/2026-08-04-custodian-design.md
link-plan: docs/specs/2026-08-04-custodian-implementation-plan.md
adrs:
blocked-by:
---

Slice 4·2·1 (the register) built: eleven per-firm tables, trigger-enforced append-only movement ledger, mandatory Directory ownership, allocation-ledger custody numbers, holds, and scan binding via a system holding matter. Slice 4·2·2 built the review-and-reporting half: review dates with an anniversary-anchored roll forward and a `reviewed` ledger entry, one query-shaped reminder emission point covering both reviews and overdue check-outs, three register reports (holdings per owner, occupancy per location, holds in force), and printable Code 128 label sheets — twenty-five routes in total. Slice 4·2·3 built gated release: a `released` movement must name who collected the property and carry the authority it leaves on, how the collector was identified, and the member who made that check, frozen on the append-only ledger row and enforced by three `BEFORE INSERT` triggers rather than by a CHECK, so releases recorded before the gate existed stay exactly as they were recorded. Two-signatory release is a per-firm policy, off by default, and the two signatories must be two people. The authority vocabulary is deliberately not invented — the basis is free text a firm writes. Receipts and portal visibility, the other half of 4·2·3, are not built: the document-assembly path is matter-routed and matter-permissioned, and no portal grant model exists. The destruction workflow and any retention policy remain deliberately unbuilt and owner-gated; `custody_destruction_request` is still a table with no service and no route.
