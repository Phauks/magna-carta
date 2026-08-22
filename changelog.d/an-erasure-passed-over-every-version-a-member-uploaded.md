---
category: Fixed
audience: internal
---

**`file_version.uploaded_by` was classified as containing no personal data, so erasing a member left
their name on every document version they had ever committed.**

The column has existed since the baseline schema and is deliberately not a foreign key — the upload
fact is meant to outlive the member row, so nothing cascades when an account is removed. That is the
correct shape for chain of custody and exactly the shape that needs an erasure rule. It had none: the
table sat in the registry's no-personal-data list under a note enumerating the object key, the hashes
and the status, which simply did not mention the uploader.

Three tables already carry the identical shape and the identical answer — the billing record's
timekeeper, the audit log's actor, the conflicts check's actor — all `pseudonymize-keep`. This is now
the fourth. Pseudonymize rather than delete, for the reason the append-only tables do: that somebody
committed this version at this time is a fact a firm can be asked to account for, and removing the
row would break the version lineage the current-version pointer walks.

Found while specifying a version-history surface that wanted to show who uploaded what. The wire
field is a separate question; the erasure gap was true with or without it.
