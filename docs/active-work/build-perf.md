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
_implementation_ (editing 41 tsconfigs) is a later, separately-specced step. No overlap with feature
streams — touches build tooling/docs only.
