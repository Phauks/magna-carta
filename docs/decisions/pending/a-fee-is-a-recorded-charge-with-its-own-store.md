---
slug: a-fee-is-a-recorded-charge-with-its-own-store
status: Proposed
area: Financial
date: 2026-09-07
summary: "The 2026-08-26 fee-surface design ruled that Fees is NOT a work-in-progress surface: a matter's fee value was the time ledger's or the arrangement's, so the screen showed the fee AGREEMENT paired with the invoice LINES a bill had already composed. The owner then removed the arrangement from that screen on 2026-09-03 — it is a fact of the engagement and now lives in the matter's status window — which removed the ruling's own justification, because it rested on pairing agreement-as-cause with billed-lines-as-effect. What was left was the pure invoice view the design had itself rejected as too thin: a ledger of lines can show nothing that is still unbilled, which is the whole of what a work-in-progress ledger is for. So the third store is built. `fee_entry` holds the flat charge somebody decided on — neither an hourly matter's time value nor a flat-fee arrangement's amount, and so with nowhere to live — riding the same draft-to-billed chain as time and costs through `@magna-carta/billing-core`, claimed onto a draft invoice through the same `invoice_wip_claim` whose CHECK is widened to admit it. A fee is never computed from time entries."
---

**A ledger of what a bill already did cannot answer what is still unbilled, and that question is the
only reason a work-in-progress ledger exists.**

**Context.** The fee-surface design of 2026-08-26 reasoned as follows: an hourly matter's fee value is
its time ledger's, and a flat-fee or contingency matter's is the arrangement's, so a fee has no store
of its own and the Fees screen should show the arrangement in force paired with the invoice lines the
firm's bills had composed from it. It explicitly considered and rejected a screen of invoice lines
alone, as "a projection of billing rather than a section of the matter".

Two things then happened. The first is that the owner removed the arrangement from the Fees screen on
2026-09-03: the fee agreement is a fact of the ENGAGEMENT rather than of the ledger, rarely read, and
it belongs in the matter's status window behind the seal in the masthead. That is a good ruling on its
own terms and it is not in question here. What it did, though, was remove the standing design's own
justification — the pairing WAS the argument, cause beside effect — and leave behind precisely the
screen that design had rejected.

The second is that the reasoning had a hole the pairing was hiding. "Every fee is either time or an
arrangement" is not true of the way firms actually charge. A firm settles a file for a flat sum on an
hourly matter; it charges a fixed amount for a document it did not meter; it agrees a number in a
conversation. That charge is neither the time ledger's product nor the arrangement's amount, so under
the standing design it could not be recorded at all until somebody typed it straight onto a draft
invoice — at which point it exists only as a line on a bill, invisible to every unbilled-work read,
uncountable in what the matter is owed, and gone if the draft is abandoned.

**Decision.**

**A fee is a first-class work-in-progress record with its own store.** `fee_entry` carries a service
date, an optional timekeeper, a description, an amount in minor units, a currency, a billing
disposition, a status, a kick-back reason, an internal memo and the invoice mirror — the same anatomy
`time_entry` and `cost_entry` carry, deliberately, so the three ledgers stay one surface with three
vocabularies rather than three surfaces.

**The chain is `@magna-carta/billing-core`'s, not a third copy of it.** `assertTransition` and
`isFrozen` govern the fee exactly as they govern the other two, so the optional review gate, the
freeze past `billed`, and the rule that billing may drive a record INTO `billed` and never back out
are one implementation rather than three that agree today.

**The claim path is `invoice_wip_claim`, widened.** SQLite cannot widen a CHECK without a destructive
rebuild, so admitting `fee_entry` to `source_kind` is a hand-written rebuild rather than a generated
one — because the two triggers that freeze a finalized invoice's claims are not in the Drizzle schema,
and a generated rebuild would have dropped them silently, unfreezing every finalized bill's claims in
the fleet. The rebuild is on the reviewed-rebuild allowlist with that reasoning, and a test seeds a
claim on a FINALIZED invoice and proves both triggers still fire afterwards.

**The amount is TYPED and never computed.** Nothing in `packages/fees` reads a time entry, a rate or an
arrangement. `feeEntryToClaimable` composes a `flat_fee` line; the non-hourly-arrangement guard that
refuses hourly time on a flat-fee matter stays scoped to `time_entry` and must not be widened, because
a recorded fee on a flat-fee matter is a separate charge the firm decided on rather than a second
billing of the same agreement.

**The kinds are a union, and the code derives from it.** `WORK_IN_PROGRESS_KINDS` replaces the two-way
ternaries and the two hand-written mirror-clearing statements in the draft composer, so a fourth kind
is one entry rather than a search for every place two were enumerated.

**Considered and rejected.** **Leaving the screen as invoice lines** — the shape the standing design
rejected, now with nothing left arguing for it. **Recording such a charge as a zero-duration time
entry** — it would be counted as time in every utilization and realization read, which is a figure a
firm makes staffing decisions on. **Recording it as a soft cost** — a cost is money the firm laid out
or a resource it consumed, credits Cost Recovery Income, and would report the firm's own fees as cost
recovery. **A nullable amount for a charge moved in from another ledger**, which the built surface
carried: the table's CHECK makes it unreachable and the cross-ledger move route does not exist, so the
"Needs an amount" state was a branch no reader could ever meet.

**Consequences.** Fees becomes the third work-in-progress store and the matter's Fees section reads
it: every status, the whole record, paged. What Costs and Fees share is hoisted rather than copied —
the readings every ledger makes of a record (`$lib/records/work-in-progress-record.ts`), and the
void, kick-back and delete-draft confirmations — because the second surface is the moment to hoist,
and `canWorkDraft` had already been written twice byte-identical before anybody noticed. Fees is also
the first ledger with a DELETE, which is why `deletesDraft` joins the shared menu beside
`opensTheBill`: deleting is not voiding, and the refusal on the wrong one is where the difference gets
taught. The firm-wide period surface and the sidebar row follow. The reversal is deliberate and is
recorded here rather than by editing the superseded design, which stands as the reasoning that was
true while the arrangement was on the screen.
