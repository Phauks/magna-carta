---
number: 105
slug: worktree-coordination
status: Accepted
date: 2026-06-18
area: Dev guidelines
summary: Parallel-worktree coordination — an active-work registry (`vp run worktrees` + per-stream `docs/active-work/` notes), a main-sync cadence, and a worktree/branch lifecycle rule.
---

Multiple worktrees run concurrently and collide on shared files and ADR numbers (a live merge this cycle hit ~100-commit drift on `main` and an ADR-number collision). Decision: (1) an **active-work registry** — one hand-authored note per stream at `docs/active-work/<branch>.md` (scope + the files it expects to touch) plus a `vp run worktrees` command that merges `git worktree list` facts with the notes and flags declared touch-overlaps and drift from `main`; the index is printed, never committed, so it cannot itself become a contended file. (2) A **sync-cadence** rule: long-lived branches merge/rebase `main` regularly and always before touching a shared or generated file. (3) A **worktree-lifecycle** rule: feature worktrees at `C:/dev/magna-carta-worktrees/<branch>`, transient agent worktrees under `.claude/worktrees/`; on merge, remove the worktree, branch, and the stream's note together. Builds on the fragment workflow (ADR-0104). Rejected: a single shared active-work document (becomes the next contended file); a purely git-derived index (cannot convey a stream's scope or intent).
