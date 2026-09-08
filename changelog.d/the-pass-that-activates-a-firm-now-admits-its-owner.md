---
category: Fixed
audience: public
---

**The sweep that activates a new firm now carries the chain to its end, instead of leaving the owner's member record for the next cron fire.** Activation and the member mirror are two outbox rows, and the second is written by the consumer that applies the first — from inside the pass, after `sweepOutbox` had already read its pending set. So the firm went active within seconds and the row that every permission resolves through sat pending for up to five minutes: a founder attached to a firm whose own database had never heard of them, which is what the joining screen's last step and the database-health panel's "Not in the database yet" have been reporting. Redeeming an invitation never had the problem, because its `member.provision` row is committed by the request itself and is already pending when the sweep reads.

`sweepOutbox` gains `maxRounds`: a pass may re-read the pending set, taking only rows it has not already tried — a row whose publish failed keeps its remaining attempts for the next fire rather than spending them seconds apart — and stops as soon as a round finds nothing new. It defaults to 1, so every per-firm sweep is unchanged; those publish to a Queue and cannot feed the table they are reading. The control-plane sweep asks for four, which is headroom over the deepest chain its consumer map can make.

## Public

**A new firm is ready to use as soon as it is built.** Setting up a firm made the workspace within seconds but could take several more minutes to finish adding you to it, and screens opened in between refused what you asked for. Both steps now finish together.
