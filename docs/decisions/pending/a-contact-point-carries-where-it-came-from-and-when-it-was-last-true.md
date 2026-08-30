---
slug: a-contact-point-carries-where-it-came-from-and-when-it-was-last-true
status: Proposed
area: Directory
date: 2026-08-30
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
`verified_at`, and `verified_by`.

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

**Consequences:** a firm can show which addresses were confirmed, by whom and when, and can produce
that list for a diligence affidavit. A send path can be asked to warn on or refuse a `failed` channel
— which of the three it does is an open question, because refusing is safer and will occasionally be
wrong about a temporary bounce. The cost is twenty new columns across four tables and one more
decision at every contact entry, mitigated by a default source the entering surface can supply.
