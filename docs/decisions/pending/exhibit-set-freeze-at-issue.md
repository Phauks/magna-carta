---
slug: exhibit-set-freeze-at-issue
status: Proposed
area: Documents
date: 2026-08-11
summary: "An exhibit set has exactly two states. A DRAFT set is a plan: reorder it and every label recomputes and every citation follows. An ISSUED set is a record of an act that happened — filed, served, exchanged, or lodged — so at issue every member's label, title, and file version are materialized onto the row and frozen by a trigger, the set admits no new members and loses none, and its numbering can never be recomputed. Because the platform has no court e-filing integration and will not pretend to observe a filing, issuing is a recorded human assertion carrying a disposition and a date, and it is irreversible. The line is the calendar's correction-versus-continuance line transplanted: a CORRECTION means the row misdescribed what was actually filed (edit in place, audited, structurally unable to renumber because it composes no statement touching label or position), and a SUPERSESSION is the continuance (an amended filing is a NEW set, the old one preserved byte-untouched, one `supersedes_set_id` link held to a chain by a partial unique index so a fork is refused even under racing writes). An issued exhibit is never removed but WITHDRAWN, and its label is retired and never reused — two documents both correctly cited as Exhibit C is a collision no reader can resolve — so a continuing set starts past the retired label. Freezing on download or on PDF conversion was rejected: both punish drafting, and neither is what actually happened."
---

**Draw the freeze at issue, not at edit and not at export: a draft exhibit set is a plan whose labels
are computed, an issued set is a record of an act whose labels are stored and immutable, and the only
route from one issued set to a different numbering is a new set that supersedes it.**

**Context:** Once a document is filed with a court, its exhibit numbering is frozen. Reordering
exhibits afterwards cannot renumber a document already served on opposing counsel and sitting on a
docket — the filed copy is the authority, and a later document must refer to the exhibits as they were
numbered when filed. A design that lets a filed exhibit list silently renumber is wrong no matter how
elegant. The platform already draws a line of exactly this shape in the calendar, deliberately: a
correction is an edit because the row misdescribed reality, and a continuance is a new row because
both settings really happened and the old one is preserved with one typed link. Primary practice
confirms the consequence rather than softening it — where an amended pleading adds exhibits, the
existing A, B, and C keep their letters even where that leaves them cited out of order and the new
ones start at D — and exhibit lists in trial practice carry Withdrawn as a first-class status
precisely because a served label cannot be taken back. None of the litigation-support products
surveyed models the boundary at all; the freeze is a convention their users maintain by hand.

**Decision:** Two states, `draft` and `issued`. A draft set is edited freely and its labels are
computed from position on every read. Issuing materializes every member's `label`, `title_as_issued`,
and `file_version_id_as_issued` in one idempotent batch — resolving a floating exhibit to the file's
current clean version, so the platform can state which bytes went out rather than offering its word —
and hand-written raw-SQL triggers (the `matter_asset_valuation` and `custody_movement` idiom) then
refuse any `UPDATE` touching those columns or `position`, any `DELETE` of a member, and any move of
`state` out of `issued`. **Issuing is a recorded assertion by a member holding `exhibits:issue`,
carrying a disposition (`filed` / `served` / `exchanged` / `lodged`) and a civil date, and optionally
the file-stamped copy**, because there is no court e-filing integration on this platform or on the
roadmap and designing as though the platform could observe a filing is how a freeze silently fails to
happen. It is irreversible; a set issued in error is corrected the way an erroneous filing is
corrected in practice, by superseding it. A **correction** stays available and stays narrow: the row
misdescribed what was actually filed, so an issued member's recorded title or file may be fixed in
place under `exhibits:issue`, audited, and the service composes no statement touching `label` or
`position`, so it is structurally unable to renumber. A **supersession** is the continuance: a new set
carrying `supersedes_set_id`, the predecessor untouched, held to a chain by
`UNIQUE(supersedes_set_id) WHERE supersedes_set_id IS NOT NULL` with the predecessor side held by the
column, so a fork is refused even under racing writes. An issued member is **withdrawn** rather than
removed — status, date, and basis on the frozen row — and **its label is retired and never reused**,
by any later member of that set or by a set continuing from it, because two documents both correctly
cited as Exhibit C is a collision no reader can resolve. A withdrawn exhibit still resolves in an
in-text reference, with a warning, since a brief citing a withdrawn exhibit is a real thing a lawyer
sometimes means to write.

**Consequence:** `exhibit_set_member.label` is NULL while draft and the authority once issued, and a
source scan asserts that the issue batch is the only code path that writes it. The narrow correction
path and the withdrawal path exist precisely so the immutability can be total everywhere else. The
numbering scheme lives on the set rather than on the firm or the jurisdiction, because one matter runs
two schemes at once under the Eighth Judicial District Court's own rule and two departments of that
one courthouse currently direct incompatible ones — so the platform ships starter schemes as copyable
presets and never as live rules, the posture Custodian takes on will-deposit statutes and the calendar
takes on deadline computation, for the stated reason that a catalog which is ninety percent right gets
trusted because it was computed. `continues_from_set_id` starts a later set past the predecessor's
highest consumed ordinal, retired labels included, and the chain read is depth-capped as the
continuance chain is. Reordering a draft set is free, and the surface reads `exhibit_reference` before
committing to report which cited labels are about to move; an issued set never enters that path
because its members cannot move. Freezing on download and freezing on PDF conversion were both
rejected — they punish a paralegal for printing a draft, and neither event is the thing that happened
— and the interface owes only a prompt at export, not a state change. Owner flag E2 asks whether
irreversibility is too strict; E6 asks whether the narrow correction should exist at all.
