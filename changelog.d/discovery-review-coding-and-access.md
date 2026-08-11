### Added

- **Discovery — review coding, and the per-review-set access list.** A reviewer can now code documents
  in a review set against a coding panel of ordered questions and answers, and a firm can say who may
  reach a corpus at all.
  - **The coding panel.** Every review set is seeded with three questions — Responsiveness, Privilege
    and Confidentiality — and a firm adds its own issue codes beside them. A question is single-choice
    (a radio row) or multi-choice (a flag set), and the single-choice rule is enforced by the database
    rather than the surface, so a document can never end up coded two contradictory ways. Renaming
    anything is free: production and privilege logging resolve through a tag's recorded meaning and
    never through its name.
  - **Coding, with the history a challenge is answered from.** Tags apply to one document, to a whole
    family, or across a named selection. Every application and removal is a row that is never deleted —
    removal is a state with an actor and an instant — and every gesture is one entry in a history that
    records who coded what, when, one document at a time or in bulk, under what criteria, and who
    reversed it. A bulk operation freezes its selection before it writes anything, so it cannot drift
    onto documents the person who started it never saw. Undo is exact: it takes back precisely the rows
    one act wrote, leaves a tag somebody applied independently alone, and never shortens the history.
  - **Progress and two quality-control reads.** How many documents are coded, how many carry each tag,
    which are still uncoded, and which families are split across the produce/withhold line — the last
    computed from the coding rather than stored, because a stored flag about two documents goes stale
    the moment either is re-coded, and that is how a privileged document rides a family into a
    production.
  - **The access list.** Reaching a review set no longer follows from reaching its matter. Each review
    set carries its own list of members, checked beside the permission on every read and write;
    material another party produced may be attorney's-eyes-only under a protective order, and an
    attorneys'-eyes-only production is a review set whose list is two people. A corpus a member is not
    listed on is absent to them rather than refused — no rows, no counts, and nothing naming it. The
    list is fail-closed and never reaches empty: the last member cannot be removed.
  - Two new discovery permissions, `discovery:review` (coding) and `discovery:produce` (managing the
    access list, and later staging and cutting productions), seeded to the same seats the existing
    three reach and to neither Billing nor Read-only.

### Changed

- **Creating a review set now seeds its access list and its coding panel in the same write.** The list
  starts with the member creating it, and widening it is a recorded act somebody performs on purpose.
- **Review sets that already existed keep their creator on the list.** The migration adds one access
  row per existing review set, for the member who created it. Anyone else who was reviewing one will
  need to be added back — deliberately, since inferring who was cleared for a corpus from who happened
  to be staffed on the matter would assert something nobody decided.
