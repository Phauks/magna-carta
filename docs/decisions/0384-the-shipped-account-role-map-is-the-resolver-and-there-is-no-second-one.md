---
number: 384
slug: the-shipped-account-role-map-is-the-resolver-and-there-is-no-second-one
status: Proposed
date: 2026-08-17
area: Financial Core
summary: "The operating general ledger adopts billing's shipped firm_account_role map as THE account resolver and adds no second one. The phase-3 slice map's fourth coordination pin expected the chart and resolver to be co-designed with 3·5 landing first; billing landed first instead, with nine role keys, a resolver that refuses by name when a role is unmapped, and a configuration composer, and the payments design extends the same map with two more roles. A semantic_key column on ledger_account — the earlier design's answer — is refused because it would be a SECOND map from meaning to account, editable independently of the first: a firm could carry semanticKey 'accountsReceivable' on one account while firm_account_role pointed at another, both correct in their own surface, and one of them is where the money went. Three changes to the seam that exists: the map moves into a pure leaf package so general-ledger, billing and payments can all depend on it and none on the others (the billing-core precedent, with a no-behaviour-change gate); exactly two roles are added, accounts_payable and owners_equity, with deliberately no default expense account because a plausible fallback makes a misposting invisible; and three configuration guards land — no trust-registered account, no parent account (a role must resolve to a leaf or every posting through it aborts at commit), and the account's type must match the role's declared normal balance, because mapping fee_income to an asset account is a silent sign inversion on every future invoice that nothing downstream would notice."
---

**Billing's `firm_account_role` map is the account resolver, and this slice extends it rather than
adding a second one.**

**Context:** the phase-3 slice map's fourth coordination pin said the product chart of accounts and the
firm account resolver must be co-designed across the billing and general-ledger boundary, and warned
that if the general ledger landed second, billing would need an interim resolution seam. Billing landed
first and built that seam: `firm_account_role`, nine roles, `resolveAccountRole` refusing by name and
naming where to set the mapping, and `composeAccountRoleConfiguration`. Every billing posting path
resolves through it — finalize, credit notes, write-offs, client credits — and the payments design adds
`payments_clearing` and `merchant_fees` to the same map. It is not a placeholder any more; it is the
mechanism, with stored rows behind it.

**Decision:**

(1) **`firm_account_role` is the resolver.** Nothing moves, no stored mapping is migrated, and the
refusing-when-unmapped behaviour is kept exactly as it is.

(2) **No `semantic_key` column on `ledger_account`.** It would be a second map from meaning to account,
independently editable, and the disagreement between the two would look correct in both surfaces. The
handle that survives a rename is the role, and there is one of them.

(3) **The map moves into a pure leaf package** (`@magna-carta/account-roles`) so
`@magna-carta/general-ledger`, `@magna-carta/billing`, and later payments all depend on it and none
depends on the others. The alternative edges are both wrong: billing depending on the general ledger, or
the general ledger depending on billing. The precedent is `@magna-carta/billing-core`, extracted for
exactly this reason. The extraction is mechanical, the table and every stored row are untouched, and the
gate is that billing's suite passes with no test edited beyond an import path.

(4) **Two roles are added, and only two.** `accounts_payable` (liability) and `owners_equity` (equity).
There is deliberately **no** `operating_expense_default`: a vendor bill line names its expense account
explicitly and refuses if it does not, because a default expense account is the kind of plausible
fallback that makes a misposting invisible. Retained earnings is not a role because it is not an
account.

(5) **Three configuration guards.** A role may not name a trust-registered account; may not name a
parent account, because a role must resolve to a leaf or every posting through it would abort at commit
after the caller had composed a whole invoice; and the account's `type` must match the role's declared
normal balance. The third is the cheapest high-value guard in the slice: mapping `fee_income` to an
asset account inverts the sign of every future invoice posting, the entry still balances, the batch
still commits, and nothing downstream notices.

**Consequences:** the pin resolves in the direction the build order actually took, and a firm that has
already mapped nine roles keeps them. Widening the `firm_account_role` CHECK for the two new roles is a
rebuild of a small configuration table rather than an in-place widen, written as a hand migration with
the copy and asserted to preserve every existing mapping. Builds on **ADR-0072**.
