---
category: Added
audience: internal
---

**`pnpm run lint:lints` — the gate over the gates.** Thirty-eight governance lints, and until now nothing asked whether any of them could still fail. The argument is `lint-control-characters.mjs`'s own, one level up: a check that never fires is indistinguishable from a clean tree, and that hazard applies hardest to the checks nothing checks.

Four rules, all deriving their subject from the `lint:*` scripts in the root `package.json` rather than a roster:

- **Every lint can fail** — it has a fixture test beside it, or a self-test that runs on every invocation. Twenty-five can today; thirteen are carried on a register in `tooling/lint-lints/rules.mjs` that may only shrink, and deleting a name is the whole procedure for tightening it. A name on the register that has since gained a test is reported too, so the debt cannot quietly outlive its payment.
- **Every lint is documented** — named somewhere a reader can find it, so a failing run leads somewhere. All thirty-eight are.
- **Every lint command the conventions cite exists** — the reverse direction, which nothing checked after a rename.
- **The fitness sweep's environment variable is pinned** — the gate's `MAGNA_CARTA_FITNESS_SCOPES` held identical to `FITNESS_SCOPES_ENV`, the way `lint:cache-keys` holds the two cache-key expressions identical. A rename on one side would leave the sweep on its default scope, covering half of what the step claims, and say nothing.

It states its own limits: it proves the machinery is present and wired, not that a fixture is meaningful, and one stale sentence naming a lint counts as documented.
