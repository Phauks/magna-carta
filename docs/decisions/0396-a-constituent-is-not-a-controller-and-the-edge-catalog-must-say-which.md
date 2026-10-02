---
number: 396
slug: a-constituent-is-not-a-controller-and-the-edge-catalog-must-say-which
status: Proposed
date: 2026-08-30
area: Directory
summary: "Every organizational membership — employment, a directorship, an officer post, a shareholding, a trusteeship — currently collapses into the single edge type affiliation, which the conflicts engine classes as control. So the traversal spends its control budget walking from an adverse corporation to a mailroom clerk with exactly the weight it spends walking to the chief executive. The class map is right and the catalog underneath it is too coarse to feed it. The fix is catalog granularity plus a fifth budgeted class, not a new membership table: directory_edge already is the n-ary object Popolo argues for, with its own id, role, note and validity period, and a second table would split the conflicts traversal across two corpora. Rule 4.2 comment 9 draws the line the classes need — a constituent who can bind or direct the organization is a different traversal risk from one who cannot. affiliation stays in the catalog and stays classed control, so nothing already recorded is reinterpreted, and the existing coverage test means a new type cannot land without a class beside it."
---

**A constituent is not a controller, and the edge catalog has to be able to say which.**

**Context:** `EDGE_TYPES` is seven values, and `packages/conflicts/src/edge-classes.ts` partitions
them into four classes with per-class hop budgets. That module's own opening argument is that one
integer cannot express "follow a corporate rename chain forever but do not walk from a spouse to her
employer's other directors", which is exactly right — and then every organizational membership arrives
as the single type `affiliation`, classed `control`.

The consequence is that the traversal spends its control budget walking from an adverse corporation to
a mailroom clerk with precisely the weight it spends walking to the chief executive. The class map is
sound; the catalog beneath it cannot feed it.

Model Rule 1.13 and Rule 4.2 comment [9] draw the line the classes need. An organization acts only
through its officers, directors, employees and shareholders, and those constituents are not the
lawyer's clients. Of them, the ones a lawyer may not contact are those who supervise, direct or
consult with the organization's lawyer about the matter, who have authority to obligate the
organization, or whose acts may be imputed to it. Binding authority is the discriminant, and it is a
property of the role.

**Decision:** the catalog grows and a fifth budgeted class joins the set. `officer_of`, `director_of`,
`partner_of`, `trustee_of`, `personal_representative_of` and `agent_of` are `control` — each can bind
or direct. `employment`, `member_of`, `shareholder_of` and `primary_contact_of` are a new
`constituent` class with a tighter budget — none can bind at ordinary holdings. `beneficiary_of` and
`guardian_of` are `family` — an interest and a capacity, not a control.

**No new table.** `directory_edge` already is the first-class n-ary membership object the Popolo model
argues for: it has its own id, a role, a note and a validity period, which is the whole reason
membership is not a bare foreign key. A `directory_membership` table would duplicate it and split the
conflicts traversal across two corpora, which is a defect rather than a feature. The defect here is
granularity, not shape.

**`affiliation` stays in the catalog and stays classed `control`.** Every row already recorded keeps
working and keeps its traversal weight; nothing is reinterpreted or quietly downgraded. It becomes the
legacy, unclassified-membership value, and the entry surface stops offering it.

The existing coverage test in `edge-classes.ts` fails when a catalog entry lands with no class beside
it, so this change cannot arrive half-done — the catalog addition and the classification are one
commit by construction rather than by care.

**Considered and rejected:** a `directory_membership` table (two corpora for one traversal); a
`control_level` column on the edge (the decision of what a relationship means already lives in the
class map, and a second home for it would drift); leaving `affiliation` and disambiguating on the
free-text `role` (unconstrained text is what the identifier catalog problem is made of, and the
conflicts traversal would have to parse prose to budget a hop); reclassifying `affiliation` to the new
`constituent` class (it would silently narrow the traversal over every relationship a firm has already
recorded, which is the one direction this engine must never be wrong in).

**Consequences:** the control budget stops being spent on rank-and-file employment hops, and the
Rule 4.2 constituent question becomes answerable against an organization. A firm records "member of"
because the owner asked for it, and it lands in a class that means something. The cost is twelve new
catalog entries and one new budget default a firm may need to tune.

**Build status, 2026-09-02:** the catalog half is built — `EDGE_TYPES` carries the membership family
and the record screen offers it, with `affiliation` kept for the rows already recorded and no longer
offered. The fifth budgeted class is **deferred to the owner's conflicts pass**, which will align
conflicts with intake: a new class needs its own default in settings, its own row in the recorded
scope and the check runner's budget field, and none of those is built. Until then every constituent
type is classed `control` in `packages/conflicts/src/edge-classes.ts`, the over-inclusive direction,
so no conflict the engine looked for before goes unlooked for; the class map's comment says so beside
the entries. The status stays Proposed for the class half.
