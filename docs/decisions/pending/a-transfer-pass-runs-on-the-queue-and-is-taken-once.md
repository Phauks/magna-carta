---
slug: a-transfer-pass-runs-on-the-queue-and-is-taken-once
status: Accepted
area: Platform
date: 2026-11-14
summary: "A pass over a record transfer's source file is recorded as a transfer_pass row and run by the firm's shared job queue, never on the request. The first delivery takes the pass; a pass whose job died is shown as stalled and is never restarted, because asking for the pass again repeats nothing. The whole report is one object beside the source file and the row carries its counts. One permission, firm:transferRecords, seeded to Owner/Admin, gates every transfer route."
---

**A transfer pass runs on the queue and is taken once.**

**Context:** The record-transfer framework could run a pass over a file only from a test. A person needs to ask for one, and a pass is work in proportion to the file, which the platform's rules keep off a request. The owner's instructions of 2026-11-13 and 2026-11-14 were to continue the migration work and merge it as necessary.

**Decision.** The author's recommendation, built on those instructions.

1. **A pass is a row and a queue message.** The request writes the `transfer_pass` row with the rules as stated, an audit row and one outbox message in a single batch, and answers 202. The consumer on the firm's shared job queue runs it. The shared queue is used because a deploy that binds a queue the account does not have fails, and a merge to `main` deploys.
2. **A pass is taken once and never restarted.** The job writes a start time only where there is none. A pass with a start and no ending after twenty minutes reads as stalled. The way on from a stalled or failed pass is a new pass, which is safe because every row reads its link before it writes.
3. **The report is an object; the counts are columns.** The report is stored at a key built from the run and the pass, before the row is marked finished. A database check holds the counts to the rule that every row read is accounted for.
4. **One permission for the whole surface.** `firm:transferRecords`, Owner/Admin alone, on reads as well as writes.

**Consequences.** A transfer can be driven end to end through the API, and a failure leaves a stated reason and nothing half-recorded. A pass is one queue delivery, so a file of several hundred thousand rows will need the pass to resume across deliveries; the row-numbered reader allows that and nothing yet does it. A stalled pass waits for a person, which is slower than an automatic retry and cannot run the same file twice at once.
