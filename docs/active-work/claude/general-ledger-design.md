---
worktree: /home/user/magna-carta/.claude/worktrees/general-ledger-design
area: Slice 3·5 — operating accounting / general ledger — design and implementation plan only
status: designing
touches: docs/specs, docs/decisions/pending, roadmap.d/financial.md, roadmap.d/integrations.md, docs/now.md, status.d/3-5-operating-general-ledger.md, STATUS.md, STATUS.json, changelog.d
---

Design-only cycle for slice 3·5: the product chart of accounts on the existing `ledger_account`
schema, accounts payable, the general journal, period close, and the financial-statement read
primitives, plus the QuickBooks seam. No application code and no schema change lands on this branch.
It supersedes the stale design on the dormant `slice-3-5-operating-general-ledger` branch, which was
written before billing 3·4 shipped `firm_account_role` and before trust 3·2 shipped its composition
guard, and whose account-resolver design is a second answer to a question `main` now answers. Nothing
here edits `packages/ledger`, `packages/billing`, or `packages/trust`; the plan describes edits a
later build stream makes.
