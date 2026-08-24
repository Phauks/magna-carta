---
number: 352
slug: an-email-filing-announces-itself-with-a-row-not-a-call
status: Proposed
date: 2026-08-15
area: Communications
summary: "Email filing now commits an `email.filed` outbox row in the same batch that puts a link in `filed`, on both paths that reach that state, and the in-process `raiseEmailFiledNotification` no-op is deleted rather than kept beside it. Nothing subscribes to a function call; a call fires for a batch that rolled back; and it fires only from whichever write path remembered to make it — so the raise was not a body swap away from working, it was the wrong mechanism. Keeping the no-op as a documented call site, which the notifications design proposed, would leave two apparent mechanisms at one call site, which is how a codebase acquires a second convention nobody chose. Writing the row also forced the emission to be honest: the accept route committed an audit row and would have committed a topic on a repeat accept whose guarded UPDATE promoted nothing, and answered 200 filed over a link somebody had unlinked."
---

**A notification that must be true is a row in the batch, not a call after it.**

**Context:** `packages/email-filing/src/seams.ts` held `raiseEmailFiledNotification`, an in-process
no-op placed as the point where "email filed to matter" would one day be delivered. By the time
`@magna-carta/notifications` shipped, the seam could not have been filled: that package subscribes to
outbox topics and produces none, on the stated ground that "the outbox row IS the emission" — and email
filing committed no outbox row for a filing. The comment above the function had been rewritten to say
exactly this, which is the state a seam should never rest in.

The shape was wrong three ways at once, and each is a different failure:

- **Nothing subscribes to a call.** The consumer is a queue dispatcher reading rows off the per-firm
  bus. A function call is invisible to it whatever its body does.
- **A call fires for work that did not commit.** The raise sat after the capture batch. A batch that
  rolls back leaves the raise already made.
- **A call fires only where someone remembered it.** Two paths reach `filed` — the capture consumer
  (accept-on-capture, and an auto-file rule choosing to file) and the staff accept route — and only
  one of them called the raise.

**Decision:** `EMAIL_FILED_TOPIC` in a new `packages/email-filing/src/topics.ts`, matching the frozen
topic-set shape the matters, conflicts, directory and file-manager packages already hold, committed as
an outbox message in the same atomic batch as the link change on **both** paths, plus one entry in the
notification registry subscribing to it (`category: email`, `audience: matter-team`, matter-anchored,
digest, counts-only email). The payload is two identifiers — the message and the matter — and the
declared facts are empty: an email's subject line is routinely the client's name, the opposing party,
or the substance of the advice, and a notification row outlives the access check that justified it.
What a reader needs resolves behind the deep link through email filing's own access-checked read.

The notifications design proposed keeping the no-op raise "as the documented call site". It is deleted
instead. Once the row is written at the same place, the function documents nothing the row does not,
and a no-op call beside a real emission reads as a second mechanism — the exact thing naming one topic
in one place exists to prevent.

**Writing the row forced the emission to be honest, which the audit row had not been.** The accept
route's `UPDATE` is guarded on `state = 'staged'` and quietly changes nothing otherwise, but the batch
around it was unconditional: a second accept wrote a second audit row for a promotion that did not
happen, and would have announced a filing that did not happen. The route now reads the link first —
`staged` promotes and announces; `filed` writes nothing and returns the same 200 the first accept
returned; `unlinked` or absent is the 404 the route already declares, where before it answered 200
`filed` over a row somebody had deliberately unlinked. On the capture path the link insert is
`ON CONFLICT DO NOTHING`, so a second filer forwarding a message the matter already holds changes
nothing; the topic is written only when the link is genuinely new, which costs one indexed read and
only on the dedup path.

**Consequences:** "An email reached this matter" now reaches the matter's team — the responsible member
plus everyone holding a currently-valid assignment — through the machinery every other producer already
uses, with no new binding, no new queue, no schema change, and no second mechanism. The narrow race
where two concurrent accepts both read `staged` can still write two rows; that is the same window every
guarded-update producer here accepts, and the guarded `UPDATE` remains the correctness backstop.
