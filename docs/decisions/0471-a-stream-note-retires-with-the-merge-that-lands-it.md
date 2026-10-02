---
number: 471
slug: a-stream-note-retires-with-the-merge-that-lands-it
status: Accepted
date: 2026-09-16
area: Repository workflow
summary: An active-work note is retired in the pull request that lands its stream's work, not in a second merge afterwards — because on this repository a merge is a deploy.
---

An active-work note is retired in the pull request that lands its stream's work, not in a second merge afterwards — because on this repository a merge is a deploy.

**The problem.** `vp run retire-note` refuses a branch that has not landed, so retiring a note could only happen after the merge, which meant a second pull request whose entire content was deleting one file. Since `main` became production that second merge is also a second production deploy, with a build, a deploy and a review round behind it, to remove a file nothing reads.

**Why the guard was there.** Deleting the note of a stream still in flight erases the one collision warning other worktrees get, and re-creating the file does not undo it — the point of a note is that it was there while the work was. In the workflow the guard was written for, the deletion is committed on `main` and takes effect immediately, so the check is exactly right.

**Why it is the wrong question for the same pull request.** A deletion committed on the branch reaches `main` when the branch does and not a moment sooner. `main` keeps the note for the whole time the pull request is open, so every other worktree goes on seeing it and nothing is hidden early. The check also cannot be satisfied there even in principle: a branch has not landed while the pull request landing it is still open, so requiring it would make the flag unusable in the only situation it exists for.

**The decision.** `--with-merge` replaces the landing check with the fact that actually has to hold — HEAD is on the branch whose note this is. That is what makes "the deletion travels with the merge" true rather than asserted, and it is checkable at the moment the command runs.

**What stays split.** The flag does the paperwork only. Removing a worktree and deleting a branch cannot happen from inside that branch, so the workspace half remains a later, local pass that keeps its landing check — which is the half the check was always really about. The command also no longer refuses a run where only a workspace is left: that is precisely the state a landed `--with-merge` produces, and refusing it meant the cleanup was turned away by the retirement that had worked.

**Testability, as a side effect worth naming.** The guard moved out of the runner into a pure `retirementRefusal`, matching the rules/runner split the migration gates already keep. The decisions it encodes had no tests before, because they were statements inside a script that also removed worktrees.
