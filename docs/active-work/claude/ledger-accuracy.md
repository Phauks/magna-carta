# claude/ledger-accuracy

**Scope.** Close the blind spot in `pnpm run lint:ledger-staleness` that let two nodes sit at
`not-started` over a built package, and correct every node the new rule reaches.

The existing rules all key on a node **naming a path**. A node that describes its own absence in
prose — "no code", "no registration exists" — offers nothing to key on, and
`financial.trust.reconciliation` and `financial.trust.close-rule` survived that way over
`packages/trust`'s reconciliation modules, `apps/worker/src/routes/trust-reconciliation.ts` and a
close gate registered in the matter composition root. The new rule reads no prose at all: a node
carries `slices:`, a `status.d/` fragment carries `built:`, and a `not-started` node whose stream has
already shipped one of its **siblings** is two committed documents contradicting each other.

**Files I expect to touch**

- `tooling/lint-ledger-staleness/rules.mjs`, `index.mjs`, `index.test.mjs` (rules 7 and 8, the
  status.d reader, fixtures)
- `docs/specs/2026-08-14-feature-ledger-staleness-detection.md` (the rules' design home — two new
  sections, and a note on the rejected slice rule the narrowing rescued)
- `roadmap.d/README.md` (the "six exact rules" line)
- `roadmap.d/financial.md`, `roadmap.d/core-domain.md` (the corrections)
- `docs/now.md` (regenerated via `vp run register-build`, never hand-edited)
- `changelog.d/` fragment

**Not touching.** Any application code, `status.d/` fragments, `STATUS.md`, `CHANGELOG.md`, the
Decision-Log register.

**Overlap watch.** `roadmap.d/*` and `docs/now.md` are shared surfaces. I touch two area files and
regenerate the register; anything else editing the ledger should sync before I merge.
