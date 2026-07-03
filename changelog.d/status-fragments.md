---
category: Changed
---

**`STATUS.md` is now a build output assembled from per-slice fragments.** Each slice's stage status lives in its own `status.d/<slice>.md` fragment (flat frontmatter + a one-line note); `vp run status-build` renders both `STATUS.md` (the familiar per-phase matrix) and `STATUS.json` (a machine-readable index carrying each slice's stages plus dev fields — next action, branch, spec/plan/ADR links). Branches edit only their own slice's fragment, so parallel worktrees never collide on the tracker, and generated tables are width-independent so a note edit no longer re-pads every row. Validated by `pnpm run lint:status`; the fragment set mirrors the `changelog.d/` → `CHANGELOG.md` pattern but persists rather than being consumed.
