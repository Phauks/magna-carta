---
category: Added
audience: internal
---

**An email reaching a matter now commits an `email.filed` outbox row in the same batch as the link
change, on both paths that reach `filed`, and the notification registry subscribes to it. The
in-process `raiseEmailFiledNotification` that stood there is deleted: nothing subscribes to a function
call, a call fires for a batch that rolled back, and it fired from only one of the two write paths.**

`packages/email-filing/src/topics.ts` is new and holds `EMAIL_FILED_TOPIC` in the frozen topic-set
shape the matters, conflicts, directory and file-manager packages already use. The staff accept route
(`apps/api-worker/src/routes/email/emails.ts`) and the capture consumer (`apps/api-worker/src/emails/capture-consumer.ts`)
each write the row beside the link change, so the row exists exactly when the filing does and rolls
back with it. One registry entry subscribes: `category: email`, `audience: matter-team` — the
responsible member plus everyone currently assigned, which resolves properly now that
`matter_assignment` backs it — matter-anchored, digest, counts-only email. The payload is two
identifiers and the declared facts are empty, because an email's subject line is routinely the
client's name, the opposing party, or the substance of the advice, and a notification row outlives the
access check that justified writing it. No binding, no queue, no schema change: the relay already
sweeps every per-firm topic onto the bus and the dispatcher already offers each message to the
translator.

**Writing a row instead of making a call exposed an emission that was not honest.** The accept route's
`UPDATE` is guarded on `state = 'staged'` and quietly changes nothing otherwise, but the batch around
it was unconditional — a repeated accept wrote a second audit row for a promotion that never happened,
and would have announced a filing that never happened. The route now reads the link first: `staged`
promotes and announces, `filed` writes nothing and returns the same 200 the first accept returned, and
`unlinked` or absent is the 404 the route already declares — where it previously answered 200 `filed`
over a link somebody had deliberately unlinked. On the capture path the link insert is `ON CONFLICT DO
NOTHING`, so a second filer forwarding a message the matter already holds changes nothing and raises
nothing; the check costs one indexed read and only on the dedup path.
