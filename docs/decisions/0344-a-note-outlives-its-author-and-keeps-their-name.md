---
number: 344
slug: a-note-outlives-its-author-and-keeps-their-name
status: Accepted — built
date: 2026-08-15
area: Notes and activity
summary: "A note's author is a plain foreign key to member.user_id and it never nulls, never repoints, and is not anonymized when a member leaves the firm. An unattributed contemporaneous record is worth a fraction of an attributed one, the foreign key is what the federated timeline reads as the entry's actor, and every sibling subsystem here already made this choice — custody movements, trust movements, calendar events and deadlines, conflicts checks and filed email all name their actor as a member reference and none of them clears it, while matter_assignment deliberately keeps ended rows because who carried a file is the matter's record. What changes when a member leaves is presentation and not storage: a note authored by a former member renders with a former-member signal derived from a read-time join on member.status, never a stored flag, on the same reasoning that keeps overdue out of the calendar's schema — a fact that is a join cannot drift from the row it joins. The one case that genuinely moves is a member who is themselves the subject of an erasure request, where the member row anonymizes to a tombstone and the author reference correctly points at it under the PII registry's pseudonymize-keep action, with the note body handled separately as report-manual because it may name the departed member and no automated pass can safely rewrite prose."
---

**A note keeps its author's name after the author has gone, because the name is most of what the note
is worth.**

**Context:** `member` is five columns and a status flip; membership ends by setting `status`, and the
offboarding function exists while the flow that invokes it is a future design. A note primitive has to
say what happens to authorship at that moment, and the tempting answers — null the reference, repoint
it to a generic "former staff" row, anonymize it alongside the member — all look tidy and all destroy
something.

**Decision:** `author_user_id` is a plain foreign key to `member.user_id`. It never nulls, never
repoints, and is not anonymized on offboarding.

**Three reasons, and the first is decisive.** An unattributed contemporaneous record is worth a
fraction of an attributed one. The whole value of "I spoke to her on Tuesday, she is thinking about
it" is that a specific person wrote it on a specific day; strip the person and it becomes a rumour the
file is carrying. Second, the foreign key is what the federated timeline reads as the entry's actor,
so nulling it makes a note the one entry on a matter's history with nobody attached. Third, every
sibling subsystem already chose this — custody movements, trust movements, calendar events and
deadlines, conflicts checks, filed email, and every financial correction all name their actor as a
member reference and none of them clears it. `matter_assignment` goes further and keeps ended
assignments deliberately, on the stated ground that who carried a file is the matter's record. Making
the opposite choice here would leave notes as the single record type whose provenance dissolves on a
resignation.

**What does change is presentation, and it is a read.** A note authored by a former member must not
render as a bare name that reads as current staff — a colleague seeing "per Sarah Chen" will go and
ask Sarah, who left two years ago. The former-member signal comes from a read-time join on
`member.status`, not from a column on the note, on exactly the reasoning that keeps overdue out of the
calendar's schema: a fact that is a join cannot drift from the row it joins, and there is nothing to
backfill when a member's status moves.

**The erasure case, which is the one that genuinely moves.** The PII registry carries a `user` subject
axis alongside the entity axis. Erasing a member anonymizes the member row into a tombstone, and the
note's author reference then points at that tombstone — which is the correct outcome and has a name in
the registry's own vocabulary: **`pseudonymize-keep`**, "append-only rows: replace the subject
reference, never delete." This decision registers the author references accordingly. The note **body**
is a separate problem with a separate entry — `report-manual` — because the body may name the departed
member in prose and no automated pass can safely rewrite it.

**Considered and rejected:** **nulling the reference on offboarding** — it treats a note as a work
item rather than a record, and it is the one change that cannot be undone once the member row is gone.
**A denormalized `author_display_name` snapshot beside the key** — it survives erasure, which is
exactly why it is wrong: it is a copy of personal data outside the registry's reach, and it goes stale
against a name change. **A stored `author_was_active` flag** — a stored copy of a join, drifting from
the moment the member's status next moves. **Reassigning notes to a successor on offboarding** — it
would make the successor the author of statements they never made.

**Consequences:** a firm's note history is durable across staff turnover, which is the ordinary case
and the one that matters most. The platform also acquires, for the first time, a durable, attributable
and discoverable place to record criticism of a colleague. Nothing here prevents that and nothing
should — a firm has to be able to record what happened — but it is a new category of content on this
platform, and it is raised as an open owner flag rather than buried in a schema decision.
