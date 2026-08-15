# @magna-carta/trust-jurisdictions — CLAUDE.md

**Purpose.** Compiled trust-accounting reference data: what one jurisdiction's rules require, with
the citation and verbatim quote that prove it, plus the resolver that turns a profile into an answer
or into a refusal that names what is missing. Holds no per-firm state, reads no database, and knows
nothing about ledgers — it answers "what does Nevada require", never "what does this firm owe".

**Invariants:** [`docs/conventions/invariants.md`](../../docs/conventions/invariants.md). The trust
domain that consumes this is [`packages/trust/CLAUDE.md`](../trust/CLAUDE.md).

## Key files / entry points

- `src/types.ts` — the contract: `TypedField<T>` (the discriminant that makes a wrong claim
  unrepresentable), `Provenance`, `AttorneyReview`, `JurisdictionProfile`, `REQUIREMENT_BUCKETS`
- `src/data/nevada.ts` — the Nevada profile. Every value carries its citation, verbatim quote,
  source tier, and the rule's own last-amendment date
- `src/registry.ts` — `findJurisdictionProfile` / `encodedJurisdictionCodes`. One entry
- `src/resolve.ts` — `resolveJurisdictionRequirement` (the gate and the bucket asymmetry),
  `describeJurisdiction` (the read that never throws), `isReviewCurrent`
- `src/port.ts` — `encodedTrustJurisdictions`, the adapter satisfying the trust domain's seam

## Invariants that apply here

- **Encoded is not reviewed, and nothing resolves until it is.** A profile whose `attorneyReview` is
  null refuses every requirement with `jurisdiction-not-verified`. Nevada ships **NOT REVIEWED**, and
  filling that field in to make something pass is the one change nobody may make casually — it is an
  attestation by a named person on a stated date, not a flag.
- **A review covers the revision it was performed against.** `AttorneyReview.profileRevision` must
  equal `JurisdictionProfile.revision` or the gate stays shut. Amending a value means bumping the
  revision, which re-closes the gate — a review of superseded text is not a review.
- **Four refusals, and they must stay distinct.** `jurisdiction-not-recorded` (no state on the
  account, raised in the trust domain), `jurisdiction-not-encoded` (nobody researched it),
  `jurisdiction-not-verified` (encoded, unreviewed), `jurisdiction-requirement-not-encoded` (reviewed
  jurisdiction, unresearched field). Each is fixed by a different person doing a different thing.
- **A silence and an absence of research are opposite types.** `NOT_ADDRESSED` means the rule was
  READ and says nothing. `GAP` means nobody looked. Never widen one into the other, and never give
  either a value — the compiler forbids it, and that is the point.
- **A silence resolves only where a silence MEANS something.** `SILENCE_MEANS` in `src/resolve.ts` is
  the complete list, and every `data` requirement is absent from it deliberately: "the rule does not
  say who receives the interest" is not "nobody does". A restriction's recorded silence resolves OFF,
  which is the whole reason the silence has to be recorded rather than assumed.
- **A firm may be stricter than its jurisdiction; the platform may never be stricter on its behalf.**
  Guidance that a state bar recommends but has not enacted is carried as prose and is opt-in. Encoding
  it as a ban would refuse a lawyer a method the rules permit, in the platform's voice.
- **`binding: false` means render, never gate.** A `judgmentStandard` is the rule assigning the
  decision to the lawyer. Surfacing the standard with its citation is right; resolving it to a value
  would be the platform making a call the rule expressly withholds.
- **No baseline, no fallback, no "most states do X".** There is exactly one way to reach a value:
  a jurisdiction someone researched and an attorney reviewed.
- **A value without a verbatim quote is not shippable.** The reviewing attorney is checking the quote
  against the rule; a value they cannot check is a value they cannot review.

## Dependencies & contracts

- Depends on `@magna-carta/trust` for the seam's requirement names and for `TrustValidationError`, so
  refusal codes have one home. The dependency runs THIS way and never the other — the trust domain
  must not learn which jurisdictions exist, or binding a corpus would become a change to it.
- **Rules are a package; choices are firm-scoped.** A rule correction is a package release, never a
  migration against every tenant. Which jurisdiction governs an account is per-firm state
  (`trust_account.jurisdiction`, derived from the office's Location), and it does not live here.
- Pure and synchronous. No clock, no database, no network.

## Gotchas

- **The firm-funds bank-charge carve-out is wired, through a SECOND door and not a relaxed first
  one.** Nevada permits it (NRPC 1.15(b)), and `composeTrustEntry` — the door client money goes
  through — still refuses every firm-funds line **absolutely**. What was built beside it is
  `composeTrustFirmFundsEntry`, which admits strictly fewer shapes than the general door: two lines,
  a trust account's own firm-funds node and that same account's bank leaf, so the path cannot
  express a movement of somebody else's money at all. The two things the rule leaves open are
  answered by refusing rather than by inventing — no cap is chosen (the node carries the same zero
  floor a matter leaf carries, so a charge larger than the firm's own money aborts the batch), and
  because SCR 217(3) exempts pooled interest-bearing accounts from service charges,
  `openTrustFirmFundsNode` refuses to open the carve-out on an account recorded as that kind. All of
  that machinery is the trust domain's, never this package's:
  [`packages/trust/src/firm-funds.ts`](../trust/src/firm-funds.ts),
  [`packages/trust/src/composition-guard.ts`](../trust/src/composition-guard.ts), and the carve-out
  invariant in [`packages/trust/CLAUDE.md`](../trust/CLAUDE.md). Here it stays what it always was: a
  permission with a citation. See the comment on `cited.firmFundsForBankCharges` in
  `src/data/nevada.ts`.
- **State bar handbooks go stale, and they are the first search result.** Nevada's own published
  trust-accounting handbook still quotes a seven-year retention period (the rule now says five) and
  still cites a rule repealed in 2019. Read the rule text; the handbook is guidance and is dated.
- **Court rules move by court order, not on a legislative calendar.** The page revision stamp on the
  publisher's site tracks the legislature and is not a staleness signal for these rules. Each rule's
  bracketed source note is, which is why `Provenance.ruleEffectiveDate` exists.
- Adding a jurisdiction is not a data-entry task. It is the primary-source research, the verbatim
  quotes, the searches that establish the negatives, and an attorney's review.
