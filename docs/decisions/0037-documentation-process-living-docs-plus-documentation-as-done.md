---
number: 37
slug: documentation-process-living-docs-plus-documentation-as-done
status: Accepted
date:
area: Documentation & process
---

**Living docs, plus documentation-as-done and a standard writing language.** A root [`CHANGELOG.md`](./CHANGELOG.md) (Keep a Changelog, `[Unreleased]` updated per PR) and a living root [`ROADMAP.md`](./ROADMAP.md) (execution tracker — Now/Next/Shipped/Backlog — **distinct** from the white paper's stable phase strategy) are maintained in the **same commit** as the work. Documentation is a **definition-of-done** gate for **both** developer and user audiences (standard in `docs/conventions/documentation.md`). A single **writing language** standardizes change types via **Conventional Commits → Keep a Changelog** categories, commit/changelog phrasing, bug-fix/feature templates, and a **canonical glossary** (`docs/conventions/documentation-style.md`). Cross-references into the white paper use **document + topic name or `ADR-NNNN`, never `§` numbers** (numbers shift on reorganization). Release-time changelog aggregation and roadmap roll-up are **automated in Phase 0** — tool (Conventional Commits + git-cliff / release-please / changesets) picked then and logged as its own ADR; a propose-only changelog/roadmap **maintenance agent** can later draft entries from merged PRs for human approval. Chose hand-written `[Unreleased]` entries as the reliable baseline over fully-generated changelogs.
