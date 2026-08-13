# Trust — bank charges and unclaimed client funds

**Date:** 2026-08-12
**Scope:** Owner flags T3 (the firm's own funds in trust, for bank charges) and T16 (unclaimed funds),
both directed by the owner. What was built, and what was deliberately left for a later slice.
**Status:** T3 built through the domain layer. T16's first slice built through the domain layer; the
remainder is section 4 below and is not started. Neither has a route or interface layer yet.
**Rules read, not invented:**
[`docs/research/2026-08-07-nevada-trust-accounting-rules.md`](../research/2026-08-07-nevada-trust-accounting-rules.md)
and
[`docs/research/2026-08-07-nevada-unclaimed-client-funds-escheat.md`](../research/2026-08-07-nevada-unclaimed-client-funds-escheat.md),
with the narrative 56-jurisdiction corpus under
[`docs/research/trust-rules/`](../research/trust-rules/) as context.

Decisions are recorded as ADRs (`trust-bank-charge-carve-out-wired-narrowly`,
`trust-unclaimed-funds-is-a-diligence-file-not-an-escheat-engine`); this document exists to name the
boundary of what shipped and to hold the deferred work in one place.

---

## 1. The bank-charge carve-out — what shipped

`packages/trust/src/firm-funds.ts`, `packages/trust/src/composition-guard.ts` (the second door),
`packages/trust/src/three-way-proof.ts` (the fourth figure), `packages/trust/src/fitness.ts` (three
re-proofs), and migration `20260812T000000_trust-firm-funds-and-unclaimed-funds`.

| Mechanism                                                                | What it makes impossible                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `trust_firm_funds_movement` has no client, matter, node, or payee column | A record of this category describing somebody else's money                        |
| `composeTrustFirmFundsEntry`                                             | An entry pairing the firm's cushion with anything but its own account's bank leaf |
| `assertTrustComposition`, unchanged                                      | A client-money entry touching the cushion                                         |
| `min_balance_minor = 0` on the cushion                                   | A bank charge larger than the firm's own funds reaching client money              |
| `trust:firmFunds`, Owner/Admin only                                      | The carve-out being exercised by whoever can keep the books                       |
| The pooled-account refusal                                               | Firm money in a pooled account the rules exempt from the charges it would pay     |
| The proof's fourth figure                                                | A cushion reading as client money, or as a `book-to-client` disagreement          |

Two movement kinds and no more: `firm_funds_deposit` and `bank_charge`. There is no kind that pays a
person — that is a disbursement.

## 2. Unclaimed funds — what shipped (first slice)

`packages/trust/src/unclaimed-funds.ts` and the three tables in the same migration.

- **The dormancy read.** Matter ledgers under one trust account still holding money and quiet since a
  date the caller states. Nothing stored, no default period, capped with truncation detected. Returns
  the earliest receipt date and the last activity date separately, because the rules' clocks run from
  receipt.
- **The diligence file.** An append-only review per dormant ledger, one open at a time, recording the
  observations it was opened on; append-only contact attempts across the channels the rule enumerates,
  each with the address or number actually used.
- **The manual-confirmation gate.** A closure names a disbursement that already posted through the
  ordinary authorized path. The closing composer receives no amount, payee, date, or method, so there
  is nothing it could build an entry from; it writes one row and emits nothing.

## 3. Open questions for the owner

Each is a place the recorded rule text does not answer the question the code would have to answer,
and where guessing would be the platform legislating.

1. **Does the firm's cushion carry a maximum?** NRPC 1.15(b) limits it to "an amount necessary for
   that purpose" — a standard applied after the fact against a known schedule of charges, not a
   number a `max_balance_minor` can hold. It ships unbounded. Should it carry a bound at all, and if
   so is the bound a per-firm setting rather than a rule value?
2. **May a firm withdraw surplus own funds from a trust account, and on what authority?** The rule
   authorizes the deposit and is silent on the withdrawal. Nothing was built, so a cushion is spent
   down by charges and cannot be taken back out. Two shapes make that bite: a firm that over-funded,
   and a firm closing the account with a cushion still in it. Is the withdrawal permitted in Nevada,
   and if so does it belong in this category or in the disbursement queue?
3. **Is the pooled-account refusal right?** SCR 217(3) exempts pooled accounts from service charges,
   so opening the carve-out on one is refused outright. Does a Nevada firm ever hold a pooled account
   that in fact bears charges the firm must cover? If so the refusal should become a warning.
4. **Does the diligence file need its own capability?** It ships under `trust:read` (the dormancy
   list) and `trust:manage` (recording the review and its attempts). A firm may want the search
   recorded by a member who cannot move money at all.
5. **Is `search_continues` the right name for an inconclusive round?** It is the outcome most reviews
   will carry, and the word appears on an evidentiary record.

## 4. Deferred to a later slice — deliberately not half-built

1. **The Clients Security Fund remittance packet.** NRPC 1.15(f)(3) requires a certification plus
   supporting documentary evidence of every locate attempt before remitting, and the State Bar
   publishes a form. That is a document-assembly problem over the evidence this slice now records,
   and the remittance is terminal — "the Clients Security Fund shall grant remitted funds and shall
   not hold funds for future recovery" — so it wants its own gate and its own owner decision rather
   than being tacked onto a closure outcome. It also needs the actual movement of money out of trust,
   which is a disbursement to a payee the platform would be naming.
2. **The jurisdiction profile's `UnclaimedFunds` shape.** It models a dormancy clock, a mandatory
   remittance, and a reclaimable destination. Nevada has none of the three: the clock runs from
   receipt, the remittance is permissive, and the Fund will not hold funds for future recovery. The
   type needs repairing before any surface computes on it, and that is `@magna-carta/trust-jurisdictions`
   work rather than this package's.
3. **The firm's NON-trust unclaimed property.** An uncashed payroll or vendor check is ordinary NRS
   120A holder property — one-to-three-year dormancy, a report before 1 November, 60-to-120-day
   notices, negative reports in empty years, seven-year retention. It is a different regime with
   different deadlines and it must not share logic or copy with the trust path; the same dollars owed
   to the same person are Clients-Security-Fund property in the trust account and NRS 120A property
   out of an operating one.
4. **Routes, OpenAPI contracts, the interface, and the user documentation.** Both features are
   domain-layer only in this stream: no route, no problem-type mapping, no telemetry metric, no
   screen. Each new route lands with its operation in the conformance not-vacuous list, its metric in
   the telemetry catalog, and its refusal codes in the trust problem-type map. The user guides land
   with the interface for the same reason nothing else does yet — a guide to a surface a firm cannot
   reach tells them the platform supports something it does not, which is the exact failure the
   research recorded when it declined to wire the carve-out on a permission alone.
5. **The contact-attempt log's personal data.** `contact_used` holds a client's address, telephone
   number, or mailbox. It needs its entry in the personal-data registry before the field reaches a
   route, an export, or a report.
6. **Multistate.** A client whose last known address is in another state may be owed treatment under
   that state's unclaimed property act, which Nevada's exemption does not bind. The research records
   this as genuinely unsettled and unresearched; nothing may be encoded for it.
