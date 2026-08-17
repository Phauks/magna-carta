---
number: 350
slug: the-matter-team-is-the-assignment-table-plus-the-responsible-member
status: Proposed
date: 2026-08-15
area: Notifications
summary: "The matter-team notification audience resolves to the matter's responsible member unioned with every member holding a currently-valid matter_assignment row, in one clamped statement, and no longer substitutes to the responsible member alone. The responsible member is an unconditional arm of that read rather than an assignment lookup, because matter.responsible_member_id is that fact's one home and the assignment write path refuses a role that normalizes to it — the attorney who owns the file is structurally incapable of appearing in the assignment table, so resolving the team from assignments alone would omit exactly the person most entitled to hear. That is also what settles the unstaffed-matter case: a matter with no assignments resolves to its responsible member rather than to nobody, because a team of one is a correct answer where an empty one silently drops a critical notice such as a quarantined file. The two arms filter membership differently on purpose: the responsible arm is byte-for-byte the responsible-member resolver's read so the two audiences cannot disagree about the same person, while the assignment arm additionally requires an active member, because an assignment row outlives a member's departure by design and this audience reaches email where a deactivated member's feed does not. The validity window is read exactly as the document-assembly staffing read reads it — a creation bound is a civil date inclusive of its whole day, an end-assignment bound is the ending instant and exclusive — so an assignment that staffs a document also staffs its notifications rather than the platform carrying two answers to who is on a matter. substituted now reports false for this audience and no registered type declares audienceSubstitutedFrom; the field and its counter stay for the next audience that needs them, with a fitness test holding today's emptiness to being deliberate."
---

**The people working a matter are the responsible member plus the matter's live assignments, and the
audience that meant that now resolves it.**

**Context:** the notifications delivery slice declared a `matter-team` audience and could not resolve
it — its resolver narrowed to the responsible member and set `substituted: true` on the stated
grounds that no per-matter team table existed. That was true when written. `matter_assignment`
shipped two merges later carrying matter id, member user id, an assignment role and a
`valid_from`/`valid_to` interval, and the `audienceSubstitutedFrom` field existed precisely so the
day it landed would be a one-resolver change. Three registered types declare this audience, all of
them document events on a matter, and all three were quietly reaching one person.

**Decision:** `matter-team` resolves in one statement to the union of `matter.responsible_member_id`
and the `matter_assignment` rows valid at the pass's own instant whose member is active, ordered and
clamped at the fan-out ceiling the way the capability resolver is. `substituted` is `false`.

**Why the responsible member is unconditional.** The assignment write path refuses a role that
normalizes to `responsibleAttorney`, because `matter.responsible_member_id` is that fact's one home.
So the person who owns the file cannot appear in the assignment table at all, and a resolver reading
assignments alone would omit the one member most entitled to hear. The document-assembly staffing
read already unions the same two arms for the same reason; a second shape here would mean the
platform holding two answers to "who is on this matter".

**Why an unstaffed matter resolves to one person rather than to nobody.** Returning nobody is
arguably the more honest report of an empty assignment table, but the assignment table is not what
the audience is asking about — the team of a matter nobody else is staffed on is its responsible
member, and that is a complete answer rather than a narrowed one. The failure modes are not
symmetric: the three types on this audience include a quarantined file and a re-scan that found
malware, and the empty answer silently drops those on exactly the matters nobody has staffed yet.
Because it is the correct resolution and not a stand-in, it reports `substituted: false`.

**Why the two arms filter membership differently.** The responsible arm is byte-for-byte the
`responsible-member` resolver's read, so the two audiences can never disagree about the same person.
The assignment arm additionally requires `member.status = 'active'`, because staffing history is a
matter record and an assignment ends only by an explicit act — a departed member's still-open
assignment is the ordinary case, not the exception — and this audience reaches email, which a
deactivated member's feed does not. Widening a recipient list is a disclosure, and a former employee
receiving a firm's matter mail is the disclosure this arm actually risks.

**Widening was checked against what the three types carry.** All three are matter-anchored document
events; two declare no facts at all and the third declares one identifier (`divergedFrom`). No title,
filename, client name, or reason string travels, the email content is a category count, and the deep
link is resolved through the File Manager's own access-checked read. Nothing any of them carries is
narrower than a member staffed on the matter is entitled to see, so all three widen safely.

**Considered and rejected:** **assignments only** — omits the responsible attorney by construction.
**Falling back to the responsible member only when there are no assignments** — the same result on an
unstaffed matter, but it makes the responsible member's presence depend on whether somebody else was
staffed, which is a rule nobody could predict from the outside. **Returning nobody on an unstaffed
matter** — honest about the table and wrong about the question, and it loses a malware notice. **A
second validity convention** — an assignment that staffs a document and not its notifications is a
bug nobody would find. **Filtering the responsible arm on `member.status` too** — defensible, but it
would silently change the `responsible-member` audience's meaning for every other type, which is a
separate decision and not this one's to take.

**Consequences:** three document notification types now reach a matter's staffed team. The
`audienceSubstitutedFrom` field and the translator's `substitutedAudiences` counter survive with no
declared user; a fitness test asserts no type declares a substitution, so re-introducing one is a
deliberate edit rather than a line that slips into a declaration.
