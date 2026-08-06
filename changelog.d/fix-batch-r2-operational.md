---
category: Fixed
---

Review campaign 2, the operational area — every finding applied (1 high, 6 medium, 7 low).

**A two-signatory custody release can no longer be composed by one person.** The member who checked
identity used to arrive in the request body alongside the witness, bound to nothing: one member
holding `custody:manage` could record a release and type a colleague's handle — or any well-formed
`user_…` string belonging to nobody — into the witness field, and the append-only ledger would
permanently assert that two people signed off on a handover only one person witnessed. The verifying
member is now the authenticated caller and is no longer a field on the wire at all; the witness must
be a DIFFERENT, ACTIVE member of the firm, checked against the member roster at the write path and
re-asserted by two new `BEFORE INSERT` triggers, the same footing the two-person destruction rules
already stand on. Triggers rather than CHECK constraints, so the binding is future-only: every
release recorded before it was recorded honestly under the rules that then applied, and rows already
on the ledger stay exactly as they were written.

**A closed stocktake is frozen at the database.** `custody_stocktake` — the row holding the frozen
counts and the `open` status all four sighting guards key off — carried no triggers of its own, so
the freeze rested entirely on one guarded UPDATE being the only UPDATE anybody had written. A
`BEFORE UPDATE` guard and a REPLACE-bypass guard now refuse a re-open, a second close, and any edit
to a closed count's findings.

**A truncated stocktake reconciliation says so, and cannot be frozen as a finding.**
`CustodyReconciliation` carries `truncated` and the cap that produced it, both reads request one row
past the cap to learn whether there was one, and the sighting read now runs newest-first so the cap
drops the OLDEST observations rather than the corrections the last-observation rule depends on.
Closing a count whose reconciliation truncated is refused (`custody-stocktake-truncated`) rather than
freezing a partial answer; an abandoned close records the truncation.

**The case calendar no longer disagrees with the register it federates.** The three custody-derived
timeline sources were missing status predicates their custodian equivalents carry, so a deed returned
on Tuesday kept a "due back Friday" entry forever and a released or destroyed original kept showing
"review due", named by its custody number. Each source now carries every predicate of the read it
mirrors, and a fitness test pairs the two sides so the divergence cannot recur silently.

**`overdue=true` is now the real predicate rather than a UTC-date approximation.** It was
`due_on <= <today in UTC>`, which reported a Nevada firm's live same-day deadlines as already missed
for most of the working day and let non-overdue rows consume the page. The narrowing is now composed
per zone and is exact — the same comparison `isOverdue` makes row by row — and it stays entirely in
SQL, because a post-filter under-fills the page and turns the page size into an existence oracle.

**Daylight-saving arithmetic matches what it promises.** A wall clock in the hour after a fall-back
resolved an hour early (02:14 PST became 01:14 PST), and one in a spring gap resolved BEFORE the time
somebody wrote down rather than to the instant the clock reached. Resolution is now by round trip: a
repeated hour takes its first occurrence, an unambiguous time after a transition takes itself, and a
skipped time moves forward. End-of-day is now correct in zones whose transition falls at midnight.

**Also fixed.** A deadline edit now carries the state guard its satisfy and close siblings carry,
plus a precondition fence so a losing concurrent edit aborts rather than silently rewriting a
discharged deadline. The two event reads that bypassed the visible-matter seam now compose it, and
every direct read of `matter_event` or `matter_deadline` takes the predicate as a required argument
with a fitness test over the set. The will-deposit catalog refuses an unreadable or impossible
trigger date (`custody-invalid-trigger-date`) instead of returning the same null it uses for "this
duty has no computable interval", normalizes a jurisdiction key before lookup and walks every
hyphen segment upward to name the nearest encoded ancestor, and states its verified negative in prose
rather than only in a boolean. The holdings-by-owner report replaces a correlated subquery that ran
once per owner entity in the firm with a one-pass joined aggregate. An interrupted destruction —
ledger row committed, request still `approved` — is now a list somebody can open
(`outcome=interrupted`). The keyset cursor is minted through `encodeCursor` rather than hand-rolled
at two route sites.

Contract moves: `CustodyReleaseAuthorization` drops `identityVerifiedByUserId`;
`CustodyWillCapability` replaces `summary` with `question` + `answer`; `CustodyReconciliation` gains
`truncated` and `rowLimit`; `ClosedCustodyStocktakeResponse` gains `truncated`; the destruction list
accepts `outcome=interrupted`. Adds the `custody-stocktake-truncated` problem type. Migration
`20260806T040000_operational-fixes` adds the four triggers and rebuilds nothing.
