---
category: Removed
---

Swept **64 stale stream notes** out of the active-work registry, leaving the streams that are genuinely
in flight. The registry exists so a starting stream can see what else is running and where it would
collide; at 64 entries — nearly all of them describing work that merged days or weeks earlier — it had
stopped answering that question, because a reader could no longer tell the live entries from the dead
ones. What remains is four notes: the orchestrator stream, this sweep, and two older streams that never
opened a pull request and still carry unmerged commits.

Merged-ness was established from the **merged-pull-request record**, matching each note's filename to
the head branch of the pull request that landed it, and corroborated against the files each note said it
would create. The obvious test — asking git whether a remote branch is an ancestor of `main` — is
misleading in this repository: pull requests are squash-merged and the git proxy refuses ref deletions,
so branches for long-landed work sit permanently ahead of `main`. Two notes whose streams left unmerged
commits and no pull request were kept on the principle that a stale note is untidy while a deleted note
for live work destroys the only record of what a stream was doing.

Each deletion is paired with its `status.d/<slice>.md` fragment flipped back to `branch: main` and an
empty `active-work:`, so nine slice fragments no longer point at notes that are gone — the pairing the
status fitness function enforces.

This also settles a **naming inconsistency** the docs-sync reports had flagged three runs running. Notes
are named after the branch they describe, slashes included, so a `claude/<name>` branch belongs at
`docs/active-work/claude/<name>.md`; a flattened `claude-<name>.md` is invisible to the registry's
branch-to-note lookup and reads as "no note at all". Exactly one flattened note remained, and it
belonged to a merged stream, so the sweep removed it and the two naming conventions became one.
