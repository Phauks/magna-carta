---
branch: claude/active-work-sweep
worktree: .claude/worktrees/active-work-sweep
area: registry hygiene — sweep the active-work notes whose streams have merged, and repair the status fragments that pointed at them
status: building
touches: docs/active-work/claude/, docs/active-work/claude-escheat-research.md, status.d/ (branch/active-work fields only), changelog.d/
---

Docs-only sweep. The registry had grown to 64 notes under `docs/active-work/claude/`, nearly all of
them streams that merged; at that size it stops answering the question it exists to answer. This
stream deletes the note for every stream whose pull request merged, and pairs each deletion with the
matching `status.d/<slice>.md` fragment flipped back to `branch: main` and an empty `active-work:` so
`node tooling/lint-status.mjs` stays green.

Merged-ness was established from the merged-pull-request record (head branch to note filename), not
from `git merge-base` — the git proxy here refuses ref deletions and the repository squash-merges, so
remote branches sit ahead of `main` for work that landed long ago and prove nothing either way.

Three notes are deliberately left behind: `passive-dev-orchestrator-m7f9jw.md` (the live orchestrator
stream), and `file-surface-web.md` plus `slice-0-7b-app-shell.md` — two pre-`claude/` streams that
never opened a pull request and still carry unmerged commits on their remote branches.

Touches no source. `status.d/tools-area.md` is deliberately **not** flipped: it points at
`slice-0-7b-app-shell.md`, which stays.
