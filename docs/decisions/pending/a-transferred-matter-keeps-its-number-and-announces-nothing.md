---
slug: a-transferred-matter-keeps-its-number-and-announces-nothing
status: Accepted
area: Platform
date: 2026-11-13
summary: "A matter that arrives through a record transfer is written by its own composition, composeTransferredMatter, and not by createMatter. It keeps the number the source gave it and draws nothing from the firm's counters, takes its opening and closing instants from the source, writes no outbox message (so no conflicts check or notification follows), and is not written at all until every Directory record it names has arrived."
---

**A transferred matter keeps its number, announces nothing, and waits for the records it names.**

**Context:** The record-transfer framework reached matters. A matter created here draws a number, is stamped as opened now, and publishes events that request a conflicts check and can notify people. A matter that arrives from the system a firm is leaving already has a number the firm and the courts quote, was opened and perhaps closed years ago, and arrives beside several thousand others.

**Decision.** The author's recommendation, built on the owner's instruction of 2026-11-13 to continue development of the migration.

1. **Its own composition.** `composeTransferredMatter` in `@magna-carta/matters` writes the matter row, the client and party rows, and the audit rows. `createMatter` is not used, because it would draw a new number and record today as the opening.
2. **The source's number is kept.** It is written as a number entered by hand is: no counter is drawn and no allocation row is written, and it must be safe to carry in an address. A number another matter already wears is refused and reported.
3. **Nothing is announced.** The composition returns no outbox messages. Clio's own migration guidance is to leave integrations off until the imported data has been reviewed, and the framework's design adopted that as a rule. Telling the rest of the product that the matters exist belongs to accepting a finished run.
4. **A matter waits for the records it names.** If its client or a party has no live Directory record, the matter is not written and the outcome lists what is missing. A second run never updates a record, so a matter written without a party would never get it back.
5. **No close precondition runs** for a matter that arrives closed. Those ask whether a matter still holds money or property in this system, and a matter being written for the first time holds none.

**Consequences.** The audit trail distinguishes a transferred matter (`matter.transferred`) from one typed in. The conflicts corpus contains transferred matters and their parties as rows, but no check has been requested for them until a run is accepted, and that step is not built. The firm's numbering counter must be set above the highest transferred number before the first new matter is opened, because a draw steps past a taken number only a bounded number of times; this is an item for the cutover runbook. A source that marks a closed matter without a closing date is not yet handled.
