---
worktree: C:/dev/magna-carta-worktrees/claude/repo-branch-cleanup-hibmeb
area: tooling/stale-branches — sorting the remote branch backlog into what can go and what cannot
status: review
touches: tooling/stale-branches/, vite.config.ts, changelog.d/
---

Making `vp run stale-branches` answerable for the whole remote, and safe to believe. Three changes,
all in `tooling/stale-branches/index.mjs`: it refuses to run in a shallow clone, it covers every
remote namespace rather than `claude/*` alone, and it separates branches holding no commit of their
own from branches holding real work.

The shallow-clone refusal is the one that matters. The landing test starts from `git merge-base`, so
a truncated history cannot find any fork point and every branch falls through to "not landed" — with
no error. In a clone cut to fifty commits the command reported 42 landed of 321 against a true 297,
which is a wrong answer that reads exactly like a right one.

Nothing here deletes a branch, and no branch has been deleted. The counts today are 310 landed,
4 holding nothing of their own, 34 holding work, of which four carry open pull requests.

Not touching `tooling/branch-landing/` or `tooling/clean/` — the landing rule and its guard are
shared with the artifact cleaner and the registry, and both are right as they stand; the new
classification is drawn in the reporter instead.
