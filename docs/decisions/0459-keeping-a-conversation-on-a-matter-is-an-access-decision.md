---
number: 459
slug: keeping-a-conversation-on-a-matter-is-an-access-decision
status: Proposed
date: 2026-09-11
area: Magnus
summary: "A Magnus conversation can be kept on a matter's file after it was started, or taken off one, and the rule for that write is an access rule: a member may move a conversation they can read (their own, or anyone's under magnus:readAllConversations) onto a matter the firm still writes to (a closed matter and the platform's own matters are refused), and the confirmation states that which matter a transcript is kept on decides who may read it. The move is audited naming both matters. The conversation's attachments go with the move, because each is one of the old matter's files. The matter link still scopes only the record: what reaches the assistant beyond the typed question is exactly the readable text of the files a member attaches by reference, read fresh on each question and copied nowhere, which is why the disclosure moved to version 2."
---

**Keeping a conversation on a matter is an access decision, made by somebody who can read the
conversation, onto a matter the firm still writes to, said out loud before the press.**

**Context:** A conversation carried a matter link from its first day, set only when it was started.
The owner's Magnus round asked that a conversation which turns out to belong to a matter be kept on
it afterwards (C1), and that files be attached to a conversation (C2). The research beneath the
round named the consequence: the matter a transcript is kept on is what decides who can read it, so
moving one widens or narrows its audience. That makes C1 an access decision as much as a filing one,
and it needs a rule rather than a write.

**Decision:** `PATCH /api/v1/magnus/conversations/{id}/matter` takes `{ matterId: string | null }`.
It is allowed to a caller who can READ the conversation — the author, or a holder of
`magnus:readAllConversations` — because moving is an act on a record one is entitled to see, and the
supervision permission is exactly the permission that reads across authors. The target must be a
matter the firm still writes to: a closed matter is refused with the reason, and so are the
platform's own matters. `null` takes the conversation off every matter. The write is audited as
`magnus.conversation_moved` naming both matters and how many attachments went with it. The
confirmation dialog states, before the press, that which matter a conversation is kept on decides
who may read it, and that keeping it on a matter does not let the assistant read the matter.

Attachments are references to a matter's files (`magnus_conversation_attachment`, keyed by the
pair). A conversation on no matter can attach nothing, and only the conversation's own matter's
files may be attached, so a move takes every attachment off: each belongs to the old matter, and a
conversation kept elsewhere has no claim on it. Nothing of a file is copied anywhere: on each
question the consumer reads the file's current clean version from the firm's bucket, takes its text
through the platform's one extraction port (plain text directly), and sends it ahead of the question
under a heading naming the file, within a 64 KiB budget that cuts and says so. The row records what
reached the model. Because what Magnus can see changed, `MAGNUS_DISCLOSURE_VERSION` moved to 2 and
every member is re-prompted.

**Considered and rejected:** **Author-only moves** — the supervision permission exists to read across
authors, and a supervisor who can read a conversation but cannot keep it on the file it belongs to
would have to ask the author to do their filing. **Silently keeping attachments across a move** — a
file from the old matter riding a conversation onto a new one would let the new matter's readers
reach a document their matter does not hold. **Storing an extraction per attachment** — a second copy
of privileged content outside the file's own erasure path; re-extracting per question is bounded by
the attachment cap and the source-size cap, and is the cost paid to keep exactly one copy.

**Consequences:** Who may read a conversation is decided by where it is kept, and the surface says so
at the one moment it changes. A conversation's audience can be widened by its author or a supervisor
and by nobody else. The per-question extraction is compute the firm pays for on every question that
carries files; a cached extraction is a named seam for the day its retention posture is decided.
