# Auto-clean build artifacts — design

**Date:** 2026-06-23
**Status:** Approved (design); implementation pending
**Author:** brainstorming session

## Problem

The development disk filled to 100% (2 GB free of 510 GB). The reclaimable weight had
accumulated because nothing sweeps regenerable build output:

- **Rust `target/` dirs multiply per worktree.** Across ~10 worktrees, ~15 GB of `target/`
  had built up — 10.8 GB in `pdf-engine-roadmap` alone (its `crates/` plus five feasibility
  spikes), 3.6 GB in `scan-yara-forge`. These belong to branches already merged to `main`.
- **Docker build cache grows unbounded.** Building the scan and raster containers locally left
  21 GB of `docker builder` cache (113 entries) and stale image layers. Deleting images does
  not return the space — the WSL2 virtual disk must also be kept sparse.
- **Merged worktrees are never swept.** CLAUDE.md already carries a worktree-lifecycle rule
  (remove the worktree, branch, and active-work note on merge; periodically prune), but it is
  manual and was not happening.

The fix is to make the recurring, regenerable artifacts clean themselves so a manual disk
rescue is rarely needed again.

## Scope

In scope (decided):

- **Regenerable project build artifacts** — `target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`,
  `dist/`, `build/`, `coverage/`.
- **Docker build cache** — dangling builder cache and dangling image layers; keep the WSL2
  disk sparse.

Out of scope (decided):

- **Worktree / branch removal** — stays a manual step. Worktrees may hold uncommitted or
  foreign work; automated removal is too risky. Artifacts are reclaimed without deleting the
  worktree shell.
- **`node_modules`** — reclaimable but expensive to reinstall; left in place.
- **System locations** (OneDrive cache, Phone Link `CrossDevice`, `hiberfil.sys`, `Temp`) —
  these are personal-data or OS concerns, handled manually, not by project tooling.

## Behaviour

### Trigger

A `post-merge` git hook fires when a feature branch lands in `main`. The hook **guards on the
current branch being `main`**, so routine `git pull` on a feature branch does nothing. This is
the "auto on branch merge" trigger: cleanup happens exactly when a branch completes.

Because git worktrees share one common git directory, a single tracked hook covers every
worktree. The hook is installed by pointing `core.hooksPath` at a tracked directory, so it is
version-controlled rather than living only in `.git/hooks`.

### What runs on each merge to main

1. **Sweep regenerable artifacts in merged worktrees.** Enumerate worktrees; for each whose
   branch is merged into `main` (`git branch --merged main`) **and is not the current
   worktree**, delete the regenerable artifact dirs listed in Scope. The worktree shell, its
   `node_modules`, and all tracked/uncommitted source are left untouched (the targets are all
   git-ignored, so uncommitted source is never at risk).
2. **Docker prune (every merge).** `docker builder prune -f` and `docker image prune -f`
   (dangling only). Re-assert WSL sparse mode if it was disabled. No throttle — merges to
   `main` are infrequent and the prune is cheap when the cache is already small.
3. **Report.** Print reclaimed bytes per category.

Docker is invoked best-effort: if Docker is not running, the step logs a skip and the hook
still succeeds (cleanup must never block a merge).

### Safety

- **Auto-delete is limited to regenerables.** Build artifacts and dangling Docker cache are
  deleted silently — they cost only rebuild time. Nothing heavier (worktrees, `node_modules`,
  tagged images) is ever auto-deleted.
- The active worktree and any non-merged branch are never swept.
- Only git-ignored directories are removed, so source and uncommitted work are safe by
  construction.

## Components

### `tooling/clean/index.mjs` — the mechanism (`vp run clean`)

A Node script in the same style as `tooling/worktrees/index.mjs`, runnable on demand and from
the hook.

- Resolves the repo's worktrees and the set of branches merged into `main`.
- Deletes regenerable artifact dirs from merged, non-current worktrees.
- Runs the Docker prune steps.
- Prints a reclaimed-bytes summary.

Flags:

- `--dry-run` — report what would be deleted; delete nothing.
- `--all-worktrees` — sweep regenerables from every worktree except the active one (still
  regenerables-only; opt-in, for a manual deep clean).

Registered in `vite.config.ts` under `run.tasks` as `clean`.

### `tooling/git-hooks/post-merge` — the trigger

- Exits immediately unless the current branch is `main`.
- Invokes `vp run clean`.
- Always exits 0 (cleanup failure must not fail the merge).

### `vp run setup-hooks` — installer

- Sets `git config core.hooksPath tooling/git-hooks`.
- Idempotent; safe to re-run. Documented as a one-time step after clone, alongside
  `vp install`.

Registered in `vite.config.ts` under `run.tasks` as `setup-hooks`.

## Interfaces and isolation

- **`clean` script** — input: repo git state; effect: deletes git-ignored artifact dirs and
  prunes Docker; output: a printed report. Pure with respect to tracked files. Testable by
  pointing it at a fixture repo with mock worktrees (mirrors `tooling/worktrees`'s test
  approach) and asserting which paths it selects in `--dry-run`.
- **`post-merge` hook** — input: current branch; effect: conditionally calls `clean`. Thin
  enough to read at a glance.
- **`setup-hooks` task** — input: none; effect: one git config write.

## Testing

- Unit-test the worktree/merged-branch selection logic in `tooling/clean` (which paths are
  chosen, current worktree excluded, non-merged branches excluded) using `--dry-run` against a
  fixture, following `tooling/worktrees/parse-note.test.mjs`.
- Register `tooling/clean/vitest.config.ts` in the root `test.projects` list.
- Docker steps are shelled out and guarded; assert the script degrades to a logged skip when
  the `docker` CLI is absent, rather than mocking the daemon.

## Documentation (same commit as implementation)

- Update the **Worktree lifecycle** subsection of `CLAUDE.md` to reference `vp run clean`
  (automatic on merge) and the one-time `vp run setup-hooks`.
- Add `vp run setup-hooks` to the Commands list near `vp install`.
- Changelog fragment under `changelog.d/`.
- ADR fragment under `docs/decisions/pending/` recording the auto-clean decision (trigger
  model, regenerables-only safety bound, worktree-removal deliberately excluded).

## Implementation hygiene

This is cross-cutting tooling, unrelated to the current `tools-metadata-scrubber` branch. It
should be built on its own branch/worktree. Before editing the shared files it touches
(`CLAUDE.md`, `vite.config.ts`), run `vp run worktrees` to check for overlap and sync `main`,
per the parallel-worktree rules.
