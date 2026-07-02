---
branch: build-perf
worktree: C:/dev/magna-carta-worktrees/build-perf
area: Build-time performance — static-check (type-check/lint) speed: TS project references + TS 7 (tsgo) trajectory
status: designing
touches: docs/conventions/build-performance.md (new "Static analysis & type-check speed" section), docs/specs/ (references-rollout design), docs/decisions/pending/ (likely 1 ADR when the rollout is decided). Later, if the rollout implements: every package tsconfig.json (composite + references), root tsconfig, CI.
---

Extends `build-performance.md` with the missing static-check dimension: how we keep `vp check`
(type-check + lint) fast as the monorepo grows. Prompted by a 5+ minute whole-repo typecheck. Findings:
oxlint/oxfmt are already Rust-fast; the cost center is whole-repo TypeScript `tsc` with no
incrementality. Audit: **41 packages, 0 circular dependencies** (clean for project references),
Compiler-API exposure isolated to 3 off-hot-path tools (openapi-ts, drizzle-kit, svelte-check),
tsconfig already TS 7-clean.

Plan is sequenced: (1) scope-on-changed local checks + trustworthy fmt now; (2) TypeScript **project
references + incremental** under TS 6 (the structural scaler — mature `tsc -b`); (3) adopt the **TS 7
native compiler (tsgo, ~10x)** after references land (tsgo's `-b` composite handling is still maturing
at RC; we carry no cycles but still take the mature path first, and keep `typescript@6` for the
Compiler-API tooling until the 7.1 API).

This stream captures the convention section + designs the references rollout; the rollout
_implementation_ (adding a generated `tsconfig.build.json` to every package) is a later step,
specced in `docs/specs/2026-06-30-typescript-project-references-rollout-design.md`.

**COORDINATION — repo-wide when it lands (all streams read this):** the references rollout adds a
`tsconfig.build.json` to every package + a root solution file. These are **generated from
`package.json` workspace deps and never hand-edited** — a branch that adds a package or changes its
`@magna-carta/*` deps re-runs the generator rather than editing configs, and a CI/`vp check` **fitness
check fails any PR whose build configs are stale vs `package.json`.** So alignment is mechanical: on
your next `main` sync after this lands, merge, run the generator (or let `vp install`/the fitness lane
run it), commit the regenerated configs. Branches that add no package and change no workspace dep get a
no-op generator and a clean new-file merge. Shared edits are limited to `.gitignore` (+`.tsbuild/`) and
the root `package.json` `check`/`typecheck` scripts. Gate on `vp run worktrees` before landing.
