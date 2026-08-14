---
slice: 4·1 — Conflicts matching engine
group: phase-4
order: 1
research: done
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: done by="Opus 4.8"
tested: done by="Opus 4.8"
branch: claude/conflicts-slice-2
active-work: docs/active-work/claude/conflicts-slice-2.md
next: Deepening slices 1-2 built (reporting posture; event triggers + the re-check ledger + the consumers, cron backstop and notification); slices 3-5 follow — traversal depth, matching depth, adjudication read models
link-spec: docs/specs/2026-08-13-conflicts-deepening-design.md
link-plan: docs/specs/2026-08-13-conflicts-deepening-implementation-plan.md
adrs:
blocked-by:
---

No-scorer evidence-tier engine; typed source registry + firm floor; three append-only log tables. Firm personnel resolved as a source, not a Directory node type. Deepening slice 1 adds the reporting posture: one derived per-matter read, an honest zero-hit report, and a vocabulary fitness function — the platform reports what it searched and never concludes. Slice 2 makes the check fire when the corpus moves: one outbox row on each producing write path, the `conflicts_recheck_request` ledger (partial unique index on the open rows, immutable cause, one-way satisfaction, never deleted), separate request and run consumers, a cron drain plus a scheduled re-scan, and `conflicts.hit.surfaced` carrying counts only. The automated path cannot dispose of anything, and two source scans prove it.
