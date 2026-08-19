---
worktree: .claude/worktrees/agent-a212443c3fc8285d3 (agent worktree)
area: Feature-ledger verification sweep — reading every area's `evidence:`/`notes:` prose against the repository and correcting what is false
status: building
touches: roadmap.d/, docs/now.md, docs/now.html, docs/decisions-open.html, docs/register-history.json, changelog.d/
---

`lint:ledger-staleness` keys on a node naming a code path or carrying a slice tag that reports built.
Roughly a fifth of the ledger asserts an absence in prose while naming no path, which puts it outside
every rule by construction — the gate is green over sentences no rule can read. A sweep of
`roadmap.d/discovery.md` found five false statements in one file of about twenty nodes. This stream
reads the remaining areas the same way.

Scope is deliberately narrow: **`evidence:` and `notes:` only.** No `status:` value is changed except
where a correction makes `lint:ledger-staleness` fail in a way only a status change fixes, and that
case is called out rather than absorbed. `awaiting-owner:` is added only where the repository already
records the question in prose. `discovery.md` is skipped — it has had its sweep.

`claude/passive-dev-orchestrator-m7f9jw` also touches `roadmap.d/` and the three rendered documents
on most passes; a status flip landing there while this stream is rendering conflicts on all three
outputs. This stream flips no statuses, so the collision surface is the generated documents and
whichever area file both touch.
