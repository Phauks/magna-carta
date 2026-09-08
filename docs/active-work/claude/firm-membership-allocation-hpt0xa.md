---
worktree: C:/dev/magna-carta-worktrees/claude/firm-membership-allocation-hpt0xa
area: The founding cascade — the control-plane sweep carries firm.provision to member.provision in one pass
status: review
touches: packages/data-access/src/outbox-relay.ts, apps/api-worker/src/scheduled.ts
---

Founding a firm queues its owner's member record from inside the sweep that activated the firm, so
the pass that read the pending set had already read past it and the mirror waited for the next
five-minute cron fire. `sweepOutbox` gains a bounded re-read (`maxRounds`, default 1 and unchanged
for every other caller) and the control-plane sweep opts into it. Nothing outside those two files
moves; the joining guards and the waiting screen already read the membership state and are left
alone.
