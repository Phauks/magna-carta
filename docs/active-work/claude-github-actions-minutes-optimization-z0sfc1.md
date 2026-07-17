---
branch: claude/github-actions-minutes-optimization-z0sfc1
worktree: (web session)
area: Cut GitHub Actions billed minutes on the CI gate
status: building
touches: .github/workflows/gate.yml, .github/workflows/nightly-sweep.yml, tooling/affected-lint/, CLAUDE.md, docs/conventions/build-performance.md, changelog.d/, docs/decisions/pending/
---

Reduce the gate's GitHub-billed minutes, which were pressing against the 3,000-min/month ceiling. A
full PR gate was ~57 billed minutes, of which the whole-repo type-aware `lint` job alone was ~26.
Three changes:

- **Lint off the PR critical path.** The PR gate's `lint` job now runs the package-scoped affected
  lint only; a whole-repo input change (lockfile, root config, `.github/`, …) no longer escalates to
  the ~26-min whole-repo pass on the PR — that pass moves to a daily scheduled sweep
  (`nightly-sweep.yml`). Implemented via a `--defer-global` mode on `tooling/affected-lint`.
- **Drop the redundant `push: main` gate.** The gate ran again in full on every merge to `main`,
  re-confirming what the PR already proved. Removed; `main`'s greenness now rests on the required PR
  gate plus the nightly sweep. **Requires** branch protection to keep "require branches up to date
  before merging" (or a merge queue) on `main` — see the ADR fragment.
- **Docs-assembly commit is docs-only.** The auto-generated fragment-assembly PR only renders `.md`
  files + `STATUS.json`; the `changes` filter now classifies that as docs-only so the assembly gate
  runs format + governance instead of the full worker/typecheck/test suite (~32 min → ~4).

Touches several cross-cutting files (`CLAUDE.md`, `docs/conventions/build-performance.md`) and the
`.github/` workflows — `.github/` changes force a whole-repo lint on the current gate, so this branch
itself will pay one whole-repo lint on its own PR.
