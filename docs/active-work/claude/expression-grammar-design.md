---
branch: claude/expression-grammar-design
worktree: C:/dev/magna-carta-worktrees/claude/expression-grammar-design
area: Slice 2·6·2 — the template expression language (design only, no product code)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream amending the document-automation design for the conditionals/repeats slice with
the owner's expanded expression ceiling (taken 2026-08-04 evening, answering owner flag F6): template
expressions grow from presence/negation/literal-equality to **computed expressions** — arithmetic,
date math, and a fixed helper catalog — while the non-negotiable line survives untouched, that an
expression is never executable template-supplied code. The new spec designs the closed grammar, the
type system, the integer-exact money rules with division replaced by three explicitly-rounded
helpers, date math in the matter's office time zone, registration-time static checking, the resource
bounds, the security analysis, the prior-art survey (HotDocs, Gavel, docxtemplater's Angular parser),
and the fuzzing obligation.

**No product code, no schema, no route, and no source file in this stream.** The shipped
`packages/document-assembly` from build slice 2·6·1 is read as input only; nothing under `packages/`
or `apps/` is touched.

The one existing file edited is the document-automation **implementation plan**, whose slice 2·6·2 is
resequenced into grammar → evaluator → conditionals → repeats → computed fields (tasks 11–15) with
the later tasks renumbered 16–21, plus one new global constraint and an updated gates paragraph. The
document-automation **design spec itself is deliberately not edited** — it is a point-in-time record,
and the new spec states what it supersedes.

Nothing cross-cutting is touched: `STATUS.md`, `ROADMAP.md`, `CLAUDE.md`, the white paper,
`docs/conventions/`, `status.d/`, and `roadmap.d/` are all left alone. A concurrent stream owning
`packages/document-assembly` would not collide with this one, but should read the new spec before
building slice 2·6·2. Note for whoever next sweeps the registry:
`docs/active-work/claude/document-automation-slice-1.md` is stale — that branch merged as the slice
2·6·1 build and its note was never removed.

Files:

- `docs/specs/2026-08-04-template-expression-language-design.md` (new)
- `docs/specs/2026-08-04-document-automation-implementation-plan.md` (edited)
- `docs/decisions/pending/template-expression-ceiling.md` (new)
- `changelog.d/template-expression-language-design.md` (new)
