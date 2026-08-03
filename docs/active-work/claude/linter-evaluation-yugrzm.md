---
branch: claude/linter-evaluation-yugrzm
worktree: (web session)
area: oxlint ruleset — broaden categories/plugins, verify type-aware tsconfig scoping
status: review
touches: vite.config.ts, oxlintrc.json (deleted), tooling/affected-lint/, docs/conventions/, changelog.d/
---

Evaluating and broadening the oxlint configuration. Confirmed oxlint (Oxc) is already the fastest
linter available — no engine swap. Found that the ruleset lived in a root `oxlintrc.json` that vp
never reads (vp reads the `lint` block of `vite.config.ts`), so the ruleset — including
`oxc/no-barrel-file` — was dead. Migrated the ruleset into `vite.config.ts` (restoring enforcement),
deleted the dead file, updated `tooling/affected-lint` (+test), enabled the `suspicious`/`perf`
categories as `warn` (gate-safe) with the two noise-flood rules off, and listed plugins explicitly
(no react/jsx-a11y — Svelte, no JSX). Confirmed the type-aware tsconfig `include` is already scoped.

Touches the global lint ruleset (`vite.config.ts` `lint` block) — a whole-repo lint input, so
coordinate before overlapping edits.
