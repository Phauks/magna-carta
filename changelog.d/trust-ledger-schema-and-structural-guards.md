---
category: Added
---

Trust accounting — the trust ledger schema and its by-construction invariants. A three-level
sub-ledger tree over the existing double-entry ledger (trust-account liability root, a client node
per trust client, a matter leaf under it), with `min_balance_minor = 0` written onto every matter
leaf in the same batch that creates it, so an overdraw aborts the whole posting batch at the database
rather than at a check a caller has to remember. The new `@magna-carta/trust` package owns the single
composition guard every trust entry passes through: it refuses commingling and, with it, a processor
fee netted out of a trust deposit; refuses postings to a roll-up tier; and refuses any entry touching
more than one client, which makes a client-to-client movement unrepresentable. Disputed-funds holds
reduce an available balance without moving money and are append-only (a release is a new linked row);
the transfer out of trust posts two linked entries, is limited by available balance rather than by a
positive one, and refuses outright until an earned-fee precondition is supplied. Jurisdiction fields
refuse to resolve rather than falling back to any baseline. Adds `trust:read` and `trust:manage`.
