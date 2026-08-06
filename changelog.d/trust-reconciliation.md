### Added

- **Trust: the three-way reconciliation.** A trust account's bank statement is now a recorded period
  — member-entered or imported from a file the firm exported from its bank — and reconciling it
  proves three totals against each other as of the period end: the statement's closing balance
  adjusted for items the firm recorded that have not reached the bank, the trust bank account's own
  book balance, and the sum of every client ledger under it. Both ledger totals are computed from
  the ledger's own dated rows rather than from a stored balance, so the same period reproduces the
  same answer later.
- **Statement lines are matched by a person, never automatically.** The platform offers bounded
  candidates with the reasons it considers them candidates — the amount agrees, the dates are the
  same day or within the window, the reference matches, the counterparty looks similar — and a match
  exists only once a member names both ends. A wrong automatic match would make the totals tie out
  while the ledger and the bank disagreed about which events happened, which is the discrepancy a
  reconciliation exists to find. A match a person got wrong is withdrawn by appending, never by
  deleting, and the item becomes outstanding again.
- **Unmatched on either side is a first-class outcome.** A statement line nothing accounts for is
  usually the bank fee, the returned deposit, or the check the firm never recorded — the item the
  no-negative floor structurally cannot see. A recorded item no statement carries is a deposit in
  transit or an outstanding check. Both are named in the proof, and neither has to be cleared before
  a period can be closed.
- **A reconciliation that does not balance is recorded as such.** Closing a reconciliation freezes
  its proof as an evidentiary row that never changes afterwards, even when a backdated entry moves
  the live proof. A period that did not tie out closes exactly as readily as one that did, recording
  which leg disagreed and by how much — bank-to-book, or book-to-client — with no plug figure and no
  rounding to agreement. Redoing a period later is a new reconciliation that supersedes the old one.
- **Bank-statement import is previewed, confirmed, and reported.** Reading a file reports what is in
  it — the column mapping resolved, every row that could be read and what it would become, every row
  that could not and why, and the totals — and stores nothing. Importing takes that report's
  fingerprint back, so a file that changed in between is refused rather than stored. A date
  convention is stated by the caller and never detected, and a file whose columns nothing recognizes
  is refused naming the headers it found rather than guessed at by position.
