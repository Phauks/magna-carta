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
  `composeMatterToMatterTransfer` + the `TrustDisbursementMethodPolicy` port
- `src/transfer.ts` — `composeTrustToOperatingTransfer` + the `EarnedFeePrecondition` port
- `src/jurisdiction.ts` — the resolver contract and the refusing default
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
- **Append-only around the ledger too.** `trust_hold`, `trust_transfer`, and `trust_movement` carry
  RAISE(ABORT) triggers. A release is a new row linked by `releases_hold_id` (UNIQUE, so a double
  release loses at commit); a partial release is a release plus a new, smaller hold. A movement
  correction is a reversing entry with its own movement row. Never add a status column.
- **Available, not balance, is the disbursement ceiling.** `available = balance - active holds`.
- **A movement records who authorized it.** Money leaving a client ledger — a disbursement or a
  matter-to-matter reallocation — carries `authorized_by`, enforced by the `trust_movement` shape
  CHECK rather than by the composer remembering. A movement also carries its method as a VALUE
  (never buried in a description), because a jurisdiction rule cannot forbid a payment method the
  engine cannot see.
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
  `@magna-carta/identifiers`, `@magna-carta/money`. Pure and synchronous: returns `EffectWrite` for
  the caller to commit.
- **Creation and first posting belong in ONE batch.** `ensureMatterTrustLeaf` returns an effect
  rather than committing precisely so the caller concatenates it with the posting — a trust leaf that
  exists without its floor is a leaf that can be overdrawn.
- **The chart of accounts is not ours.** `openTrustAccount` and the transfer take operating account
  ids from the caller and invent no numbering scheme; the operating general ledger designs that.

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
