---
category: Added
audience: public
---

**A file's version history could not say who committed any of it.** The column has been on the row
since the baseline schema; `listCleanVersionsStatement` simply never selected it.

`FileVersionItem` and `FileSummary` gain `uploadedByUserId` and `uploadedByDisplayName`. Two
separately nullable fields rather than one object, because they are null for different reasons and
the difference is the point: the identifier is absent for a version no member produced (the repair
and carve path writes none), while the **name** is absent for a member the firm has since removed,
whose identifier the version still carries — `file_version.uploaded_by` is deliberately not a foreign
key, so the upload fact outlives the member row. One nullable object would erase exactly the
distinction the non-foreign-key decision exists to preserve.

The name is resolved in the same read (`LEFT JOIN member ON member.user_id = uploaded_by`, a
primary-key seek, no extra round trip) rather than left to the client, because no route maps a user
identifier to a display name — an identifier-only field would have been a field nothing could render.
The precedent is `BillingAuthorizedMember`, which embeds a name for the same reason: a ledger that can
say only that _somebody_ did this is not a ledger. The join is LEFT, and a test holds it there: an
inner join would make a removed member's uploads vanish from the history.

No migration. The erasure classification for the column landed separately and already reads
`pseudonymize-keep`.

## Public

**A document's version history now shows who filed each version.** Every version in a file's history
names the member who committed it. A version filed by someone who has since left the firm still shows
that the version has an author, even though their name is no longer on it.
