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
branch: <your-branch>
worktree: C:/dev/magna-carta-worktrees/<your-branch>
area: <one-line scope>
status: designing | building | review | blocked
touches: packages/foo, STATUS.md, docs/Decision-Log.md
---

One short paragraph: what this stream is doing and anything a concurrent stream should not step on.
```

`touches` lists the files/areas you expect to edit — especially **cross-cutting files** (`STATUS.md`,
`ROADMAP.md`, `CLAUDE.md`, the white paper, `docs/conventions/`). It is how overlaps are surfaced.

## Seeing everything in flight

`vp run worktrees` prints the live registry: every git worktree merged with these notes, each
stream's divergence from `main` (so drift is visible), and any **touch-overlaps** between streams.
The index is printed, never committed, so it is always accurate and never a contended file.

Run it **before starting a stream or editing a cross-cutting file** (golden rule in the root
`CLAUDE.md`).

## When your stream merges

Delete `docs/active-work/<branch>.md` in the same change that removes the worktree and branch (see
the worktree-lifecycle rule in the root `CLAUDE.md`). A note left behind is a stale stream.
