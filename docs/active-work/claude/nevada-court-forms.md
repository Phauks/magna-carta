---
branch: claude/nevada-court-forms
worktree: C:/dev/magna-carta-worktrees/claude/nevada-court-forms
area: The Nevada starter court-form library — design and plan only, no feature code
status: review
touches: docs/specs/, docs/research/, docs/decisions/pending/, changelog.d/
---

# claude/nevada-court-forms

**Scope.** Design-only. Establishes what Nevada actually publishes and on what terms, then specifies what a shipped court form IS — its representation, provenance, currency, attorney-review gate, forum binding, and how a firm comes to hold one. Answers the document-automation design's court-form flag (F2) with a design; opens a new `N` owner-flag series, of which N1 through N5 gate the build. **Ships no capability and no feature code**, so no `roadmap.d/` node moves.

**Files added**

- `docs/specs/2026-08-14-nevada-court-form-library-design.md`
- `docs/specs/2026-08-14-nevada-court-form-library-implementation-plan.md`
- `docs/research/2026-08-14-nevada-court-form-sources-and-terms.md`
- `docs/decisions/pending/a-shipped-court-form-is-reference-data-a-firm-adopts.md`
- `docs/decisions/pending/an-unreviewed-court-form-cannot-be-adopted.md`
- `docs/decisions/pending/a-court-form-declares-its-forum-and-a-wrong-court-is-a-refusal.md`
- `changelog.d/nevada-court-form-library-design.md`

**Not touched.** No package, no worker route, no migration, no test. `CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper, `docs/conventions/` and `roadmap.d/` are all unchanged.

**Overlap watch.** Only the two append-don't-collide fragment directories (`docs/decisions/pending/`, `changelog.d/`), each with a uniquely-slugged new file. Nothing here edits a shared or generated file.

**For a stream that touches document automation.** The design records three findings about the shipped subsystem that are true independent of this library and are worth knowing before working in it: a fillable PDF cannot be a template today; a legacy Word form field (`FORMTEXT` / `FORMCHECKBOX`) binds nothing at assembly and is reported by no absence, because the normalizer recognizes only `MERGEFIELD`; and the merge-field dictionary carries no address, telephone or email address for any party subject, and no county or address for the court.
