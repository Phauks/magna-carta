---
category: Changed
audience: internal
---

The matter's section strip is grouped, the header's overflow (`...`) control and the Other section
are gone, and Magnus takes a section.

The control held exactly one item — the status's lifecycle action, shipped disabled and marked Soon
— so a member had to open it to discover there was nothing in it to press. That is a control's width
of chrome returning nothing, and it also quietly broke the standing rule it was built to honour: a
designed-but-unwired capability ships VISIBLE, and a seam in a drawer is not visible. The lifecycle
action comes back as a named control on the row when it is wired. Until then the band carries no
actions at all, and its inline-end column is the section strip and nothing else.

The Other section leaves both the registry and the route tree. It was the only tab whose label named
no place: it stood for whatever the other thirteen
did not cover, which is a bin rather than a destination, and its stub had to be written in the
abstract because nothing concrete was ever going to land there first. Content with no home yet waits
for the section that will own it.

In its place, **Magnus gets a matter section** — a `soon` stub for now, at the head of the non-core
group so it is visible on a wide canvas and the last of that group to fold. The assistant reads a
matter rather than recording anything on it, so it does not hold a core record section's width; it
now has both of the homes it was always going to need, the always-reachable sidebar destination and
the conversation already scoped to one matter.

**The strip stopped folding by measurement and started grouping by meaning.** Fourteen sections fit
no canvas: at 1440 the measured fold left seven on the row and put the other seven behind More, and
which seven was decided by pixel arithmetic — Trust and Calendar were buried for sitting late in a
list, not for being less used. The row now carries six entries, four of them sections and two — three,
counting People — named neighbourhoods that open a menu:

**Overview · Files · Money ⌄ · Record ⌄ · People ⌄ · Magnus**

Money is Time, Fees, Costs, Billing and Trust; Record is Notes, Emails, Messaging and Custodian;
People is Parties and Calendar. Measured after building, the whole strip holds the row down to a
1360 canvas. The measured fold stays underneath as a backstop for anything narrower, and an entry
that reaches it folds as a GROUP — its name becomes a menu heading over its own sections, so the two
routes to one destination never disagree about what it belongs to.

`sections.ts` now carries two lists with one home: every section that exists, and the arrangement
the strip reads them in, declared by slug. A section nobody placed, a slug naming no section, a
section placed twice, and a group of one are all module-load failures, so the strip cannot silently
stop offering a section that exists. The `core` flag is gone with the flat strip that used it.

All three generalizations are in `docs/conventions/design-corrections.md`, and the Record Detail
archetype carries the grouping rule and no longer lists a `⋯` in its header.
