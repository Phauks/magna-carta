# The account-role vocabulary, and the rebuild two slices are each carrying

**Analysis and a recommendation. Nothing built, and no migration written** — the role names one half
of this depends on are an open owner flag, and a table rebuild performed against unconfirmed names is
a rebuild that gets done twice.

## What is true today

`firm_account_role` (`packages/database/src/per-firm-schema.ts`) maps each posting role a billing
entry needs to one of the firm's ledger accounts. Nine roles, `role` as the primary key, and a
DDL `CHECK` that lists all nine by name:

```
check("firm_account_role_role_check",
  sql`${table.role} IN ('accounts_receivable', 'fee_income', … 'client_credit_liability')`)
```

The `CHECK` is load-bearing, not decorative. `packages/billing/test/account-roles.test.ts` inserts
`petty_cash` directly and asserts the database refuses it — the TypeScript `ACCOUNT_ROLES` array is a
type, and this is the constraint. A firm can populate the table today:
`PUT /api/v1/billing/account-roles` is live in `apps/api-worker/src/http/routes/billing/billing.ts`.

SQLite cannot widen a `CHECK` in place. Adding a role is a table rebuild with a data copy.

## The two slices, and which of them knows

Both merged plans add roles. Only one of them knows what that costs.

**The general-ledger plan knows, in detail.** Task 5 of
[`2026-08-17-general-ledger-implementation-plan.md`](2026-08-17-general-ledger-implementation-plan.md)
adds `accounts_payable` and `owners_equity`, states outright that "this is a CHECK widening on a table
that holds data", prescribes a new table plus a data-copying migration, and offers a sibling-table
alternative if the owner prefers no rebuild.

**The payments plan does not.** Task 1 of
[`2026-08-15-payments-implementation-plan.md`](2026-08-15-payments-implementation-plan.md) adds
`payments_clearing` and `merchant_fees` and says only: add them to `ACCOUNT_ROLES` in
`packages/billing/src/types.ts`. The DDL `CHECK` is not mentioned. Its next step even says "No schema
change: the CHECK already admits the kind" — of a different `CHECK`, on a different table, which
makes the omission read as a considered answer rather than a gap.

**Payments opens first.** Followed as written, it ships two roles that typecheck, resolve through the
map, and are refused by the database the moment a firm tries to map one. The refusal would arrive on
the screen where a firm configures billing, not in a test.

## The precedent the codebase already set, in this subsystem

Ten table definitions above `firm_account_role`, `invoice_delivery.channel` carries a value nothing
can produce, with the reason written beside it:

> `client_portal` is here with nothing yet able to produce it — the portal is unbuilt — because the
> alternative is rebuilding a financial-evidence table on the day it lands.

That is this question, already answered once, by the same slice that built `firm_account_role`. The
answer was: put the value in the vocabulary ahead of its producer, because the vocabulary is cheap and
the rebuild is not.

## Why not a reference table

The obvious structural fix — move the vocabulary into a table with a foreign key, so additions stop
being migrations — would make `firm_account_role` the only closed vocabulary in the per-firm schema
enforced that way. There are **142 `IN (…)` vocabulary `CHECK`s** across that schema. Changing one is
inconsistency; changing all of them is a schema-wide project with a migration per table, which is a
larger and more destructive undertaking than the thing it avoids.

The convention stays. What is worth deciding is _when_ the widening happens, not _whether_ it is a
`CHECK`.

## Recommendation

**Widen once, ahead of both slices, at the moment the table holds the least data it ever will.**
One rebuild instead of two, on the `invoice_delivery.channel` precedent. Each slice then adds its role
to `ACCOUNT_ROLES` in TypeScript — not a migration — and the second slice does nothing at all.

The rebuild is the safest shape one can be: `role` is the primary key, every existing row stays valid
under the wider `CHECK`, and the table holds at most one row per role per firm. The migration test the
general-ledger plan already specifies — every pre-existing row survives with its mapping intact — is
the right assertion whenever it runs.

**What blocks doing it now, and it is not the migration.** The two payments role names are gated on
owner flag **K8** ("Confirm `payments_clearing` and `merchant_fees`"), which is unanswered. Widening
against names that then change is the second rebuild this exists to avoid. So the sequence is:

1. Answer K8, fixing all four names.
2. Perform one widening for all four, before either slice opens.
3. Each slice adds its own role to `ACCOUNT_ROLES` and writes no migration.

**If K8 stays open when payments opens**, the fallback is the general-ledger plan's own alternative —
payments does its rebuild for its two, and general ledger does a second one later. That is the
expensive path, and it is the path the repository is currently on by default.

## The one thing to fix regardless of the decision

The payments plan's Task 1 is wrong as written, whichever way the widening is sequenced: adding a role
to `ACCOUNT_ROLES` alone does not make it usable. That correction is made in the same change as this
document, so a reader of the plan is not led into the failure while the decision is open.
