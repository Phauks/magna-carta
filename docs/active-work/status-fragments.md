# status-fragments

**Scope:** Make `STATUS.md` a build output assembled from per-slice fragments (the `changelog.d/` →
`CHANGELOG.md` pattern), so parallel branches stop colliding on it. Folds in "Solution A" — the
generator emits non-aligned, width-independent tables and `STATUS.md` becomes formatter-ignored.

**Why:** `STATUS.md` is a single shared, column-aligned GFM table; oxfmt re-pads the whole table on any
cell-width change, so a one-cell edit churns every row and every branch touching it conflicts.

Extended (owner review, 2026-07-03) with agent-first fields: structured stage frontmatter, a
machine-readable `STATUS.json`, per-slice dev fields (next / branch / links), and a CI drift gate +
`lint:status` guard. See the design addendum.

**Files touched:**

- `status.d/` (new) — 42 per-slice fragments + `_sections.md` + `README.md`
- `tooling/doc-fragments/status.mjs`, `build-status.mjs`, `migrate-status.mjs`, `status.test.mjs`
- `tooling/lint-status.mjs` (new) + `package.json` `lint:status` script
- `vite.config.ts` — `status-build` run task; `STATUS.md` + `STATUS.json` in `fmt.ignorePatterns`
- `STATUS.md` (regenerated build output) + `STATUS.json` (new machine index)
- `CLAUDE.md` (worktree "append-don't-collide" bullet), `docs/conventions/documentation.md`
- `changelog.d/status-fragments.md` + `docs/decisions/pending/status-fragments.md`

**Cross-cutting coordination:** touches `CLAUDE.md`, `vite.config.ts`, `STATUS.md`,
`docs/conventions/documentation.md`. No other active stream has declared overlap on these or on
`tooling/doc-fragments/`. `changelog.d/` and `docs/decisions/pending/` are shared via the fragment
convention (append-only, no collision).

**Spec:** [`docs/specs/2026-07-02-status-fragments-design.md`](../specs/2026-07-02-status-fragments-design.md)
