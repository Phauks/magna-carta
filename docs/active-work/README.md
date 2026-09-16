# Active work — concurrent stream registry

This directory lets parallel worktrees see each other. The firm runs several branches/worktrees at
once, and they collide on shared files; this registry makes concurrent work **visible** so a new
stream can avoid stepping on one already in flight.

One file per stream — **never a shared list** — so two streams never edit the same file (the same
conflict-proof discipline as `changelog.d/` and `docs/decisions/`).

## When you start a stream

Add `docs/active-work/<branch>.md` (named after your branch) in your first commit.

**The path mirrors the branch name exactly, slashes included** — a branch called `claude/fix-thing`
gets `docs/active-work/claude/fix-thing.md`, not a flattened `claude-fix-thing.md`. One note per
branch, at the path its name dictates, is what keeps the registry collision-free and lets a reader go
from a branch name straight to its note.

```markdown
---
worktree: C:/dev/magna-carta-worktrees/<your-branch>
area: <one-line scope>
status: designing | building | review | blocked
touches: packages/foo, STATUS.md, docs/Decision-Log.md
---

One short paragraph: what this stream is doing and anything a concurrent stream should not step on.
```

The branch is **not** a key — it is the path, which is why the path has to mirror it exactly. A note
that repeats its branch inside itself keeps the same fact twice and the two are free to disagree.

`touches` lists the files/areas you expect to edit — especially **cross-cutting files** (`STATUS.md`,
`ROADMAP.md`, `CLAUDE.md`, the white paper, `docs/conventions/`). It is how overlaps are surfaced.

## Seeing everything in flight

`vp run worktrees` prints the live registry: every stream in flight merged with these notes, each
stream's divergence from `main` (so drift is visible), and any **touch-overlaps** between streams.
The index is printed, never committed, which is what keeps it from becoming a contended file — it is
not what keeps it accurate. Accuracy comes from the tool deciding for itself which streams are still
in flight, rather than trusting that a note on disk means work is happening.

A stream counts as in flight while it has a workspace or its branch has not landed. Everything the
tool cannot fold into those two sections it names instead of dropping: notes for branches that have
landed (delete them), notes whose branch resolves to no ref (misnamed, or never pushed), and notes
with no frontmatter block (invisible, so they warn nobody).

Run it **before starting a stream or editing a cross-cutting file** (golden rule in the root
`CLAUDE.md`).

## When your stream merges

**`vp run retire-note <branch> --with-merge`, in the pull request that lands the work.** Not a hand
deletion — a note is not the only thing that names it.

A `status.d/<slice>.md` fragment may carry `active-work: docs/active-work/<branch>.md`, and
`pnpm run lint:status` fails when that path stops existing. Nothing in this directory knows who
references it, so the pointer is invisible from where the deletion happens, and the only way to find
it by hand is to think of grepping — which is the step that fails. The command clears every pointer
naming the note, re-renders `STATUS.md`/`STATUS.json`, deletes the note, and removes the worktree and
branch, so the pointer cannot survive the note.

**Retire it in the pull request, not in a second one afterwards.** A merge to `main` deploys, so a
follow-up merge whose only content is a deletion is a production deploy to delete one file. With
`--with-merge` the deletion is a commit on the branch, so it reaches `main` exactly when the work
does — `main` keeps the note for as long as the pull request is open, and every other worktree goes
on seeing it. That is also why the flag skips the landing check: a branch cannot have landed while
the pull request landing it is still open, so what is checked instead is that you are **on** the
branch, which is what makes "the deletion travels with the merge" true rather than asserted.

It does the paperwork only. Removing a worktree and deleting a branch cannot happen from inside that
branch, so that half stays a later, local step — `vp run retire-note <branch>` once it has landed —
and keeps its landing check.

Without `--with-merge`, the command refuses a branch that has not landed unless you pass `--force`,
because retiring a live stream removes the only collision warning other worktrees get. `--dry-run`
prints the plan and writes nothing; `--keep-workspace` does the paperwork and leaves the worktree and
branch alone.

`vp run worktrees` lists the notes you forgot — each with the fragments pointing at it and the command
that retires it — so a missed retirement is a line of output rather than a false collision warning.
The list is a backstop, not the routine.
