---
category: Changed
audience: internal
---

The register's "Waiting on you" section is a flat list, and at thirty entries a flat list stops working. "Whether a separate gender field is ever added to a Directory person" was sitting between two decisions that each hold an entire unbuilt subsystem still, and nothing on the page distinguished them.

It now splits by what the answer costs. A question on a capability with **nothing built behind it yet** is holding work still: nobody can start until it lands, and answering it late means somebody waited. A question on a capability that **already runs** is refining something that works — it deserves an answer and it is blocking nobody. Each group leads with its own count, and a group with no entries prints no heading rather than a zero.

The split reads the node's own `status` rather than a second key declaring it. A `blocking: true` field would be the same fact recorded twice, and the two copies would eventually disagree — which is the failure this document has spent the week correcting everywhere else.
