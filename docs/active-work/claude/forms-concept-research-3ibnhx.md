---
worktree: C:/dev/magna-carta-worktrees/claude/forms-concept-research-3ibnhx
area: What "forms" means — the Documents / Forms / Templates taxonomy, and executing the owner's ruling
status: building
touches: docs/specs/, docs/conventions/design-corrections.md, docs/decisions/pending/, roadmap.d/document-automation.md, roadmap.d/intake.md, docs/now.md, apps/web/src/lib/navigation/destinations.ts, apps/web/src/routes/developer-console/
---

The owner asked what forms are, and whether templates are simply documents. The word carried two opposite jobs on shipped screens — the sidebar said Forms meant document automation, the intake procedure said forms were what the client fills in. The study at `docs/specs/2026-09-07-documents-forms-templates-taxonomy-study.md` set out three taxonomies; the owner ruled **B** on 2026-09-07: **Forms means what a client fills in.**

Executing that ruling: `destinations.ts` changes what the Forms destination is for (id, label and route unchanged, still announced-not-shipped); the field-input scaffold moves from `/forms/assemble` to `/developer-console/document-assembly`; the ruling is recorded in `design-corrections.md` and as an ADR fragment; the feature ledger gains `document-automation.supplied-values` for the gap the move surfaced.

**Anyone editing `destinations.ts` should coordinate** — this stream changes the Forms entry's comment and description. It touches no other destination and no ordering. Nothing else in `apps/web` moves except the one route directory and the developer-console fixture list.
