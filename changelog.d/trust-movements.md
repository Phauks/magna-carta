---
category: Added
---

Trust accounting — the movement operations over the trust ledger: deposits, disbursements, and
transfers between two matters of one client, each with an HTTP surface that requires an
idempotency key, because a retried request that posted twice would be a second real movement of
somebody else's money. Beside every trust entry the platform now writes a client-ledger record
carrying what the ledger has no column for and the record-keeping rules require — the source or the
payee, the purpose, the payment method as a value rather than as prose, the check or wire reference,
who entered the record, and, for money leaving a client ledger, who authorized it. That record is
append-only at the database, and its shape is a constraint: an internal reallocation cannot claim a
bank method or an external payee, a bank movement cannot hide as internal, and a disbursement
without a named authorizer will not store. A disbursement is measured against the ledger's
_available_ balance rather than its stored balance, so a positive balance whose disputed portion is
under hold is not money the firm can pay out. A matter-to-matter transfer posts no bank line at all,
because no bank movement happened — the two matters' balances move against each other and the
reconciliation gains nothing that could never clear. Movements refuse outright on a trust account
whose office recorded no jurisdiction, distinctly from a jurisdiction whose rules are not encoded.
