---
branch: claude/linter-ruleset-reconciled
worktree: (web session)
area: reconcile the merged lint-ruleset branch with today's gate — re-measure the whole-repo lint, fix the cap and the stale ruleset docs
status: review
touches: .github/workflows/gate.yml, tooling/affected-lint/index.mjs, docs/conventions/typescript.md, docs/conventions/build-performance.md, changelog.d/
---

Re-verified the lint ruleset that landed in `claude/linter-evaluation-yugrzm`: the ruleset itself is
already on `main` and still correct (vp reads the `vite.config.ts` `lint` block; neither `oxlintrc.json`
nor `.oxlintrc.json` at the root is read — re-proven against vp 0.1.24). What had drifted is the
measurement behind the gate's hang guard: the whole-repo type-aware lint now takes ~45 min, past the
45-minute cap, so the cap is raised and every doc quoting the old ~24-min figure is corrected. Also
retires the merged branch's stale active-work note.

Touches the gate's `lint` job and `tooling/affected-lint` comments — coordinate before overlapping
edits there.
