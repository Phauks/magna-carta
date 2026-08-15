---
category: Fixed
audience: internal
---

`vp run worktrees` printed two views of the active-work registry and they disagreed completely. The
streams list was empty — it required a non-agent worktree, and every stream here runs in an agent
worktree it explicitly omitted. The touch-overlap list, three lines below, named twenty branches
colliding across twenty-five paths. Every one of those branches had already landed: measured, twenty
of twenty. The section a new stream is told to consult before editing a shared file was wrong in
every entry it had.

Overlaps were computed from every note file on disk with no liveness test of any kind. A note is a
file, and a file outlives the work it describes — nothing deletes one but the hand that wrote it, and
the cue to do so, the branch disappearing, never fires here, because this repository cannot delete
its remote branches. Two hundred and thirty of them are still on the remote; exactly one note named a
branch that was actually gone.

The registry now decides for itself. "Has this branch landed" moves to `tooling/branch-landing`,
shared with the build-artifact cleaner, which already had to answer it for the opposite purpose — one
implementation, because a wrong answer either deletes a live workspace's build output or hides a real
collision. A stream is in flight while it has a workspace or an unlanded branch, so a forgotten note
can no longer manufacture a warning, and work on another machine is visible even though this checkout
sees none of its worktrees.

Three failures it used to swallow are now named rather than dropped: notes for branches that have
landed (thirty-six of them, swept here), notes whose branch resolves to no ref, and notes with no
frontmatter block — nineteen of those, half the directory, all silently collapsing onto one empty key
so that eighteen were discarded and their declared touch lists warned nobody. A note's branch is now
read from its path, which is why a malformed one still has an identity to report. Drift for a branch
that is not checked out locally reads as unknown instead of `+0/-0`; the live UI stream, which the old
output called perfectly in sync, is four hundred and eleven commits behind.
