---
category: Fixed
audience: public
---

**An anonymous poll's answer leaves nothing in the idempotency record the choice could be read back
out of.** The answer route's fingerprint was an unsalted SHA-256 of the path and `{ optionIds }`, so
a choice among at most ten options was recovered by hashing each candidate, and its stored response
was the tally just before the answer, so consecutive bodies differed by exactly one choice. The route
now stores the poll's handle alone and re-reads the poll on a retry, and the chokepoint gained an
opt-in `idempotencyFingerprint: "path"` mode on `RouteMeta` (`chokepoint/idempotency-port.ts`) that
fingerprints the method and path without the body and leaves the replay decision to the handler's
`runIdempotentEffect`. The trade: a retry under the same key with different choices is answered as
the first was rather than refused 422; it can never become a second answer.

**The room's tallies cannot move backwards across a flush.** A poll's tallies are ordered by
`respondents`, which only grows; a question's by the read instant. Each flush of the per-second
bucket leaves a per-subject high-water mark under a `tally-marks` storage key, written in the same
storage turn that clears the bucket, and a poll's close raises its mark to the final count
(`room/room-coalescing.ts`, `room/room-polls.ts`).

**A reconnect while a media session is being opened no longer strands the browser.**
`admitParticipant` gives up an opening the routing service has answered, inside the gate that resets
the record, and closes its session (`abandonAnsweredOpening`, `closeUnrecordedSession` in
`room/room-media.ts`); an unanswered one is still inherited. `releaseParticipant` closes an
unrecorded session even when no roster entry was left to remove.

**The question queue.** An upvote on a question that has been taken back is refused 409 `conflict`
(withdrawal still allowed). `since` without `sinceId` is inclusive (`asked_at >= ?`), so a question
committed in the same millisecond as the last one held is no longer skipped; callers drop ids they
hold. A withdrawal's audit row names the stay the upvote was cast from. Upvote and withdrawal spend a
new member-scoped bucket, `meeting-question-upvote` (thirty a minute, keyed `member:<firm>:<user>`
through `MEMBER_SCOPED_BUCKETS`), instead of the firm's default budget.

## Public

**Anonymous polls keep your choice private in one more place.** When you answer a poll that does not
show names, nothing the system keeps to handle a repeated tap can be used to work out what you chose.

**Live counts in polls and the question queue no longer jump backwards** when several people answer
or upvote at the same moment.

**Rejoining a meeting while your camera was still connecting works first time**, rather than showing
a connection error until you tried again.

**The question queue is steadier.** A question that has been taken back can no longer be upvoted,
two questions asked at the same instant both appear, and pressing upvote repeatedly can no longer
slow the app down for your colleagues.
