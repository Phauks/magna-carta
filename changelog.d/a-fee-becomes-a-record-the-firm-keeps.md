---
category: Added
audience: public
---

**A fee becomes a record the firm keeps, not a line a bill already composed.** Until now a matter's
Fees section showed the fee agreement in force paired with the invoice LINES the firm's bills had
made from it. That pairing was the whole argument for the shape, and it ended when the owner moved
the arrangement into the matter's status window on 2026-09-03 — leaving the pure invoice view the
design had itself rejected, which can show nothing that is still unbilled.

**`fee_entry` is the third work-in-progress store**, beside `time_entry` and `cost_entry` and with
the same anatomy: a service date, an optional timekeeper, a description, an amount in minor units, a
billing disposition, a status, a returned-draft reason, an internal memo and the invoice mirror. What
it holds is the charge somebody DECIDED on — a flat sum to settle a file on an hourly matter, a fixed
amount for a document nobody metered. An hourly matter's fee value is its time ledger's and a
flat-fee arrangement's is the arrangement's, so that third charge had nowhere to live and could only
be typed straight onto a draft bill, invisible to every unbilled read and gone if the draft was
abandoned. **Nothing here is computed from time entries.**

**The chain and the claim are the ones that already exist.** `assertTransition` and `isFrozen` from
`@magna-carta/billing-core` govern the fee exactly as they govern the other two, and a draft invoice
claims a fee through the same `invoice_wip_claim` — whose `source_kind` CHECK is widened by a
**hand-written** rebuild rather than a generated one, because the two triggers freezing a finalized
invoice's claims are not in the Drizzle schema and a generated rebuild would have dropped them
silently. `packages/database/test/invoice-wip-claim-rebuild-migration.test.ts` seeds a claim on a
finalized invoice and proves both still fire.

`GET/POST /api/v1/fees` answers both listing shapes — one matter entire, and a span of service dates
across every matter — with the timekeeper, the recorder and the matter resolved beside each record
rather than by a read per row. The chain, the draft delete and the kick-back reason ride the same
routes.

**What Costs and Fees share is hoisted, not copied.** `$lib/records/work-in-progress-record.ts` is
now the one home for the readings every ledger makes of a record — who wrote it down, why a draft
came back, whether it is this reader's to change. It exists because the alternative already happened:
`canWorkDraft` had been written twice, byte-identical, on two cost surfaces. The void and kick-back
confirmations moved there too, and **delete-draft** joins them — Fees is the first ledger with a
DELETE route, so `deletesDraft` sits beside `opensTheBill` in the shared row menu. Deleting is not
voiding, and the refusal on the wrong one is where the difference is taught.

## Public

**Flat charges are now recorded the way your hours and your costs are.**

A fee is a flat charge for professional services — a settlement drafting fee, a fixed amount for a
document, anything you agreed as a number rather than metered. Record it on the matter's **Fees**
section with its date, who it is for, what it covers and what it comes to. It saves as a draft, it
appears on the matter's fee record straight away, and a draft bill takes it up the same way it takes
up a cost.

**A fee is never worked out from your time.** The amount is what you decided to charge. If your
matter is billed hourly, your hours still bill as hours; a fee recorded here is a separate charge
beside them.

The section shows **every fee on the matter in every status** — drafts, anything waiting on review,
what has been approved, and what a bill has already taken up — with two figures underneath: what is
still unbilled, and what has been billed. A billed fee opens the bill it was charged on.

Two ways to take a fee off the ledger, and they are different acts. **Delete Draft** removes a fee
nobody has been shown; it does not come back, and there is no record to preserve. **Void** withdraws
anything further along: the fee freezes, stops counting toward every figure, and stays on the record
struck through, because it is something you may be asked to account for.

Updated guide: [A matter's money sections](docs/user/features/matter-money-sections.md).
