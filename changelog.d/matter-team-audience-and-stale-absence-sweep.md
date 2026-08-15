---
category: Fixed
audience: internal
---

**Three notification types stopped reaching one person, and the class of comment that let that happen
was swept by hand.**

**The `matter-team` audience resolves against `matter_assignment`.** The resolver narrowed to the
matter's responsible member on the stated grounds that no per-matter team table existed — true when
written, false two merges later. It now reads the responsible member unioned with every member
holding an assignment valid at the pass's own instant, in one statement, deduplicated and clamped in
SQL at the fan-out ceiling. The responsible member is an unconditional arm rather than an assignment
lookup, because the assignment write path refuses a role that normalizes to `responsibleAttorney` —
so a matter with no assignments resolves to that one member rather than to nobody, and reports
`substituted: false`, because a team of one is a correct answer and not a narrowed one. The
assignment arm additionally requires an active member, since staffing history outlives a departure by
design and this audience reaches email. The validity window is read exactly as the document-assembly
staffing read reads it, so an assignment that staffs a document also staffs its notifications.
Widening was checked against content first: all three affected types are matter-anchored document
events carrying no free text, at most one identifier, and a count-only email. No registered type
declares `audienceSubstitutedFrom` any more, and a fitness test now asserts that emptiness rather than
asserting the substitution. Decision recorded as
`the-matter-team-is-the-assignment-table-plus-the-responsible-member`.

**A hand sweep of absence comments, deliberately not a linter.** That comment was true when written,
false two merges later, and nothing could have caught it; the equivalent problem in the ledger's
evidence prose was measured last week and found unrulable. So this was one pass by hand over every
comment in the tracked source asserting that something does not exist. Most were still true — that is
the point of doing it by hand. Ten were not, and they are corrected where they live: the
`matter_asset_valuation.encumbrance_id` seam had been waiting for a table that has since landed and
that the column's own readers already filter on; the file-manager meter telemetry port claimed the
telemetry package had not landed when it has, and now says plainly that nothing implements the port
and no meter trend point is written; the email-filing and custodian notification seams claimed to be
waiting for a subsystem that has shipped, and now name what actually stands between them and a
delivery; the accordion deferred its height animation on a motion gate that now exists; the tools
listing claimed no tool had a page when two do; the assemble scaffold claimed there was no assembly
API when the submit and poll routes exist; and three worker test fixtures granted a permission the
baseline migration already seeds while explaining that the seeding migration had not landed.
