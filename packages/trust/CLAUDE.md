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
- `src/composition-guard.ts` — `composeTrustEntry` + `assertTrustComposition`; **the** door
- `src/holds.ts` — `placeTrustHold` / `releaseTrustHold` / `readTrustAvailableBalance`
- `src/movements.ts` — `composeTrustDeposit` / `composeTrustDisbursement` /
  `composeMatterToMatterTransfer` + the `TrustDisbursementMethodPolicy` port, and
  `resolveTrustDisbursement`: the shared pre-checks a proposal and its posting both run
- `src/disbursement-authorization.ts` — the pending request, and the one decision that settles it:
  `composeTrustDisbursementRequest` / `composeTrustDisbursementApproval` /
  `composeTrustDisbursementRejection` / `composeTrustDisbursementWithdrawal`
- `src/transfer.ts` — `composeTrustToOperatingTransfer` + the `EarnedFeePrecondition` port
- `src/jurisdiction.ts` — the resolver contract and the refusing default
- `src/close-precondition.ts` — `matterTrustClosePrecondition` + `readMatterTrustPositions`: the
  matter-close gate the app registers against the matter shell's close hook
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
- **No commingling / fees never touch trust — one rule, one place.** An entry touching a trust
  account may touch nothing outside it. That single check refuses firm money in a client ledger,
  client money in an operating account, and a processor fee netted out of a trust deposit. This
  package is the structural owner: billing's apply-funds path and the payments card rail inherit it
  by calling `composeTrustEntry`, never by rebuilding the rule.
- **One client per entry.** Client-to-client movement is unrepresentable; two matters of the same
  client are fine.
- **Append-only around the ledger too.** `trust_hold`, `trust_transfer`, `trust_movement`,
  `trust_disbursement_request`, and `trust_disbursement_decision` carry RAISE(ABORT) triggers. A
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
- **A disbursement takes two people, and the second one is the database's business.** A payment out
  of a client ledger is a pending `trust_disbursement_request` until a `trust_disbursement_decision`
  approves it; the movement is composed at that moment through the ordinary
  `composeTrustDisbursement`, in the approver's context, so the available-balance ceiling is re-read
  against the ledger as it stands THEN. Never fork the posting path for an approval. The
  approver-differs rule, the withdrawal-by-the-submitter rule, and the availability of the
  `sole_trust_manager` basis are all triggers on the decision insert — a route is one code path
  among several that will reach this table, and a control that lives in one of them protects only
  that one. `recorded_by` is the submitter and `authorized_by` is the approver; that is what the two
  columns are for.
- **Pending is derived, settled is one row.** A request no decision names is pending; `UNIQUE` on
  `request_id` is what makes two concurrent approvals produce one payment, because the decision and
  the posting ride ONE batch and the loser's ledger entry rolls back with its decision. No status
  column on either table, on the same reasoning that keeps one off `trust_hold`.
- **Every movement resolves a jurisdiction or refuses.** A trust account whose office recorded none
  cannot be told which rules govern it, so movements refuse with `jurisdiction-not-recorded` — a
  different refusal from `jurisdiction-not-encoded`, and never a fallback.
- **Jurisdiction facts refuse rather than fall back.** A null `trust_account.jurisdiction` and an
  unencoded jurisdiction are different refusals (`jurisdiction-not-recorded` vs
  `jurisdiction-not-encoded`) and must stay different. Never introduce a default.
- **Money discipline.** `Money` in, `toMinor` integers at the SQL boundary; no floats, no rounding.
- **Clock injection.** No wall-clock reads — `ClockPort` only.

## Dependencies & contracts

- Depends on `@magna-carta/ledger` (posting, account creation, bounds), `@magna-carta/data-access`,
  `@magna-carta/identifiers`, `@magna-carta/money`, and — for the close hook's contract, types only —
  `@magna-carta/matters`. The dependency runs THIS way and never the other: the matter shell knows
  nothing about money, and the app hands it the rule. Pure and synchronous: returns `EffectWrite` for
  the caller to commit.
- **Creation and first posting belong in ONE batch.** `ensureMatterTrustLeaf` returns an effect
  rather than committing precisely so the caller concatenates it with the posting — a trust leaf that
  exists without its floor is a leaf that can be overdrawn.
- **The chart of accounts is not ours.** `openTrustAccount` and the transfer take operating account
  ids from the caller and invent no numbering scheme; the operating general ledger designs that.
- **One read reaches outside the trust tables**: `selectActiveTrustManagerCountStatement` counts
  active members holding `trust:manage` across `member` / `member_role` / `role_permission` /
  `direct_grant`. It exists only to turn the sole-authorizer trigger's abort into a sentence — the
  trigger in the migration is the guarantee, and it counts the same rows the same way. Keep the two
  in step, and keep this the only place trust reads RBAC.

## Gotchas

- D1 has no interactive transactions — read before composing, or assert inside the batch.
- **`.all()` + `results[0]`, never `.first()`** — the node-sqlite test adapter has no `.first()`.
- A parent created in the same batch is not readable yet, which is why `createAccount` takes
  `pendingParents`. Do not "fix" this by splitting the tiers across batches: that reintroduces a
  window in which a half-built tree exists.
- **A new migration must be registered in `apps/worker/src/per-firm-migrations.ts`** as well as the
  drizzle journal — the Durable Object applies the lineage from there.
- The no-negative floor guards the firm's **book**. It cannot prevent a bank overdraft, which can
  arise from an item the firm never recorded (a bank fee, a returned deposit, a forged check).
  Reconciliation is what catches those. Never state, in the product or in user documentation, that
  the platform prevents trust overdrafts.
