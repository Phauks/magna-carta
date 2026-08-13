---
category: Added
audience: public
---

**The conflicts reporting posture — a derived per-matter read, an honest zero-hit report, and a
fitness function that keeps both honest.** The first slice of the conflicts deepening, and the framing
every later slice inherits. No new matching, no new firing, no schema change.

`readMatterConflictsPosture` (`packages/conflicts/src/posture.ts`) is now the one sanctioned way to
ask where a matter stands. It is computed from rows at read time and writes nothing: the latest check
with the scope it actually ran under read back verbatim; the shortfall between that scope and the
firm's **live** policy; undisposed counts by evidence tier; disposition counts by kind, each naming its
reviewers; every source that recorded `unavailable`, with a derived reason; and a `neverChecked` state
distinct from checked-and-nothing-surfaced and distinct again from a check whose sources were all
unavailable. There is no aggregate and no field named `clear`, `clean`, `ok`, `passed`, `status`,
`severity`, or `conflictFree` — a caller that wants one word writes it itself and owns it. Raising the
firm floor makes the shortfall appear immediately on every affected matter with no sweep and no write,
the posture `packages/calendar/src/overdue.ts` already holds for an overdue deadline.

`describeCheck` (`packages/conflicts/src/report-text.ts`) renders one check as the statement of a
procedure: what ran with what settings over how many entities, which identifier types cannot be probed
on their own, what did not run and why, and what surfaced. A check that surfaced nothing ends
**"Nothing surfaced."** — a fact about the search ending, never about the matter. `packages/conflicts/src/sources.ts`
becomes the one home for what a check can search and, when it cannot, why, so the write side and the
read side of the log cannot describe the same row differently.

Both are served over the API: `GET /api/v1/matters/{matterId}/conflicts-posture` on `conflicts:read`,
and the shipped check GET gains the statement list. The posture route deliberately does not 404 on an
unknown matter — a 404 would make "never checked" and "no such matter" the same answer.

`readHitDispositionStates` reads every hit of a check with its latest disposition in **one** query
(the same `created_at DESC, rowid DESC` tie-break the shipped current-disposition read uses), removing
the per-hit N+1 a page-view read cannot afford. Both posture queries are proved to walk an index
rather than scan the append-only log, in the package test and as two new load-profile plan probes.

**`pnpm run lint:conflicts-vocabulary`** (`tooling/lint-conflicts-vocabulary/index.mjs`, modelled on
the shipped custodian lint and wired into the gate's governance step) makes the vocabulary mechanical
rather than conventional. It scans the conflicts package, the conflicts route, the web conflicts
surfaces, and `docs/user/` for assertion phrases and for verdict-shaped field declarations, self-tests
its own patterns before every run, and carries a fixture suite that proves each banned phrase fires.
`cleared` survives only as a `DISPOSITION_KINDS` value — a named human's conclusion about one hit,
carried on a row with that human's identity and rationale. Prose that exists to state the rule rather
than to break it carries an inline `conflicts-vocabulary:allow — <reason>` marker on the same line; a
verdict-shaped **field name** has no escape hatch at all.

## Public

**A conflicts check now tells you what it searched, what it could not search, and what nobody has
answered yet — and it will never tell you a matter is safe to accept.**

Every matter has a conflicts position you can read at any time. It answers six questions separately,
because collapsing them into one answer is what loses the information: when the matter was last
checked and under what settings; whether your firm's policy has been widened since, so that the last
check no longer covers everything you now require; which sources could not be searched at all, named,
with the reason; how many results are still waiting for a person to look at them, grouped by strength
of evidence; which results have been decided and by whom; and whether the matter has ever been checked
at all — which is shown as its own answer, never as the same thing as a check that turned up nothing.

The position is worked out fresh every time you look, so widening what a check must cover shows up on
every affected matter straight away, without re-running anything.

A check that turns up nothing now says so in plain words, ending with the sentence **"Nothing
surfaced."** That sentence is about the search. Magna Carta does not show a tick, a score, or a
one-word verdict on whether a matter is safe to take on, and it will not: a search can only look at
what has been recorded, and several things a conflicts search would ideally examine have nothing
behind them yet — the report names each one every time. Describing the procedure is what your firm can
stand behind if it is ever asked how a matter was screened. A verdict the software produced is not.
Deciding remains a lawyer's act, and the record says whose.

New guide: [Conflicts reports](docs/user/features/conflicts-reports.md).
