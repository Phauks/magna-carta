---
number: 336
slug: a-prospect-is-a-directory-entity-and-an-unnumbered-matter
status: Proposed
date: 2026-08-15
area: Client intake
summary: "A prospect is not a record — it is a reading of two records the platform already has: a Directory entity, and a matter that has not drawn a number. No prospect table, no prospect status, no prospect category. The Directory placement is forced rather than chosen, because the conflicts engine's four blocking channels are Directory tables and there is no narrower home a prospect could occupy and still be checkable from first contact. The distinction between a prospect and a client is carried by the absent matter number, which is structural rather than a status column: the number is the join every money subsystem reaches a matter through, so a prospective matter has no invoice, holds no trust money and carries no portal grant — not because a permission check refuses it, but because there is nothing to join on. What a prospect can therefore do to the rest of the platform is exactly one thing: join the conflicts corpus, permanently."
---

**A prospect is a Directory entity plus an unnumbered matter, and the platform holds no third record
that means "prospect".**

**Context:** intake needed to say what a prospect is before it could say anything else, and the
obvious shapes — a prospect table, a `prospect` status, a `prospect` Directory category — all put the
person somewhere narrower than the Directory. The conflicts engine settles it: `runConflictsCheck`
takes `subjectEntityIds` and reads `directory_person` / `directory_organization`, and its four
blocking channels are phonetic codes, an FTS5 trigram index, blind-index identifiers and typed edges,
every one of them a Directory table. A prospect stored anywhere else is invisible to the engine, and
the requirement that a prospect be conflict-checkable from first contact is not negotiable.

**Decision:** the two records are the same two a client has. The prospective client is an ordinary
Directory entity — same tables, same corpus, same merge and search behaviour — and the engagement
that has not been agreed is a matter at `status = 'prospective'`, unnumbered, surfaced only in the
per-attorney Consultations view. "Prospect" is a reading of those two rows together.

The structural carrier of the distinction is the **absent matter number**, not the status column.
That is a consequence of drawing the number at open rather than at prospective creation, and the
consequence is stronger than the decision that produced it: the matter number is the join every money
subsystem reaches a matter through, so a prospective matter cannot be invoiced, cannot hold trust
money, and cannot carry a client portal grant. None of that is enforced by a check somebody
remembered to write; it is a property of the graph. A `prospect` boolean would have had to be
defended in every one of those subsystems separately, forever.

A `prospect` Directory category is rejected for a second reason: a category is a per-firm
classification label, so a firm could rename or delete it, and a structural distinction that a firm
can rename is not one.

**Considered and rejected:** a dedicated prospect or lead store (invisible to the matching channels,
and a second identity to reconcile at conversion — the failure already refused once for firm
personnel); a `prospect` status on the matter beside `prospective` (two words for one state); a
`prospect` Directory category (a renameable label carrying a structural fact); a `prospect` flag on
the Directory entity (the entity is the same entity before and after retention — flagging it would
mean a write at conversion on a row whose whole value is that it does not change).

**Consequences:** intake creates no new identity, and the conflicts corpus is complete from first
contact by construction. A declined prospective client's parties stay in the corpus forever, which is
the retention posture the matter lifecycle already fixed and the reason the information is worth
keeping. The cost is that a prospect is as permanent as a client, which is exactly why nothing
anonymous may create one.
