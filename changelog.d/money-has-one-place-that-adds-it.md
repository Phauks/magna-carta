---
category: Added
audience: internal
---

**`pnpm run lint:money-arithmetic` — the money gate.** `@magna-carta/money` has been the one place an amount is added, rounded and split since it was built, and nothing enforced it. The scan looks for three things outside that package: arithmetic on a money-shaped name (`*Minor`, `*_minor`, `*E4`), a hard-coded minor-unit conversion (`/ 100`, which floats a currency value and fixes the exponent at two digits for every currency that will ever register), and a float escape (`toFixed`, `parseFloat`, `Number`) on a money expression. Comments, strings and template text are blanked by a state machine before any rule runs, with offsets preserved, so a reported line is the real line.

It landed against **152 findings across 73 files**, in a debt register that may only shrink. The classification is the useful part:

- **26 are display**, and one signature causes all of them: `formatMoney` takes a major-unit amount, so every surface divides on the way in — the same line copy-pasted into twelve Svelte surfaces. A minor-unit entry point that reads the exponent off the currency retires them mechanically.
- **69 are real arithmetic**, worst first: `document-assembly`'s expression evaluator is a **second money engine** — add, multiply, remainder, divide, an exact-division refusal and its own safe-integer guard, with an oracle test deriving the answer a third way in BigInt. `billing/contingency.ts` derives entitlement and residual in bare numbers. `trust/three-way-proof.ts` derives the whole reconciliation in raw numbers, which is the one place in the product where a cent of drift is a bar-compliance event. Twenty-seven findings are a hand-written `reduce` that is exactly `sum`, and "unpaid" is written out as `totalMinor - appliedMinor` in eight files.
- **The rest are tests and fixtures**, where the test re-computes the formula it is testing — and twelve conversions that look like display and are not: five feed a data-table column accessor whose totals row then **sums the divided floats**, so the conversion became arithmetic one layer down where the call site cannot see it.

**One finding the scan cannot see, recorded in `invariants.md` instead:** `billing/fitness.ts` computes the contingency entitlement in SQL as a float divide with hand-rolled half-up rounding, while `contingency.ts` computes it in TypeScript. Two answers that can round apart — and the fitness check meant to catch a divergence is one of the two.
