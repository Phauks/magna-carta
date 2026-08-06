### Fixed

- **A trust ledger's client is now derived, never asserted.** `ensureMatterTrustLeaf` resolves whose
  money a matter leaf holds from the matter's own client party rather than from a handle the caller
  supplied, and refuses a matter that has no client. Previously a member holding `trust:manage` could
  move one client's money onto another client's matter simply by naming the source client beside the
  destination matter: the leaf was created under that attribution and the composition guard was told
  the same thing, so the one-client rule saw one client and passed. `clientEntityId` and
  `toClientEntityId` are gone from the deposit and matter-transfer request bodies, an existing leaf is
  re-checked against its matter's client on every movement, and a new fitness query proves every
  matter ledger is filed under a client whose matter it actually is.
- **A trust reconciliation refuses rather than attesting to a total it cannot see.** The
  outstanding-item read is capped so a runaway period cannot pull an unbounded result set into a
  request handler, but the cap was silent: past it the proof's totals, its adjusted bank balance, and
  its balanced verdict were all derived from a truncated list — internally consistent and short by
  everything past the ceiling — and closing froze exactly those numbers as the firm's attestation.
  The read now asks for one row past the ceiling and both the proof and the close refuse by name.
- **Ordinary bad input on a money route answers 422 instead of 500.** The ledger's own refusals — a
  future effective date, a date that is not a day, an unbalanced entry — are a different error class
  from the trust and billing packages' and were mapped nowhere, so every one of them reached the app's
  error boundary and a member got a platform-bug page with an Error ID for typing next week's date.
  All three money route modules now map them (new `ledger-entry-refused` problem type), and the three
  civil-date request schemas refuse a date that is not a real calendar day before it travels that far.
- **A firm running with the bill-review gate on gets a sentence instead of a 500.** Finalizing a bill
  that claims work which has not been through review raised the work-in-progress state machine's own
  error class straight at the HTTP boundary; it is now caught and rethrown as a billing refusal naming
  the entry and the state it is in.
- **A negative invoice line posts correctly instead of aborting the batch.** A courtesy credit written
  into bill review makes a role subtotal negative on a bill whose total is still positive; finalize
  emitted every subtotal as a credit of the signed amount, which the ledger refuses outright. The
  direction is now chosen from the sign and the line carries the magnitude, and a per-matter subtotal
  that nets negative is refused by name before the balance CHECK can abort the whole batch.
- **The accounts-receivable aging report is bucketed in SQL.** It read every finalized invoice in the
  firm with a correlated unpaid-balance subquery per row and bucketed them in the Worker — the whole
  billing history read on every dashboard load to produce five integers. Five rows come back now.
- **A typo in an invoice numbering scope no longer mints a second sequence.** The scope key selects
  which counter a number is drawn from and was unvalidated free text, so `nyc` where the firm always
  sent `NYC` silently started a fresh sequence that the gap-detection query reported as perfectly
  gapless. An unrecognized scope is refused unless the request opens it deliberately.
- **Six smaller financial fixes.** A statement-import date that is well-shaped but not a day is now
  rejected instead of sitting unmatched forever; the import request body is capped and the row ceiling
  applies as rows are parsed rather than after the whole file is materialized; the sole-manager
  disbursement refusal names the members it counted, so a firm can find the lapsed grant speaking for
  somebody who left; the trust-to-operating transfer runs the currency guard every sibling composer
  runs; a match withdrawal is refused when the reconciliation in the URL is not the one the match
  belongs to; and claiming work recorded in a currency the invoice does not bill in is refused by name.

Fixes every finding in
[`docs/reviews/2026-08-06-campaign-2-financial.md`](docs/reviews/2026-08-06-campaign-2-financial.md).
