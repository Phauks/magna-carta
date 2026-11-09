# @magna-carta/trust — CLAUDE.md

**Purpose.** The trust-accounting domain module: the client-to-matter sub-ledger tree over
`@magna-carta/ledger`'s account seam, the composition guard that is the only supported way to build
an entry touching client money, disputed-funds holds and available balance, the two-linked-entry
transfer out of trust, and the fitness queries that re-prove all of it against stored data. Validates
in memory and composes statements for the caller to commit through `@magna-carta/data-access`'s
chokepoint; never runs logic mid-transaction, never calls external services, holds no D1 binding.

**White paper:** _Trust accounting_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0009, ADR-0032,
ADR-0072.) **Invariants:** [`docs/conventions/invariants.md`](../../docs/conventions/invariants.md).

## Key files / entry points

- `src/account-tree.ts` — `openTrustAccount`, `ensureMatterTrustLeaf`, `loadTrustAccount`,
  `loadTrustNode`, and `TRUST_LEAF_MINIMUM_BALANCE_MINOR` (the floor)
- `src/composition-guard.ts` — `composeTrustEntry` + `assertTrustComposition`; **the** door for client
  money — plus `composeTrustFirmFundsEntry` + `assertTrustFirmFundsComposition`, the SECOND door,
  which is narrower and admits only the firm's own bank-charge cushion beside its account's bank leaf
- `src/holds.ts` — `placeTrustHold` / `releaseTrustHold` / `readTrustAvailableBalance`
- `src/movements.ts` — `composeTrustDeposit` / `composeTrustDisbursement` /
  `composeMatterToMatterTransfer` + the `TrustDisbursementMethodPolicy` port, and
  `resolveTrustDisbursement`: the shared pre-checks a proposal and its posting both run
- `src/authorization-policy.ts` — the firm's disbursement-authorization posture: off, threshold, or
  always, plus the approver-authority option; `readCurrentTrustAuthorizationPolicy` /
  `composeTrustAuthorizationPolicyChange` / `trustAuthorizationRequiresSecondPerson` (THE predicate
  both money-out paths share) / `assertActorHoldsTrustAuthority` /
  `resolveLoneTrustManagerException` (the count-plus-membership pair, in one place) /
  `resolveTrustAuthorizationDisposition` (THE read both money-out paths choose solo-versus-route
  from, before composing anything)
- `src/disbursement-authorization.ts` — the pending request, and the one decision that settles it:
  `composeTrustDisbursementRequest` / `composeTrustDisbursementSubmission` (proposal plus, when the
  disposition says solo, the release — one batch) / `composeTrustDisbursementApproval` /
  `composeTrustDisbursementRejection` / `composeTrustDisbursementWithdrawal`, plus the shared
  approval resolution (`resolveTrustAuthorizationApproval`) and the earned-fee application's queue
  row and decision (`composeEarnedFeeApplicationAuthorizationRequest` /
  `composeEarnedFeeApplicationApprovalDecision` — billing composes the transfer and the invoice
  side)
- `src/firm-funds.ts` — the bank-charge carve-out: `openTrustFirmFundsNode` (the deliberate
  enablement, per account), `composeTrustFirmFundsDeposit` / `composeTrustBankCharge`,
  `loadTrustFirmFundsNode` / `readTrustFirmFundsPosition`
- `src/unclaimed-funds.ts` — `readDormantTrustBalances` (the read-time comparison, and the only
  definition of dormancy anywhere), the diligence file's three composers, and
  `readTrustUnclaimedFundsReview`
- `src/transfer.ts` — `composeTrustToOperatingTransfer` + the `EarnedFeePrecondition` port
- `src/jurisdiction.ts` — the resolver contract and the refusing default
- `src/close-precondition.ts` — `matterTrustClosePrecondition` + `readMatterTrustPositions`: the
  matter-close gate the app registers against the matter shell's close hook
- `src/bank-statements.ts` — the bank's own figures: `composeTrustBankStatement` plus the reads
- `src/statement-import.ts` — the guided CSV import: `previewTrustStatementImport` (reports, stores
  nothing) then `confirmTrustStatementImport` (stores, only against the previewed fingerprint)
- `src/reconciliation.ts` — `openTrustReconciliation` / `closeTrustReconciliation` (the freeze) /
  `readTrustThreeWayProof`
- `src/three-way-proof.ts` — `computeTrustThreeWayProof` plus the two reads it is derived from, which
  every other surface shares: `readOutstandingTrustBankItems` and
  `readUnmatchedTrustBankStatementLines`
- `src/matching.ts` — `suggestTrustStatementMatches` (pure, suggests only) and the two composers a
  person's confirmation goes through
- `src/fitness.ts` — re-proves the invariants over stored data
- `src/statements.ts` / `src/types.ts` / `src/trust-validation.ts`

## Invariants that apply here

- **No negative client trust balance, enforced ONLY by the database.** Every matter leaf carries
  `min_balance_minor = 0`, written by `setAccountBoundsStatement` in the same batch that creates the
  account and its balance row. The `account_balance` bounds CHECK aborts the whole posting batch on
  an overdraw. **Never add an application-level balance comparison as the guarantee** — a read-then-
  write cannot be atomic here, so a pre-check is at best a nicer error message in front of the real
  mechanism (`composeTrustToOperatingTransfer` uses one exactly that way, and says so).
- **Postings land on MATTER leaves.** Three tiers: the trust account's liability root, a client node,
  a matter leaf. The upper two are roll-ups; a roll-up's stored balance stays at zero forever, so a
  client-side total is a `SUM` over descendant leaves and is **never** read from a parent row.
- **A client ledger's attribution is DERIVED, never accepted.** `ensureMatterTrustLeaf` resolves whose
  money a matter leaf holds from the matter's own client party (`readMatterClientEntityId` in
  `@magna-carta/matters/matter-party` — the same link billing resolves an invoice's client through),
  and refuses `matter-has-no-client` when the matter has none. A caller-supplied client handle is not
  an input here: it is the answer to the question the whole sub-ledger tree exists to ask, and a
  caller naming another client's handle beside a matter was enough to file that client's money on
  another client's matter file — the composition guard reasons about `client_entity_id`, so asserting
  it told the guard the answer it was checking. The derived value is what the node row stores, what
  `declarePendingLeaf` declares to the guard, and what an existing leaf is re-checked against on every
  movement (`trust-leaf-client-mismatch`). Re-proved over stored rows by
  `trustMatterNodesMisattributedStatement`.
- **No commingling / fees never touch trust — one rule, one place.** An entry touching a trust
  account may touch nothing outside it. That single check refuses firm money in a client ledger,
  client money in an operating account, and a processor fee netted out of a trust deposit. This
  package is the structural owner: billing's apply-funds path and the payments card rail inherit it
  by calling `composeTrustEntry`, never by rebuilding the rule.
- **THE BANK-CHARGE CARVE-OUT IS A SECOND DOOR, NEVER A RELAXED FIRST ONE.** The firm's own money may
  sit in a trust account for one purpose — bearing the institution's service charges — and
  `assertTrustComposition` still refuses a firm-funds line ABSOLUTELY. The carve-out lives in
  `assertTrustFirmFundsComposition`, which admits strictly fewer shapes than the general door:
  exactly two lines, the named firm-funds node and that same account's bank leaf, nothing else. A
  flag on the general door would have put the exception inside the function billing and payments
  inherit no-commingling from, leaving every future caller one boolean away from moving client money
  on a firm-funds entry. Four further mechanisms carry the same weight and none of them is a comment:
  `trust_firm_funds_movement` has **no client, matter, node, or payee column**, so a record of the
  category cannot describe somebody else's money; the firm-funds node carries the same
  `min_balance_minor = 0` a matter leaf carries, which is how "a charge is never borne by client
  funds" becomes a database guarantee (a charge over the cushion aborts the batch, and the named
  pre-check in front of it is only a better sentence); `trust:firmFunds` is a capability of its own,
  seeded to Admin alone; and opening the carve-out is refused on a pooled interest-bearing
  account, which the corpus records as exempt from the charges it would pay. There is deliberately no
  movement in the category that pays a person, and none that withdraws surplus firm funds — the rule
  text authorizes the deposit and is silent on taking it back out.
- **The firm's cushion is its OWN leg of the three-way proof.** `book = client + firm funds`. Folding
  it into the client total would tie out while asserting that firm money is client money; leaving it
  out of the comparison would report `book-to-client` on every account that enabled the carve-out,
  poisoning the one signal that means something reached the ledger without going through the guard.
  The client-leg statement is therefore restricted to `kind = 'matter'` — that predicate is
  load-bearing, not tidiness.
- **One client per entry.** Client-to-client movement is unrepresentable; two matters of the same
  client are fine.
- **Append-only around the ledger too.** `trust_hold`, `trust_transfer`, `trust_movement`,
  `trust_disbursement_request`, `trust_disbursement_decision`, `trust_bank_statement`,
  `trust_bank_statement_line`, `trust_reconciliation`, `trust_reconciliation_match`,
  `trust_firm_funds_movement`, `trust_unclaimed_funds_review`,
  `trust_unclaimed_funds_contact_attempt`, and `trust_unclaimed_funds_review_closure` carry
  RAISE(ABORT) triggers (a reconciliation takes exactly one update — its close). A
  release is a new row linked by `releases_hold_id` (UNIQUE, so a double release loses at commit); a
  partial release is a release plus a new, smaller hold. A movement correction is a reversing entry
  with its own movement row. Never add a status column.
- **Available, not balance, is the disbursement ceiling.** `available = balance - active holds`.
- **A matter does not close over client money.** A non-zero matter-leaf balance, or an active hold on
  one, refuses the close outright — no override, and the refusal names the balance, the account, and
  the movements that clear it. The refusal is proven at commit as well as read before it:
  `refuseMatterCloseWithTrustBalanceStatement` rides the close batch and aims a `kind` the table's
  CHECK forbids at exactly the leaves that still hold money, so it matches nothing when the ledger is
  clear and aborts the whole close when a deposit landed in the meantime. A guard here must never be
  able to store a row — that is what makes it a guard rather than a write.
- **A movement records who authorized it.** Money leaving a client ledger — a disbursement or a
  matter-to-matter reallocation — carries `authorized_by`, enforced by the `trust_movement` shape
  CHECK rather than by the composer remembering. A movement also carries its method as a VALUE
  (never buried in a description), because a jurisdiction rule cannot forbid a payment method the
  engine cannot see.
- **Whether money out takes two people is the FIRM'S POLICY, and the request keeps the version it
  was submitted under.** `trust_authorization_policy` is append-only and densely versioned. Two
  distinct facts about the default, deliberately kept apart: **no row** means always-two-person with
  no authority requirement — that is what a NULL stamp resolves to, forever, because it describes
  the requests decided before any posture existed — while **every per-firm database is seeded** with
  version 1 (`off` plus the authority requirement) by
  `20260808T020000_trust-authority-default-posture.sql`, conditionally on the table being empty so a
  firm that already chose a posture keeps it. Every new request and transfer stamps the current
  version; every decision trigger and the approval resolution read the STAMP, never the latest row —
  an in-flight request is governed by the rules it was proposed under, in both directions. The
  stamp-is-current triggers are what stop a caller reviving a superseded posture.
- **AUTHORITY IS A PROPERTY OF THE PERSON, and the check is always about the ACTOR.** With
  `require_authorized_approver` set, the amount-only exemption becomes actor-conditional: an amount
  no second person is required for can still only be released by a holder, and a non-holder's
  self-decision is refused, leaving the request pending for one. Every authority or lone-holder
  check therefore asks whether **this actor is in the counted set** — never whether the set is
  non-empty, and never whether the firm has exactly one holder without also asking whether the actor
  IS that holder. A count without the membership half let a member holding only `billing:apply`
  borrow a lone manager's exception and release money alone. `resolveLoneTrustManagerException` is
  the one place the pair is written, and both triggers hold the same pair.
- **The disposition is a READ IN FRONT of the guarantees, never a substitute for them.**
  `resolveTrustAuthorizationDisposition` answers "may this member release this amount alone, on what
  footing, and if not who can" before anything is composed, so an ordinary outcome (a member without
  authority raising a payment for somebody else) does not have to wear the face of a refusal. It
  calls the shared predicate and the same membership reads the triggers count — it is not a fifth
  mirror — and every path out of it is a refusal, a route, or an answer the composers and triggers
  would independently accept. A composer that moves money must never become one that writes a queue
  row: the routing arm lives one level up, in the caller.
- **A gated disbursement takes two people, and the second one is the database's business.** A
  payment out of a client ledger is a pending `trust_disbursement_request` until a
  `trust_disbursement_decision` approves it; the movement is composed at that moment through the
  ordinary `composeTrustDisbursement`, in the approver's context, so the available-balance ceiling
  is re-read against the ledger as it stands THEN. Never fork the posting path for an approval. The
  approver-differs rule, the withdrawal-by-the-submitter rule, the exactness of every authorization
  basis against the stamped policy (`second_person` / `sole_trust_manager` / `policy_exempt`), and
  the approver-authority requirement (`trust:authorize`) are all triggers on the decision insert — a
  route is one code path among several that will reach this table, and a control that lives in one
  of them protects only that one. `recorded_by` is the submitter and `authorized_by` is the
  approver; that is what the two columns are for.
- **The earned-fee application rides the SAME queue and the same policy.** An application is a
  `trust_disbursement_request` with kind `earned_fee_application`; billing keeps its invoice lines
  beside it (`invoice_trust_application_line`) and composes the transfer at approval through
  `composeTrustToOperatingTransfer`, which runs the same predicate against the same policy rows and
  stamps the transfer with the request's policy version. Rejection and withdrawal are kind-agnostic.
- **Pending is derived, settled is one row.** A request no decision names is pending; `UNIQUE` on
  `request_id` is what makes two concurrent approvals produce one payment, because the decision and
  the posting ride ONE batch and the loser's ledger entry rolls back with its decision. No status
  column on either table, on the same reasoning that keeps one off `trust_hold`.
- **Every movement resolves a jurisdiction or refuses.** A trust account whose office recorded none
  cannot be told which rules govern it, so movements refuse with `jurisdiction-not-recorded` — a
  different refusal from `jurisdiction-not-encoded`, and never a fallback.
- **Jurisdiction facts refuse rather than fall back, in four distinguishable ways.** A null
  `trust_account.jurisdiction` (`jurisdiction-not-recorded`), a jurisdiction nobody researched
  (`jurisdiction-not-encoded`), a jurisdiction whose rules ARE encoded but no attorney has reviewed
  (`jurisdiction-not-verified`), and a reviewed jurisdiction with one unresearched field
  (`jurisdiction-requirement-not-encoded`). Each is fixed by a different person doing a different
  thing, so they must stay different. Never introduce a default. The rules themselves are
  `@magna-carta/trust-jurisdictions`, which owns the review gate — this package owns only the
  contract and the refusing behaviour in its absence.
- **Nothing matches a bank statement line on its own.** `suggestTrustStatementMatches` ranks bounded
  candidates and returns the reasons; a `trust_reconciliation_match` row exists only because a caller
  named both ends. There is deliberately no composer that takes a suggestion — one would let a caller
  loop over the top candidate and the human confirmation would be gone with nothing in this package
  having changed. A wrong automatic match is worse than no match: the totals tie out while the ledger
  and the bank disagree about which events happened, and the reconciliation then certifies the
  discrepancy it exists to find.
- **The book side of a match is a LEDGER ENTRY, never a movement.** An earned-fee transfer out of
  trust records a `trust_transfer` and no `trust_movement` row at all, so a match keyed on movements
  could never clear one and every such transfer would sit outstanding forever. Anything that moves the
  bank balance is an entry touching the trust bank account, whatever composed it.
- **Every leg of the proof is computed from dated ledger rows, never from `account_balance`.** The
  stored balance is a live figure with no as-of, and a reconciliation is an assertion about a moment.
  Book and client agree by construction while the composition guard holds, so a `book-to-client`
  disagreement means something reached the ledger without going through it.
- **A proof is never computed from a truncated list — and BOTH of its lists carry the probe.** The
  outstanding-item read and the unmatched-statement-line read are each capped so a runaway period
  cannot pull an unbounded result set into a request handler, and each cap is DETECTED rather than
  silent: the read asks for one row past `MAX_TRUST_RECONCILIATION_ROWS`, and the proof refuses
  `reconciliation-outstanding-items-truncated` or `reconciliation-unmatched-lines-truncated` when that
  row comes back. A truncated list does not produce a short answer, it produces a confidently wrong
  one — every figure the proof derives is computed from those lists, they stay internally consistent
  with each other, and a close freezes all of them as the firm's attestation, `unmatchedLineCount`
  included. Each read carries its OWN probe: the line read was whole only because a statement is
  separately capped at `MAX_TRUST_BANK_STATEMENT_LINES`, which happens to sit lower — an arithmetic
  accident neither constant states, and one nothing would have caught if either moved. The
  outstanding read deliberately has NO lower date bound: a check written two years ago and never
  cleared is still outstanding, which is exactly what reconciliation exists to surface.
- **"Unmatched statement line" has ONE definition.**
  `selectUnmatchedTrustBankStatementLinesStatement`, reached through
  `readUnmatchedTrustBankStatementLines`, is it: the lines of the statement a reconciliation covers
  that no ACTIVE match in that reconciliation ties to a ledger entry. The proof counts them, the
  close freezes the count, and the matching surface shows a member the same list — the list a person
  works through and the list the period attests to must be one list, exactly as the outstanding-item
  list is. Deriving it a second time (subtracting the active matches from the statement's lines in
  memory, say) produces an equally plausible answer from different rows, so the day the two parted
  company nothing would say so. Note the scope difference from the outstanding read, which is
  deliberate on both sides: the line read is scoped to ONE reconciliation and therefore has no
  business with superseded periods, while the item read asks whether an item has reached any
  statement at all and so must ignore matches on a superseded reconciliation.
- **An unbalanced proof is recorded, never forced.** No plug figure, no rounding to agreement, no
  "unreconciled difference" line that absorbs the gap. The proof names WHICH leg is out and by how
  much, and `closeTrustReconciliation` freezes that answer whether or not it balanced — a close that
  refused an unbalanced period would leave firms with a year of periods open, which is the same as no
  record, and would make the platform the judge of when a firm may have a problem.
- **A close is a one-way freeze, and it writes exactly one row.** No ledger entry, no movement, no
  correction to anything the proof disagreed with — the same boundary the custody stocktake holds.
  The migration's triggers refuse every further write to a closed reconciliation, so a backdated
  reversal moves the LIVE proof and can never move the attestation. A period redone later is a new
  reconciliation naming the one it supersedes.
- **A conversion of a firm's file is previewed, confirmed, and reported — in that order.**
  `previewTrustStatementImport` touches no database and is safe to run on a file nobody has decided
  about; `confirmTrustStatementImport` re-parses the same text and refuses unless the fingerprint the
  preview returned still matches. A date format is STATED by the caller and never detected, because
  03/04/2026 is two different days on two sides of an ocean and a reconciliation built on the wrong
  one is wrong in a way nobody notices.
- **DORMANCY IS A COMPARISON, NOT A COLUMN, and nothing in the unclaimed-funds path moves money.**
  `readDormantTrustBalances` is the only definition of dormancy in the package: matter ledgers still
  holding money whose last movement is on or before a date THE CALLER STATES. No stored flag, no
  sweep, no default period — the periods differ by jurisdiction, several gate a permission rather
  than an obligation, and a platform that writes "dormant" onto a client's ledger has asserted
  something about the firm's conduct it cannot know. Same posture and same reasoning as
  `packages/calendar/src/overdue.ts`. The read returns the EARLIEST receipt still on the ledger
  alongside the last activity, because the rules' clocks run from receipt of the property and the two
  are different questions. And the closure that ends a review takes a `trust_movement` that ALREADY
  POSTED: `composeTrustUnclaimedFundsReviewClosure` receives no amount, payee, date, or method, so
  there is nothing it could assemble into an entry — the manual-confirmation gate is the absence of
  the inputs rather than a check that could be removed. A trigger independently refuses a closure
  naming a payment out of another client's ledger.
- **This is not an escheat feature.** In the researched jurisdiction, designated client trust accounts
  are exempt from the state unclaimed-property presumption outright and the one onward destination
  the rules name is permissive. Never surface a deadline, a countdown, or a "required by" date on
  this path: it would assert an obligation no rule imposes, on a record a disciplinary body may read.
- **Money discipline.** `Money` in, `toMinor` integers at the SQL boundary; no floats, no rounding.
  The one exception to "amounts are positive": a bank statement's opening and closing balances are
  signed, because a trust bank account really can be overdrawn and refusing to record that would
  refuse to record the condition reconciliation exists to catch.
- **Clock injection.** No wall-clock reads — `ClockPort` only.

## Dependencies & contracts

- Depends on `@magna-carta/ledger` (posting, account creation, bounds), `@magna-carta/data-access`,
  `@magna-carta/identifiers`, `@magna-carta/money`, and `@magna-carta/matters` — for the close hook's
  contract (types only) and for `matter-party`, the one home for "whose matter is this", which the
  client attribution is derived from and which billing reads the same way. The dependency runs THIS
  way and never the other: the matter shell knows nothing about money, and the app hands it the rule.
  Pure and synchronous: returns `EffectWrite` for the caller to commit.
- **Creation and first posting belong in ONE batch.** `ensureMatterTrustLeaf` returns an effect
  rather than committing precisely so the caller concatenates it with the posting — a trust leaf that
  exists without its floor is a leaf that can be overdrawn.
- **The chart of accounts is not ours.** `openTrustAccount` and the transfer take operating account
  ids from the caller and invent no numbering scheme; the operating general ledger designs that.
- **One read reaches outside the trust tables**: the trust-manager and authority-holder selects
  count active members holding `trust:manage` / `trust:authorize` across `member` / `member_role` /
  `role_permission` / `direct_grant`. They exist only to turn the sole-authorizer and authority
  triggers' aborts into sentences — the triggers in the migration are the guarantee, and they count
  the same rows the same way. Keep them in step, and keep `src/statements.ts` the only place trust
  reads RBAC.

## Gotchas

- D1 has no interactive transactions — read before composing, or assert inside the batch.
- **`.all()` + `results[0]`, never `.first()`** — for one spelling of "no row", not because `.first()`
  is missing. Every adapter behind the statement interface implements it, so an existing `.first()` call
  is not a bug; it just returns `null` where the rest of the platform's reads return `undefined`. Stated
  once in [`packages/data-access/src/idempotency-statements.ts`](../data-access/src/idempotency-statements.ts).
- A parent created in the same batch is not readable yet, which is why `createAccount` takes
  `pendingParents`. Do not "fix" this by splitting the tiers across batches: that reintroduces a
  window in which a half-built tree exists.
- **A new migration must be registered in `apps/api-worker/src/per-firm-migrations.ts`** as well as the
  drizzle journal — the Durable Object applies the lineage from there.
- The no-negative floor guards the firm's **book**. It cannot prevent a bank overdraft, which can
  arise from an item the firm never recorded (a bank fee, a returned deposit, a forged check).
  Reconciliation is what catches those. Never state, in the product or in user documentation, that
  the platform prevents trust overdrafts.
- **One statement line clears one entry.** A single bank line covering several recorded items — one
  deposit slip for three checks — is a real shape this does not yet express: it reads as one match
  plus items left outstanding, and the proof reports the resulting difference rather than hiding it.
  The one-to-one rule itself cannot be a UNIQUE index (a match's active state is derived from the
  absence of a withdrawal row), so it is checked in `composeTrustReconciliationMatch` and re-proved
  over stored rows by the fitness suite — the same arrangement the hold model uses.
- **A closed reconciliation's matches can never be withdrawn**, which is why the outstanding read
  ignores matches belonging to a SUPERSEDED reconciliation. Without that, a match somebody got wrong
  in a period they then closed would suppress its item from every future outstanding list forever;
  with it, superseding the reconciliation is a real remedy — the replacement re-asserts the matches
  that were right and omits the one that was not.
