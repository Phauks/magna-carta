---
slice: Navigation — the rail's information architecture, sub-menu clusters, tools as top-level abilities, and favorites
group: cross-cutting
order: 44
research: n/a
spec: n/a
plan: n/a
built: done
ui: done
load-profile: n/a
tested: done
branch: claude/hopeful-cannon-tsrczb
active-work: docs/active-work/claude/hopeful-cannon-tsrczb.md
next: carrying a member's favorites and sidebar arrangement across their devices, which waits on the member-preferences store; a matter's own section rows as a cluster, now that the mechanism exists
link-spec:
link-plan:
adrs:
blocked-by:
---

The owner's navigation round of 2026-09-16, worked end to end.

**The rail was one long list with a heading on it.** Workspace held fourteen rows, from Home to
Custodian, which put "your morning" in the same list as "the firm's evidence". It is five groups now,
each answering one question: **Favorites** (the member's own shortcuts), **My Desk** (what is on MY
plate — the day, the alerts, the tasks, the diary, the assistant), **Workspace** (the firm's work,
which is matters and everything hanging off one), **Money**, **Firm**, **Tools**.

**The Tools area is gone, and the tools are not.** A tool was reached through a two-sided /tools
screen until a fortnight ago and through a /tools index after that; both are retired. Every tool is a
top-level ability now — its own address at `/<id>`, its own rail row, one press from wherever the
reader is, the whole canvas when it opens. The index's two worthwhile parts, the descriptors and the
search, were never the index's: they belong to the presentation layer, and the command palette has
rendered them all along from one keystroke with no navigation first.

**Nine rows under one heading is a wall, so the rail grew a second level.** A CLUSTER is a row with a
glyph, a name and a chevron whose members tuck beneath it — `Sidebar.MenuTrigger` and
`Sidebar.MenuSub` in the design system, `navigation/clusters.ts` as the registry. It is a fold and
never a screen: nothing is reached through one, which is the whole difference between this and the
sub-page it replaced. A cluster holding one row is seated as a plain row, because a chevron hiding
one thing costs a press and saves nothing. The mechanism is general — any group may fold — and the
eight catalog subject groups became four on the same ruling: Records, Internet, Mailing, Files. Eight
headings over nine tools is a heading per tool. Within a cluster the tools sort alphabetically, which
is how somebody with a name in mind actually scans.

**Two rows changed sides.** The File Workbench went back into the catalog, in the Files cluster — it
had been promoted to a hand-written Firm destination precisely because the old area charged a
navigation to reach it, and that reason is gone. **Firm Usage** went the other way, out of the
catalog and into Firm beside Reports: a tool is a utility a member RUNS, and this runs nothing; it is
the firm reading its own records. It kept the `tools:firmUsage` key that gates it, which is what
`Destination.permission` is for.

**One symbol had been answering two questions.** Customize's star meant "show this row"; it is an
**eye** now, which is the plain word for visible-here. The star means what a star means everywhere
else: a **favorite**. A favorite is any address at all — a matter, a tool, a client's record, a
section deep inside one — saved by the person standing on it, because the platform cannot know which
of ten thousand matters somebody opens every morning. The gesture reaches every page without a single
screen opting in, because it lives in the one header component every screen builds its title from.
Favorites lead the rail; a favorite is keyed by pathname, borrows its glyph from the area it sits in,
and is dragged into the order the member wants like any other row.

**Three defects the owner reported in the same breath.** The drag-to-reorder stutter was three
stacked faults: the slot size was measured off a row's height and rows have a gap between them, so
every slot was short; `Math.round` flipped the landing index at exactly half a row, which is where a
hand rests while it decides; and every pointer event wrote state, several times per frame. It
measures the real pitch from two rows, the landing index is sticky with a dead band either side, and
the offset is coalesced to one write per frame. The rows carry a **grip** now, because the grab
cursor only answers once the pointer is already on the row. And the Soon badge on an unbuilt tool was
invisible: it rode inside the label, which carries the row's overflow, so every long row clipped it —
the row is a three-track grid now and the trailing column never shrinks.
