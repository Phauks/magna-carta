---
category: Fixed
audience: internal
---

The build-artifact cleaner now recognises a branch that landed by **squash merge**, which is how
every pull request in this repository lands.

It asked only `git branch --merged`, an ancestry question. A squashed branch's commits are never
ancestors of `main`, so the answer was always "nothing is merged" — the post-merge hook swept
nothing from the day it was installed, and the on-demand run reported `0 worktree(s)` in a tone
indistinguishable from having found nothing to do. Twenty-six landed worktrees had accumulated
roughly nine gigabytes of `target/`, `.svelte-kit/`, and `dist/` output before anyone looked.

Three changes, all in `tooling/clean/`:

- **A content test beside the ancestry test.** A branch is landed when merging it into the baseline
  would change no file — `git merge-tree --write-tree` against the baseline's own tree. That is
  blind to how the commits got there. A merge that conflicts counts as not landed: the branch and
  the baseline disagree about something, and this tool deletes things.
- **A worktree sitting exactly on the baseline commit is never swept.** It has delivered nothing, so
  every "does it add anything?" test calls it landed — while it is in fact a freshly created
  workspace with a build running in it. The tip check comes before anything else is asked.
- **The baseline is `origin/main`, not the local `main` ref**, which drifts behind in a long-lived
  clone and answers for a state nobody is on.

The report also says which of the two zeros it is: a sweep that selected nothing now names how many
worktrees it declined and why, rather than printing a total that reads as "all clear" to whoever is
watching the disk fill.
