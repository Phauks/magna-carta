---
category: Added
---

The design for **Magnus**, the assistant a firm member can talk to — the conversation record, the
consent gates, the path from a typed question to an answer, and the seams later work attaches to.
Design and plan only; no product code, and nothing is enabled for any firm.

**Magnus does not get an AI connection of its own.** The platform already has exactly one place a model
can be reached, and everything that keeps that safe — no caching, no logging, the firm identity derived
by the server rather than taken from the caller, and a check that refuses outright to send anything to
a model that has not committed to retaining nothing — is a handful of settings in a single function.
The strength of those settings comes entirely from there being one of them. So Magnus becomes the first
real user of that one path rather than a second path beside it. The single change is one addition: the
existing path could send a question, and now it can send a conversation, with the platform's own words
for who said what and the platform's own instructions kept structurally apart from anything a member
typed, so nobody can talk their way into the instruction seat.

**A conversation is a record the firm keeps.** Transcripts live in the firm's own database, are kept
the way correspondence is kept, are readable by the person who wrote them and by administrators holding
a separate permission for exactly that, and are never shown to clients. A member can delete a
conversation whenever they like and the deletion is on the audit trail. The cost of this is real and
worth saying out loud: a question a member would once have thought and not written down is now written
down. It is accepted because a firm that cannot see what its people asked cannot supervise the thing at
all, because every neighbouring part of the platform already keeps its records, and because if somebody
relies on an answer that turns out to be wrong, the transcript — with the exact model version recorded
against it — is the only thing that helps. What was deliberately not built is an off-the-record mode,
because the question "why was that one off the record" is worse than any answer to it.

**Turning it on takes three separate yeses.** The firm must already permit AI processing at all; the
firm must then enable Magnus specifically, which is a different question and is off by default; and the
member must hold the permission and have read and accepted a disclosure. The disclosure is versioned,
which sounds like bookkeeping and is not: the day Magnus can do something new, every member is asked
again automatically, because the thing they agreed to has changed. Switching Magnus off stops questions
that are already in flight rather than letting them finish quietly.

**What the firm is told, it is told plainly.** That what members type is sent to a model provider
outside the platform; which provider and model; that the provider keeps nothing and trains on nothing,
along with the honest residual that a retention guarantee is not the same as nothing existing anywhere
for any interval; that Magnus can see nothing but the conversation itself; that Magnus can do nothing
at all; that transcripts are kept and who can read them; and that whether the firm's own client
agreements permit any of this is the firm's judgement and not the platform's. Members are additionally
told the thing an administrator does not need told — that Magnus can be wrong, that nothing it says is
legal advice, and that checking it is their job.

**Magnus starts able to see nothing and do nothing, on purpose.** It cannot read matter files, the
calendar, or the directory, and it cannot create, edit, file, send, or delete anything. The narrow
start is what lets the disclosure be a sentence a firm can actually weigh — "what you type is what is
sent" — rather than a description of whatever a search layer happened to pick out of their files. The
places retrieval and actions will attach are built and empty, so adding them later changes one piece
and not the whole design.

**Answers come back the way every other slow job's results already do.** A question is accepted
immediately and answered in the background, so one firm's long question cannot occupy capacity everyone
else is queuing for, and the live connection that pushes the answer to the screen carries no
conversation content of its own — it reads the record and shows it, so there is exactly one copy of a
transcript anywhere. There is a hard limit on how much can be sent in one message and how much of an
older conversation is carried forward, and when older parts are dropped the member is told, because an
answer confidently built on something the member believed was included is worse than a visible gap.

Also settled: what the firm's spending record looks like when the model gateway is configured to log
absolutely nothing (the platform's own per-firm token record is the only source, which is what it was
already designed to be), and that the gateway's content-moderation feature must stay off permanently,
because it works by logging the prompts and responses it inspects.
