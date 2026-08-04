---
branch: claude/docs-pipeline-followups
worktree: (agent worktree)
area: Docs-pipeline follow-ups from the 2026-08-04 docs-sync audit
status: review
touches: .github/workflows/assemble-docs.yml, tooling/worktrees/index.mjs, docs/active-work/, docs/user/features/filing-email-to-a-matter.md, roadmap.d/communications.md, status.d/2-4-in-app-conversion.md, status.d/2-5-pdf-services-e-signature-core.md, docs/decisions/pending/, changelog.d/
---

The flagged, non-owner items from `docs/maintenance/reports/2026-08-04.md`: the shallow checkout that
was silently numbering assembled ADRs alphabetically, the missing capture-address user guide, the stale
2·5 `next:` line, a ledger node for the capture-address surface, the two competing active-work naming
conventions (unified on the nested form, which required making the registry loader recursive), and a
decision fragment recording why ADR-0098/0099/0102 are permanently vacant. Docs and workflow only — no
product code. Renames every flat `docs/active-work/claude-*.md` note, so a concurrent stream holding one
of those paths should rebase before touching it.
