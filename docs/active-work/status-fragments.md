# status-fragments

**Scope:** Make `STATUS.md` a build output assembled from per-slice fragments (the `changelog.d/` →
`CHANGELOG.md` pattern), so parallel branches stop colliding on it. Folds in "Solution A" — the
generator emits non-aligned, width-independent tables and `STATUS.md` becomes formatter-ignored.

**Why:** `STATUS.md` is a single shared, column-aligned GFM table; oxfmt re-pads the whole table on any
cell-width change, so a one-cell edit churns every row and every branch touching it conflicts.

**Files I expect to touch:**

- `status.d/` (new) — per-slice fragments + `_sections.md` + `README.md`
- `tooling/doc-fragments/status.mjs`, `build-status.mjs`, `migrate-status.mjs` + tests
- `vite.config.ts` — add the `status-build` run task; add `STATUS.md` to `fmt.ignorePatterns`
- `STATUS.md` — regenerated (becomes a build output)
- `CLAUDE.md` (worktree "append-don't-collide" bullet), `docs/conventions/documentation.md`
- `changelog.d/` + `docs/decisions/pending/` — one fragment each for this change

**Cross-cutting coordination:** touches `CLAUDE.md`, `vite.config.ts`, `STATUS.md`,
`docs/conventions/documentation.md`. No other active stream has declared overlap on these or on
`tooling/doc-fragments/`. `changelog.d/` and `docs/decisions/pending/` are shared via the fragment
convention (append-only, no collision).

**Spec:** [`docs/specs/2026-07-02-status-fragments-design.md`](../specs/2026-07-02-status-fragments-design.md)
