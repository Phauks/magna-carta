---
branch: claude/roadmap-condense
worktree: .claude/worktrees/roadmap-condense
area: documentation — ROADMAP.md condensation and correction
status: building
touches: ROADMAP.md, changelog.d/, docs/active-work/claude/roadmap-condense.md
---

# Roadmap condensation

`ROADMAP.md` had decayed into running build commentary: the Next section carried multi-hundred-word
paragraphs per slice mixing design dates, plan links, ADR numbers, task-by-task build notes and
deferral lists, and it contained verbatim duplicates — the integration port system twice with
contradictory verdicts, and the property external-links resolver twice.

Now that [`docs/now.md`](../../now.md) is the complete generated per-capability register, this file
no longer has to carry completeness. This stream cuts it back to what the register structurally
cannot hold: narrative scope and ordering — which stream is live, what it does next, what order the
rest comes in, and the cross-slice gates.

**Scope.** Resolve the duplicates against the tree and the ledger; refresh _Now_ from `status.d/`,
`CHANGELOG.md` and the ledger; cut _Next_ to scope, dependencies and gates; move everything the
changelog and status fragments agree is done into _Recently shipped_ as condensed lines.

**Not touched.** `docs/now.md`, `CHANGELOG.md`, `STATUS.md`/`STATUS.json` and the Decision-Log
register are build outputs. No `status.d/` fragment is edited — two stale ones are reported to the
owner instead (3·6's rendered `STATUS.md` row is behind its own fragment, and `docs/integrations.md`
still lists the EasyPost adapter as unmerged).
