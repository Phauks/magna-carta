---
branch: tooling-auto-clean
worktree: C:/dev/magna-carta-worktrees/tooling-auto-clean
area: Dev tooling — auto-clean regenerable build artifacts + Docker cache on merge to main
status: designing
touches: tooling/clean/, tooling/git-hooks/, vite.config.ts, CLAUDE.md, changelog.d/, docs/decisions/pending/
---

Adds a `vp run clean` task (sweeps regenerable build artifacts — `target/`, `.svelte-kit/`,
`.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/` — from worktrees whose branch is merged into
`main`) plus dangling Docker cache pruning, wired to fire automatically via a tracked `post-merge`
git hook (guarded on `main`). Also adds `vp run setup-hooks`. Edits `vite.config.ts` (run.tasks) and
the Worktree-lifecycle section of `CLAUDE.md` — coordinate before touching those. Design spec:
`docs/superpowers/specs/2026-06-23-auto-clean-build-artifacts-design.md`.
