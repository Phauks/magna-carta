---
category: Added
---

Custodian — stocktake. A firm can now take a physical count of its custody register, or of one branch
of its container tree and everything beneath it, and get back a reconciliation of what the register
claims against what a person actually saw: originals expected and not found (missing), originals
found somewhere other than where the register said (misplaced), originals found where the register
did not expect them at all (unexpected), and objects on the shelf the register has no row for
(unregistered). Observations are recorded in batches, the way a person walking a safe with a scanner
produces them, and each one freezes the location the register expected at the moment it was made — so
"sighted on the wrong shelf" stays true after somebody moves the packet to the right one.

**A stocktake observes and reports. It does not dispose, relocate, or correct.** Nothing on this path
writes the movement ledger, a packet, or an item: a count that wrote the register into agreement with
itself would erase the difference the count exists to find, and would put a movement in an
append-only ledger that no person asserted. The reconciliation names the corrective movement a person
would record — a move to where it was actually seen, a `found` for an original the register believed
was out — as a proposal on a report, and a person records it through the one movement write path or
does not. A missing original proposes nothing at all: the honest answer to an empty shelf is an
investigation, not a ledger entry closing the record on the exact failure that most needs one open.
Destruction and retention are untouched and remain owner-gated.

Sighting rows are evidentiary — a named person's assertion that they saw a specific original on a
specific shelf on a specific day — so they carry the movement ledger's append-only discipline at the
database: `RAISE(ABORT)` triggers on update and delete, the INSERT-OR-REPLACE bypass closed by a
BEFORE INSERT guard, and a further trigger refusing an observation recorded against a count that has
already closed. A mistake is corrected by recording the later, truer observation; both stay on the
record, because both are what happened. Closing a count freezes what it found on the stocktake row,
so the number a firm reports cannot drift as the register is subsequently put right; a count begun
and never finished closes as abandoned instead, freezing nothing — the reconciliation of a half-done
walk reads as a safe full of missing originals, which would be alarming and wrong.

Seven routes over the existing `custody:read` and `custody:manage` permissions (no new permission),
two per-firm tables, and the `custody-stocktake-closed` problem type.
