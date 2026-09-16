---
category: Fixed
audience: internal
---

**The Database section reported `Schema: Up to date` for a firm database that was refusing every request because of its ledger.**

The schema check compared two head tags and nothing else. The runner rejects a ledger holding a tag it cannot place _before_ it applies anything, so the tags already there are untouched and the ledger can sit exactly at the expected head — which read as health. The panel then showed `Firm database: Not answering` and `Schema: Up to date` together, two rows describing one subsystem contradicting each other, with the reassuring one wrong. That is the reading the section exists to prevent, and it shipped in the section's own worst case.

`migrationState()` was already returning the fault; `readSchemaState` read the object and used two fields of it. The schema state gains `refused`, read from the fault first, and the row says `Not applied` with the count and head the database does have — the refusal's own sentence stays on the firm database row rather than being copied into a second place free to drift from it.

**Two signals the firm database computes and sends were being dropped in the same function.** `outOfOrderArrivals` names migrations that reached this database behind its own ledger head, which has no other symptom — everything is applied, but this database ran the pair in an order a newly provisioned firm will not, and for dependent migrations those orders do not reach the same schema. `restorePoint` names the instant the object can be restored to and the migrations it sits in front of, which is the question a database broken by a migration raises next. Both now appear as lineage notes beside the row, on the same "said only when there is something to say" rule as the provisioning backlog, and both travel in the copyable report — a pasted report is how a diagnosis reaches anyone who can act on it.

The restore point's Cloudflare bookmark is deliberately not on the wire: restoring is an operator's act with dashboard access, and the opaque handle does nothing for the member reading the panel.
