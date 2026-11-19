---
slug: accepting-a-transfer-run-asks-for-its-conflicts-checks
status: Accepted
area: Platform
date: 2026-11-19
summary: "A record transfer run ends by being accepted or stopped. Accepting marks it complete and puts one message on the outbox; its consumer records a conflicts request in the conflicts ledger for each live matter the run brought in, with the run as the cause. Stopping keeps what arrived and asks for nothing. A file's working mapping is one strict-shaped object beside the file, not a table. Removing what a run created is not built and waits for the owner."
---

**Accepting a transfer run asks for its conflicts checks.**

**Context:** Transferred matters arrive without asking for a conflicts check, so that several thousand arriving in an afternoon do not each ask. Until a run could be accepted, nothing ever asked. On 2026-11-19 the owner confirmed that the transfer is run from inside the product and asked for the build to continue.

**Decision.** The author's recommendation, built on that instruction.

1. **Two endings, neither undone.** Accepting writes the run's completed time; stopping writes its abandoned time. Both are refused while a pass is waiting or running. Neither removes a record or a link.
2. **Accepting announces through the conflicts ledger.** The request writes one outbox message. The consumer records one request per live matter the run linked, with the run as the cause, and runs no check itself; the ledger queues what one event may and its own sweep takes the rest. A closed matter is not asked about, as for every closed matter. The check is labelled comprehensive.
3. **A working mapping is an object.** It is kept at a key under the run's prefix and replaced whole on each save. Its declared shape admits column names, the source's codes and the firm's identifiers only. It is not a table because it belongs to one file and nothing queries across mappings.
4. **Two more reads answer file values.** A column's different values, bounded, and the rejected rows of a finished pass, both to the member who asks and stored nowhere.

**Consequences.** A run can be taken from upload to accepted without leaving the product, with no migration. A mapping has no history: the last save is the only one. Removing what a run created remains open, because the product has no delete of a matter or a Directory record and a removal would be the first; the owner is asked whether to delete only untouched records, archive, or leave it out.
