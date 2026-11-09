# Review campaign 2 — the financial area

**Date:** 2026-08-06 · **Reviewer:** adversarial read-only pass · **Branch:**
`claude/review-campaign-2-financial`

**Scope.** Everything merged in the financial area since the first review campaign:
`packages/trust/` (foundation, movements, matter-close precondition, two-person disbursement
authorization, reconciliation), `packages/billing/`, `packages/sequence-numbering/`, the statements
those packages compose, their worker routes (`apps/api-worker/src/http/routes/trust/trust.ts`,
`apps/api-worker/src/http/routes/trust/trust-reconciliation.ts`, `apps/api-worker/src/http/routes/billing/billing.ts`), and their
fitness suites. Supporting reads into `packages/ledger/`, `packages/money/`,
`packages/billing-core/`, `packages/data-access/`, `packages/access-control/`, and the per-firm
migrations those subsystems own.

This is a defect report, not a style pass. Every finding was traced from a concrete input through
the code to a wrong outcome before it was recorded. Nothing here was fixed — the fixes belong to the
streams that own the files.

**Counts.** 13 findings: **3 high**, **4 medium**, **6 low**. No critical.

**Fix ledger.** Every finding below carries a status line naming where it was fixed. Fix batch R1
(#154, `claude/fix-batch-r1-financial`) addressed all thirteen; three carry a partial or a deliberate
substitution, argued in their own status lines. This report stays the record of what was found — the
status lines say what happened to it, and nothing above them is edited after the fact.

---

## High

### H1 — A trust ledger's client attribution is caller-asserted and never checked against the matter's recorded client

**Status: fixed in #154.** `ensureMatterTrustLeaf` derives the client from `matter_party` through
`readMatterClientEntityId` (`packages/matters/src/matter-party.ts` — the one home for that derivation,
now shared with billing) and refuses `matter-has-no-client`. The caller-supplied handle was DROPPED
rather than kept as a cross-check: the field's stated justification ("a matter's Directory client link
does not exist yet") was stale, and a field whose only possible values are "redundant" or "wrong" is
not worth the contract surface. `clientEntityId` and `toClientEntityId` are gone from
`TrustDepositRequest` and `TrustMatterTransferRequest`; `declarePendingLeaf` declares the derived
value; an existing leaf is re-checked against its matter's client on every movement
(`trust-leaf-client-mismatch`); and `trustMatterNodesMisattributedStatement` re-proves the attribution
over stored rows, so a leaf created before the fix is detectable.

**Where.** `apps/api-worker/src/http/routes/trust/trust.ts:75` (`DepositRequest.clientEntityId`), `:122`
(`MatterTransferRequest.toClientEntityId`), `:576-598` (`resolveLeafNames`) ·
`packages/trust/src/movements.ts:157-183` (`declarePendingLeaf`), `:213-274`, `:408-491` ·
`packages/trust/src/account-tree.ts:213-236` (`ensureMatterTrustLeaf`)

**What.** `ensureMatterTrustLeaf` locates an existing matter leaf by `(trust_account_id, matter_id)`
only. When no leaf exists it **creates one attributed to whatever `clientEntityId` the caller
supplied**, hangs it under that client's node, and — via `declarePendingLeaf` — declares that same
caller-asserted attribution to the composition guard as a `pendingRoles` entry. Nothing in the trust
package or its routes ever consults `matter_party` where `role = 'client'`, which is the link the
platform already treats as authoritative: `packages/billing/src/statements.ts:595-617`
(`readMatterClientEntityIds`) resolves an invoice's client exactly that way, and
`packages/billing/src/fitness.ts:37-51` re-proves it over stored rows. `resolveLeafNames` reads the
`matter` row but uses `client_entity_id` only as a display fallback for `client_display_name`; it
validates nothing. The route comment at `trust.ts:73-76` justifies the field on the grounds that "a
matter's Directory client link does not exist yet" — that is stale, the link exists and billing
depends on it.

**Failure scenario.** Client A owns matter M1 (leaf exists, `client_entity_id = A`). Client B owns
matter M2, which has never held trust money. A member holding `trust:manage` calls
`POST /api/v1/trust/matter-transfers` with `{ fromMatterId: M1, toMatterId: M2, toClientEntityId: A,
amountMinor: 500000 }`. `ensureMatterTrustLeaf` finds no leaf for M2, reuses client A's existing
client node, and creates a matter leaf carrying `client_entity_id = A, matter_id = M2`. The
composition guard resolves both lines to client A, so the one-client-per-entry rule passes, and
$5,000 of client A's money now sits on a trust ledger attached to another client's matter file. It
is readable at `GET /api/v1/trust/matters/M2/ledger`, it is disbursable from there, and it blocks
M2's close. The same shape reaches the deposit route: a deposit naming matter M2 with
`clientEntityId: A` records client B's receipt onto client A's client node.

**Why the existing controls do not catch it.** The composition guard reasons about
`trust_ledger_node.client_entity_id`, which is the value being asserted — the guard is being told
the answer it is checking. `multiClientTrustEntriesStatement`
(`packages/trust/src/fitness.ts:43-49`) counts `DISTINCT n.client_entity_id` over the same nodes, so
it sees one client and reports healthy. `trust_ledger_node_matter_unique_index` guarantees one leaf
per matter per account but says nothing about whose client it is. There is no trigger tying
`trust_ledger_node.client_entity_id` to `matter_party`.

**Fix shape.** Resolve the client from `matter_party` (`role = 'client'`, `deleted_at IS NULL`)
inside `ensureMatterTrustLeaf` rather than accepting it, and refuse when the matter has no client
party — the same refusal billing already raises (`matter-has-no-client`). If the caller-supplied
handle is kept for the transitional period, compare it to the resolved one and refuse on
disagreement. Add a fitness query proving every `kind = 'matter'` node's `client_entity_id` is a
client party of its `matter_id`, so a leaf created before the fix is detectable.

---

### H2 — The outstanding-item read silently truncates at 5,000 rows, and the truncated figures are what a close freezes

**Status: fixed in #154 — the cap half. The period-bound half is deliberately not applied.** The read
now asks for `MAX_TRUST_RECONCILIATION_ROWS + 1`, and both `computeTrustThreeWayProof` and
`readOutstandingTrustBankItems` refuse `reconciliation-outstanding-items-truncated` when the extra row
comes back — so the proof and the close cannot attest to a total drawn from a list they could not see
all of, and `composeTrustReconciliationMatch` stops refusing a genuinely outstanding entry for three
wrong reasons. The proposed lower date bound was NOT applied: an uncleared check written two years ago
is still outstanding, and bounding the read by a period start would drop exactly the stale items a
reconciliation exists to surface. The absence of a lower bound is the correct accounting, which is why
the cap has to be detected rather than moved.

**Where.** `packages/trust/src/statements.ts:552` (`MAX_TRUST_RECONCILIATION_ROWS`), `:889-900`
(`selectOutstandingTrustBankItemsStatement`) · `packages/trust/src/three-way-proof.ts:126-160` ·
`packages/trust/src/reconciliation.ts:208-219` (`closeTrustReconciliation`)

**What.** `selectOutstandingTrustBankItemsStatement` carries `LIMIT ?3`, defaulted to 5,000, with no
signal to the caller that the limit bound. `computeTrustThreeWayProof` sums whatever rows come back
into `outstandingDepositsMinor` / `outstandingDisbursementsMinor`, derives `adjustedBankMinor` from
them, decides `balanced` from that, and `closeTrustReconciliation` writes those exact numbers into
the frozen columns as the firm's attestation for the period.

The read has **no lower date bound** — it is every ledger entry touching the trust bank account from
the account's first day to the period end that no binding match ties to a statement line. A firm
that has not reconciled before (the ordinary case the moment this ships) accumulates every trust
entry it has ever posted in that list, and items whose match belonged to a superseded reconciliation
come back into it. At a hundred trust movements a week a firm crosses 5,000 inside a year.

**Failure scenario.** A firm with 5,400 unmatched historical bank items opens and closes a
reconciliation. `ORDER BY e.effective_date, e.id LIMIT 5000` drops the 400 newest. The proof's
outstanding totals are short by their net, `adjustedBankMinor` is wrong by the same amount,
`frozen_unmatched_movement_count` is capped at 5,000, and the frozen row records a difference figure
that is not the real difference. The `trustReconciliationsWithIncoherentProofStatement` fitness query
(`packages/trust/src/fitness.ts:141-149`) still passes, because the frozen numbers are internally
consistent — they are consistently derived from a truncated set. The comment at
`statements.ts:549-552` claims the cap makes a runaway period "truncate to an obviously-short
answer"; it does not, it truncates to a confidently-wrong one.

`selectUnmatchedTrustBankStatementLinesStatement` shares the cap but is safe today, because
`MAX_TRUST_BANK_STATEMENT_LINES` is 2,000. The same truncation also makes
`composeTrustReconciliationMatch` (`packages/trust/src/matching.ts:287-293`) refuse a genuinely
outstanding entry with `entry-is-not-a-bank-item` and a message listing three reasons, none of which
is the real one.

**Fix shape.** Make the cap detectable rather than silent: select `limit + 1`, and when the extra row
comes back refuse the proof (and the close) by name — a reconciliation that cannot see all of its
outstanding items must not attest to a total. Separately, bound the read by a period start (the
statement's `period_start`, or the previous closed reconciliation's period end) so the list is a
period's items rather than the account's whole history.

---

### H3 — `LedgerValidationError` is mapped nowhere: ordinary bad input on a money route returns 500

**Status: fixed in #154.** All three commit helpers map it, through one shared
`problemResponseForLedgerRefusal` (`apps/api-worker/src/http/ledger-refusal-problems.ts`) so the three cannot
drift: `unknown-account` to 404, everything else to 422 under a new `ledger-entry-refused` problem
type. And, as the finding suggests, the three civil-date route schemas now refine on
`isValidCalendarDate`, so a date that is not a day is refused at the request shape and never reaches a
composer.

**Where.** `packages/ledger/src/validate.ts:8-38` (the error and its codes) ·
`apps/api-worker/src/http/routes/trust/trust.ts:690-693` · `apps/api-worker/src/http/routes/billing/billing.ts:695-699` ·
`apps/api-worker/src/http/routes/trust/trust-reconciliation.ts:861-864`

**What.** All three financial route modules catch exactly one error class each —
`TrustValidationError` or `BillingValidationError` — and rethrow everything else.
`LedgerValidationError` is thrown by `validateEntry` on every entry composed through
`postEntry`/`composeTrustEntry` and is caught nowhere in `apps/api-worker/` or in either domain package
(verified by search). Every one of its codes therefore escapes to the `app.onError` boundary and
becomes the RFC 9457 500 with an Error ID.

**Failure scenario.** `POST /api/v1/trust/deposits` with `effectiveDate` set to tomorrow. The route's
`civilDate` schema (`trust.ts:66`) is a bare `^\d{4}-\d{2}-\d{2}$` regex; nothing in
`composeTrustDeposit` checks the date. `validateEntry` raises
`LedgerValidationError("future-effective-date")`, which is not a `TrustValidationError`, so
`commitTrustWrite` rethrows and the member gets a 500 for typing next week's date. Same for
`2026-02-30` (`invalid-effective-date`, the regex passes and `isValidCalendarDate` does not), and
same on `POST /api/v1/billing/invoices/{id}/finalization` with a future or malformed `issueDate`.
The route contracts declare a 422 for "the trust rules refuse this movement" and it is never the
status these produce.

**Fix shape.** Map `LedgerValidationError` at each of the three commit helpers, code-by-code as the
existing helpers do (`future-effective-date`/`invalid-effective-date`/`non-positive-amount`/
`currency-mismatch` → 422; `unknown-account` → 404). Better still: validate the effective date at the
route schema (a real calendar date, not after today in UTC), so the common cases never reach the
ledger. A conformance assertion that every money route's declared statuses are actually reachable
would have caught this.

---

## Medium

### M1 — `IllegalTransitionError` leaks out of `finalizeInvoice` as a 500 whenever the firm's review gate is on

**Status: fixed in #154.** The claim loop catches it and rethrows
`BillingValidationError("work-in-progress-not-billable")` naming the entry and the state it is in —
the same vocabulary timekeeping and costs use at their own boundaries.

**Where.** `packages/billing/src/finalize.ts:316` · `apps/api-worker/src/http/routes/billing/billing.ts:695-699` ·
`packages/billing-core/src/lifecycle.ts:13-17`

**What.** `finalizeInvoice` calls `assertTransition(fromStatus, "billed", approvalRequired)` without
a `try`. `packages/billing-core/CLAUDE.md` states the contract plainly: "Do not leak
`IllegalTransitionError` to an HTTP boundary directly" — each consumer catches it and rethrows its
own domain error. Billing does not.

**Failure scenario.** A firm turns on `billing.approval_required`. A draft invoice claims a time
entry still in `draft` — legal, because `timeEntryToClaimable`
(`packages/billing/src/draft.ts:154-168`) refuses only `billed` and `void`, deliberately, so bill
review can happen before approval. At finalize, `GATE_ON_TRANSITIONS.get("draft")` is `{submitted}`,
so `canTransition("draft", "billed", true)` is false and `IllegalTransitionError` is thrown. It is
not a `BillingValidationError`, so `runBillingEffect` rethrows and the member gets a 500 instead of
"this entry has not been through review yet". Every gate-on firm hits this the first time it bills
unapproved work.

**Fix shape.** Catch `IllegalTransitionError` in the claim loop and rethrow a
`BillingValidationError("work-in-progress-not-billable", …)` naming the entry and the state it is in
— the vocabulary timekeeping and costs already use at their own 409 boundaries.

### M2 — Finalization composes a ledger line from a negative role subtotal with the direction hard-coded to `credit`

**Status: fixed in #154.** The direction is chosen from the sign and the line carries the magnitude —
a negative role subtotal is a debit. The receivable leg needs no branch, because `totalMinor` is
already proved strictly positive above it. The second manifestation is refused by name:
`invoice-matter-total-negative` names the matter that nets negative, ahead of the balance CHECK that
would otherwise abort the whole batch on a column name.

**Where.** `packages/billing/src/finalize.ts:269-297` (the credit-line loop and the posting),
`:353-364` (the per-matter balance rows) · `apps/api-worker/src/http/routes/billing/billing.ts:99`
(`amountMinor: z.number().int().optional()`) · `packages/billing/src/draft.ts:431-472`
(`updateDraftLine`)

**What.** A negative invoice line is a first-class shape here: `invoice_line.amount_minor` carries no
positivity CHECK, `updateDraftLine` accepts any integer with no sign guard, the route schema is a
bare `z.number().int()`, `roundInvoiceLine` is half-away-from-zero **specifically** so a negative
line rounds symmetrically (`packages/money/src/rounding.ts:21-26`), and `postingRoleForLine` has
explicit arms for `discount` and `adjustment` pointing at the `fee_adjustments` account role. But
finalize buckets lines by role, aggregates each bucket, and emits every non-zero bucket as
`direction: "credit"` with `money(roleTotalMinor, …)`. It never inspects the sign.

**Failure scenario.** A draft carries a $100 fee line and a $30 cost line; during bill review the
cost line is written down to `-3000` (a courtesy credit for a wrongly-billed disbursement). Finalize
computes `totalMinor = 7000` — positive, so the total guard passes — then builds a credit line of
`money(-3000)` for `cost_recovery_income`. `validateEntry` refuses with `non-positive-amount`, which
per **H3** is an unmapped 500. The second manifestation is the per-matter balance: a multi-matter
bill whose net is positive but whose subtotal on one matter is negative inserts an
`invoice_matter_balance` row with `total_minor < 0`, and
`invoice_matter_balance_bounds_check (applied_minor >= 0 AND applied_minor <= total_minor)` aborts
the whole batch as a raw constraint error — also a 500.

**Fix shape.** Choose the direction from the sign: a negative role subtotal is a `debit` of its
magnitude, a positive one a `credit` (and mirror the same rule for the accounts-receivable leg). Then
refuse a negative per-matter subtotal by name in `finalizeInvoice`, before the balance CHECK gets to
abort the batch, so a firm is told which matter nets negative. If negative lines are meant to be out
of scope until the credit-note slice, refuse them at `updateDraftLine` instead — but the rounding
helper and the posting-role arms both say they are not.

### M3 — The accounts-receivable aging report is an unbounded whole-table read with a correlated subquery per row

**Status: fixed in #154.** One `GROUP BY` over a `CASE` on `julianday(?asOfDate) - julianday(due_date)`,
joined to a pre-aggregated `invoice_matter_balance` sum, with the `unpaid > 0` predicate applied
inside the database. Five rows come back; a paid invoice is never carried out of D1 at all.

**Where.** `packages/billing/src/queries.ts:268-303` · `apps/api-worker/src/http/routes/billing/billing.ts:970-979`

**What.** `readAccountsReceivableAging` selects **every** `status = 'final'` invoice in the firm with
no `LIMIT`, no cursor, and no page, evaluates
`(SELECT SUM(total_minor - applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id)`
once per returned row, streams the whole result set into the Worker, and buckets it in JavaScript —
discarding rows with `unpaid_minor <= 0` only after they have been fetched. This runs synchronously
in a request handler, which golden rule 10 forbids ("no heavy work in a request handler; stream,
don't buffer; no N+1").

**Failure scenario.** A firm three years in with 40,000 finalized invoices, most of them fully paid.
Every call to `GET /api/v1/billing/aging` reads all 40,000 rows plus 40,000 correlated aggregate
subqueries and buffers them, to produce five integers. There is no ceiling at which it degrades
gracefully — it just gets slower until the request times out, and the report is on a dashboard.

**Fix shape.** Do the bucketing in SQL: one `GROUP BY` over a bucket expression derived from
`julianday(?asOfDate) - julianday(due_date)`, joined to a pre-aggregated
`invoice_matter_balance` sum, with the `unpaid > 0` predicate applied in the `HAVING`. Five rows come
back instead of forty thousand. `invoice_status_due_date_index` already leads with the status.

### M4 — `numberScopeKey` is unvalidated free text, so a typo silently mints a second invoice sequence

**Status: fixed in #154, by the report's "at minimum" shape rather than by binding to `location`.** A
scope key with no counter row is refused (`unknown-number-scope`) unless the request passes
`createNumberScope`. Binding to `location` handles was considered and rejected: `renderInvoiceNumber`
prefixes the rendered number with the scope key, so a location identifier would put
`location_01ABC-00001` on a remittance advice. The key is never normalized either — folding `nyc` into
`NYC` would merge two sequences a firm may have meant to keep apart, which is the same silent decision
in the other direction.

**Where.** `apps/api-worker/src/http/routes/billing/billing.ts:112` (`numberScopeKey: z.string().optional()`) ·
`packages/billing/src/finalize.ts:321-335` · `packages/billing/src/numbering.ts:16-29`

**What.** The scope key selects which counter a finalize draws from. It is taken verbatim from the
request body, is not bound to a `location` row, is not checked against previously used scopes, and
is not normalized. `ensureCounterRowStatement` creates a counter for any string it has never seen,
starting at `INVOICE_NUMBER_START_VALUE`.

**Failure scenario.** A firm issuing on two letterheads passes `"NYC"`. Someone's client sends
`"nyc"` on one request. A brand-new counter appears and the next bill out the door is numbered
`nyc-00001` — a fresh sequence, while `NYC-00042` was the real next number. `invoice_number_unique_index`
does not object (the rendered strings differ), and `invoiceNumberSequenceGapsStatement`
(`packages/billing/src/fitness.ts:105-115`) reports the new scope as a perfectly gapless sequence of
one. Gaplessness is the property an auditor asks about, and it has just been redefined per typo.

**Fix shape.** Validate the scope key against the firm's `location` handles (or an explicit
registered-scope table) and refuse an unknown one; the route already accepts `locationId` elsewhere,
so the same identifier can serve. At minimum, refuse a scope key that has no counter row unless the
request opts in explicitly.

---

## Low

### L1 — Non-existent calendar dates pass every date check on the reconciliation and aging paths

**Status: fixed in #154.** `parseCivilDate` ends every branch at `isValidCalendarDate`, and the
trust, reconciliation, and billing route schemas refine on it. `daysPastDue` is gone with the aging
rewrite (M3), which computes the day difference in SQL from a route-validated as-of date.

`packages/trust/src/statement-import.ts:157-171` (`parseCivilDate`) accepts month 1-12 and day 1-31
with no rollover check, and the ISO branch is a bare regex; `apps/api-worker/src/http/routes/billing/billing.ts:66`
and `apps/api-worker/src/http/routes/trust/trust.ts:66` use the same regex. `composeTrustBankStatement`
(`packages/trust/src/bank-statements.ts:239-244`) only compares `postedOn` lexically to the period
bounds, so `2026-02-31` inside a January-to-March period is stored. `dayGapBetween`
(`packages/trust/src/matching.ts:64-69`) then gets `NaN` from `Date.parse` and returns `Infinity`, so
that line is never offered a candidate and sits unmatched forever with no explanation. On the aging
side, `daysPastDue` (`packages/billing/src/queries.ts:261-266`) returns `NaN` for an unparseable
`asOfDate`, every comparison in the bucket ladder is false, and the whole receivable is silently
reported as "90+". Fix: reuse `isValidCalendarDate` from `packages/ledger/src/validate.ts:55-59` at
every civil-date boundary, including the two route schemas.

### L2 — Statement-import preview parses an unbounded file body on the request path

**Status: fixed in #154.** Both `fileText` fields are capped at the schema, and the row ceiling is
applied as rows are built rather than after the whole file has been materialized.

`apps/api-worker/src/http/routes/trust/trust-reconciliation.ts:146` and `:195` declare `fileText: z.string().min(1)`
with no maximum. `previewTrustStatementImport`
(`packages/trust/src/statement-import.ts:303-383`) parses the whole file character-by-character and
materializes every row **before** the `MAX_TRUST_BANK_STATEMENT_LINES` ceiling is applied at `:361`.
A 40 MB CSV is fully parsed and mapped in the handler before it is refused for having too many rows.
Fix: cap `fileText` at the schema (a 2,000-line statement is well under a megabyte) and stop parsing
once the row ceiling is exceeded.

### L3 — An expired direct grant permanently disables the sole-manager exception

**Status: fixed in #154 — the naming half. The revocation half needs schema.** The over-count is kept
(the report is right that it is the safe direction), and the refusal now NAMES the members it counted,
so a firm can find the lapsed grant speaking for somebody who left. Giving the grant table a
revocation distinct from an expiry is a migration, and this batch adds none.

`packages/trust/src/statements.ts:543-547` and the matching trigger at
`packages/database/drizzle/per-firm/20260908T000000_baseline.sql:94-110`
count `direct_grant` rows for `trust:manage` regardless of `expires_at`, while
`effectivePermissions` (`packages/access-control/src/resolver.ts:28-31`) excludes expired ones. The
migration comment names this deliberately ("over-counting authorizers refuses the exception, which is
the safe direction"), and the direction is right — but the consequence is unbounded in time: a
one-person firm that once direct-granted `trust:manage` to a contractor whose grant lapsed a year ago
can never use the exception again and cannot pay client money out at all, with a refusal that says
the firm "has more than one member who can authorize". Fix: keep the over-count, but make the
refusal name the counted members so the firm can see the stale grant, and give the grant table a way
to be revoked rather than only expired.

### L4 — `composeTrustToOperatingTransfer` never compares the amount's currency to the trust account's

**Status: fixed in #154.** It calls `assertMovementCurrency`, now exported from `movements.ts`.

`packages/trust/src/transfer.ts:97-117` reads `currencyCode(input.amount)`, stores it on the transfer
row, and compares `amountMinor` to `available.availableMinor` — which is denominated in the account's
currency — without ever asserting the two match. Every sibling composer routes through
`assertMovementCurrency` (`packages/trust/src/movements.ts:116-125`) for exactly this. The mismatch
is eventually caught by the ledger's per-line currency check, which per **H3** surfaces as a 500
rather than the named `movement-currency-mismatch`, and the availability pre-check compares minor
units across currencies in the meantime. Latent today (no route reaches this composer, and the
default `EarnedFeePrecondition` refuses), which is why it is low — but it is the one money composer
in the package missing the guard. Fix: call `assertMovementCurrency`.

### L5 — The match-withdrawal route's `{reconciliationId}` path segment is not enforced

**Status: fixed in #154.** `composeTrustReconciliationUnmatch` takes the reconciliation the caller
named and refuses `match-belongs-to-another-reconciliation` when the match belongs to a different one.

`apps/api-worker/src/http/routes/trust/trust-reconciliation.ts:1148-1165` reads `matchId` from the path and ignores
`reconciliationId`; `composeTrustReconciliationUnmatch`
(`packages/trust/src/matching.ts:324-342`) resolves the reconciliation from the match row. So
`POST /reconciliations/{anyId}/matches/{matchId}/withdrawal` succeeds regardless of what the first
segment says. Not a privilege boundary — both are firm-scoped behind the same `trust:manage` — but
the URL asserts a containment the handler does not check, which is how a client-side bug becomes a
withdrawal on the wrong period with a 201 in reply. Fix: refuse when the match's `reconciliationId`
differs from the path's.

### L6 — Claiming work onto a draft never compares the entry's currency to the invoice's

**Status: fixed in #154.** `addClaimsToDraft` refuses `invoice-line-currency-mismatch` by name.

`packages/billing/src/draft.ts:310-373` writes `entry.currency` onto each invoice line without
comparing it to `invoice.currency`, and `finalizeInvoice`
(`packages/billing/src/finalize.ts:232-235`, `:271`) then aggregates every line under the **invoice's**
currency via `aggregateMinor` (`packages/billing/src/line-amounts.ts:32-36`) — re-labelling any line
that disagreed rather than refusing it. Unreachable today only because `time_entry_currency_check`
and `cost_entry_currency_check` pin both stores to USD and the route schemas are `z.literal("USD")`;
the guard is the schema, not the code, and the first non-USD currency added to the registry removes
it silently. Fix: refuse a claim whose entry currency differs from the invoice's, by name.

---

## Areas read, nothing found

Recorded so the coverage is auditable — these were examined for the defect classes in scope and came
back clean.

- **The composition guard** (`packages/trust/src/composition-guard.ts`). All five structural refusals
  and their ordering; the client-to-client check placed ahead of the shape checks so the refusal names
  the real problem; the "a stored role always wins over a declared one" rule at `:238-240`, which
  correctly fills only `outside` slots and so cannot be talked out of what the database says. No
  composition of `pendingRoles` lets a caller invent a role for an account the read already resolved.
  (The attribution problem in **H1** is upstream of this file, in what the guard is told about a row
  being created in the same batch.)
- **Ledger exactness** (`packages/ledger/src/validate.ts`, `post-entry.ts`). The
  `MAX_ENTRY_MAGNITUDE_MINOR` argument holds: the cap is checked before each addition with both
  operands inside the safe range, and every per-account delta in `composePostedEntry` is a subset of
  the same contributions, so the plain-number aggregation is provably exact. Currency is checked
  per line against the account **and** against the entry. Chunking at `MAX_BOUND_PARAMETERS` is
  applied on both the snapshot read and the role read.
- **The money package** (`packages/money/`). The three rounding helpers and their stated modes;
  `allocate` delegating to Dinero's largest-remainder split; `fromDecimal`'s `-0` guard;
  `decimalToScaled` refusing exponential notation; `assertSafeInteger` at every minor-unit SQL
  boundary in both `packages/ledger/src/statements.ts` and `packages/trust/src/statements.ts`.
- **The two-person control, searched for a bypass.** The four triggers in
  `20260805T170000_trust-disbursement-authorization.sql` compose correctly: `approver_differs` fires
  on every non-withdrawal decision except one declaring the `sole_trust_manager` basis;
  `sole_basis_is_self` requires that basis to name the submitter; `sole_basis_requires_lone_manager`
  requires the firm to have at most one active `trust:manage` holder. The shape CHECK forces
  `authorization_basis` non-null on an approval and null on a rejection, so a rejection cannot borrow
  the exception's exemption. `selectActiveTrustManagerCountStatement` counts the same rows the trigger
  counts, by the same UNION-per-member. There is **no owner bypass** in RBAC —
  `effectivePermissions` builds only from `role_permission` and `direct_grant`, and `trust:manage` is
  seeded onto Owner/Admin, Attorney, and Billing as ordinary `role_permission` rows, so the count sees
  every member who can actually act.
- **Money-out reachability.** `composeTrustDisbursement` is called from exactly one place,
  `composeTrustDisbursementApproval`; there is no route that pays client money out in a single call.
  The only other composer that moves money out of a trust account,
  `composeTrustToOperatingTransfer`, is not routed and defaults to `refusingEarnedFeePrecondition`.
  `composeMatterToMatterTransfer` moves money only between leaves under one client node, and the
  decision/movement/posting ride one batch so the `UNIQUE(request_id)` loser rolls its ledger entry
  back with its decision.
- **Idempotency on money mutations.** Every mutating trust, reconciliation, and billing route
  declares `idempotency: "required"` with `idempotencyStore: "firm"`. The fingerprint
  (`packages/data-access/src/hono-idempotency-middleware.ts:30-37`) covers method, canonical path,
  sorted query, and body, so two approvals of different requests cannot collide on one key.
  `runIdempotentEffect` commits the record inside the business batch, which is what makes billing's
  bounded finalize retry (`apps/api-worker/src/http/routes/billing/billing.ts:844-882`) correct — a lost number draw
  rolls the record back with everything else and the retry re-executes rather than replaying.
- **The number draw** (`packages/sequence-numbering/`). The allocation composite primary key is the
  real guard and the guarded increment is correctly documented as not being one; the first-ever draw
  is race-correct (`ON CONFLICT DO NOTHING` then a guarded increment that matches zero rows for the
  loser, whose allocation then aborts); `isNumberAllocationConflict` matches both the UNIQUE shape
  and the append-only-trigger shape.
- **Holds** (`packages/trust/src/holds.ts`). Release is an appended row linked by `releases_hold_id`
  with a UNIQUE index; no status column; the active-hold predicate is written once
  (`activeTrustHoldPredicate`) and shared by the available-balance read, the close gate, and the
  fitness query, so the three cannot disagree.
- **The matter-close precondition.** `refuseMatterCloseWithTrustBalanceStatement` aims
  `kind = 'close-refused-trust-balance'` at exactly the offending leaves, and
  `trust_ledger_node_kind_check` genuinely forbids that value, so the guard can abort but can never
  store. It rides the close batch (`packages/matters/src/matter-service.ts:519-539`) alongside the
  close, its audit row, its outbox message, and its idempotency record, and the catch at `:541-549`
  re-runs the preconditions so a raced close produces an honest refusal rather than a constraint
  message.
- **Reconciliation honesty, apart from H2.** No composer takes a suggestion —
  `composeTrustReconciliationMatch` requires the caller to name both ends, and there is no overload
  that does otherwise. The proof records rather than forces: no plug figure, no rounding to
  agreement, and `closeTrustReconciliation` freezes an unbalanced answer as readily as a balanced
  one. Book and client legs are both computed from dated `ledger_line`/`ledger_entry` rows, never
  from `account_balance`. `bindingTrustReconciliationMatchPredicate` correctly excludes a superseded
  reconciliation's matches so superseding is a real remedy. The freeze triggers
  (`trust_reconciliation_no_reopen`, `trust_reconciliation_close_only`) permit exactly one update and
  pin every column that says what the reconciliation is about.
- **Append-only escape hatches.** Every evidentiary trust table carries the
  `no_update` / `no_delete` / `no_replace` trio, and the `no_replace` BEFORE INSERT guard genuinely
  closes the `INSERT OR REPLACE` hole (which bypasses BEFORE DELETE/UPDATE with
  `recursive_triggers` off). Billing's freeze triggers read `OLD.status`, so the finalizing update
  passes and everything after it aborts. Searched for a write path that reaches these tables outside
  the composers and found none.
- **Trust fitness suite** (`packages/trust/src/fitness.ts`). All eleven queries were read against the
  invariants they claim to re-prove. `trustReconciliationsWithIncoherentProofStatement` correctly
  catches a self-contradicting frozen proof in both directions (a `balanced = 1` whose legs disagree,
  and a `balanced = 0` whose legs agree). `commingledTrustEntriesStatement`'s membership relation is
  written once and reused so its two halves cannot drift.
- **Cross-firm binding.** Isolation is the per-firm database boundary, so no statement in either
  package carries a firm predicate that could be wrong. The one read that reaches outside the trust
  tables (`selectActiveTrustManagerCountStatement` over `member` / `member_role` / `role_permission` /
  `direct_grant`) is in the same per-firm database. Every write route resolves its database from
  `requireChokepointFirmContext`, never from a path or body value.
- **Route meta.** Every money mutation across the three modules declares
  `permission: trust:manage` or the matching `billing:*`, `resource: "firm"`, `audited: true`,
  `idempotency: "required"`, `idempotencyStore: "firm"`, `rateLimit: "default"`; reads declare
  `trust:read` / the billing read key with `audited: false`. The import-preview route's
  `audited: false` override is correct — it stores nothing.
- **Redaction.** No amount-plus-name pair reaches a log line from these subsystems. Trust and billing
  refusal messages do carry amounts, account handles, and user handles, but they travel only as RFC
  9457 `detail` to the member who made the request, never through `@magna-carta/telemetry`. The one
  path that logs error text — `messageHead` in `packages/telemetry/src/operation.ts:31` and the
  request-path `error.captured` event — is capped at 120 characters and passes the `scrub.ts`
  denylist. No `console.*` and no ad-hoc event exists in either package. `assertTrustFitness` does
  serialize amounts into its thrown message, but it is called only from the fixtures and load-profile
  harness, never from a Worker handler.
- **Billing concurrency.** The partial unique index on `(source_kind, source_id) WHERE released_at IS
  NULL` is the claim guard and the entry's `invoice_id` is correctly treated as a mirror;
  `refuseFinalizeOnFrozenWorkInProgressStatements` aims `'billing-refused-frozen-entry'` at a column
  whose `time_entry_status_check` / `cost_entry_status_check` genuinely forbid it (both verified in
  the baseline migration), so a concurrent void aborts the finalize batch rather than being relocked.
- **Plan quality.** No read inside a loop was found in either package: `loadClaimableEntries`,
  `readMatterClientEntityIds`, `readCostDisbursementClasses`, and `readWorkInProgressStatuses` are
  all one read per bound-parameter chunk; `computeTrustThreeWayProof` issues four parallel reads and
  nothing per row; `readTrustMatchSuggestions` issues three. `readUnbilledWorkInProgress` is served
  from the mirror column with no join, as designed. The one exception is **M3**.
