---
branch: claude/discovery-5-2-design
worktree: .claude/worktrees/discovery-5-2-design
area: Discovery 5·2 review-workflow design — tagging/coding, privilege review, productions (design only, no product code)
status: review
touches: docs/specs/2026-08-07-discovery-5-2-review-workflow.md, docs/decisions/pending/discovery-review-workflow-tagging-privilege-productions.md, changelog.d/discovery-5-2-design.md
---

Design-only stream: the spec and slice plan for the discovery review workflow over the 5·1 corpus —
the coding model (grouped tags, machine-read semantics, per-document audit rows, bulk with exact
undo), privilege as tag-plus-claim with a content-blind log generator, redaction drawing, immutable
productions with block-drawn Bates, batches/QC, and the wall and AI-Search-boundary composition.
Tagging is sub-slice 1 by owner direction. Touches only new docs files plus its own fragments;
nothing here collides with the 5·1·3/5·1·4 build streams, but the spec depends on their reads and
should be re-checked against them at merge if they land first.
