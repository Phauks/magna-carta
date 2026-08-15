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
branch: claude/conflicts-traversal
active-work: docs/active-work/claude/conflicts-traversal.md
next: Deepening slices 1-3 built (reporting posture; event triggers + the re-check ledger + the consumers, cron backstop and notification; typed traversal budgets + the closure cap and its truncation record + the batched matcher); slices 4-5 follow — matching depth (organization match keys, Beider-Morse, the empty nickname catalogue) and the adjudication read models. Slice 3 left the firm-marked non-expandable entity to whichever slice owns the Directory write path
link-spec: docs/specs/2026-08-13-conflicts-deepening-design.md
link-plan: docs/specs/2026-08-13-conflicts-deepening-implementation-plan.md
adrs:
blocked-by:
---

No-scorer evidence-tier engine; typed source registry + firm floor; three append-only log tables. Firm personnel resolved as a source, not a Directory node type. Deepening slice 1 adds the reporting posture: one derived per-matter read, an honest zero-hit report, and a vocabulary fitness function — the platform reports what it searched and never concludes. Slice 2 makes the check fire when the corpus moves: one outbox row on each producing write path, the `conflicts_recheck_request` ledger (partial unique index on the open rows, immutable cause, one-way satisfaction, never deleted), separate request and run consumers, a cron drain plus a scheduled re-scan, and `conflicts.hit.surfaced` carrying counts only. The automated path cannot dispose of anything, and two source scans prove it. Slice 3 makes the graph half of search depth real: traversal is budgeted per edge class rather than by one integer (corporate family transitive at no hop cost; control, family and representation one hop each by default), bounded by a per-run closure cap, and both are firm settings recorded verbatim on the check row. Reaching the cap stops the walk and the check records that it was TRUNCATED with the frontier it did not reach — a truncated expansion is never reported as a completed one, the depth analogue of `unavailable` never reading as searched and clean. Degree-based hub suppression is refused and the refusal is held by a test; expired edges are traversed with the expiry on the path step. The N+1 goes in the same change: one subject-facts read per node table over the closure, one batched edge read per traversal round, each blocking channel once over the closure — gated by an equivalence test proving the batched matcher returns exactly the per-entity matcher's hit set over a real corpus.
