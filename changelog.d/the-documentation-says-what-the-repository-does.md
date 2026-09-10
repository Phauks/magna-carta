---
category: Fixed
audience: internal
---

**The documentation says what the repository does.** A review pass over the root and conventions
docs, changing only what could be verified against the code, the account or the git history: the
README's quickstart now gives the install order the root `CLAUDE.md` insists on (`pnpm install`
first, because `vp` is a devDependency) and the single-flight `pnpm test`; `CLAUDE.md` says that
`pnpm install` activates the tracked hooks through `postinstall` and that four packages, not three,
carry git-ignored WASM output; the maintenance runbook stops claiming the per-merge docs assembly
keeps the changelog current minutes after a merge (GitHub Actions has been blocked account-side since
2026-08-05, and 401 changelog fragments and 171 pending decisions are waiting) and stops saying the
docs-sync Routine has not been created (it was, twice); the documentation standard names the lint
rules that exist instead of a link checker and a changelog gate that do not; the conventions index
lists the four rulings ledgers and the engine-host seam it omitted and no longer calls `code-style.md`
and `typescript.md` stubs; the gate workflow's and the pre-push hook's comments stop describing
`git push main:release` as the only deploy; the roadmap stops placing the file-manager primitives on
a branch that no longer exists and stops saying Directory pronouns await a pull request; and the
relative links that broke when `apps/worker` became `apps/api-worker`, when decision fragments were
numbered, and when the calendar's time-zone module moved to `@magna-carta/civil-time` point at the
files again. Twenty-two `docs/active-work/` notes whose branches had landed are retired, with their
`status.d/` pointers cleared.
