---
category: Changed
audience: internal
---

**`vp run retire-note <branch> --with-merge` retires a stream note in the pull request that lands the work, instead of a second merge afterwards.**

`main` is production, so a follow-up pull request whose only content is deleting one file is a production deploy to delete one file. Four of the last ten merges were exactly that.

The landing check that made the second merge necessary is the right guard for the workflow it was written for — retiring on `main` after the fact, where the deletion takes effect the moment it merges, so removing a note early really does erase the one collision warning other worktrees get. It is the wrong question for a deletion committed on the branch: that reaches `main` when the branch does and not a moment sooner, so `main` keeps the note for as long as the pull request is open. And it cannot be satisfied anyway, because a branch has not landed while the pull request landing it is still open. What `--with-merge` checks instead is that HEAD is on the branch whose note it is, which is what makes "the deletion travels with the merge" true rather than asserted.

It does the paperwork only — clearing every `status.d/` pointer at the note, re-rendering `STATUS.md`/`STATUS.json`, deleting the note. Removing a worktree and deleting a branch cannot happen from inside that branch, so that half stays a later local `vp run retire-note <branch>` and keeps its landing check. The command no longer refuses that pass: a workspace with no note left is exactly what a landed `--with-merge` leaves behind, and it used to be told there was nothing to retire by the retirement that had worked.

The guard moved out of the runner into `retirementRefusal` in `tooling/retire-note/dependents.mjs`, on the same pure-rules / impure-runner split the migration gates keep, so the decisions now have tests — they had none before.
