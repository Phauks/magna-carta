---
category: Added
audience: public
---

**A firm can set its own conflicts floor — the write path, and the screen over it.** The floor has
been a real setting since the matching engine shipped: `resolveScope` raises every narrower request
up to it, `readConflictsPolicy` serves it, and every check row records the value that was in force.
What it never had was a way to change it. `GET /api/v1/firm/conflicts-policy` served a value no route
could set, so a firm changed what its checks searched by writing the `conflicts.policy` row directly.

`PUT /api/v1/firm/conflicts-policy` closes it, on **`conflicts:configure`** — a new permission rather
than a reuse of `conflicts:run`, seeded to Owner and Admin alone. The three existing conflicts keys
all act on a check; this one does not. It decides what every LATER check searches, and no check row
records that a person chose it, which is why it is audited (`conflicts.policy.changed`, subject
`conflicts.policy`) and why the audit row is the only place the decision carries a name.

**What is stored is what runs.** The read has always repaired an unsound stored policy on its way out
— `party` unioned back into the floor, `current` back into the name roles, the candidate cap clamped
to what one atomic batch can carry. That is right for a value the platform did not write, and it
becomes a trap the moment a screen can write one: an administrator who deselected every source would
store `[]`, be shown `[]` on reload, and be reading a floor the platform would never run. So
`normalizeConflictsPolicy` was extracted from the read, the write normalizes through the same
function, and the **normalized value is what goes in the row**. `packages/conflicts/test/policy-write.test.ts`
asserts against the raw setting row rather than the read's answer, because a repairing read would
make a broken write look correct.

PUT rather than PATCH, for a reason that is about the domain rather than about REST: the floor is one
value, and a partial update would let two administrators saving different halves of one screen compose
a floor neither of them chose.

**Settings · Conflicts** is the surface. Draft mode throughout — instant apply would make a half-typed
cap ("5" on the way to "500") the firm's bound for as long as it took to finish the number. It renders
the response rather than its own request, and names each specific repair the platform made on the way
in instead of leaving an administrator to notice a control that moved on its own. Party and Current
render as locked controls carrying their reason rather than being hidden: a firm-wide invariant a
reader cannot see reads as an option somebody forgot to offer. `conflicts.matching-engine.strictness`
leaves `awaiting-screen`, and the depth node's traversal half does too.

## Public

**Your firm can now decide what every conflicts check has to cover.**

Under **Settings, Conflicts**, an owner or administrator sets the minimum every check searches,
whoever runs it. Somebody running a check can search wider; a narrower request is raised back up to
the floor before it runs, and the check records that this happened. Nobody can search below what your
firm requires. Until now these settings were real but unreachable — changing them meant editing your
firm's stored configuration directly.

You choose what a check searches, which band it must reach, which of a person's names the narrower
band compares — current, former, maiden, alias, and two more you can add — how far a check follows
each kind of relationship, and the two limits on how much any one check may do.

Two controls are shown but cannot be switched off, each saying why. Your party register is always
searched, because conflicts apply across your whole firm. And a person's current name is always
compared, because a check that skipped the name someone goes by today would not be a conflicts check.

Three things are worth knowing before you change it. **Changing the floor re-runs nothing** — no check
already on your record is altered or repeated; instead, any matter whose last check no longer covers
what you now require says so on its own Conflicts tab, worked out fresh each time it is read.
**Narrowing the floor reduces what your firm will look at from then on**, and no individual check
records that somebody chose that, which is why the change is kept in your firm's audit trail and
limited to owners and administrators. And **what you save is what you are shown**: if you ask for
something that cannot be stored as given, it is adjusted on save and the screen tells you exactly what
was adjusted.

Updated guide: [Conflicts reports](docs/user/features/conflicts-reports.md).
