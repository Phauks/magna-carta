---
branch: claude/signals-that-lie
worktree: .claude/worktrees/signals-that-lie
area: three signals that report something other than what a reader believes they report
status: building
touches: apps/worker/test/emails-capture.test.ts, tooling/clean/, tooling/doc-fragments/build-register-history.mjs, tooling/doc-fragments/register-history.mjs, CLAUDE.md, docs/active-work/claude/passive-dev-orchestrator-m7f9jw.md
---

# Signals that lie

Three independent defects sharing one shape: a check that reads as evidence for a claim it does
not actually support. Each is in a different file and each is fixed on its own terms.

1. **`apps/worker/test/emails-capture.test.ts`** — two assertions resolved their subject with
   `SELECT id FROM email_message LIMIT 1`, against a table earlier tests in the file had already
   filled. Row order comes from the primary-key index, whose key is a randomly generated
   identifier, so the test asserted against whichever message SQLite happened to yield. Fixed by
   naming the message each assertion means — the one filed on that assertion's own matter — not by
   adding an `ORDER BY`, which would only have made an arbitrary choice stable.

2. **`tooling/clean/select.mjs`** — the cleaner decided a branch had landed by merging it into
   today's `origin/main` and checking the tree was unchanged. Correct at the moment of merge and
   wrong from the next trunk commit that touches any of the branch's files. Replaced with a search
   for the commit the branch's content actually entered the trunk at, which cannot decay because
   that commit does not move. The ancestry test beside it was removed: under squash merges it
   reports only branches with no commits of their own, which are live workspaces.

3. **`tooling/doc-fragments/build-register-history.mjs`** — `vp run register-build` reconstructed
   `docs/register-history.json` from `git log --first-parent`, which off `main` walks the branch's
   line and cannot see any trunk landing after the branch point. Those snapshots were then deleted
   as unreachable. The reconstruction is now a trunk-only operation, and a snapshot is dropped only
   when its commit has genuinely left the repository.

`CLAUDE.md` gains the durable rule for question 2, because the guidance in circulation taught the
test that decays.
