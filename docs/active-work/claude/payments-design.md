---
branch: claude/payments-design
worktree: .claude/worktrees/payments-design
area: Payments subsystem — design and implementation plan only, no feature code
status: review
touches: docs/specs/, docs/decisions/pending/, changelog.d/, roadmap.d/payments.md, docs/now.md, docs/register-history.json, docs/active-work/claude/
---

Design-only stream for the payments subsystem: the spec
([`docs/specs/2026-08-15-payments-design.md`](../../specs/2026-08-15-payments-design.md)), the plan
beside it, six ADR fragments at `Proposed`, and the `roadmap.d/payments.md` status flips the spec
justifies. **No feature code, no schema, no migration, no route.**

The stream reads `@magna-carta/billing`, `@magna-carta/trust`, `@magna-carta/trust-jurisdictions`,
`@magna-carta/integrations` and `@magna-carta/ledger` and **writes none of them**. Nothing under
`packages/` or `apps/` is touched, so there is no overlap with any code stream in flight.

Twelve owner flags in a new **`K`** series (payments); seven of them decide what gets built, and the
plan does not start until those seven are answered. The largest of them, K1, is that billing shipped
and a firm still cannot record a client's cheque — `composeInvoiceApplication` refuses the `payment`
kind for every rail, not only the electronic ones — so the manual receipt is one composer away and
needs no processor at all.

## Overlaps

- `roadmap.d/payments.md` only. `claude/index-fixes` also touches `roadmap.d/`, in a different area
  file.
- `docs/now.md` and `docs/register-history.json` are **generated** — re-rendered by
  `vp run register-build` because the ledger moved, never hand-edited. `lint:roadmap` fails without
  the history catch-up, so the churn is required rather than incidental. `claude/register-history`
  and `claude/build-register` own that tooling; this stream only re-runs it.
- No overlap with `claude/statement-import-design` (trust reconciliation design) beyond citing the
  same trust reconciliation model; that stream owns `docs/specs/` files of its own and neither edits
  the other's.

## Gates run

Documents only, so the doc fitness functions are the whole gate: `lint:decisions`,
`lint:changelog-fragments`, `lint:roadmap`, `lint:ledger-staleness`, `lint:process-refs`,
`lint:status`. The compile and test gates were deliberately not run — a whole-repo verification suite
held the machine, and running a second one produces phantom failures in files neither run touched.
