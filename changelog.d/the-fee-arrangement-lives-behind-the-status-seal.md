---
category: Changed
audience: public
---

**The fee arrangement moves from the Fees screen into the matter status window, and a version can name its signed agreement.** `matter-status-dialog.svelte` reads the arrangement on open and shows an Engagement section (agreement on file, billed as, terms, in force since, folded history) with Amend seated beside it; `fee-ledger.svelte` and `fee-details-panel.svelte` lose the strip, View and Amend, and `arrangement-dialog.svelte` is deleted with its allowance. `matter_billing_arrangement` gains a nullable `agreement_file_id` (a matter file, the conflicts waiver's precedent), carried through `setBillingArrangement`, the route contract and the client; the amend dialog gains a document picker, now the shared `matter-document-picker.svelte`.

## Public

**Find a matter's fee arrangement behind its status seal.** Press the status in the matter's masthead: the window now shows how the matter is engaged — the agreement the client signed, how it is billed, the terms, and since when — with the earlier versions a click away and Amend beside it. The Fees screen no longer shows the arrangement. When you record or amend the arrangement, you can name the signed intake agreement or amendment from the matter's files, and the window links to it.
