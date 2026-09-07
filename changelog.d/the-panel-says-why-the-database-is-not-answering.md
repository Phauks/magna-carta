---
category: Fixed
audience: internal
---

The database panel names the fault instead of only the symptom, and the docket stops rendering `[object Object]`.

A firm database bricked by a failing migration read as "Firm database: Not answering" and nothing more. The cause was in hand the whole time — the durable object throws a specific error, and the health read was catching it in a bare `catch` and discarding it — so a reader went to the logs for a fact the panel already held. The firm-database check now carries that message, scrubbed and bounded to the same length the error pipeline gives any `messageHead`, because a constraint failure names the constraint but a UNIQUE violation can carry the offending value out with it. Where the database gave no reason at all, the row says that plainly rather than implying none exists.

Separately, the docket's failure branch interpolated the failure RECORD into its Alert, so a reader got `[object Object]` where the sentence belonged — and no Error ID, which is the one thing that makes a report actionable. It goes through the standard failure surface now, which reads the problem's own detail, keeps this screen's words for when the server sent none, and carries both the correlation handle and the retry.
