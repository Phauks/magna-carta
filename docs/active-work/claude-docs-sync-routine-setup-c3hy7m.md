---
branch: claude/docs-sync-routine-setup-c3hy7m
worktree: cloud session (Claude Code on the web)
area: docs maintenance automation — per-merge assembly workflow + weekly docs-sync routine (ADR-0058 realized) + verified baseline
status: review
touches: .github/workflows/, docs/maintenance/, docs/specs/, docs/decisions/pending/, changelog.d/, .claude/skills/, roadmap.d/, docs/conventions/documentation.md, CLAUDE.md
---

Sets up the docs-maintenance system: the `assemble-docs` per-merge CI workflow (folds fragments into the rendered trackers on every push to `main`), the docs-sync design spec, the `/docs-sync` skill, the `docs/maintenance/` home with the verified 2026-07-14 baseline report, the decision fragment, and pointer updates in `CLAUDE.md` and `docs/conventions/documentation.md`. Cross-cutting edits are small additive pointers only. The weekly cloud Routine is created alongside this branch; on merge, the workflow's first run clears the fragment backlog automatically.
