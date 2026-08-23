---
category: Fixed
audience: internal
---

**Three checks that read as evidence for a claim none of them supported: a test that asserted
against a random row, a cleaner whose merge test expired the day after each merge, and a register
rebuild that deleted 942 lines of committed trunk history when run off `main`.**

**The email-capture test picked its subject at random.** Two assertions in
`apps/api-worker/test/emails-capture.test.ts` resolved the message they were about with
`SELECT id FROM email_message LIMIT 1`, against a table earlier tests in the same file had already
filled. No `WHERE`, no `ORDER BY` — the row came back in primary-key index order, and that key is a
randomly generated identifier, so which message the assertion checked changed from run to run. It
failed roughly one run in three; measured here, 3 failures in 11 on unmodified `main`, always the
`email.filed` topic assertion, always with two different `emailMessageId` values in the diff. It had
been read as one of this repository's real concurrency phantoms, which is what a genuine flake
hiding behind a genuine phenomenon looks like.

The fix is not an `ORDER BY` — that makes an arbitrary choice stable, so the test would reliably
assert against a row it never meant to pick. Each assertion now names the message it means and
resolves it through that matter's own filed link: the "one record, two links" test takes the record
the _second_ matter's filing points at, which is the claim it is making; the `email.filed` test takes
the message that matter was just filed with, so it compares the outbox row against the link written
in the same batch. A third assertion in the same file, `SELECT … LIMIT 1` followed by
`expect(results).toHaveLength(1)`, could not fail at all — the `LIMIT` capped the count at exactly
the number being asserted. It is unbounded now, so "one capture creates one message record" is a
claim the test can actually refute.

**`vp run clean` asked a question that expires.** It decided a branch had landed by merging it into
today's `origin/main` in memory and checking the resulting tree was unchanged. That is exactly right
at the instant of the merge and wrong from the first trunk commit afterwards that touches any file
the branch also touched: the re-merge stops being a no-op, and the branch reads as not-landed
forever. One branch tested as landed immediately after its merge and as not-landed two merges later,
with the pull request provably merged both times.

The durable question is not "would merging this change `main`" but "did this branch's content land",
and a landing is a fact about the past, so it is looked for there: walk the trunk forward from the
merge base, narrowed to commits touching the branch's own files, and take the first one the branch
merges into without changing it. That commit never moves, so the answer never expires, and it
survives squash merges for the same reason the tree comparison did — the squashed commit is a new
object, but merging a branch into the commit that squashed it still changes nothing. Narrowing by
the branch's own paths is what keeps it cheap: the landing commit is normally the first and only
candidate, and an unfiltered walk of sixty commits is about twelve seconds per branch.

Measured over all 162 local branches: the old test found **7 of 63 real landings**, and selected
**94 empty workspaces** — branches with no commits of their own, whose build output is live — for
deletion. The new one finds 63 of 63, selects none of the 94, and correctly leaves the 3 open
branches alone.

The ancestry test beside it is gone rather than kept. Under squash merges a delivered branch is
never an ancestor of the trunk, so every branch `git branch --merged` reports is one with no commits
of its own — the same condition as the live-workspace guard, asked with the opposite answer. It read
as an independent second confirmation of a landing and was a rename of the condition that means the
reverse. The guard itself is strengthened from "the tip equals the baseline commit" to "the branch
holds no commit the baseline lacks", because a workspace cut a week ago and never committed in is
just as empty and is no longer sitting on the baseline: 93 of the 95 such branches here slipped past
the equality form.

**Rebuilding the register history off `main` destroyed it.** `vp run register-build` reconstructs
`docs/register-history.json` by walking `git log --first-parent`, which on a feature branch is the
_branch's_ line. Every trunk landing after the branch point is unreachable from it and was treated
as a snapshot to drop. Reproduced on a ref 57 commits back: 53 snapshots reduced to 15, **942 lines
of committed trunk history deleted** by a command whose job is to render a document. It had not yet
bitten only because recently cut branches share most of the trunk's line, so the damage stayed small
enough to be invisible in a diff.

Two changes, either of which alone would have prevented it. The reconstruction is now a **trunk-only
operation**: off `main` it reads the committed file and leaves it untouched, saying why, and
`--rebuild` is refused there too, since that is the destructive one. Trunk-ness is decided from the
ref's name rather than the shape of the graph, because the two cases that must be told apart — `main`
holding unpushed commits, and a branch cut from that same commit holding commits of its own — are
graph-identical and differ only in what they are called. And a snapshot the walk cannot see is no
longer deleted on those grounds: it is dropped only when its commit has genuinely left the
repository, and otherwise retained in date order and reported as retained. Unreachable from here is
evidence about here.

`docs/now.md` still renders off-trunk, from the committed history, which is the same input
`lint:roadmap` re-derives from — so declining to rebuild never puts the gate out of reach.

**The guidance is fixed with the tool.** `CLAUDE.md` taught the merge-into-`main` comparison as the
way to answer "has this landed", without the caveat that it is only true on the day of the merge; it
now carries the durable form under _Parallel worktrees & branches_, and the orchestrator's hard-won
knowledge register, which taught the same lesson, is corrected in place.
