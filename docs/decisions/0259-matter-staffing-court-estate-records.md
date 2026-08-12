---
number: 259
slug: matter-staffing-court-estate-records
status: Accepted
date: 2026-08-07
area: Matters / Document automation
summary: "The three H1 platform records land as the Matters area's own tables with the merge-field catalog as one consumer: matter_assignment carries staffing beyond the responsible attorney (whose one home stays matter.responsible_member_id — the write path refuses an assignment role that normalizes to it), matter_court_case carries the case identity with the court as a Directory organisation and the judge as a Directory person (resolving the catalog design's open question in favour of Directory references, so a court's address and a judge's name formats are recorded once), and matter_estate carries the estate identity with STORED styles (a court-fixed designation is never composed), the decedent as a Directory person, and the estate's own optional Directory organisation as the home of its encrypted tax identifier. matter_party gains a nullable capacity column — a fact about the link, never inferred. A member's professional profile is one whole-record upsert keyed by the member's own user id; the bar number is deliberately NOT a profile column and lives encrypted in directory_identifier on the member's mapped Directory person, read only through the protected-field chokepoint (bar_number joins the identifier-type catalog, never standalone-indexed). One deliberate deferral: the member's self-maintenance door for the profile, because the chokepoint structurally refuses authenticated permission-null mutations and the platform has no self-scoped mutation concept anywhere — the profile is written through firm:manageMembers until the Members area designs self-service writes."
---

**Matter staffing, the court case, and the estate become the Matters area's platform records, with Directory references for every person and organisation they name.**

**Context:** Owner flag H1 ratified platform tables for the facts every firm in the practice area
records — staffing, court/case identity, estate identity — over per-firm custom fields, unblocking
the merge-field catalog's remaining platform subjects. The catalog design left two shapes to their
owning areas: whether a court is a Directory organisation, and the staffing table's columns.

**Decision:** All three land as designed, with the Directory as the reference model throughout.
(1) `matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to)` —
free-text roles matched by the letters-and-digits rule `matter_party.role` already uses, so a
recorded role resolves as a document's staffing subject with no mapping table. The responsible
attorney stays on `matter.responsible_member_id` — one home per fact — and the write path refuses an
assignment role that normalizes to it. (2) `matter_court_case` — one live record per matter (partial
unique index), the court a `directory_organization` reference and the judge a `directory_person`
reference, plus the case number, division, department, filing date, and the two caption designation
words. Side is a caption fact recorded here, never a key axis. (3) `matter_estate` — one live record
per matter; the styles are STORED, never composed; the decedent is a Directory person so every name
rendering applies; the estate's own optional Directory organisation is where its tax identifier
lives through the ordinary encrypted-identifier machinery, never a ciphertext column on this table.
(4) `matter_party.capacity` — nullable free text on the link, recorded by the firm and never
inferred. (5) `member_professional_profile` — whole-record upsert keyed by the member's user id;
admissions are running prose; the bar number is a sensitive identifier on the member's mapped
Directory person (`bar_number` joins the identifier-type catalog, protected and never
standalone-indexed — a short state-scoped integer would leak its distribution).

**Consequences:** Caseload views, billing attribution, conflicts imputation, and docketing read the
same staffing and court rows the document engine reads. All five tables are classified in the
personally-identifiable-information registry. **One deferral:** the member's own profile-maintenance
door — the chokepoint refuses an authenticated mutation with a null permission (privilege escalation
by omission) and no self-scoped mutation exists anywhere on the platform (the per-member analytics
opt-out sits in the same gap), so the profile is written through `firm:manageMembers` until the
Members area designs self-service writes; the record and schema are ready for that door unchanged.
