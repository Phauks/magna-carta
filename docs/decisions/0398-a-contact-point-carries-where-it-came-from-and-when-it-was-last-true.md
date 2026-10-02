---
number: 398
slug: a-contact-point-carries-where-it-came-from-and-when-it-was-last-true
status: Accepted — the verification half is built, the source half is deferred
date: 2026-08-30
area: Directory
summary: "Nothing records where an address came from or when it was last confirmed, and courts require proof of diligence before permitting substituted service — verification of a last-known address against postal forwarding records being the ordinary first step. Five columns go on every contact point and every identifier: a source on a closed catalog, a free-text source detail, a verification status of unverified, verified or failed, and who verified it when. The status that does the most work is failed, because returned mail, a bounced message and a disconnected line are the facts an affidavit of diligence turns on and there is nowhere to put any of them today. The columns go on the row rather than in a polymorphic side table keyed on table-and-id, because that would turn every contact read into a join and last-confirmed is exactly the fact a list renders inline; five columns on four tables is more DDL and less code, and the DDL is paid once."
---

**A contact point carries where it came from and when it was last true.**

**Context:** `directory_email`, `directory_phone`, `directory_address` and `directory_identifier`
record a value and a validity period and nothing else. An address entered three years ago from a
client's intake form is indistinguishable from one confirmed last week against a public record, and a
letter returned undelivered leaves no trace anywhere.

This matters most where it is least recoverable. Courts require proof of diligence before permitting
substituted service, and the ordinary first step is verifying the last-known address against current
postal forwarding records. An address record that cannot say where it came from or when it was last
confirmed cannot support the affidavit that rests on it.

**Decision:** five columns, the same five, on all four tables — `source` (client stated, intake form,
court filing, opposing counsel, public record, correspondence, third-party service, firm staff,
imported), `source_detail`, `verification_status` (unverified by default, verified, failed),
`verified_at`, and `verified_by` — plus `verification_detail`, which carries what a failure actually
said. The four verification columns ship with the contact work; the two source columns are deferred
(see the consequences below).

**`failed` is the column that earns the change.** Returned mail, a bounced message, a disconnected
line: the three facts a firm most needs to have recorded and the three it has nowhere to record. A row
with no source is honestly unsourced rather than falsely trusted, which is why `unverified` is the
default and why nothing existing changes meaning when the columns land.

**On the row, not in a side table.** A polymorphic `directory_contact_provenance` keyed on (table, id)
would turn every contact read into a join, and "last confirmed" is precisely the fact a contact list
renders inline beside the value. Five columns across four tables is more DDL and less code, and the
DDL is paid once while the join would be paid on every read forever.

**Considered and rejected:** the polymorphic side table; a single free-text note (unqueryable, and a
probe cannot report how much of the corpus is unverified); deriving verification from the audit log
(the audit log records that a member edited a row, not that a member confirmed a fact with a third
party, and conflating them would let an incidental edit read as a verification); a boolean `verified`
(it cannot express a failure, which is the state that matters most).

**The owner settled what a failure does, and it is not a gate.** "Failed address verification doesn't
block a send but we notify users." So a `failed` status is recorded, is surfaced to the member who is
about to send, and the send proceeds. The reasoning holds in both directions: a bounce or a returned
envelope is frequently temporary, and a platform that refuses on a stale failure teaches its users
that its warnings are noise — at which point the warning that mattered goes unread too. The place a
failure earns its keep is the affidavit of diligence and the moment before the post, not a refusal.

**What was built, and what was not.** The four verification columns — `verification_status`,
`verified_at`, `verified_by`, `verification_detail` — landed on all three contact tables with the
contact work, because they are what the owner's ruling needs to be true. `verification_detail` carries
what the failure said in the words it said it, which is the sentence an affidavit quotes.
`verified_at` and `verified_by` move only when the status itself moves, so an unrelated edit to a row
can never read back later as a confirmation the firm never made.

`source` and `source_detail` are **deferred**. They are the diligence half of this decision rather
than the send half, they change nothing about what a firm can record today, and the entry surface that
would supply a sensible default for them is the intake form rather than the contact pane. They land
with the provenance pass, on tables that are by then in use. `directory_identifier` gains none of the
four yet: sealing a value and confirming it are different acts, and the identifier surface has no
verification gesture to hang them on.

**Consequences:** a firm can show which addresses were confirmed and when, can quote what a carrier
said when one came back, and is warned rather than blocked at the moment it matters. The cost is four
new columns across three tables and one more thing a contact entry can say.
