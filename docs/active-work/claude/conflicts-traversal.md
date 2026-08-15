---
branch: claude/conflicts-traversal
worktree: .claude/worktrees/conflicts-traversal
area: Conflicts 4·1 deepening slice 3 — typed traversal budgets, the closure cap and its truncation record, expired-edge traversal, and the batched matcher
status: building
touches: packages/conflicts/src/, packages/conflicts/test/, packages/directory/src/edges.ts, packages/directory/src/search.ts, packages/fixtures/src/load-profile/, apps/worker/src/routes/conflicts.ts, packages/api-client/, openapi.json, changelog.d/, docs/decisions/pending/, status.d/slice-4-1-conflicts.md, roadmap.d/conflicts.md, docs/user/features/
---

Slice 3 of the conflicts deepening, per
[`docs/specs/2026-08-13-conflicts-deepening-implementation-plan.md`](../../specs/2026-08-13-conflicts-deepening-implementation-plan.md).
The engineering half of search depth: walk the graph as far as the firm's typed budgets allow, record
every stop, and pay O(channels) queries rather than O(entities x channels) for it.

- **Typed per-edge-class budgets** — `packages/conflicts/src/edge-classes.ts` maps the Directory's
  edge-type catalogue onto four classes; corporate family stays transitive and zero-cost, the other
  three carry their own hop budget. Budgets and the per-run closure cap are firm-configurable
  settings on `ConflictsPolicy` with the design's recommended defaults, resolved per run and recorded
  verbatim on the check row.
- **The closure cap and the truncation record** — expansion stops on reaching the cap and the check
  records that it was truncated, with the entities reached, the caps in force, and the size of the
  unexplored frontier. A truncated expansion is never reported as a completed one; the posture read
  and the report statement both say so.
- **Expired edges are traversed** with the expiry carried on the path step, read at the check's own
  clock rather than an ambient `new Date()`.
- **The N+1 removal** — `readSubjectFactsBatch` (one query per node table over the whole expanded
  set), `findDuplicateCandidatesBatch` in the Directory (each blocking channel once over the set),
  and a batched exact-name probe, all proved equivalent to the shipped per-entity path by an
  equivalence test over a real migrated corpus before the per-entity path is retired.

**Not in this branch, deliberately.** The three professional-conduct flags (F1 name-role breadth, F2
imputation/screening, F11 refuse-to-open) are the owner's and are untouched. The firm-marked
non-expandable-entity mark (F9) needs a Directory write path and belongs with the slice that owns
`packages/directory/src/`. Degree-based hub suppression is refused and stays refused — the refusal is
stated inline in `expansion.ts`.

**Finding, recorded not fixed.** `composeEffectBatch` in `packages/data-access/src/effect-batch.ts`
composes with `statements.push(...effect.statements)`, and a spread argument list has a hard engine
ceiling — the first deep-graph profile hit `RangeError: Maximum call stack size exceeded` on a check
that produced hundreds of thousands of hit statements. The fixture was corrected (a templated fan of
identical subsidiary names measures an all-pairs name collision, not a graph walk), but the ceiling
is real, applies to every domain composing a large batch, and belongs to whoever owns that seam.

**Overlaps to watch:** `packages/directory/src/edges.ts` and `search.ts` (additive only — the shipped
signatures keep their exact behaviour), `apps/worker/src/routes/conflicts.ts` plus `openapi.json` and
the generated client, and `roadmap.d/conflicts.md`. No migration: the traversal record rides the
existing `inputs_json` blob, so no conflicts table is touched and no journal index is claimed.
