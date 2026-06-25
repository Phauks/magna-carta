---
slug: auto-clean-build-artifacts-on-merge
status: Accepted
date: 2026-06-23
area: Dev tooling
summary: "Regenerable build artifacts and dangling Docker cache are reclaimed automatically when a branch lands in main, via a tracked post-merge git hook that runs a `vp run clean` script. The cleaner deletes only git-ignored artifact directories (target/, .svelte-kit, .wrangler, .vite, dist, build, coverage) inside worktrees whose branch is merged into main, and prunes dangling Docker builder cache and image layers. It deliberately never removes worktrees, branches, or node_modules — those stay manual because a worktree may hold uncommitted or foreign work. Installed once per clone with `vp run setup-hooks` (sets core.hooksPath to the tracked tooling/git-hooks)."
---

**Build artifacts auto-clean on merge to main.**

**Context:** the dev disk filled to 100%. Regenerable build output had accumulated unbounded — Rust `target/` directories multiplied across ~10 worktrees, and local Container image builds left tens of gigabytes of Docker builder cache. The existing worktree-lifecycle rule (remove a merged worktree by hand) was not being followed, and nothing swept artifacts from worktrees that were kept.

**Decision:** a tracked `post-merge` git hook, guarded on the current branch being `main`, runs a `vp run clean` script on every merge to `main`. The script deletes only **git-ignored** artifact directories (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) inside worktrees whose branch is merged into `main`, confirming each candidate with `git check-ignore` before removal, and prunes dangling Docker builder cache and image layers (best-effort; a missing or stopped Docker daemon is a logged skip, never a merge failure). The worktree shell, `node_modules`, tracked source, and the worktree/branch themselves are never touched. Installation is a one-time `vp run setup-hooks` that points `core.hooksPath` at the tracked `tooling/git-hooks` directory, so the hook is version-controlled and shared across all worktrees through the common git directory.

**Scope:** automatic trigger is merge-to-`main` only; routine `git pull` on a feature branch is a no-op. Worktree/branch removal and `node_modules` deletion stay manual (a worktree may hold uncommitted or foreign work, so automated removal is too risky). System-level reclamation (OneDrive cache, Phone Link media, hibernation file, OS temp) is out of scope — those are handled manually. The WSL2 Docker disk is kept sparse as a one-time setup so pruned space returns to the host automatically; it is not re-asserted per merge.

**Consequences:** dead build output no longer accumulates, so manual disk rescues become rare. The cost is a few seconds added to each merge-to-`main` and a one-time `vp run setup-hooks` step after cloning. Squash- or rebase-merged branches are not detected by `git branch --merged main`; their artifacts are reclaimed on the next `vp run clean --all-worktrees` or when the worktree is removed.
