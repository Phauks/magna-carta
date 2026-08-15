---
branch: claude/intake-design
worktree: .claude/worktrees/intake-design
area: Client intake / CRM — design and implementation plan only, no feature code
status: review
touches: docs/specs/, docs/decisions/pending/, changelog.d/, roadmap.d/intake.md, roadmap.d/conflicts.md, docs/now.md, docs/register-history.json, docs/active-work/claude/
---

Design-only stream for client intake: the spec
([`docs/specs/2026-08-15-client-intake-design.md`](../../specs/2026-08-15-client-intake-design.md)),
the plan beside it, ADR fragments at `Proposed`, and the ledger-evidence corrections the ground-truth
pass found. **No feature code, no schema, no migration, no route.**

The stream reads `@magna-carta/matters`, `@magna-carta/directory`, `@magna-carta/conflicts`,
`@magna-carta/custom-fields`, `@magna-carta/billing` and `@magna-carta/document-assembly` and
**writes none of them**. Nothing under `packages/` or `apps/` is touched, so there is no overlap with
any code stream in flight.

Owner flags are a new **`J`** series (intake); the first seven decide what gets built and the plan
does not start until those are answered. The heaviest of them are professional-conduct questions —
what the conversion gate refuses, and what happens to a declined prospect's information — which are
analysed here and decided by the owner, not by the design.

## Ledger corrections

`roadmap.d/intake.md` — `intake.conflict-check` claimed "no conflicts check exists to trigger" over a
shipped `packages/conflicts` whose trigger vocabulary already contains the two names intake needs.
Two more intake nodes were sharpened where the tree contradicted them. No status flips: a design
ships no capability, and the spec is `Proposed` until the owner flags are answered, so every intake
node stays `not-started` and none carries a `spec:` key yet — the vocabulary defines `designed` as an
_accepted_ spec, and `lint:ledger-staleness` rule 6 holds `not-started` to carrying none.

`roadmap.d/conflicts.md` — the parent and `conflicts.triggers` both described a state that ended when
conflicts slices 1 and 2 merged. Corrected because the intake nodes now name `packages/conflicts`,
and a pre-code node may only name a code path some has-code node claims (rule 1). The remaining
conflicts nodes are also stale in the same direction and are reported rather than rewritten here —
that area belongs to a conflicts stream, not to this one.

## Overlaps

- `roadmap.d/intake.md` and `roadmap.d/conflicts.md`. `claude/ledger-accuracy` and
  `claude/ledger-staleness` also touch `roadmap.d/`, in other area files.
- `docs/now.md` and `docs/register-history.json` are **generated** — re-rendered by
  `vp run register-build` because the ledger moved, never hand-edited.
- `docs/specs/` is shared with `claude/nevada-court-forms`, `claude/payments-design` and
  `claude/statement-import-design`; each stream owns its own files and none edits another's.

## Gates run

Documents only, so the doc fitness functions are the whole gate: `lint:decisions`,
`lint:changelog-fragments`, `lint:roadmap`, `lint:ledger-staleness`, `lint:process-refs`,
`lint:status`, then `fix:scoped` and `check:scoped`. No test suite was run — another worktree is
active, and two suites at once produce phantom failures in files neither run touched.
